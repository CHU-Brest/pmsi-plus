// Listes de la fonction groupage SMR — deux sections de recherche
// indépendantes, sur le modèle du thème MCO : les listes de diagnostics des
// tests d'entrée dans les GN (Manuel des GME, volume 1, 2.2.2), puis les
// listes d'actes spécialisés (3.2). L'adresse #/smr/groupage/<recherche>
// pré-remplit la première (« #/smr/groupage/D-0112 ») ; la saisie l'y
// reporte, pour qu'une recherche se partage ou se signale telle quelle.
//
// Le tableau partagé (interface.js) n'affiche que du texte : ses `formats`
// mettent une valeur en forme, ils ne font pas de lien. Le lien vers la
// fiche des codes trouvés est donc donné à part, sous la barre de
// recherche, dès que la recherche n'en rend que quelques-uns.

import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats, nombre } from "../interface.js";
import { chargerActesSpe, chargerClassification, chargerDiagnostics, cle, graphie, libelleGroupe } from "../smr.js";
import { lienArbre, lienCode, sourceFg } from "../smr_interface.js";

// Au-delà, une ligne de liens serait plus longue que le tableau qu'elle
// accompagne : la recherche est trop large pour qu'on vise un code.
const LIENS_FICHES_MAX = 12;

// Colonne GN des listes que n'emploie aucun test d'entrée (D-9001, D-9090).
const SANS_GN = "Aucun";

// Numéros de GN séparés d'une espace, sans virgule : le tableau partagé
// dimensionne une colonne d'identifiants sur sa valeur la plus longue tant
// qu'aucune ne passe 20 caractères, et sur la longueur moyenne au-delà. Les
// quatre GN de D-0831 font 19 caractères ainsi, 22 avec des virgules : la
// colonne se serait alors réglée sur la moyenne (un seul GN) et tronquée
// jusqu'au numéro seul (« 0… »).
const SEPARATEUR_GN = " ";

// ==== Listes de diagnostics ====

// « GN » est volontairement hors de l'index, comme « CMD » en MCO : les
// listes portent le plus souvent le numéro du GN qu'elles ouvrent (D-0103,
// GN 0103), et une liste peut servir à un GN voisin (D-0830 entre dans les
// tests du GN 0831) — chercher « 0831 » ramènerait alors D-0830 à côté de
// D-0831. La colonne reste affichée et triable ; une saisie qui est un
// numéro de GN renvoie à l'algorithme (cf. indicationGnDiagnostics).
const COLONNES_DIAGNOSTICS = ["Liste", "Libellé liste", "Code", "Libellé code"];

/** Liste → GN dont un test d'entrée l'emploie, triés. Gardé sur la
 *  classification, partagée par les thèmes SMR : le nom est préfixé pour
 *  ne pas croiser l'index d'un autre thème. */
function gnParListe(k) {
  if (!k._groupageGnParListe) {
    const m = new Map();
    for (const noeud of k.tests) {
      for (const test of noeud.tests) {
        if (!m.has(test.liste)) m.set(test.liste, new Set());
        m.get(test.liste).add(noeud.gn);
      }
    }
    k._groupageGnParListe = new Map([...m].map(([liste, gns]) => [liste, [...gns].sort()]));
  }
  return k._groupageGnParListe;
}

/** Une ligne par code et par liste, listes dans l'ordre de leur numéro et
 *  codes dans celui de CIM_infos_SMR. Construite et indexée une fois par
 *  jeu chargé (près de 13 000 lignes tirées de 43 000 codes), jamais à la frappe. */
