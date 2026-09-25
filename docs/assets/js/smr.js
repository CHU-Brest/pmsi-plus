// Fonction groupage SMR — chargement des jeux produits par
// scripts/build_smr.py, et ce que plusieurs thèmes SMR lisent de la même
// façon : graphie des codes, libellés des groupes, positions permises d'un
// diagnostic et erreurs qu'il lève, exclusions des CMA, caractère spécialisé
// d'un acte. Les règles du groupage elles-mêmes (volume 1 du Manuel des
// GME, data/smr/manuel_gme_volume_1.pdf) sont présentées par l'algorithme,
// themes/smr_arbre.js.
//
// Rien ici ne touche au DOM : les fonctions reçoivent les jeux chargés en
// argument (`smr`, cf. chargerSmr). Partagé par les thèmes SMR : fiche code,
// listes, algorithme, tarifs, pondérations, transcodage CSAR, CMA, erreurs.

import { chargerJeu, chargerJson } from "./donnees.js";

// ==== Graphie des codes ====

/** Saisie ou code de l'ATIH → clef sans point ni espace, en capitales :
 *  « i63.4 » → « I634 », « C16.9+0 » → « C169+0 ». */
export function cle(code) {
  return String(code ?? "").toUpperCase().replace(/[\s.]/g, "");
}

/** Clef → graphie des référentiels du site : « I634 » → « I63.4 »,
 *  « B24+0 » → « B24.+0 ». */
export function graphie(code) {
  const c = cle(code);
  return c.length <= 3 ? c : `${c.slice(0, 3)}.${c.slice(3)}`;
}

export const RE_CSARR = /^[A-Z]{3}\+\d{3}$/;
export const RE_CSAR = /^\d{2}[A-Z]\d{2}$/;
export const RE_CIM = /^[A-Z]\d{2}[0-9+]*$/;

/** Code d'acte saisi → graphie des fichiers de l'ATIH : capitales, sans
 *  espace ; « ALQ247 » → « ALQ+247 » (CSARR saisi sans son « + ») ;
 *  « EBLA0030 » → « EBLA003 » (code CCAM suivi de sa phase, comme dans
 *  CMA_CCAM.xlsx). Un code CIM-10 ou CSAR est rendu tel quel. */
export function normaliserActe(code) {
  const brut = String(code ?? "").toUpperCase().replace(/\s/g, "");
  if (/^[A-Z]{3}\d{3}$/.test(brut)) return `${brut.slice(0, 3)}+${brut.slice(3)}`;
  if (/^[A-Z]{4}\d{4}$/.test(brut)) return brut.slice(0, 7);
  return brut;
}

// ==== Chargement ====

const LIBELLES = {
  diagnostics: "codes CIM-10 de la fonction groupage SMR",
  actes: "pondérations des actes de réadaptation",
  actesSpe: "listes d'actes spécialisés",
  csar: "transcodage CSAR vers CSARR",
  tarifs: "tarifs des GMT (arrêté tarifaire SMR, annexe I)",
};

/** La classification (brute) et ses index : tests par CM, GME par GL. */
export function chargerClassification() {
  return chargerJson("smr", "classification").then((k) => {
    if (!k._testsParCm) {
      k._testsParCm = new Map();
      for (const t of k.tests) {
        if (!k._testsParCm.has(t.cm)) k._testsParCm.set(t.cm, []);
        k._testsParCm.get(t.cm).push(t);
      }
      for (const liste of k._testsParCm.values()) liste.sort((a, b) => a.ordre - b.ordre);
      k._cmaCcam = new Map(k.cmaCcam.map(([code, libelle]) => [code, libelle]));
      k._erreurs = new Map(k.erreurs.map(([code, libelle, bloquant]) => [code, { code, libelle, bloquant }]));
      // Listes d'actes spécialisés : GN → numéro de liste.
      k._listeSpeParGn = new Map(Object.entries(k.gnListeSpe).map(([gn, e]) => [gn, e.liste]));
    }
    return k;
  });
}

/** Les codes CIM-10, indexés par clef sans point. */
export function chargerDiagnostics() {
  return chargerJeu("smr", "diagnostics", LIBELLES.diagnostics).then((jeu) => {
    if (!jeu._parCle) jeu._parCle = new Map(jeu.lignes.map((l) => [cle(l.Code), l]));
    return jeu;
  });
}

export function chargerExclusions() {
  return chargerJson("smr", "exclusions");
}

/** Pondérations : code → lignes (une « 00 », ou une par intervenant). */
export function chargerActes() {
  return chargerJeu("smr", "actes", LIBELLES.actes).then((jeu) => {
    if (!jeu._parCode) {
      jeu._parCode = new Map();
      for (const l of jeu.lignes) {
        if (!jeu._parCode.has(l.Code)) jeu._parCode.set(l.Code, []);
        jeu._parCode.get(l.Code).push(l);
      }
    }
    return jeu;
  });
}

/** Listes d'actes spécialisés : code → numéros de liste. */
export function chargerActesSpe() {
  return chargerJeu("smr", "actes_spe", LIBELLES.actesSpe).then((jeu) => {
    if (!jeu._parCode) {
      jeu._parCode = new Map();
      for (const l of jeu.lignes) {
        if (!jeu._parCode.has(l.Code)) jeu._parCode.set(l.Code, new Set());
        jeu._parCode.get(l.Code).add(l.Liste);
      }
    }
    return jeu;
  });
}

