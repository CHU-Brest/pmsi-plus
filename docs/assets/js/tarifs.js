// Tarifs des GHS — la feuille « Tarifs public » de l'arrêté tarifaire MCO,
// convertie par scripts/build_data.py. Partagés par le thème Tarifs,
// l'algorithme de la fonction groupage et la fiche code : chargement, index
// par GHM, mise en forme des montants, et la table compacte qui donne les
// GHS d'un groupe de GHM (une case de l'arbre, une racine).
//
// Un GHM a le plus souvent plusieurs GHS : le GHS facturé dépend de
// conditions de l'arrêté « prestations » (GHS intermédiaire d'un séjour de
// moins d'une journée, GHS UHCD d'une prise en charge en UHCD qui ne produit
// qu'un RUM, prise en charge particulière : soins palliatifs, infection
// ostéo-articulaire complexe, acte…) que le tableau de l'arrêté ne porte
// pas. On les montre donc tous, sans en désigner un d'office.

import { chargerJeu } from "./donnees.js";
import { el, nombre } from "./interface.js";

const FORMAT_EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

// 0 veut dire « pas de borne » ou « pas de montant » : un tiret, comme dans
// le classeur de l'ATIH, plutôt qu'un « 0 jour » ou « 0,00 € » trompeur.
export const euros = (n) => (n ? FORMAT_EUROS.format(n) : "–");
export const jours = (n) => (n ? nombre(n) : "–");

export function chargerTarifs() {
  return chargerJeu("groupage", "tarifs", "tarifs des GHS (arrêté tarifaire, secteur public)");
}

/** GHM → ses lignes de tarif, par numéro de GHS croissant. Calculé une
 *  seule fois : le jeu reste en cache d'une page à l'autre. */
export function parGhm(jeu) {
  if (!jeu._parGhm) {
    const index = new Map();
    for (const l of jeu.lignes) {
      if (!index.has(l.GHM)) index.set(l.GHM, []);
      index.get(l.GHM).push(l);
    }
    for (const lignes of index.values()) lignes.sort((a, b) => a.GHS - b.GHS);
    jeu._parGhm = index;
  }
  return jeu._parGhm;
}

/** Les GHM tarifés d'une racine, dans l'ordre des codes. */
export function ghmDeRacine(jeu, racine) {
  return [...parGhm(jeu).keys()].filter((g) => g.startsWith(racine)).sort();
}

/** Nombre de GHS distincts d'un groupe de GHM. */
export function nombreGhs(jeu, ghms) {
  const index = parGhm(jeu);
  return new Set(ghms.flatMap((g) => (index.get(g) ?? []).map((l) => l.GHS))).size;
}

/** Ce qu'il faut savoir pour lire un tarif, en une phrase ; `lien`, s'il
 *  est donné, mène aux tarifs de la racine dans le thème Tarifs. */
export function noteTarifs(lien) {
  return el(
    "p",
    { class: "note-tarifs" },
    "Tarifs nationaux du secteur public, avant coefficients (géographique, Ségur…) et hors suppléments. Un GHM peut relever de plusieurs GHS : le GHS facturé dépend des conditions de l'arrêté « prestations » (GHS intermédiaire d'un séjour de moins d'une journée, GHS UHCD d'une prise en charge en UHCD qui ne produit qu'un RUM, prise en charge particulière : soins palliatifs, infection ostéo-articulaire complexe, acte particulier…).",
    lien ? " " : null,
    lien ? el("a", { class: "lien-texte", href: lien }, "Voir dans les tarifs des GHS") : null
  );
}

/** GHS communs à tous les GHM tarifés du groupe, s'il y en a au moins deux
 *  et que chacun garde au moins un GHS à lui : sans quoi un GHM
 *  disparaîtrait du tableau derrière la ligne commune. */
function ghsCommuns(index, tarifes) {
  if (tarifes.length < 2) return new Set();
  let communs = new Set(index.get(tarifes[0]).map((l) => l.GHS));
  for (const g of tarifes.slice(1)) {
    const siens = new Set(index.get(g).map((l) => l.GHS));
    communs = new Set([...communs].filter((s) => siens.has(s)));
  }
  const chacunLesSiens = tarifes.every((g) => index.get(g).some((l) => !communs.has(l.GHS)));
  return chacunLesSiens ? communs : new Set();
}