function lignesDiagnostics(diagnostics, k) {
  if (!diagnostics._groupageLignes) {
    const gns = gnParListe(k);
    const parListe = new Map();
    for (const d of diagnostics.lignes) {
      for (const liste of d.Listes) {
        if (!parListe.has(liste)) parListe.set(liste, []);
        parListe.get(liste).push(d);
      }
    }
    const lignes = [];
    for (const liste of [...parListe.keys()].sort()) {
      const gn = gns.get(liste)?.join(SEPARATEUR_GN) ?? SANS_GN;
      const libelle = k.listes[liste] ?? "";
      for (const d of parListe.get(liste)) {
        lignes.push({ Liste: `D-${liste}`, "Libellé liste": libelle, GN: gn, Code: d.Code, "Libellé code": d["Libellé"] });
      }
    }
    recherche.indexer(lignes, COLONNES_DIAGNOSTICS);
    diagnostics._groupageLignes = lignes;
  }
  return diagnostics._groupageLignes;
}

/** Saisie réécrite mot à mot dans la graphie de l'index : un code sans
 *  point (« i634 ») prend le sien (« I63.4 »), un numéro de liste sans
 *  tiret (« D0112 ») le sien (« D-0112 ») — sauf s'il est lui-même un
 *  code. On n'indexe pas plutôt la clef sans point : « 0112 » y trouverait
 *  F01.12, et un numéro de liste ou de GN ne se chercherait plus. */
function corrigerDiagnostics(diagnostics, requete) {
  return requete
    .split(/\s+/)
    .map((mot) => {
      if (/^d-?\d{4}$/i.test(mot) && !diagnostics._parCle.has(cle(mot))) return `D-${mot.slice(-4)}`;
      if (/^[a-z]\d{2}[0-9+]+$/i.test(mot)) return graphie(mot);
      return mot;
    })
    .join(" ");
}

/** Un numéro de GN saisi : la colonne GN n'est pas cherchée, on dit où
 *  trouver les tests de ce GN plutôt que de laisser « aucun résultat »
 *  sans explication. */
function indicationGnDiagnostics(k, requete) {
  const gn = requete.trim();
  if (!/^\d{4}$/.test(gn) || !k.groupes.GN[gn]) return null;
  return el(
    "p",
    { class: "message-info" },
    `GN ${gn}, ${libelleGroupe(k, gn)} : la recherche porte sur les listes et les codes, pas sur la colonne GN. Les tests d'entrée dans ce GN, et les listes qu'ils emploient, sont dans `,
    el("a", { class: "lien-texte", href: lienArbre(gn) }, "l'algorithme de la fonction groupage"),
    "."
  );
}

/** Ce que montre la section, et les listes que n'emploie aucun test
 *  d'entrée en GN (D-9001, D-9090), lues dans les données plutôt
 *  qu'écrites en dur. */
function explicationDiagnostics(k) {
  const gns = gnParListe(k);
  const sans = Object.keys(k.listes)
    .filter((liste) => !gns.has(liste))
    .sort()
    .map((liste) => `D-${liste} (${k.listes[liste] || "sans libellé"})`);
  const enClair = sans.length > 1 ? `${sans.slice(0, -1).join(", ")} et ${sans.at(-1)}` : sans[0];
  return el(
    "p",
    {},
    "Une ligne par code et par liste ; un code qui n'entre dans aucune liste n'y figure pas. La colonne GN donne les GN " +
      "dont un test d'entrée emploie la liste, une même liste pouvant en servir plusieurs.",
    sans.length === 1
      ? ` La liste ${enClair} n'est employée par aucun test : elle n'oriente vers aucun GN (« ${SANS_GN} »).`
      : sans.length
        ? ` Les listes ${enClair} ne sont employées par aucun test : elles n'orientent vers aucun GN (« ${SANS_GN} »).`
        : null
  );
}

// ==== Listes d'actes spécialisés ====

// Ici les GN couverts entrent dans l'index : un code d'acte n'a que trois
// chiffres (ALQ+183, ZZQM004), et les listes ne portent pas de numéro de
// diagnostic avec lequel les confondre. Chercher « 0147 » donne donc les
// actes spécialisés de ce GN, même quand sa liste s'appelle autrement
// (« 0106_09_15_30_45_47_48 », « tous_05 »).
const COLONNES_ACTES = ["Liste", "Libellé liste", "GN couverts", "Code", "Nomenclature", "Libellé"];

