// Fonction groupage SMR — chargement des jeux produits par
// scripts/build_smr.py, et ce que plusieurs thèmes SMR lisent de la même
// façon : graphie des codes, libellés des groupes et des modalités CSAR,
// modulateurs de lieu CSARR, positions permises d'un diagnostic et erreurs
// qu'il lève, exclusions des CMA, GN sans niveau de sévérité 2, caractère
// spécialisé d'un acte. Les règles du groupage elles-mêmes (volume 1 du
// Manuel des GME, data/smr/groupage/manuel_gme_volume_1.pdf) sont
// mises en arbres par smr_arbre.js, que dessine l'algorithme.
//
// Rien ici ne touche au DOM : les fonctions reçoivent les jeux chargés en
// argument (`smr`, cf. chargerSmr). Partagé par les thèmes SMR : fiche code,
// listes, algorithme, tarifs, pondérations, transcodage CSAR, CMA, erreurs.

import { chargerJeu, chargerJson } from "./donnees.js";
import { nombre } from "./interface.js";
import * as recherche from "./recherche.js";

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

/** La classification (brute) et ses index : tests par CM, GME par GL. Les
 *  tables de la réadaptation (listes d'actes spécialisés, intervenants,
 *  modulateurs, CSAR : readaptation/referentiel.json) la rejoignent : les
 *  thèmes lisent un seul objet, quelle que soit la section de la source. */
export function chargerClassification() {
  return Promise.all([chargerJson("smr/groupage", "classification"), chargerJson("smr/readaptation", "referentiel")]).then(([k, r]) =>
    indexerClassification(k, r)
  );
}

/** Les codes CIM-10, indexés par clef sans point. */
export function chargerDiagnostics() {
  return chargerJeu("smr/groupage", "diagnostics", LIBELLES.diagnostics).then(indexerDiagnostics);
}

export function chargerExclusions() {
  return chargerJson("smr/groupage", "exclusions");
}

/** Pondérations : code → lignes (une « 00 », ou une par intervenant). */
export function chargerActes() {
  return chargerJeu("smr/readaptation", "actes", LIBELLES.actes).then(indexerActes);
}

/** Listes d'actes spécialisés : code → numéros de liste. */
export function chargerActesSpe() {
  return chargerJeu("smr/readaptation", "actes_spe", LIBELLES.actesSpe).then(indexerActesSpe);
}

/** Transcodage CSAR : code CSAR → lignes (une par intervenant et modalité). */
export function chargerCsar() {
  return chargerJeu("smr/readaptation", "csar", LIBELLES.csar).then(indexerCsar);
}

/** Tarifs des GMT : GME → lignes, GMT principal d'abord. */
export function chargerTarifsSmr() {
  return chargerJeu("smr/groupage", "tarifs", LIBELLES.tarifs).then(indexerTarifsSmr);
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

// ==== Index des jeux ====

// Posés une fois sur le jeu chargé, que les chargeurs gardent en cache :
// chaque fonction reçoit le JSON brut (classification.json et
// referentiel.json, ou un jeu de chargerJeu), le complète et le rend.

/** La classification et le référentiel de la réadaptation réunis, avec
 *  leurs index : tests d'entrée par CM, dans l'ordre de leur rang, actes
 *  CCAM CMA, erreurs de FG_erreurs, liste d'actes spécialisés de chaque GN. */
export function indexerClassification(k, r) {
  if (!k._testsParCm) {
    Object.assign(k, r, { millesimes: { ...k.millesimes, ...r.millesimes } });
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
}

/** Codes CIM-10 : clef sans point → ligne. */
export function indexerDiagnostics(jeu) {
  if (!jeu._parCle) jeu._parCle = new Map(jeu.lignes.map((l) => [cle(l.Code), l]));
  return jeu;
}

/** Pondérations : code → lignes (une « 00 », ou une par intervenant). */
export function indexerActes(jeu) {
  if (!jeu._parCode) {
    jeu._parCode = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._parCode.has(l.Code)) jeu._parCode.set(l.Code, []);
      jeu._parCode.get(l.Code).push(l);
    }
  }
  return jeu;
}

