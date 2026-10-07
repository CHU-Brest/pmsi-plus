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
//
// Les lignes des deux tableaux, la réécriture des saisies et les GN sans
// liste d'actes spécialisés sont calculés par smr.js ; ce module les dessine.

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, resultats, nombre } from "../../interface.js";
import {
  chargerActesSpe,
  chargerClassification,
  chargerDiagnostics,
  corrigerActes,
  corrigerDiagnostics,
  gnSansListe,
  libelleGroupe,
  lignesActes,
  lignesDiagnostics,
  listesSansTest,
  SANS_GN,
  situationSansListe,
  SITUATIONS,
} from "../../smr.js";
import { lienArbre, lienCode, lienCsar, lienGroupage, sourceFg } from "../../smr_interface.js";

// Au-delà, une ligne de liens serait plus longue que le tableau qu'elle
// accompagne : la recherche est trop large pour qu'on vise un code.
const LIENS_FICHES_MAX = 12;

// ==== Listes de diagnostics ====

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
  const sans = listesSansTest(k).map((liste) => `D-${liste} (${k.listes[liste] || "sans libellé"})`);
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

/** Les GN sans liste, regroupés par situation (smr.gnSansListe) ; chaque
 *  numéro mène au GN dans l'algorithme, son libellé en infobulle. */
function blocGnSansListe(k) {
  const groupes = gnSansListe(k);
  const total = [...groupes.values()].reduce((n, gns) => n + gns.length, 0);
  if (!total) return [];
  const items = [...groupes]
    .filter(([, gns]) => gns.length)
    .map(([situation, gns]) => {
      const { titre, texte } = SITUATIONS[situation];
      const liens = gns.flatMap((gn, i) => [
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
 * saisie tant que la section est affichée. Rend le titre, vers lequel
 * défile un lien profond.
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

  const h2 = el("h2", {}, titre);
  conteneur.append(h2, ...explication.filter(Boolean), el("div", { class: "barre-outils" }, champ), zoneIndication, zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(corriger ? corriger(requete) : requete);
    const trouvees = lignes.filter(filtre);
    zoneIndication.replaceChildren(...[indication?.(requete), liensFiches(trouvees)].filter(Boolean));
    resultats(zoneResultats, trouvees, { total: lignes.length });
  }
  afficher(valeur);
  return h2;
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
  // Un nom de liste d'actes spécialisés (« 0106_09_15_30_45_47_48 »,
  // lien de l'algorithme) pré-remplit la seconde section, pas la première.
  const listeActes = actesSpe && k.listesSpe[demande] ? demande : "";

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
    valeur: listeActes ? "" : demande,
    explication: [explicationDiagnostics(k)],
    corriger: (requete) => corrigerDiagnostics(diagnostics, requete),
    indication: (requete) => indicationGnDiagnostics(k, requete),
    // L'adresse suit la recherche sans entrée d'historique : le retour
    // arrière quitte la page au lieu de défaire la saisie lettre à lettre.
    auChangement: (requete) => {
      const cible = lienGroupage(requete.trim());
      if (location.hash.startsWith(lienGroupage()) && location.hash !== cible) history.replaceState(null, "", cible);
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

  const titreActes = section(conteneur, lignesActes(actesSpe, k), {
    id: "smr_groupage_actes",
    titre: "Listes d'actes spécialisés",
    exemple: "ex. : ALQ+183, 0147, diététique",
    valeur: listeActes,
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
        el("a", { class: "lien-texte", href: lienCsar() }, "transcodage"),
        " (3.2.3)."
      ),
    ],
    corriger: corrigerActes,
    indication: (requete) => indicationGnActes(k, requete),
  });
  conteneur.append(...blocGnSansListe(k));
  if (listeActes) {
    titreActes.scrollIntoView();
    return true;
  }
}