/** Une ligne par acte et par liste, listes par CM puis par nom. */
function lignesActes(jeu, k) {
  if (!jeu._groupageLignes) {
    const lignes = [...jeu.lignes]
      .sort((a, b) => a.CM.localeCompare(b.CM) || a.Liste.localeCompare(b.Liste) || a.Code.localeCompare(b.Code))
      .map((l) => ({
        Liste: l.Liste,
        "Libellé liste": l["Libellé liste"],
        "GN couverts": (k.listesSpe[l.Liste]?.gn ?? []).join(SEPARATEUR_GN),
        Code: l.Code,
        Nomenclature: l.Nomenclature,
        "Libellé": l["Libellé"],
      }));
    recherche.indexer(lignes, COLONNES_ACTES);
    jeu._groupageLignes = lignes;
  }
  return jeu._groupageLignes;
}

/** Un code CSARR saisi sans « + » (« alq183 ») prend la graphie de l'index. */
function corrigerActes(requete) {
  return requete
    .split(/\s+/)
    .map((mot) => (/^[a-z]{3}\d{3}$/i.test(mot) ? `${mot.slice(0, 3)}+${mot.slice(3)}` : mot))
    .join(" ");
}

/** Ce que dit le fichier d'un GN sans liste d'actes spécialisés. Le
 *  « GR spécialisé unique » de l'ATIH : GN non subdivisé sur la
 *  réadaptation, dont l'unique type, hors pédiatrique, est la réadaptation
 *  spécialisée importante (volume 1, 3.4.1.2). Pour les autres, on lit les
 *  types de GR_infos plutôt que de supposer qu'aucun n'est spécialisé. */
function situationSansListe(k, gn) {
  if (k.gnListeSpe[gn].speUnique) return "unique";
  return k.gr[gn]?.hc.includes("S") ? "specialise" : "sansType";
}

const SITUATIONS = {
  unique: {
    titre: "GR spécialisé unique",
    texte: "GN non subdivisé sur la réadaptation, dont l'unique type, hors pédiatrique, est la réadaptation spécialisée importante (volume 1, 3.4.1.2)",
  },
  sansType: {
    titre: "Sans type spécialisé",
    texte: "le GN n'a pas de type « réadaptation spécialisée importante » (GR_infos)",
  },
  specialise: {
    titre: "Type spécialisé sans liste",
    texte: "le GN a un type « réadaptation spécialisée importante », mais aucun acte n'y est spécialisé",
  },
};

/** Un numéro de GN saisi dont la liste n'existe pas : dire pourquoi la
 *  recherche ne rend rien. Un GN qui a une liste trouve ses actes par la
 *  colonne GN couverts, sans explication. */
function indicationGnActes(k, requete) {
  const gn = requete.trim();
  const rattachement = /^\d{4}$/.test(gn) ? k.gnListeSpe[gn] : null;
  if (!rattachement || rattachement.liste) return null;
  const { titre, texte } = SITUATIONS[situationSansListe(k, gn)];
  return el(
    "p",
    { class: "message-info" },
    `GN ${gn}, ${libelleGroupe(k, gn)} : pas de liste d'actes spécialisés. ${titre} : ${texte}.`
  );
}

/** Les GN sans liste, regroupés par situation ; chaque numéro mène au GN
 *  dans l'algorithme, son libellé en infobulle. */