/** Transcodage CSAR : code CSAR → lignes (une par intervenant et modalité). */
export function chargerCsar() {
  return chargerJeu("smr", "csar", LIBELLES.csar).then((jeu) => {
    if (!jeu._parCode) {
      jeu._parCode = new Map();
      for (const l of jeu.lignes) {
        if (!jeu._parCode.has(l["Code CSAR"])) jeu._parCode.set(l["Code CSAR"], []);
        jeu._parCode.get(l["Code CSAR"]).push(l);
      }
    }
    return jeu;
  });
}

/** Tarifs des GMT : GME → lignes, GMT principal d'abord. */
export function chargerTarifsSmr() {
  return chargerJeu("smr", "tarifs", LIBELLES.tarifs).then((jeu) => {
    if (!jeu._parGme) {
      jeu._parGme = new Map();
      for (const l of jeu.lignes) {
        if (!jeu._parGme.has(l.GME)) jeu._parGme.set(l.GME, []);
        jeu._parGme.get(l.GME).push(l);
      }
      for (const lignes of jeu._parGme.values()) lignes.sort((a, b) => (a.GMT < b.GMT ? -1 : 1));
    }
    return jeu;
  });
}

/** Tout ce que le groupage d'un séjour demande, en un objet `smr`. */
export async function chargerSmr() {
  const [classification, diagnostics, exclusions, actes, actesSpe, csar] = await Promise.all([
    chargerClassification(),
    chargerDiagnostics(),
    chargerExclusions(),
    chargerActes(),
    chargerActesSpe(),
    chargerCsar(),
  ]);
  return { classification, diagnostics, exclusions, actes, actesSpe, csar };
}

// ==== Libellés ====

/** Libellé long d'un groupe (CM, GN, GR, GL, GME), ou chaîne vide. */
export function libelleGroupe(k, code) {
  const quoi = { 2: "CM", 4: "GN", 5: "GR", 6: "GL", 7: "GME" }[code.length];
  return k.groupes[quoi]?.[code]?.[1] ?? "";
}

export const TYPES_READAPTATION = {
  P: "réadaptation pédiatrique",
  S: "réadaptation spécialisée importante",
  T: "réadaptation globale importante",
  U: "réadaptation autre",
  H: "réadaptation pédiatrique",
  I: "réadaptation très intense",
  J: "réadaptation intense",
  K: "réadaptation modérée",
  L: "réadaptation indifférenciée",
};

export const POSITIONS = ["MMP", "AE", "DAS"];

// ==== Diagnostics ====

/** Un code peut-il être codé à cette position ? Profil de CIM_infos_SMR :
 *  un caractère par position (MMP, AE, DAS), O ou N. */
export function positionAutorisee(diag, position) {
  return !!diag && diag.Profil[POSITIONS.indexOf(position)] === "O";
}

/** Le code oriente-t-il dans une CM ? CM 90 : « non groupable ou sans
 *  objet » — le code n'est dans aucune liste d'entrée de CM. */
export function orienteDansCm(diag) {
  return !!diag && diag.CM !== "90";
}

// ==== Contrôles des diagnostics (FG_erreurs) ====

/** Erreurs bloquantes sur les diagnostics d'un RHS : code inconnu, position
 *  non autorisée par le profil, doublon entre positions. */
export function controlerDiagnostics(smr, rhs) {
  const D = smr.diagnostics._parCle;
  const erreurs = [];
  const verifier = (code, position, inconnu, refuse) => {
    const d = D.get(cle(code));
    if (!d) erreurs.push({ code: inconnu, diag: graphie(code), position });
    else if (!positionAutorisee(d, position)) erreurs.push({ code: refuse, diag: graphie(code), position });
  };
  if (!rhs.mmp) erreurs.push({ code: 58, position: "MMP" });
  else verifier(rhs.mmp, "MMP", 58, 65);
  if (rhs.ae) {
    verifier(rhs.ae, "AE", 67, 71);
    if (rhs.mmp && cle(rhs.ae) === cle(rhs.mmp)) erreurs.push({ code: 69, diag: graphie(rhs.ae), position: "AE" });
  }
  for (const das of rhs.das ?? []) verifier(das, "DAS", 79, 80);
  const k = smr.classification;
  return erreurs.map((e) => ({ ...e, libelle: k._erreurs.get(e.code)?.libelle ?? "" }));
}

// ==== Actes spécialisés (volume 1, 3.2) ====

/** L'acte (CSARR, CCAM, ou CSAR transcodé) est-il spécialisé pour ce GN ? */
export function estSpecialise(smr, csarr, gn) {
  const liste = smr.classification._listeSpeParGn.get(gn);
  return !!liste && !!smr.actesSpe._parCode.get(csarr)?.has(liste);
}

// ==== CMA (volume 1, 5.2) ====

/** La CMA `cma` est-elle exclue par le code orientant `orientant` ? Les
 *  listes sont des plages de clefs, dans l'ordre de CIM_infos_SMR trié. */
export function estExclue(smr, cma, orientant) {
  const index = smr.exclusions.cma[graphie(cma)];
  if (index == null) return false;
  const c = cle(orientant);
  // Les plages ne valent que pour les codes de CIM_infos_SMR : un code
  // inconnu compris entre deux bornes n'y figure pas pour autant.
  if (!smr.diagnostics._parCle.has(c)) return false;
  return smr.exclusions.listes[index].some(([a, b]) => c >= a && c <= b);
}