/** Listes d'actes spécialisés : code → numéros de liste. */
export function indexerActesSpe(jeu) {
  if (!jeu._parCode) {
    jeu._parCode = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._parCode.has(l.Code)) jeu._parCode.set(l.Code, new Set());
      jeu._parCode.get(l.Code).add(l.Liste);
    }
  }
  return jeu;
}

/** Transcodage CSAR : code CSAR → lignes (une par intervenant et modalité). */
export function indexerCsar(jeu) {
  if (!jeu._parCode) {
    jeu._parCode = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._parCode.has(l["Code CSAR"])) jeu._parCode.set(l["Code CSAR"], []);
      jeu._parCode.get(l["Code CSAR"]).push(l);
    }
  }
  return jeu;
}

/** Tarifs des GMT : GME → lignes, GMT principal d'abord. */
export function indexerTarifsSmr(jeu) {
  if (!jeu._parGme) {
    jeu._parGme = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._parGme.has(l.GME)) jeu._parGme.set(l.GME, []);
      jeu._parGme.get(l.GME).push(l);
    }
    for (const lignes of jeu._parGme.values()) lignes.sort((a, b) => (a.GMT < b.GMT ? -1 : 1));
  }
  return jeu;
}

// ==== Libellés ====

/** Libellé long d'un groupe (CM, GN, GR, GL, GME), ou chaîne vide. */
export function libelleGroupe(k, code) {
  const quoi = { 2: "CM", 4: "GN", 5: "GR", 6: "GL", 7: "GME" }[code.length];
  return k.groupes[quoi]?.[code]?.[1] ?? "";
}

/** Libellé d'un intervenant de la réadaptation (code à deux chiffres). */
export function libelleIntervenant(k, iv) {
  return k.intervenants[iv] ?? `intervenant ${iv}`;
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

// Colonne « acte_coll » de CSAR_infos.xlsx (lisez-moi).
export const MODALITES = { 0: "individuel", 1: "collectif", 2: "individuel ou collectif" };

// Modulateurs de lieu CSARR qui majorent la pondération (3.3.1.4) : les
// seuls que note ACTES_ponderations, une colonne chacun.
export const MODULATEURS_LIEU = ["HW", "LJ", "XH", "L3"];

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

/** Les GN pour lesquels un acte CSARR ou CCAM est spécialisé, par liste
 *  d'actes spécialisés : [{ liste, gns }]. La liste des GN vient de
 *  estSpecialise, le test même de la fonction groupage. */
export function specialisation(smr, csarr) {
  const k = smr.classification;
  const listes = [...(smr.actesSpe._parCode.get(csarr) ?? [])].sort();
  const gns = Object.keys(k.groupes.GN).filter((gn) => estSpecialise(smr, csarr, gn));
  return listes.map((liste) => ({ liste, gns: gns.filter((gn) => k._listeSpeParGn.get(gn) === liste) }));
}

// ==== Transcodage CSAR (volume 1, 3.1.1) ====

// Tableau 4 du volume 1 (3.3.1.4) : le modulateur de lieu CSARR que devient
// chaque modulateur CSAR au transcodage.
export const LIEUX_TRANSCODES = { L1: "HW ou LJ", L2: "XH", L3: "L3" };

/** Transcodage CSAR à rebours : code CSARR → lignes de csar.json. */
export function csarVers(smr, csarr) {
  const jeu = smr.csar;
  if (!jeu._ficheParCsarr) {
    jeu._ficheParCsarr = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._ficheParCsarr.has(l["Code CSARR"])) jeu._ficheParCsarr.set(l["Code CSARR"], []);
      jeu._ficheParCsarr.get(l["Code CSARR"]).push(l);
    }
  }
  return jeu._ficheParCsarr.get(csarr) ?? [];
}

/** Lignes de transcodage regroupées par transcodage identique — même
 *  modalité, même CSARR, mêmes pondérations — pour qu'un acte CSAR à 32
 *  intervenants tienne en quelques lignes. Groupes par modalité, le plus
 *  nombreux d'abord. `parCsar` (code CSAR → toutes ses lignes) donne le
 *  nombre d'intervenants de chaque acte CSAR, que `lignes` peut ne donner
 *  qu'en partie (fiche d'un CSARR : les seules lignes transcodées en lui). */