function gnSansListe(k) {
  const groupes = new Map(Object.keys(SITUATIONS).map((s) => [s, []]));
  for (const [gn, rattachement] of Object.entries(k.gnListeSpe)) {
    if (!rattachement.liste) groupes.get(situationSansListe(k, gn)).push(gn);
  }
  const total = [...groupes.values()].reduce((n, gns) => n + gns.length, 0);
  if (!total) return [];
  const items = [...groupes]
    .filter(([, gns]) => gns.length)
    .map(([situation, gns]) => {
      const { titre, texte } = SITUATIONS[situation];
      const liens = gns.sort().flatMap((gn, i) => [
        i ? ", " : null,
        el("a", { href: lienArbre(gn), title: `${gn} ${libelleGroupe(k, gn)}`, "aria-label": `GN ${gn}, ${libelleGroupe(k, gn)}` }, gn),
      ]);
      return el("li", {}, el("strong", {}, `${titre} (${gns.length})`), ` — ${texte} : `, ...liens, ".");
    });
  return [
    el("h3", { class: "gn-sans-liste-titre" }, "GN sans liste d'actes spécialisés"),
    el(
      "p",
      {},
      `${nombre(total)} GN n'ont pas de liste (« PAS DE LISTE » dans ACTES_listes_SPE) : aucun acte n'entre dans leur score de réadaptation spécialisée. Chaque numéro mène au GN dans l'algorithme.`
    ),
    el("ul", { class: "gn-sans-liste" }, ...items),
  ];
}

// ==== Section de recherche ====

/** Liens vers la fiche des codes trouvés, quand ils sont assez peu
 *  nombreux pour qu'on en vise un. */
function liensFiches(lignes) {
  const codes = [];
  const vus = new Set();
  for (const ligne of lignes) {
    if (vus.has(ligne.Code)) continue;
    vus.add(ligne.Code);
    codes.push(ligne.Code);
    if (codes.length > LIENS_FICHES_MAX) return null;
  }
  if (!codes.length) return null;
  return el(
    "p",
    { class: "liens-fiches" },
    codes.length === 1 ? "Fiche du code : " : "Fiches des codes : ",
    ...codes.flatMap((code, i) => [i ? ", " : null, lienCode(code)])
  );
}

/**
 * Titre, explication, champ de recherche et tableau d'un jeu de lignes.
 * `corriger` réécrit la saisie avant le filtre, `indication` peut ajouter
 * un message au-dessus des résultats, `auChangement` est appelé à chaque
 * saisie tant que la section est affichée.
 */
function section(conteneur, lignes, { id, titre, exemple, explication = [], valeur = "", raccourci = true, corriger, indication, auChangement }) {
  // Indication et liens de fiche changent avec la saisie, comme le
  // compteur : annoncés de même aux lecteurs d'écran.
  const zoneIndication = el("div", { "aria-live": "polite" });
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id,
    exemple,
    valeur,
    raccourci,
    onInput: (saisie) => {
      afficher(saisie);
      // La frappe retombe après un délai : entre-temps, la page a pu
      // changer de thème, dont on ne réécrirait pas l'adresse.
      if (zoneResultats.isConnected) auChangement?.(saisie);
    },
  });

  conteneur.append(el("h2", {}, titre), ...explication.filter(Boolean), el("div", { class: "barre-outils" }, champ), zoneIndication, zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(corriger ? corriger(requete) : requete);
    const trouvees = lignes.filter(filtre);
    zoneIndication.replaceChildren(...[indication?.(requete), liensFiches(trouvees)].filter(Boolean));
    resultats(zoneResultats, trouvees, { total: lignes.length });
  }
  afficher(valeur);
}

/** L'adresse de la page pour une recherche dans la première section. */
function adresse(requete) {
  const texte = requete.trim();
  return texte ? `#/smr/groupage/${encodeURIComponent(texte)}` : "#/smr/groupage";
}

