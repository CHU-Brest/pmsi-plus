// Tarifs des GME — l'annexe I de l'arrêté tarifaire SMR (feuille « Tarifs
// GMT - DAF » de tarifs.xlsx, convertie par scripts/build_smr.py) : une
// ligne par couple GMT-GME, avec les bornes de la zone forfaitaire et les
// tarifs des zones, sur le modèle du thème Tarifs des GHS (MCO).
//
// L'adresse #/smr/tarifs/<recherche> pré-remplit le champ — l'algorithme y
// renvoie pour un GN (« #/smr/tarifs/0147 ») — et la saisie l'y reporte,
// pour qu'une recherche se partage ou se signale telle quelle.
//
// Numéros de GN et de GMT ont la même forme, quatre chiffres, et la plupart
// des GN ont un homonyme parmi les GMT : « 0147 » est le GN des AVC avec
// hémiplégie, et le GMT principal du GME 0130SC1. Une recherche plein texte
// ramènerait ce GME en tête des résultats du GN. Un code de groupe saisi se
// compare donc au début des codes GME, comme dans la recherche de
// l'algorithme, et un numéro de GMT n'est cherché comme tel que s'il n'est
// pas aussi un début de GME ; l'homonyme est signalé au-dessus du tableau.
//
// Le tableau partagé (interface.js) n'affiche que du texte : le lien d'un
// GME vers l'algorithme ne peut pas être posé dans sa cellule. Il est donné
// au-dessus du tableau dès que les résultats ne couvrent qu'un GN.

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, resultats, nombre } from "../../interface.js";
import { chargerTarifsSmr } from "../../smr.js";
import { lienArbre, lienTarifs, natureGmt } from "../../smr_interface.js";
import { euros, jours } from "../../tarifs.js";

const COLONNES_CHERCHABLES = ["GMT", "GME", "Nature", "Libellé"];

// Colonnes de l'annexe, dans son ordre : bornes en jours, puis montants.
const DUREES = ["DZF", "FZF"];
const MONTANTS = ["TZB", "SZB", "TZF1", "TZF2", "TZF3", "SZH"];
const FORMATS = Object.fromEntries([...DUREES.map((c) => [c, jours]), ...MONTANTS.map((c) => [c, euros])]);

// Code de groupe, entier ou en partie : CM (« 01 »), GN (« 0147 »), GR
// (« 0147S »), GL (« 0147SC ») ou GME (« 0147SC2 »). Même forme que dans
// la recherche de l'algorithme (smr/arbre.js).
const RE_CODE_GROUPE = /^\d{2}(?:\d{2}(?:[A-Z](?:[A-Z]\d?)?)?)?$/;
const RE_GMT = /^\d{4}$/;
// Longueur d'un préfixe de GME → niveau du groupe qu'il désigne.
const NIVEAUX = { 4: "GN", 5: "GR", 6: "GL", 7: "GME" };
// Nombre ordinaire de GMT d'un GME d'HC : principal, GMT2, séjours courts.
const GMT_PAR_GME_HC = 3;

const comparer = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const estHtp = (gme) => gme.endsWith("0");

/** Lignes du tableau et index de la recherche, une fois par jeu : le jeu
 *  reste en cache d'une page à l'autre, et l'algorithme le partage (nom
 *  préfixé pour ne pas croiser ses index). */
function preparer(jeu) {
  if (!jeu._tarifsTableau) {
    const lignes = jeu.lignes
      .map((l) => ({
        GMT: l.GMT,
        GME: l.GME,
        Nature: natureGmt(l),
        // Case vide de l'arrêté → 0 : tableau() n'appelle pas le format
        // d'une valeur nulle, qui s'afficherait en blanc au lieu du tiret
        // que euros() et jours() donnent pour 0 (aucun 0 dans l'annexe).
        ...Object.fromEntries([...DUREES, ...MONTANTS].map((c) => [c, l[c] ?? 0])),
        // En dernier : colonne la plus large, il repousserait sinon les
        // montants hors de l'écran.
        "Libellé": l["Libellé"],
      }))
      .sort((a, b) => comparer(a.GME, b.GME) || comparer(a.GMT, b.GMT));
    recherche.indexer(lignes, COLONNES_CHERCHABLES);

    // Débuts de GME (CM, GN, GR, GL, GME), GME de chaque GMT, et libellé
    // de chaque GN tel que l'arrêté l'écrit, avant « / » : la page n'a pas
    // à charger la classification pour nommer un GN.
    const prefixes = new Set();
    const gmeParGmt = new Map();
    const libelleGn = new Map();
    for (const l of lignes) {
      for (const n of [2, 4, 5, 6, 7]) prefixes.add(l.GME.slice(0, n));
      if (!gmeParGmt.has(l.GMT)) gmeParGmt.set(l.GMT, []);
      gmeParGmt.get(l.GMT).push(l.GME);
      const gn = l.GME.slice(0, 4);
      if (!libelleGn.has(gn)) libelleGn.set(gn, l["Libellé"].split(" / ")[0]);
    }
    jeu._tarifsTableau = { lignes, prefixes, gmeParGmt, libelleGn, exceptions: exceptionsHc(jeu) };
  }
  return jeu._tarifsTableau;
}