export function regrouperTranscodage(lignes, parCsar) {
  const groupes = new Map();
  for (const l of lignes) {
    const clef = [l["Modalité"], l["Code CSARR"], l["Pondération CSARR"], l["Pondération CSAR"], l["Équivalent"]].join("|");
    if (!groupes.has(clef)) {
      groupes.set(clef, {
        csar: l["Code CSAR"],
        libelleCsar: l["Libellé CSAR"],
        modalite: l["Modalité"],
        csarr: l["Code CSARR"],
        libelleCsarr: l["Libellé CSARR"],
        ponderation: l["Pondération CSARR"],
        fichierCsar: l["Pondération CSAR"],
        equivalent: l["Équivalent"],
        intervenants: [],
      });
    }
    groupes.get(clef).intervenants.push(l.Intervenant);
  }
  // Nombre d'intervenants transcodés pour chaque acte et modalité : le
  // dénominateur de « tous les intervenants ».
  const total = (csar, modalite) =>
    new Set(parCsar.get(csar).filter((l) => l["Modalité"] === modalite).map((l) => l.Intervenant)).size;
  return [...groupes.values()]
    .map((g) => ({ ...g, ecart: g.ponderation !== g.fichierCsar, total: total(g.csar, g.modalite) }))
    .sort((a, b) => (a.csar === b.csar ? 0 : a.csar < b.csar ? -1 : 1) || a.modalite - b.modalite || b.intervenants.length - a.intervenants.length);
}

/** Les intervenants propres au CSAR, transposés avant le transcodage
 *  (3.3.1.2) : `intervenants`, leurs codes ; `cibles`, les intervenants
 *  CSARR qu'ils deviennent, sans doublon. */