// ==== Rendu ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  // Jeu secondaire lancé en même temps : son absence ne coûte que sa
  // section, pas la page.
  const actesSpeEnCours = chargerActesSpe().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const [k, diagnostics] = await Promise.all([chargerClassification(), chargerDiagnostics()]);
  const actesSpe = await actesSpeEnCours;

  const lignes = lignesDiagnostics(diagnostics, k);
  const demande = chemin.join("/");

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Listes de la fonction groupage"),
    sourceFg(),
    fraicheur(
      [
        { libelle: diagnostics.libelle, millesime: diagnostics.millesime },
        { libelle: "tests d'entrée dans les GN", millesime: k.millesimes?.["GN_liste_tests.xlsx"] },
        actesSpe ? { libelle: actesSpe.libelle, millesime: actesSpe.millesime } : null,
      ].filter((j) => j?.millesime)
    ),
    el(
      "p",
      {},
      "Les listes de codes auxquelles la fonction groupage SMR se réfère. Les listes de diagnostics font les tests d'entrée " +
        "dans les groupes nosologiques (GN) : la CM déterminée, chaque nœud de son arbre teste si la MMP, l'AE ou, plus " +
        "rarement, un DAS appartient à une liste (Manuel des GME, volume 1, 2.2.2). Les listes d'actes spécialisés donnent, " +
        "par GN, les actes marqueurs de la réadaptation des déficiences liées à la pathologie (3.2). Chercher un code dit " +
        "dans quelles listes il entre, chercher un numéro de liste en donne les codes ; quand la recherche ne rend que " +
        "quelques codes, le lien vers leur fiche s'affiche au-dessus du tableau. L'ordre des tests et les GN auxquels ils " +
        "mènent sont dans ",
      el("a", { class: "lien-texte", href: lienArbre() }, "l'algorithme de la fonction groupage"),
      "."
    ),
    el("hr", { class: "separateur" })
  );

  section(conteneur, lignes, {
    id: "smr_groupage_diagnostics",
    titre: "Listes de diagnostics",
    exemple: "ex. : D-0112, I63.4, hémiplégie",
    valeur: demande,
    explication: [explicationDiagnostics(k)],
    corriger: (requete) => corrigerDiagnostics(diagnostics, requete),
    indication: (requete) => indicationGnDiagnostics(k, requete),
    // L'adresse suit la recherche sans entrée d'historique : le retour
    // arrière quitte la page au lieu de défaire la saisie lettre à lettre.
    auChangement: (requete) => {
      const cible = adresse(requete);
      if (location.hash.startsWith("#/smr/groupage") && location.hash !== cible) history.replaceState(null, "", cible);
    },
  });
  conteneur.append(el("hr", { class: "separateur" }));

  if (!actesSpe) {
    conteneur.append(
      el("h2", {}, "Listes d'actes spécialisés"),
      el("p", { class: "message-avertissement" }, "Listes d'actes spécialisés indisponibles pour le moment.")
    );
    return;
  }

  section(conteneur, lignesActes(actesSpe, k), {
    id: "smr_groupage_actes",
    titre: "Listes d'actes spécialisés",
    exemple: "ex. : ALQ+183, 0147, diététique",
    // « / » ne mène qu'au premier champ de la page : pas de rappel ici.
    raccourci: false,
    explication: [
      el(
        "p",
        {},
        `Une ligne par acte et par liste : ${nombre(Object.keys(k.listesSpe).length)} listes d'actes CSARR et CCAM, établies ` +
          "par GN, par regroupement de GN ou par CM (volume 1, 3.2.3) ; « GN couverts » donne les GN que le fichier de l'ATIH " +
          "rattache à chacune. Seuls les actes de la liste du GN du séjour entrent dans son score de réadaptation spécialisée " +
          "(3.3.2.1). Un acte CSAR prend le caractère spécialisé de l'acte CSARR que lui donne le ",
        el("a", { class: "lien-texte", href: "#/smr/csar" }, "transcodage"),
        " (3.2.3)."
      ),
    ],
    corriger: corrigerActes,
    indication: (requete) => indicationGnActes(k, requete),
  });
  conteneur.append(...gnSansListe(k));
}
