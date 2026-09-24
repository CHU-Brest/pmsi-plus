// Tarifs des GHS — la feuille « Tarifs public » de l'arrêté tarifaire MCO,
// convertie par scripts/build_data.py. Partagés par le thème Tarifs,
// l'algorithme de la fonction groupage et la fiche code : chargement, index
// par GHM, mise en forme des montants, et la table compacte qui donne les
// GHS d'un groupe de GHM (une case de l'arbre, une racine).
//
// Un GHM a le plus souvent plusieurs GHS : le GHS facturé dépend de
// conditions de l'arrêté « prestations » (séjour de moins d'une journée,
// séjour en UHCD, unité de soins palliatifs, acte particulier…) que le
// tableau de l'ATIH ne porte pas. On les montre donc tous, sans en désigner
// un d'office.

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

/** Ce qu'il faut savoir pour lire un tarif, en une phrase ; `lien` mène aux
 *  tarifs de la racine dans le thème Tarifs. */
export function noteTarifs(lien) {
  return el(
    "p",
    { class: "note-tarifs" },
    "Tarifs nationaux du secteur public, avant coefficients (géographique, Ségur…) et hors suppléments. Un GHM peut relever de plusieurs GHS : le GHS facturé dépend des conditions de l'arrêté « prestations » (séjour de moins d'une journée, séjour en UHCD, unité de soins palliatifs, acte particulier…).",
    lien ? " " : null,
    lien ? el("a", { class: "lien-texte", href: lien }, "Voir dans les tarifs des GHS") : null
  );
}

function celluleMontant(n) {
  return el("td", { class: "nombre" }, euros(n));
}

function celluleJours(n) {
  return el("td", { class: "nombre" }, jours(n));
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

/** Les GHS d'un groupe de GHM : une ligne par GHS de chaque GHM. Un GHS
 *  commun à tous les GHM du groupe (celui des séjours en UHCD, en règle
 *  générale) n'est donné qu'une fois, en dernière ligne, au lieu d'être
 *  répété sous chaque niveau. */
export function tableTarifs(jeu, ghms) {
  const index = parGhm(jeu);
  const tarifes = ghms.filter((g) => index.has(g));
  const communs = ghsCommuns(index, tarifes);
  const lignesDe = (g) => index.get(g).filter((l) => !communs.has(l.GHS));
  const communes = communs.size ? index.get(tarifes[0]).filter((l) => communs.has(l.GHS)) : [];
  // Le forfait EXB est le plus souvent nul (il l'est sur toutes les lignes
  // de l'arrêté 2026) : sa colonne n'apparaît que si une ligne en porte un.
  const avecForfait = tarifes.some((g) => index.get(g).some((l) => l["Forfait EXB"]));
  const nbColonnes = avecForfait ? 8 : 7;

  const ligne = (premiere, l) =>
    el(
      "tr",
      {},
      premiere,
      el("td", { class: "code" }, String(l.GHS)),
      celluleMontant(l.Tarif),
      celluleJours(l["Borne basse"]),
      celluleJours(l["Borne haute"]),
      avecForfait ? celluleMontant(l["Forfait EXB"]) : null,
      celluleMontant(l["Tarif EXB"]),
      celluleMontant(l["Tarif EXH"])
    );

  const corps = [];
  for (const g of ghms) {
    if (!index.has(g)) {
      corps.push(
        el(
          "tr",
          {},
          el("td", { class: "code" }, g),
          el("td", { class: "sans-tarif", colspan: String(nbColonnes - 1) }, "Pas de tarif dans l'arrêté")
        )
      );
      continue;
    }
    const lignes = lignesDe(g);
    lignes.forEach((l, i) => {
      const premiere = i === 0 ? el("td", { class: "code", rowspan: String(lignes.length) }, g) : null;
      corps.push(ligne(premiere, l));
    });
  }
  communes.forEach((l, i) => {
    const premiere =
      i === 0
        ? el("td", { class: "tous", rowspan: String(communes.length), title: tarifes.join(", ") }, "Tous les GHM")
        : null;
    corps.push(ligne(premiere, l));
  });

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
          entete("EXB / jour", "Minoration par journée manquante sous la borne basse", true),
          entete("EXH / jour", "Supplément par journée au-delà de la borne haute", true)
        )
      ),
      el("tbody", {}, ...corps)
    )
  );
}