/** GME d'HC qui n'ont pas trois GMT, regroupés par GN et par nombre de
 *  GMT, lus dans l'arrêté plutôt qu'écrits en dur ; `complet` : le groupe
 *  couvre tous les GME d'HC du GN. `doublons` : GN dont un GME a plusieurs
 *  GMT de même nature. */
function exceptionsHc(jeu) {
  const hcParGn = new Map();
  const groupes = new Map();
  const doublons = new Set();
  for (const [gme, lignes] of jeu._parGme) {
    if (estHtp(gme)) continue;
    const gn = gme.slice(0, 4);
    hcParGn.set(gn, (hcParGn.get(gn) ?? 0) + 1);
    if (lignes.length === GMT_PAR_GME_HC) continue;
    const cle = `${gn} ${lignes.length}`;
    if (!groupes.has(cle)) groupes.set(cle, { gn, nombre: lignes.length, gmes: [] });
    groupes.get(cle).gmes.push(gme);
    const natures = lignes.map(natureGmt);
    if (new Set(natures).size < natures.length) doublons.add(gn);
  }
  const liste = [...groupes.values()]
    .map((g) => ({ ...g, gmes: g.gmes.sort(), complet: g.gmes.length === hcParGn.get(g.gn) }))
    .sort((a, b) => comparer(a.gn, b.gn) || a.nombre - b.nombre);
  return { liste, doublons: [...doublons].sort() };
}

/** Prédicat de la recherche : mots clefs cumulatifs, comme recherche.filtre,
 *  sauf qu'un code de groupe se compare au début du GME et un numéro de GMT
 *  (qui n'est pas un début de GME) au GMT entier. */
function filtre(index, requete) {
  const tests = recherche
    .normaliser(requete)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((mot) => {
      const code = mot.toUpperCase();
      if (RE_CODE_GROUPE.test(code) && index.prefixes.has(code)) return (l) => l.GME.startsWith(code);
      if (RE_GMT.test(code) && index.gmeParGmt.has(code)) return (l) => l.GMT === code;
      return (l) => l._recherche.includes(mot);
    });
  return (l) => tests.every((t) => t(l));
}

/** Suite de liens séparés par des virgules. */
function liens(codes, href) {
  return codes.flatMap((code, i) => [i ? ", " : null, el("a", { href: href(code) }, code)]);
}

/** « 0147 » saisi seul est lu comme un GN ; s'il est aussi un numéro de
 *  GMT, dire lequel et y mener, plutôt que de le taire. */
function indicationHomonyme(index, requete) {
  const code = requete.trim().toUpperCase();
  if (!RE_GMT.test(code) || !index.prefixes.has(code) || !index.gmeParGmt.has(code)) return null;
  const gmes = [...new Set(index.gmeParGmt.get(code))];
  return el(
    "p",
    { class: "liens-fiches" },
    `« ${code} » est lu comme le GN ${code}. Le GMT ${code} est celui ${gmes.length > 1 ? "des GME" : "du GME"} `,
    ...liens(gmes, lienTarifs),
    "."
  );
}

/** Plus long début commun des GME trouvés, s'il désigne un groupe de
 *  l'algorithme (GN au moins) : l'algorithme s'ouvre sur un GN, placé sur
 *  le GR, le GL ou le GME quand on le lui donne. */
function groupeCommun(trouvees) {
  if (!trouvees.length) return null;
  let commun = trouvees[0].GME;
  for (const l of trouvees) {
    let n = 0;
    while (n < commun.length && commun[n] === l.GME[n]) n++;
    commun = commun.slice(0, n);
    if (commun.length < 4) return null;
  }
  return commun;
}

function indicationAlgorithme(index, trouvees) {
  const code = groupeCommun(trouvees);
  if (!code) return null;
  const gn = code.slice(0, 4);
  const libelle = index.libelleGn.get(gn) ?? "";
  return el(
    "p",
    { class: "liens-fiches" },
    "Dans l'algorithme de la fonction groupage : ",
    el("a", { href: lienArbre(code) }, `${NIVEAUX[code.length]} ${code}`),
    code.length > 4 ? `, du GN ${gn} ${libelle}.` : ` ${libelle}.`
  );
}