export function transpositionCsar(k) {
  return {
    intervenants: Object.keys(k.csar.transposition),
    cibles: [...new Set(Object.values(k.csar.transposition))],
  };
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

// Nombre de codes de chaque liste d'exclusion, calculé une fois par jeu
// d'exclusions et de diagnostics chargés, sans toucher aux objets que
// partagent les thèmes.
const taillesParJeu = new WeakMap();

/** Nombre de codes de la liste d'exclusion `index` : les plages ont pour
 *  bornes des clefs de CIM_infos_SMR, dans l'ordre trié (build_smr.py), on
 *  compte les clefs comprises entre elles. Une plage dont une borne n'est
 *  pas dans CIM_infos_SMR ne compte pas. */
export function tailleListeExclusion(diagnostics, exclusions, index) {
  if (!taillesParJeu.has(exclusions)) taillesParJeu.set(exclusions, new WeakMap());
  const parDiagnostics = taillesParJeu.get(exclusions);
  if (!parDiagnostics.has(diagnostics)) {
    // Tri par unités de code, comme le `sorted` de Python : les clefs ne
    // portent que des capitales, des chiffres et « + ».
    const cles = [...diagnostics._parCle.keys()].sort();
    const rang = new Map(cles.map((c, i) => [c, i]));
    const taille = (plages) => {
      let n = 0;
      for (const [a, b] of plages) if (rang.has(a) && rang.has(b)) n += rang.get(b) - rang.get(a) + 1;
      return n;
    };
    parDiagnostics.set(diagnostics, exclusions.listes.map(taille));
  }
  return parDiagnostics.get(diagnostics)[index];
}

/** Les GN sans niveau de sévérité 2 : leurs GME d'HC finissent tous par 1
 *  (5.2.3). En 2026, le seul GN 2303, soins palliatifs, comme le contrôle
 *  verifier_gme de build_smr.py. */
export function gnSansSeverite2(k) {
  const gmes = Object.keys(k.groupes.GME);
  return Object.keys(k.groupes.GN).filter(
    (gn) => gmes.some((gme) => gme.startsWith(gn) && gme.endsWith("1")) && !gmes.some((gme) => gme.startsWith(gn) && gme.endsWith("2"))
  );
}

// ==== Fiche code : saisie et suggestions ====

const SUGGESTIONS_MAX = 12;

/** Clef de comparaison d'une saisie à un code : capitales, sans point,
 *  espace ni « + » — « alq247 » trouve ALQ+247, « i634 » trouve I63.4. */
export const clefSaisie = (texte) => String(texte ?? "").toUpperCase().replace(/[\s.+]/g, "");

function entree(code, nature, libelle) {
  return { code, nature, libelle, clef: clefSaisie(code), texte: recherche.normaliser(libelle) };
}

/** Les entrées de suggestion, construites une fois par jeu chargé et
 *  gardées sur l'objet du jeu : jamais recalculées à la frappe. Les actes
 *  CCAM CMA qui ne sont pas des actes de réadaptation (EBLA003…) rejoignent
 *  les actes : ils ont eux aussi leur fiche. */
function listesSuggestion(smr) {
  const { diagnostics, actes, csar, classification: k } = smr;
  if (!diagnostics._ficheSuggestions) {
    diagnostics._ficheSuggestions = diagnostics.lignes.map((l) => entree(l.Code, "CIM-10", l["Libellé"]));
  }
  if (!actes._ficheSuggestions) {
    const entrees = [...actes._parCode].map(([c, lignes]) => entree(c, lignes[0].Nomenclature, lignes[0]["Libellé"]));
    for (const [c, libelle] of k._cmaCcam) if (!actes._parCode.has(c)) entrees.push(entree(c, "CCAM", libelle));
    // ACTES_ponderations.xlsx est rangé par hiérarchie : trié par code, un
    // début de code propose d'abord le code exact.
    actes._ficheSuggestions = entrees.sort((a, b) => (a.code < b.code ? -1 : 1));
  }
  if (!csar._ficheSuggestions) {
    csar._ficheSuggestions = [...csar._parCode].map(([c, lignes]) => entree(c, "CSAR", lignes[0]["Libellé CSAR"]));
  }
  return [diagnostics._ficheSuggestions, actes._ficheSuggestions, csar._ficheSuggestions];
}

/** Suggestions : par début de code d'abord, puis par mots du libellé. Une
 *  saisie qui a la forme d'un début de code (« i63 », « 01E », « alq+2 »,
 *  « ahqp ») ne se cherche pas dans les libellés, où elle ne trouverait que
 *  du bruit. Diagnostics, puis actes, puis actes CSAR ; douze au plus. */
export function chercher(smr, saisie) {
  const q = saisie.trim();
  if (q.length < 2) return [];
  const clef = clefSaisie(q);
  const compacte = q.replace(/\s+/g, "");
  const commeCode = /^([a-z]\d|\d{2}|[a-z]{3}\+|[a-z]{4}\d)/i.test(compacte);
  const mots = recherche.normaliser(q).split(/\s+/).filter(Boolean);
  const parTexte = !commeCode && q.length >= 3;
  const parCode = [];
  const parMots = [];
  for (const entrees of listesSuggestion(smr)) {
    for (const e of entrees) {
      if (clef && e.clef.startsWith(clef)) {
        parCode.push(e);
        if (parCode.length >= SUGGESTIONS_MAX) return parCode;
      } else if (parTexte && parMots.length < SUGGESTIONS_MAX && mots.every((m) => e.texte.includes(m))) {
        parMots.push(e);
      }
    }
  }
  return [...parCode, ...parMots].slice(0, SUGGESTIONS_MAX);
}

/** La saisie (champ ou lien profond) rapportée à une fiche : { nature,
 *  code, affiche, connu, … }. `affiche` est la graphie de l'adresse et du
 *  titre (« I63.4 », « ALQ+247 »). CSARR, puis CSAR, CCAM et CIM-10 ;
 *  `nature` nulle pour une saisie qui n'a la forme d'aucun code. */
export function trouver(smr, saisie) {
  const k = smr.classification;
  const brut = String(saisie ?? "").trim().toUpperCase().replace(/\s+/g, "");
  // CSARR saisi sans son « + » (« ALQ247 ») : aucune autre nomenclature
  // n'a cette forme.
  const csarr = /^[A-Z]{3}\d{3}$/.test(brut) ? `${brut.slice(0, 3)}+${brut.slice(3)}` : brut;
  if (RE_CSARR.test(csarr)) {
    const lignes = smr.actes._parCode.get(csarr);
    return { nature: "CSARR", code: csarr, affiche: csarr, connu: !!lignes, lignes };
  }
  if (RE_CSAR.test(brut)) {
    const lignes = smr.csar._parCode.get(brut);
    return { nature: "CSAR", code: brut, affiche: brut, connu: !!lignes, lignes };
  }
  // Code CCAM suivi de sa phase ou de son activité (« EBLA0030 »,
  // « AHQP002-10 ») : ni les pondérations ni les CMA n'en tiennent compte.
  if (/^[A-Z]{4}\d{3}/.test(brut)) {
    const c = brut.slice(0, 7);
    const lignes = smr.actes._parCode.get(c);
    const cma = k._cmaCcam.get(c);
    return { nature: "CCAM", code: c, affiche: c, connu: !!lignes || cma != null, lignes, cma };
  }
  if (brut && RE_CIM.test(cle(brut))) {
    const diag = smr.diagnostics._parCle.get(cle(brut));
    return { nature: "CIM-10", code: cle(brut), affiche: graphie(brut), connu: !!diag, diag };
  }
  // Saisie qui n'a la forme d'aucun code (« hémiplégie droite ») : montrée
  // telle quelle, pas en capitales collées (« HÉMIPLÉGIEDROITE »).
  return { nature: null, code: brut, affiche: String(saisie ?? "").trim(), connu: false };
}

// ==== Fiche d'un diagnostic ====

// Lisez-moi de CIM_infos_SMR.xlsx (colonne « Profil ») : un caractère par
// position — MMP, AE, DAS —, O pour oui, N pour non.
export const PROFILS = {
  NNN: "code non utilisable ; il s'agit en particulier de codes pères, dont l'extension est obligatoire",
  NNO: "code autorisé seulement en DAS",
  NOO: "code autorisé seulement en AE et en DAS ; il s'agit en particulier de codes séquelles",
  ONO: "code autorisé seulement en MMP et en DAS ; il s'agit en particulier de codes symptômes",
  OOO: "code autorisé aux trois positions",
};

// Conditions du seul test écrit en toutes lettres (GN 0871, fractures
// multiples), telles que les donne GN_liste_tests.xlsx ; build_smr.py les
// réduit à ces deux mots-clefs.
export const CONDITIONS = {
  mmpPrioritaire: "Si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant.",
  quatreCaracteresDifferents:
    "Les 4 premiers caractères du code classant en DAS doivent être différents des 4 premiers caractères du code classant en MMP ou AE.",
};

/** Ce que le code fait de l'orientation en CM, selon les positions que son
 *  profil permet : seules la MMP et l'AE orientent en CM (2.2.1), un code
 *  permis seulement en DAS n'y joue aucun rôle. `cas` : « aucuneCm » (CM
 *  90), « dasSeulement », « premiereIntention » ou « deuxiemeIntention » ;
 *  `mmp` et `ae` : positions permises. */
export function roleOrientation(diag) {
  const mmp = positionAutorisee(diag, "MMP");
  const ae = positionAutorisee(diag, "AE");
  if (!orienteDansCm(diag)) return { cas: "aucuneCm", mmp, ae };
  if (!mmp && !ae) return { cas: "dasSeulement", mmp, ae };
  if (!diag["Deuxième intention"]) return { cas: "premiereIntention", mmp, ae };
  return { cas: "deuxiemeIntention", mmp, ae };
}

/** Le code à chaque position : permise ou non, et l'erreur qu'il y
 *  lèverait — celles du contrôle des diagnostics (controlerDiagnostics),
 *  plutôt qu'une table recopiée. Le même code aux trois positions ajoute
 *  l'erreur 69 (AE = MMP), écartée. → [{ position, permise, erreur,
 *  bloquante }] */
export function erreursParPosition(smr, diag) {
  const k = smr.classification;
  const erreurs = controlerDiagnostics(smr, { mmp: diag.Code, ae: diag.Code, das: [diag.Code] }).filter((e) => e.code !== 69);
  return POSITIONS.map((p) => {
    const erreur = erreurs.find((e) => e.position === p);
    const bloquante = erreur && k._erreurs.get(erreur.code)?.bloquant !== false;
    return { position: p, permise: positionAutorisee(diag, p), erreur, bloquante };
  });
}

/** Les codes plus précis que regroupe un code non utilisable (profil
 *  NNN) : ceux qui prolongent la clef du code père, utilisables eux. */
export function codesPlusPrecis(diagnostics, code) {
  const clef = cle(code);
  return diagnostics.lignes.filter((l) => {
    const c = cle(l.Code);
    return c !== clef && c.startsWith(clef) && l.Profil !== "NNN";
  });
}

/** Tests d'entrée en GN qui emploient chaque liste D-xxxx : liste →
 *  [{ noeud, test, rang }], `rang` 0 ou 1 (premier ou second test du nœud). */
export function testsParListe(k) {
  if (!k._ficheTestsParListe) {
    const index = new Map();
    for (const noeud of k.tests) {
      noeud.tests.forEach((test, rang) => {
        if (!index.has(test.liste)) index.set(test.liste, []);
        index.get(test.liste).push({ noeud, test, rang });
      });
    }
    k._ficheTestsParListe = index;
  }
  return k._ficheTestsParListe;
}

/** Les listes d'entrée en GN du code et les tests qui les emploient :
 *  [{ liste, usages }], chaque usage `{ noeud, test, rang, nbTests,
 *  autreCm, autre }` — `nbTests`, nombre de nœuds de la CM du test ;
 *  `autre`, l'autre test du nœud s'il en a deux. */
export function usagesDesListes(k, diag) {
  const index = testsParListe(k);
  return diag.Listes.map((liste) => ({
    liste,
    usages: (index.get(liste) ?? []).map(({ noeud, test, rang }) => ({
      noeud,
      test,
      rang,
      nbTests: k._testsParCm.get(noeud.cm)?.length ?? 0,
      // Les tests sont propres à chaque CM (2.2.2) : un test d'une autre
      // CM que celle du code ne le lit que dans un RHS classé dans cette
      // CM par un autre code. Un test en DAS, lui, lit tous les DAS.
      autreCm: noeud.cm !== diag.CM && !test.positions.includes("DAS"),
      autre: noeud.tests[1 - rang],
    })),
  }));
}

/** Ce que la fiche dit d'un diagnostic CMA : sa liste d'exclusion
 *  (`index`, null s'il n'en a pas) et le nombre de codes qu'elle compte,
 *  et les GN sans niveau de sévérité 2. Null si le code n'est pas une CMA. */
export function cmaDuDiagnostic(smr, diag) {
  if (!diag.CMA) return null;
  const index = smr.exclusions.cma[graphie(diag.Code)] ?? null;
  return {
    index,
    taille: index == null ? 0 : tailleListeExclusion(smr.diagnostics, smr.exclusions, index),
    sansNiveau2: gnSansSeverite2(smr.classification),
  };
}

/** « Exclue par ce code orientant ? » : estExclue, le test même de la
 *  fonction groupage, sur un code saisi. Un code inconnu est signalé avant
 *  (`orientant` nul) : entre deux bornes de plage, il passerait pour exclu. */
export function exclusionParOrientant(smr, cma, saisie) {
  const orientant = smr.diagnostics._parCle.get(cle(saisie));
  if (!orientant) return { orientant: null, exclue: false };
  return { orientant: orientant.Code, exclue: estExclue(smr, cma, orientant.Code) };
}

// ==== Fiche d'un acte ====

/** « Pondération 35 pour 29 intervenants ; 130 pour neuropsychologue (33),
 *  psychotechnicien (72) ; 85 pour orthophoniste (24). » */
export function resumePonderations(k, lignes) {
  const parValeur = new Map();
  for (const l of lignes) {
    if (!parValeur.has(l["Pondération"])) parValeur.set(l["Pondération"], []);
    parValeur.get(l["Pondération"]).push(l.Intervenant);
  }
  const morceaux = [...parValeur]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([valeur, ivs]) => {
      const qui =
        ivs.length > 4
          ? `${nombre(ivs.length)} intervenants`
          : ivs.map((iv) => `${libelleIntervenant(k, iv).toLowerCase()} (${iv})`).join(", ");
      return `${valeur}${valeur === 0 ? " (non attendu)" : ""} pour ${qui}`;
    });
  return `Pondération différenciée selon l'intervenant : ${morceaux.join(" ; ")}.`;
}

