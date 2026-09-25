// Composants d'affichage partagés par les thèmes SMR : source de la
// fonction groupage, liens entre thèmes, libellés des groupes et table des
// tarifs d'un GME. Les règles de groupage, elles, sont dans smr.js (sans DOM).

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

export const lienFiche = (code) => `#/smr/fiche/${encodeURIComponent(code)}`;
export const lienArbre = (gn) => (gn ? `#/smr/arbre/${gn}` : "#/smr/arbre");
export const lienTarifs = (recherche) => (recherche ? `#/smr/tarifs/${encodeURIComponent(recherche)}` : "#/smr/tarifs");

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

/** Ce qu'il faut savoir pour lire un tarif SMR ; `lien` mène aux tarifs
 *  dans le thème Tarifs. */
export function noteTarifsSmr(lien) {
  return el(
    "p",
    { class: "note-tarifs" },
    "Tarifs nationaux de l'annexe I de l'arrêté tarifaire SMR (établissements mentionnés aux a, b et c de l'article L. 162-22 du code de la sécurité sociale), avant coefficients géographique et Ségur. Un GME d'hospitalisation complète relève de trois GMT — le GMT principal, un GMT2 et celui des séjours de moins de 8 jours terminés par un transfert ou un décès — ; les règles qui affectent un séjour à l'un d'eux sont celles de la notice technique de l'ATIH, pas du Manuel des GME.",
    lien ? " " : null,
    lien ? el("a", { class: "lien-texte", href: lien }, "Voir dans les tarifs des GME") : null
  );
}

const montant = (n) => el("td", { class: "nombre" }, n == null ? "–" : euros(n));
const duree = (n) => el("td", { class: "nombre" }, n == null ? "–" : jours(n));

/** Les GMT d'une liste de GME : un groupe de lignes par GME. */
export function tableTarifsGme(tarifs, gmes) {
  const entete = (texte, titre, numerique = false) =>
    el("th", { scope: "col", class: numerique ? "nombre" : undefined, title: titre }, texte);
  const corps = gmes.map((gme) => {
    const lignes = tarifs._parGme.get(gme) ?? [];
    if (!lignes.length) {
      return el(
        "tbody",
        {},
        el("tr", {}, el("th", { scope: "rowgroup" }, gme), el("td", { class: "sans-tarif", colspan: "11" }, "Pas de tarif dans l'arrêté"))
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
          entete("GME"),
          entete("GMT", "Groupe médico-tarifaire"),
          entete("Nature"),
          entete("DZF", "Début de zone forfaitaire, en jours", true),
          entete("FZF", "Fin de zone forfaitaire, en jours", true),
          entete("TZB", "Tarif de la zone basse", true),
          entete("SZB", "Supplément de la zone basse", true),
          entete("TZF1", "Tarif de la zone forfaitaire, période 1", true),
          entete("TZF2", "Tarif de la zone forfaitaire, période 2", true),
          entete("TZF3", "Tarif de la zone forfaitaire, période 3", true),
          entete("SZH", "Supplément de la zone haute", true)
        )
      ),
      ...corps
    )
  );
}