/** Les GHS communs à toute la racine (le GHS UHCD, en règle générale). Ils
 *  passent après les GHS propres à un GHM, même quand celui-ci est seul
 *  dans son tableau : la première ligne n'est jamais le GHS d'un cas
 *  particulier commun à toute la racine. */
function ghsCommunsRacine(jeu, racine) {
  if (!jeu._communsRacine) jeu._communsRacine = new Map();
  if (!jeu._communsRacine.has(racine)) {
    jeu._communsRacine.set(racine, ghsCommuns(parGhm(jeu), ghmDeRacine(jeu, racine)));
  }
  return jeu._communsRacine.get(racine);
}

const celluleMontant = (n) => el("td", { class: "nombre" }, euros(n));
const celluleJours = (n) => el("td", { class: "nombre" }, jours(n));

/** Les GHS d'un groupe de GHM : un groupe de lignes par GHM, une ligne par
 *  GHS. Un GHS commun à tous les GHM du groupe n'est donné qu'une fois, en
 *  dernier groupe, au lieu d'être répété sous chaque niveau. */
export function tableTarifs(jeu, ghms) {
  const index = parGhm(jeu);
  const tarifes = ghms.filter((g) => index.has(g));
  const communs = ghsCommuns(index, tarifes);
  // Le forfait EXB est le plus souvent nul (il l'est sur toutes les lignes
  // de l'arrêté 2026) : sa colonne n'apparaît que si une ligne en porte un.
  const avecForfait = tarifes.some((g) => index.get(g).some((l) => l["Forfait EXB"]));
  const nbColonnes = avecForfait ? 8 : 7;

  const ligne = (entete, l) =>
    el(
      "tr",
      {},
      entete,
      el("td", { class: "code" }, String(l.GHS)),
      celluleMontant(l.Tarif),
      celluleJours(l["Borne basse"]),
      celluleJours(l["Borne haute"]),
      avecForfait ? celluleMontant(l["Forfait EXB"]) : null,
      celluleMontant(l["Tarif EXB"]),
      celluleMontant(l["Tarif EXH"])
    );

  // Un <tbody> par GHM, dont la première cellule est l'en-tête du groupe :
  // un lecteur d'écran annonce le GHM sur chacune de ses lignes.
  const groupe = (texte, lignes, attributs = {}) =>
    el(
      "tbody",
      {},
      ...lignes.map((l, i) =>
        ligne(
          i === 0 ? el("th", { scope: "rowgroup", rowspan: String(lignes.length), ...attributs }, texte) : null,
          l
        )
      )
    );

  const corps = [];
  for (const g of ghms) {
    if (!index.has(g)) {
      corps.push(
        el(
          "tbody",
          {},
          el(
            "tr",
            {},
            el("th", { scope: "rowgroup" }, g),
            el("td", { class: "sans-tarif", colspan: String(nbColonnes - 1) }, "Pas de tarif dans l'arrêté")
          )
        )
      );
      continue;
    }
    const derniers = ghsCommunsRacine(jeu, g.slice(0, 5));
    const lignes = index
      .get(g)
      .filter((l) => !communs.has(l.GHS))
      .sort((a, b) => derniers.has(a.GHS) - derniers.has(b.GHS) || a.GHS - b.GHS);
    corps.push(groupe(g, lignes));
  }
  if (communs.size) {
    const libelle = tarifes.length < ghms.length ? "Tous les GHM tarifés" : "Tous les GHM";
    const lignes = index.get(tarifes[0]).filter((l) => communs.has(l.GHS));
    corps.push(groupe(libelle, lignes, { class: "tous", title: tarifes.join(", ") }));
  }

  const entete = (texte, titre, numerique = false) =>
    el("th", { scope: "col", class: numerique ? "nombre" : undefined, title: titre }, texte);
  return el(
    "div",
    { class: "codes-liste tarifs-ghs" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          entete("GHM"),
          entete("GHS"),
          entete("Tarif", "Tarif du GHS", true),
          entete("Borne basse", "En jours ; en deçà, le tarif est minoré de l'extrême bas", true),
          entete("Borne haute", "En jours ; au-delà, chaque journée ajoute l'extrême haut", true),
          avecForfait ? entete("Forfait EXB", "Minoration forfaitaire sous la borne basse", true) : null,
          entete("Tarif EXB", "Minoration par journée manquante sous la borne basse", true),
          entete("Tarif EXH", "Supplément par journée au-delà de la borne haute", true)
        )
      ),
      ...corps
    )
  );
}