/** Erreurs non bloquantes de FG_erreurs dont la liste d'actes cite
 *  celui-ci : [{ numero, erreur }], `erreur` lue dans k._erreurs. */
export function erreursDeLActe(k, c) {
  return ["162", "163"]
    .filter((numero) => (k.actesErreurs[numero] ?? []).some(([a]) => a === c))
    .map((numero) => ({ numero, erreur: k._erreurs.get(Number(numero)) }));
}

/** Les modulateurs de lieu qui majorent la pondération (MODULATEURS_LIEU),
 *  acceptés ou non par l'acte (sa ligne de ACTES_ponderations) :
 *  [{ modulateur, libelle, individuel, collectif, accepte }], majorations
 *  « en individuel » et « en collectif » (null : sans objet). */
export function modulateursLieu(k, ligne) {
  return MODULATEURS_LIEU.map((m) => {
    const [, libelle, individuel, collectif] = k.modulateurs.find(([c]) => c === m) ?? [m, "", 0, null];
    return { modulateur: m, libelle, individuel, collectif, accepte: !!ligne[m] };
  });
}

/** Ce que la fiche d'un acte CSARR ou CCAM (résolu par trouver) en dit : sa
 *  première ligne de ACTES_ponderations et son libellé, son caractère de
 *  CMA CCAM, ses listes d'actes spécialisés (specialisation) et le nombre
 *  de GN qu'elles couvrent, les lignes CSAR transcodées en lui et s'il y a
 *  un écart de pondération, les GN sans niveau de sévérité 2. */
