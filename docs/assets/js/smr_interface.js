// Composants d'affichage partagés par les thèmes SMR : source de la
// fonction groupage, liens entre thèmes, libellés des groupes, tableaux et
// notes des fiches, table des tarifs d'un GME. Les règles de groupage, elles, sont dans smr.js (sans DOM).

import { el } from "./interface.js";
import { euros, jours } from "./tarifs.js";
import { graphie, libelleGroupe } from "./smr.js";

/** Sous-titre commun : la version de la fonction groupage appliquée. */
export function sourceFg() {
  return el(
    "p",
    { class: "sous-titre" },
    el("span", { class: "campagne" }, "Fonction groupage SMR 2026"),
    " — version provisoire de l'ATIH, seule publiée pour 2026 (Manuel des GME, volume 1, et fichiers associés)"
  );
}

// ==== Liens entre thèmes ====

// Les adresses des thèmes SMR, dans l'ordre de registry.js : un slug
// renommé là se renomme ici.
export const lienFiche = (code) => `#/smr/fiche/${encodeURIComponent(code)}`;
export const lienGroupage = (recherche) => (recherche ? `#/smr/groupage/${encodeURIComponent(recherche)}` : "#/smr/groupage");
export const lienArbre = (gn) => (gn ? `#/smr/arbre/${gn}` : "#/smr/arbre");
export const lienTarifs = (recherche) => (recherche ? `#/smr/tarifs/${encodeURIComponent(recherche)}` : "#/smr/tarifs");
export const lienErreurs = (recherche) => (recherche ? `#/smr/erreurs/${encodeURIComponent(recherche)}` : "#/smr/erreurs");
export const lienCma = (code) => (code ? `#/smr/cma/${encodeURIComponent(code)}` : "#/smr/cma");
export const lienPonderations = (recherche) => (recherche ? `#/smr/ponderations/${encodeURIComponent(recherche)}` : "#/smr/ponderations");
export const lienCsar = (recherche) => (recherche ? `#/smr/csar/${encodeURIComponent(recherche)}` : "#/smr/csar");

/** Lien vers la fiche d'un code CIM-10 (graphie à point) ou d'un acte. */
export function lienCode(code, texte = null) {
  const affiche = /^[A-Z]\d{2}/.test(code) && !/\+\d{3}$/.test(code) ? graphie(code) : code;
  return el("a", { href: lienFiche(affiche), title: "Fiche du code" }, texte ?? affiche);
}

/** Code de groupe suivi de son libellé long : « 0147SC2 Accidents… ». */
export function groupeLibelle(k, code) {
  return el(
    "span",
    { class: "groupe-libelle" },
    el("span", { class: "code" }, code),
    " ",
    libelleGroupe(k, code)
  );
}

// ==== Composants des fiches ====

// Partagés par la fiche code (themes/smr/fiche.js) et les fiches d'actes
// (themes/smr/fiche_actes.js).

export const lien = (href, ...enfants) => el("a", { href }, ...enfants);
export const note = (...enfants) => el("p", { class: "fiche-note" }, ...enfants);
// Césures des en-têtes (trait d'union conditionnel) : en capitales
// espacées, « PONDÉRATION » ou « INTERVENANTS » sont les mots les plus
// larges d'un tableau et le faisaient déborder d'un téléphone ; coupés au
// besoin seulement, ils restent entiers sur grand écran.
const CESURES = {
  Accepté: "Accep\u00adté",
  arrivée: "arri\u00advée",
  entrée: "en\u00adtrée",
  Intervenant: "Inter\u00advenant",
  Intervenants: "Inter\u00advenants",
  Majoration: "Majo\u00adration",
  Modalité: "Moda\u00adlité",
  Modulateur: "Modu\u00adlateur",
  Pondération: "Pondé\u00adration",
  Position: "Posi\u00adtion",
  Propriété: "Pro\u00adpriété",
  spécialisé: "spécia\u00adlisé",
  transcodé: "trans\u00adcodé",
};
export const entete = (texte, titre) =>
  el("th", { scope: "col", title: titre }, texte.replace(/\p{L}+/gu, (mot) => CESURES[mot] ?? mot));
// Libellé sous son code, dans la même cellule : un tableau de quatre
// colonnes au plus tient dans un téléphone sans défiler, et l'étiquette
// d'écart, en dernière colonne, reste en vue.
export const sousLibelle = (texte) =>
  texte && texte.length ? el("span", { class: "racine-libellee" }, ...(Array.isArray(texte) ? texte : [texte])) : null;