/** Les GME d'HC hors de la règle des trois GMT, s'il y en a. */
function phraseExceptions({ liste, doublons }) {
  if (!liste.length) return [];
  const morceaux = liste.flatMap((g, i) => [
    i ? " ; " : null,
    ...(g.complet
      ? [el("a", { href: lienTarifs(g.gn) }, `GN ${g.gn}`), ` ${g.libelle}`]
      : ["GME ", ...liens(g.gmes, lienTarifs)]),
    `, ${nombre(g.nombre)} GMT par GME d'HC`,
  ]);
  return [
    " Font exception dans cet arrêté : ",
    ...morceaux,
    ".",
    doublons.length
      ? ` Quand un GME a plusieurs GMT de même nature (GN ${doublons.join(", ")}), le tableau ne dit pas ce qui les départage.`
      : null,
  ];
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const jeu = await chargerTarifsSmr();
  const index = preparer(jeu);
  const { lignes } = index;
  const exceptions = {
    ...index.exceptions,
    liste: index.exceptions.liste.map((g) => ({ ...g, libelle: index.libelleGn.get(g.gn) ?? "" })),
  };
  conteneur.innerHTML = "";

  // Lien profond (#/smr/tarifs/0147SC2) : le champ arrive rempli.
  const demande = chemin.join("/");
  // Indications et compteur changent avec la saisie : annoncés de même aux
  // lecteurs d'écran.
  const zoneIndication = el("div", { "aria-live": "polite" });
  const zoneResultats = el("div", { class: "smr-tarifs" });
  const champ = champMotsClefs({
    id: "smr_tarifs_recherche",
    exemple: "ex. : 0147, 0147SC2, 7037, hémiplégie",
    valeur: demande,
    onInput: (valeur) => {
      afficher(valeur);
      // La frappe retombe après un délai : entre-temps, la page a pu
      // changer de thème, dont on ne réécrirait pas l'adresse. Pas
      // d'entrée d'historique : le retour arrière quitte la page au lieu
      // de défaire la saisie lettre à lettre.
      if (!zoneResultats.isConnected) return;
      const cible = lienTarifs(valeur.trim());
      if (location.hash.startsWith("#/smr/tarifs") && location.hash !== cible) history.replaceState(null, "", cible);
    },
  });
  champ.append(
    el(
      "p",
      { class: "champ-aide" },
      "Un code de groupe (« 0147 », « 0147SC2 ») se compare au début du GME ; un numéro de GMT (« 7037 ») trouve ce GMT, sauf s'il est aussi un numéro de GN."
    )
  );

  conteneur.append(
    el("h1", {}, "Tarifs des GME"),
    el(
      "p",
      { class: "sous-titre" },
      ...(jeu.campagne ? [el("strong", { class: "campagne" }, `Campagne ${jeu.campagne}`), " — annexe I"] : ["Annexe I"]),
      " de l'arrêté tarifaire SMR, établissements des a, b et c de l'article L. 162-22 du code de la sécurité sociale"
    ),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      `Chaque ligne de l'annexe est un couple GMT-GME : le groupe médico-tarifaire (GMT), le groupe médico-économique (GME) qu'il tarife, les bornes de la zone forfaitaire et les tarifs des zones — ${nombre(lignes.length)} lignes pour ${nombre(jeu._parGme.size)} GME. Ce sont les tarifs nationaux, avant coefficients géographique et Ségur.`
    ),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Colonnes sous les noms de l'arrêté : DZF, début de zone forfaitaire, et FZF, fin de zone forfaitaire, en jours ; TZB, tarif de la zone basse ; SZB, supplément de la zone basse ; TZF1, TZF2 et TZF3, tarif de la zone forfaitaire, périodes 1, 2 et 3 ; SZH, supplément de la zone haute. Un tiret : pas de montant dans l'arrêté. Le tableau donne les montants, pas la façon de les appliquer à un séjour selon sa durée, qui relève de la notice technique de l'ATIH."
      ),
      el(
        "li",
        {},
        "Un GME d'hospitalisation complète (HC) relève de trois GMT : le GMT principal, un GMT2 et celui des séjours de moins de 8 jours avec transfert ou décès. Le GMT2 et le GMT des séjours courts sont partagés par plusieurs GME d'un même GN : chercher leur numéro les montre tous. Les règles qui affectent un séjour à l'un d'eux sont celles de la notice technique de l'ATIH, pas du Manuel des GME.",
        ...phraseExceptions(exceptions)
      ),
      el(
        "li",
        {},
        "Un GME d'hospitalisation à temps partiel (HTP), dont le code se termine par 0, relève d'un seul GMT, par journée : l'arrêté en donne le tarif en TZF1."
      ),
      el(
        "li",
        {},
        "Hors de ce tableau : les coefficients géographique et Ségur, les forfaits des plateaux techniques spécialisés et les suppléments de transport, que l'arrêté fixe à part. Les tarifs des établissements du d de l'article L. 162-22 (annexe II) ne sont pas repris."
      )
    ),
    el("div", { class: "barre-outils" }, champ),
    zoneIndication,
    zoneResultats
  );

  function afficher(requete) {
    const trouvees = lignes.filter(filtre(index, requete));
    zoneIndication.replaceChildren(
      ...[indicationHomonyme(index, requete), indicationAlgorithme(index, trouvees)].filter(Boolean)
    );
    resultats(zoneResultats, trouvees, { total: lignes.length, formats: FORMATS });
  }

  afficher(demande);
}