export function caracteristiquesActe(smr, trouve) {
  const k = smr.classification;
  const { code: c, lignes, nature } = trouve;
  const ligne = lignes?.[0];
  const spe = ligne ? specialisation(smr, c) : [];
  const venus = nature === "CSARR" ? csarVers(smr, c) : [];
  return {
    ligne,
    libelle: ligne?.["Libellé"] ?? trouve.cma ?? "",
    cma: k._cmaCcam.has(c),
    spe,
    nbGn: new Set(spe.flatMap((s) => s.gns)).size,
    venus,
    ecarts: venus.some((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]),
    sansNiveau2: gnSansSeverite2(k),
  };
}

/** Ce que la fiche d'un acte CSAR en dit : ses modalités, les modulateurs
 *  qu'il accepte (temps, L1 à L3), son transcodage regroupé
 *  (regrouperTranscodage), les groupes en écart de pondération, le nombre
 *  de lignes « équivalent en pondération », ses CSARR transcodés regroupés
 *  par listes d'actes spécialisés identiques et le nombre de GN couverts,
 *  et `autres` : les groupes qui sont « les autres intervenants » de leur
 *  modalité. */
export function caracteristiquesCsar(smr, { code: c, lignes }) {
  const k = smr.classification;
  const [temps, l1, l2, l3] = k.csar.modulables[c] ?? [false, false, false, false];
  const groupes = regrouperTranscodage(lignes, smr.csar._parCode);
  const csarrs = [...new Set(lignes.map((l) => l["Code CSARR"]))].sort();
  // Les CSARR transcodés d'un même acte CSAR ont souvent les mêmes listes
  // (ALQ+137 et ALQ+247 pour 01E08) : une ligne pour eux tous.
  const spe = [];
  for (const csarr of csarrs) {
    const listes = specialisation(smr, csarr);
    const signature = JSON.stringify(listes);
    const meme = spe.find((x) => x.signature === signature);
    if (meme) meme.csarrs.push(csarr);
    else spe.push({ csarrs: [csarr], listes, signature });
  }
  // Le plus nombreux des groupes d'une modalité est « les autres » quand
  // d'autres groupes existent pour la même modalité.
  const plusNombreux = new Map();
  for (const g of groupes) if (!plusNombreux.has(g.modalite)) plusNombreux.set(g.modalite, g);
  const parModalite = (m) => groupes.filter((g) => g.modalite === m).length;
  return {
    modalites: new Set(lignes.map((l) => l["Modalité"])),
    modulateurs: { temps, L1: l1, L2: l2, L3: l3 },
    groupes,
    ecarts: groupes.filter((g) => g.ecart),
    equivalents: lignes.filter((l) => l["Équivalent"]).length,
    spe,
    nbGn: new Set(spe.flatMap((s) => s.listes.flatMap((x) => x.gns))).size,
    autres: new Set(groupes.filter((g) => plusNombreux.get(g.modalite) === g && parModalite(g.modalite) > 1)),
  };
}