/** Tableau à la manière de la fiche MCO : en-têtes, puis un ou plusieurs
 *  <tbody> (un par groupe de lignes), affiché en entier. */
export function table(entetes, ...corps) {
  return el(
    "div",
    { class: "codes-liste" },
    el("table", {}, el("thead", {}, el("tr", {}, ...entetes)), ...corps)
  );
}

export function lienGn(k, gn) {
  return lien(lienArbre(gn), groupeLibelle(k, gn));
}

// ==== Tarifs ====

/** Nature d'un GMT, d'après sa tranche de numéros et son libellé : chaque
 *  GME d'HC relève de trois GMT, chaque GME d'HTP d'un seul. */
export function natureGmt(ligne) {
  const n = Number(ligne.GMT);
  if (ligne.GME.endsWith("0")) return "HTP, par journée";
  if (n >= 8000) return "Séjour de moins de 8 jours avec transfert ou décès";
  if (n >= 7000) return "GMT2";
  return "GMT principal";
}

/** Ce qu'il faut savoir pour lire un tarif SMR ; `adresse` mène aux tarifs
 *  dans le thème Tarifs. */
export function noteTarifsSmr(adresse) {
  return el(
    "p",
    { class: "note-tarifs" },
    "Tarifs nationaux de l'annexe I de l'arrêté tarifaire SMR (établissements mentionnés aux a, b et c de l'article L. 162-22 du code de la sécurité sociale), avant coefficients géographique et Ségur. Un GME d'hospitalisation complète relève de trois GMT — le GMT principal, un GMT2 et celui des séjours de moins de 8 jours terminés par un transfert ou un décès — ; les règles qui affectent un séjour à l'un d'eux sont celles de la notice technique de l'ATIH, pas du Manuel des GME.",
    adresse ? " " : null,
    adresse ? el("a", { class: "lien-texte", href: adresse }, "Voir dans les tarifs des GME") : null
  );
}

const montant = (n) => el("td", { class: "nombre" }, n == null ? "–" : euros(n));
const duree = (n) => el("td", { class: "nombre" }, n == null ? "–" : jours(n));

/** Les GMT d'une liste de GME : un groupe de lignes par GME. */
export function tableTarifsGme(tarifs, gmes) {
  const enteteTarif = (texte, titre, numerique = false) =>
    el("th", { scope: "col", class: numerique ? "nombre" : undefined, title: titre }, texte);
  const corps = gmes.map((gme) => {
    const lignes = tarifs._parGme.get(gme) ?? [];
    if (!lignes.length) {
      return el(
        "tbody",
        {},
        el("tr", {}, el("th", { scope: "rowgroup" }, gme), el("td", { class: "sans-tarif", colspan: "10" }, "Pas de tarif dans l'arrêté"))
      );
    }
    return el(
      "tbody",
      {},
      ...lignes.map((l, i) =>
        el(
          "tr",
          {},
          i === 0 ? el("th", { scope: "rowgroup", rowspan: String(lignes.length) }, gme) : null,
          el("td", { class: "code" }, l.GMT),
          el("td", {}, natureGmt(l)),
          duree(l.DZF),
          duree(l.FZF),
          montant(l.TZB),
          montant(l.SZB),
          montant(l.TZF1),
          montant(l.TZF2),
          montant(l.TZF3),
          montant(l.SZH)
        )
      )
    );
  });
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
          enteteTarif("GME"),
          enteteTarif("GMT", "Groupe médico-tarifaire"),
          enteteTarif("Nature"),
          enteteTarif("DZF", "Début de zone forfaitaire, en jours", true),
          enteteTarif("FZF", "Fin de zone forfaitaire, en jours", true),
          enteteTarif("TZB", "Tarif de la zone basse", true),
          enteteTarif("SZB", "Supplément de la zone basse", true),
          enteteTarif("TZF1", "Tarif de la zone forfaitaire, période 1", true),
          enteteTarif("TZF2", "Tarif de la zone forfaitaire, période 2", true),
          enteteTarif("TZF3", "Tarif de la zone forfaitaire, période 3", true),
          enteteTarif("SZH", "Supplément de la zone haute", true)
        )
      ),
      ...corps
    )
  );
}
