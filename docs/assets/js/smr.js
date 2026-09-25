// Fonction groupage SMR — chargement des jeux produits par
// scripts/build_smr.py et algorithme de groupage en GME, tel que le décrit le
// volume 1 du Manuel des GME (data/smr/manuel_gme_volume_1.pdf). Les tables
// (tests d'entrée dans les GN, seuils, règles de lourdeur, CMA…) viennent
// des fichiers de l'ATIH ; les règles qui les relient sont transcrites ici,
// chaque fonction citant le paragraphe du manuel qu'elle applique.
//
// Les fonctions de groupage sont pures : elles reçoivent les jeux chargés en
// argument (`smr`, cf. chargerSmr) et ne touchent pas au DOM, pour être
// vérifiées hors du navigateur. Partagé par les thèmes SMR : fiche code,
// listes, algorithme, tarifs, pondérations, transcodage CSAR, CMA.

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
export const RE_CCAM = /^[A-Z]{4}\d{3}$/;
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

/** Nomenclature d'un code saisi : « CIM-10 », « CSARR », « CCAM », « CSAR »
 *  ou null. */
export function nomenclature(code) {
  const brut = normaliserActe(code);
  if (RE_CSARR.test(brut)) return "CSARR";
  if (RE_CSAR.test(brut)) return "CSAR";
  if (RE_CCAM.test(brut)) return "CCAM";
  if (RE_CIM.test(cle(brut))) return "CIM-10";
  return null;
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

// ==== Catégorie majeure (volume 1, 2.2.1 et figure 4) ====

/** { cm, par, etapes } : `par` vaut « MMP », « AE » ou null (CM 90). */
export function orienterCm(smr, { mmp, ae }) {
  const D = smr.diagnostics._parCle;
  const dMmp = mmp ? D.get(cle(mmp)) : null;
  const dAe = ae ? D.get(cle(ae)) : null;
  const etapes = [];
  if (dMmp?.["Deuxième intention"]) {
    etapes.push("La MMP oriente en deuxième intention : l'AE est testée d'abord.");
    if (orienteDansCm(dAe)) {
      etapes.push(`L'AE ${graphie(ae)} oriente dans la CM ${dAe.CM}.`);
      return { cm: dAe.CM, par: "AE", etapes };
    }
    etapes.push(ae ? `L'AE ${graphie(ae)} n'oriente dans aucune CM : retour à la MMP.` : "Pas d'AE : retour à la MMP.");
  }
  if (orienteDansCm(dMmp)) {
    etapes.push(`La MMP ${graphie(mmp)} oriente dans la CM ${dMmp.CM}.`);
    return { cm: dMmp.CM, par: "MMP", etapes };
  }
  etapes.push(`La MMP ${mmp ? graphie(mmp) : "(absente)"} n'oriente dans aucune CM : l'AE est testée.`);
  if (orienteDansCm(dAe)) {
    etapes.push(`L'AE ${graphie(ae)} oriente dans la CM ${dAe.CM}.`);
    return { cm: dAe.CM, par: "AE", etapes };
  }
  etapes.push(ae ? `L'AE ${graphie(ae)} n'oriente dans aucune CM : CM 90.` : "Pas d'AE : CM 90.");
  return { cm: "90", par: null, etapes };
}

// ==== Groupe nosologique (volume 1, 2.2.2 et annexe 7.2) ====

/** Le code appartient-il à la liste D-`liste` ? */
export function dansListe(smr, code, liste) {
  const d = code ? smr.diagnostics._parCle.get(cle(code)) : null;
  return !!d && d.Listes.includes(liste);
}

/** Codes d'une position qui satisfont un test (MMP, AE ou DAS). */
function codesClassants(smr, test, rhs) {
  const trouves = [];
  for (const position of test.positions) {
    const codes = position === "DAS" ? rhs.das ?? [] : [rhs[position.toLowerCase()]].filter(Boolean);
    for (const code of codes) if (dansListe(smr, code, test.liste)) trouves.push({ position, code: cle(code) });
  }
  return trouves;
}

/** Un nœud de l'arbre : ses tests positifs, et les codes qui les ont rendus
 *  positifs (ceux qui « orientent » le RHS dans le GN, que les exclusions de
 *  CMA opposent aux CMA du séjour, 5.2.3). */
export function evaluerNoeud(smr, noeud, rhs) {
  const [t1, t2] = noeud.tests;
  let c1 = codesClassants(smr, t1, rhs);
  const conditions = noeud.conditions ?? [];
  // GN 0871 : si la MMP et l'AE sont classantes, seul le code en MMP est
  // retenu comme classant.
  if (conditions.includes("mmpPrioritaire") && c1.some((c) => c.position === "MMP")) {
    c1 = c1.filter((c) => c.position === "MMP");
  }
  if (!c1.length) return { positif: false, orientants: [] };
  if (!t2) return { positif: true, orientants: c1 };
  let c2 = codesClassants(smr, t2, rhs);
  // GN 0871 : les 4 premiers caractères du code classant en DAS diffèrent
  // de ceux du code classant en MMP ou AE (graphie sans point).
  if (conditions.includes("quatreCaracteresDifferents")) {
    c2 = c2.filter((c) => c1.every((p) => p.code.slice(0, 4) !== c.code.slice(0, 4)));
  }
  if (!c2.length) return { positif: false, orientants: [] };
  return { positif: true, orientants: [...c1, ...c2] };
}

/** { gn, noeud, orientants, parcours, erreur } — `parcours` : chaque nœud
 *  testé avec son résultat, jusqu'au premier positif. */
export function orienterGn(smr, cm, rhs) {
  const k = smr.classification;
  const noeuds = k._testsParCm.get(cm) ?? [];
  const parcours = [];
  for (const noeud of noeuds) {
    const r = evaluerNoeud(smr, noeud, rhs);
    parcours.push({ noeud, positif: r.positif });
    if (r.positif) return { gn: noeud.gn, noeud, orientants: r.orientants, parcours, erreur: null };
  }
  // Erreurs 300 (aucune CM) et 301-314 (aucun GN dans la CM).
  const erreur = cm === "90" ? 300 : k.erreurs.find(([, libelle]) => libelle.endsWith(`dans la CM ${cm}`))?.[0] ?? null;
  return { gn: null, noeud: null, orientants: [], parcours, erreur };
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

// ==== Pondération des actes (volume 1, 3.3.1 et figure 5) ====

/** Ligne de pondération d'un acte CSARR ou CCAM pour un intervenant : la
 *  ligne « 00 » (pondération unique), sinon celle de l'intervenant. Un acte
 *  CCAM a une seule ligne, quel que soit l'intervenant. */
export function lignePonderation(smr, code, intervenant) {
  const lignes = smr.actes._parCode.get(code);
  if (!lignes) return null;
  if (lignes[0].Nomenclature === "CCAM") return lignes[0];
  return lignes.find((l) => l.Intervenant === "00") ?? lignes.find((l) => l.Intervenant === intervenant) ?? null;
}

/** Majoration d'un modulateur de lieu : la table de ACTES_ponderations
 *  (HW, LJ, XH, L3) ou celle du CSAR (L1, L2, L3). */
function majoration(table, code, collectif) {
  const m = table.find(([c]) => c === code);
  if (!m) return 0;
  return (collectif ? m[3] : m[2]) ?? 0;
}

/** Transcodage d'un acte CSAR (3.1.1) : { csarr, ligne } ou { erreur }.
 *  `collectif` : l'acte est codé avec la modalité collective. */
export function transcoderCsar(smr, code, intervenant, collectif) {
  const lignes = smr.csar._parCode.get(code);
  if (!lignes) return { erreur: 91 };
  // Intervenants propres au CSAR (80, 81) transposés en infirmier (3.3.1.2).
  const iv = smr.classification.csar.transposition[intervenant] ?? intervenant;
  const duIntervenant = lignes.filter((l) => l.Intervenant === iv);
  if (!duIntervenant.length) return { erreur: 185 };
  const modalite = collectif ? "1" : "0";
  const ligne = duIntervenant.find((l) => l["Modalité"] === modalite) ?? duIntervenant.find((l) => l["Modalité"] === "2");
  if (!ligne) return { erreur: collectif ? 179 : 185 };
  return { csarr: ligne["Code CSARR"], ligne, intervenantTranscode: iv };
}

/**
 * Pondération d'une réalisation d'acte, et le détail du calcul :
 * - pondération unique, ou selon l'intervenant (0 pour un intervenant non
 *   attendu) ;
 * - en CSAR, la plus élevée de la pondération du modulateur de temps et de
 *   celle du CSARR transcodé (3.3.1.3), sauf intervenant non attendu ;
 * - majoration du modulateur de lieu, individuel ou collectif (3.3.1.4),
 *   sans effet pour un intervenant non attendu ;
 * - multipliée par le nombre de réalisations.
 *
 * `acte` : { code, intervenant, nombre, lieu, temps, collectif }. `lieu` :
 * un modulateur CSARR (HW, LJ, XH, L3) ou CSAR (L1, L2, L3) ; `temps` : T0 à
 * T4 (CSAR seulement) ; `collectif` : modalité collective (CSAR).
 */
export function ponderer(smr, acte) {
  const code = normaliserActe(acte.code);
  const nature = nomenclature(code);
  const nombre = Math.max(1, Number(acte.nombre) || 1);
  const k = smr.classification;
  const detail = [];
  let csarr = code;
  let collectif = false;
  let lieuEligible = false;
  let tempsEligible = false;
  let tableLieu = k.modulateurs;

  if (nature === "CSAR") {
    const t = transcoderCsar(smr, code, acte.intervenant, !!acte.collectif);
    if (t.erreur) return { nature, ponderation: 0, unitaire: 0, erreur: t.erreur, detail };
    csarr = t.csarr;
    collectif = !!acte.collectif;
    detail.push(`Transcodé en ${csarr}${t.intervenantTranscode !== acte.intervenant ? `, intervenant ${t.intervenantTranscode}` : ""}.`);
    const [tps, l1, l2, l3] = k.csar.modulables[code] ?? [false, false, false, false];
    tempsEligible = tps;
    lieuEligible = { L1: l1, L2: l2, L3: l3 }[acte.lieu] ?? false;
    tableLieu = k.csar.lieu;
    acte = { ...acte, intervenant: t.intervenantTranscode };
  } else if (nature !== "CSARR" && nature !== "CCAM") {
    return { nature, ponderation: 0, unitaire: 0, erreur: 82, detail };
  }

  const ligne = lignePonderation(smr, csarr, acte.intervenant);
  if (!ligne) return { nature, csarr, ponderation: 0, unitaire: 0, erreur: nature === "CCAM" ? 88 : 85, detail };
  let unitaire = ligne["Pondération"];
  detail.push(
    ligne.Intervenant === "00" || ligne.Nomenclature === "CCAM"
      ? `Pondération de ${csarr} : ${unitaire}.`
      : `Pondération de ${csarr} pour l'intervenant ${ligne.Intervenant} : ${unitaire}.`
  );
  const attendu = unitaire > 0;
  if (nature !== "CSAR") {
    collectif = ligne.Type === "C";
    lieuEligible = ["HW", "LJ", "XH", "L3"].includes(acte.lieu) && ligne[acte.lieu];
  }
  if (nature === "CSAR" && acte.temps && tempsEligible && attendu) {
    const t = k.csar.temps.find(([c]) => c === acte.temps);
    if (t && t[2] > unitaire) {
      detail.push(`Modulateur de temps ${acte.temps} : ${t[2]}, plus favorable.`);
      unitaire = t[2];
    } else if (t) {
      detail.push(`Modulateur de temps ${acte.temps} : ${t[2]}, moins favorable.`);
    }
  }
  if (acte.lieu && lieuEligible && attendu) {
    const plus = majoration(tableLieu, acte.lieu, collectif);
    if (plus) {
      detail.push(`Modulateur de lieu ${acte.lieu} : +${plus}${collectif ? " (acte collectif)" : ""}.`);
      unitaire += plus;
    }
  }
  if (!attendu) detail.push("Intervenant non attendu : pondération nulle, modulateurs sans effet.");
  return { nature, csarr, collectif, unitaire, nombre, ponderation: unitaire * nombre, detail, erreur: null };
}

/** L'acte (CSARR, CCAM, ou CSAR transcodé) est-il spécialisé pour ce GN ? */
export function estSpecialise(smr, csarr, gn) {
  const liste = smr.classification._listeSpeParGn.get(gn);
  return !!liste && !!smr.actesSpe._parCode.get(csarr)?.has(liste);
}

// ==== Scores de réadaptation (volume 1, 3.3.2) ====

/**
 * Scores d'un séjour d'HC ou d'une semaine d'HTP. `actes` : réalisations
 * pondérées par ponderer() (champ `csarr`). `jours` : { semaine, weekend }
 * pour l'HC (jours de présence du lundi au vendredi ; à défaut, de week-end,
 * 3.3.2.1), { presence } pour l'HTP.
 */
export function calculerScores(smr, actesPonderes, gn, hospitalisation, jours) {
  let spe = 0;
  let glob = 0;
  for (const a of actesPonderes) {
    if (a.erreur) continue;
    glob += a.ponderation;
    if (estSpecialise(smr, a.csarr, gn)) spe += a.ponderation;
  }
  if (hospitalisation === "HTP") {
    const n = Number(jours?.presence) || 0;
    return { globJour: n ? glob / n : null, globSemaine: glob, jours: n };
  }
  const n = Number(jours?.semaine) || Number(jours?.weekend) || 0;
  return { speSejour: spe, speJour: n ? spe / n : null, globSejour: glob, globJour: n ? glob / n : null, jours: n };
}

// ==== Groupe de réadaptation (volume 1, 3.4) ====

/** Test sur un couple de seuils [séjour, jour] : positif quand le score par
 *  jour ET le score par séjour les atteignent (tableau 5). Un seuil absent
 *  de GR_infos (GN 2303 : pas de seuil par séjour) ne s'oppose pas. */
export function testSeuils([seuilSejour, seuilJour], scoreSejour, scoreJour) {
  const sejourOk = seuilSejour == null || (scoreSejour ?? 0) >= seuilSejour;
  const jourOk = seuilJour == null || (scoreJour ?? 0) >= seuilJour;
  return sejourOk && jourOk;
}

/** { type, gr, etapes } pour le GN `gn`. `scores` : cf. calculerScores. */
export function grouperReadaptation(smr, gn, { hospitalisation, age, scores }) {
  const e = smr.classification.gr[gn];
  const etapes = [];
  const fin = (type, raison) => {
    etapes.push(raison);
    return { type, gr: gn + type, etapes };
  };
  const enfant = Number(age) < 18;
  if (hospitalisation === "HTP") {
    if (enfant && e.htp.includes("H")) return fin("H", "Moins de 18 ans et type pédiatrique présent : réadaptation pédiatrique.");
    if (enfant) {
      // 3.4.2.2 : enfant sans type pédiatrique, sans test sur le score.
      if (e.htp.includes("I")) return fin("I", "Moins de 18 ans, pas de type pédiatrique : réadaptation très intense, sans test sur le score.");
      return fin("L", "Moins de 18 ans, pas de type pédiatrique ni très intense : réadaptation indifférenciée.");
    }
    if (e.htp.includes("I")) {
      const [bas, haut] = e.htpSeuils;
      const s = scores?.globJour ?? 0;
      if (s >= haut) return fin("I", `Score global par jour ${arrondi(s)} ≥ ${haut} (seuil très intense).`);
      if (s >= bas) return fin("J", `Score global par jour ${arrondi(s)} ≥ ${bas} (seuil intense) et < ${haut}.`);
      return fin("K", `Score global par jour ${arrondi(s)} < ${bas} (seuil intense) : réadaptation modérée.`);
    }
    return fin("L", "GN non subdivisé en intensités : réadaptation indifférenciée.");
  }
  if (enfant && e.hc.includes("P")) return fin("P", "Moins de 18 ans et type pédiatrique présent : réadaptation pédiatrique.");
  if (enfant) {
    // 3.4.1.2 : enfant sans type pédiatrique, sans test sur les scores.
    if (e.hc.includes("S")) return fin("S", "Moins de 18 ans, pas de type pédiatrique : réadaptation spécialisée, sans test sur les scores.");
    if (e.hc.includes("T")) return fin("T", "Moins de 18 ans, pas de type pédiatrique ni spécialisé : réadaptation globale, sans test sur les scores.");
    return fin("U", "Moins de 18 ans, pas de type pédiatrique, spécialisé ni global : réadaptation autre.");
  }
  const adultes = e.hc.replace("P", "");
  if (adultes.length === 1) return fin(adultes, `GN non subdivisé sur la réadaptation : type unique « ${TYPES_READAPTATION[adultes]} ».`);
  if (adultes.includes("S")) {
    const ok = testSeuils(e.spe, scores?.speSejour, scores?.speJour);
    etapes.push(
      `Scores spécialisés : ${arrondi(scores?.speSejour)} par séjour (seuil ${e.spe[0] ?? "aucun"}), ${arrondi(scores?.speJour)} par jour (seuil ${e.spe[1] ?? "aucun"}) — test ${ok ? "positif" : "négatif"}.`
    );
    if (ok) return fin("S", "Réadaptation spécialisée importante.");
  }
  if (adultes.includes("T")) {
    const ok = testSeuils(e.glob, scores?.globSejour, scores?.globJour);
    etapes.push(
      `Scores globaux : ${arrondi(scores?.globSejour)} par séjour (seuil ${e.glob[0] ?? "aucun"}), ${arrondi(scores?.globJour)} par jour (seuil ${e.glob[1] ?? "aucun"}) — test ${ok ? "positif" : "négatif"}.`
    );
    if (ok) return fin("T", "Réadaptation globale importante.");
  }
  return fin("U", "Aucun test positif : réadaptation autre.");
}

function arrondi(n) {
  if (n == null) return "–";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

// ==== Groupe de lourdeur (volume 1, 4.2) ====

/** Rang de la classe d'âge dans GL_infos : [0-3] [4-12] [13-17] [18-60]
 *  [61-70] [71-75] [76-80] [81-85] [86 et plus]. */
export function classeAge(age) {
  const bornes = [3, 12, 17, 60, 70, 75, 80, 85];
  const i = bornes.findIndex((b) => age <= b);
  return i === -1 ? bornes.length : i;
}

const ORDRE_NIVEAU = { A: 0, B: 1, C: 2 };

/** Niveau d'une variable ; une règle combinée (4.2.2.1) le lit selon
 *  l'âge : [[min, max|null, niveau], …]. */
function niveauVariable(valeur, age) {
  if (!Array.isArray(valeur)) return valeur;
  const tranche = valeur.find(([min, max]) => age >= min && (max == null || age <= max));
  return tranche ? tranche[2] : null;
}

/** { niveau, gl, detail, erreur } — `detail` : le niveau de chaque variable. */
export function grouperLourdeur(smr, gr, { hospitalisation, age, cog, phy, postChirurgical }) {
  if (hospitalisation === "HTP") return { niveau: "A", gl: gr + "A", detail: [], erreur: null };
  const r = smr.classification.gl[gr];
  const a = Number(age);
  const c = Number(cog);
  const p = Number(phy);
  const detail = [
    { variable: "Âge", valeur: `${a} ans`, niveau: r.age[classeAge(a)] },
    { variable: "Dépendance cognitive", valeur: c, niveau: r.cog[c >= 7 ? 1 : 0] },
    { variable: "Dépendance physique", valeur: p, niveau: niveauVariable(r.phy[p >= 13 ? 2 : p >= 9 ? 1 : 0], a) },
    { variable: "Statut post-chirurgical", valeur: postChirurgical ? "oui" : "non", niveau: r.chir[postChirurgical ? 1 : 0] },
  ];
  if (detail.some((d) => !d.niveau)) return { niveau: null, gl: null, detail, erreur: 402 };
  const niveau = detail.reduce((m, d) => (ORDRE_NIVEAU[d.niveau] > ORDRE_NIVEAU[m] ? d.niveau : m), "A");
  return { niveau, gl: gr + niveau, detail, erreur: null };
}

// ==== Niveau de sévérité (volume 1, 5.2) ====

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

/** Les codes CIM-10 (MMP et DAS des RHS) et actes CCAM CMA du séjour, et
 *  ceux qui restent marqueurs de sévérité une fois les exclusions
 *  appliquées aux codes ayant orienté un RHS dans le GN du séjour (5.2.3). */
export function marqueursSeverite(smr, { rhs, orientants }) {
  const D = smr.diagnostics._parCle;
  const k = smr.classification;
  const vus = new Set();
  const marqueurs = [];
  for (const r of rhs) {
    for (const [position, code] of [["MMP", r.mmp], ...(r.das ?? []).map((d) => ["DAS", d])]) {
      if (!code) continue;
      const c = cle(code);
      if (vus.has(c) || !D.get(c)?.CMA) continue;
      vus.add(c);
      const excluePar = orientants.filter((o) => estExclue(smr, c, o));
      marqueurs.push({ nature: "CIM-10", code: graphie(c), position, excluePar: excluePar.map(graphie), retenu: !excluePar.length });
    }
    for (const acte of r.actesCcam ?? []) {
      const a = normaliserActe(acte).slice(0, 7);
      if (vus.has(a) || !k._cmaCcam.has(a)) continue;
      vus.add(a);
      marqueurs.push({ nature: "CCAM", code: a, excluePar: [], retenu: true });
    }
  }
  return marqueurs;
}

/** { niveau, gme, marqueurs } : 0 en HTP ; 2 en HC avec au moins un
 *  marqueur retenu, si le GL a un niveau 2 (pas le GN 2303) ; 1 sinon. */
export function grouperSeverite(smr, gl, { hospitalisation, rhs, orientants }) {
  if (hospitalisation === "HTP") return { niveau: 0, gme: gl + "0", marqueurs: [] };
  const marqueurs = marqueursSeverite(smr, { rhs, orientants });
  const niveau2 = !!smr.classification.groupes.GME[gl + "2"];
  const niveau = niveau2 && marqueurs.some((m) => m.retenu) ? 2 : 1;
  return { niveau, gme: gl + niveau, marqueurs, niveau2 };
}

// ==== Groupage complet ====

/** Le GN d'un séjour d'HC : le plus fréquent parmi ses 10 premiers RHS ; en
 *  cas d'égalité, le premier dans l'ordre chronologique (2.2.2). */
export function gnDuSejour(gns) {
  const premiers = gns.slice(0, 10).filter(Boolean);
  const compte = new Map();
  for (const g of premiers) compte.set(g, (compte.get(g) ?? 0) + 1);
  const max = Math.max(0, ...compte.values());
  return premiers.find((g) => compte.get(g) === max) ?? null;
}

/**
 * Groupe un séjour d'HC (suite de RHS) ou un RHS d'HTP, étape par étape.
 *
 * `sejour` : {
 *   hospitalisation: "HC" | "HTP",
 *   age,                              // au premier RHS (1.2.3.5)
 *   rhs: [{ mmp, ae, das: [], actesCcam: [] }, …],  // HTP : un seul RHS
 *   cog, phy,                         // maximum des RHS du séjour (1.2.3.6-7)
 *   postChirurgical,                  // intervention ≤ 90 jours (1.2.3.8)
 *   scores,                           // cf. calculerScores
 * }
 *
 * Rend { erreurs, rhs: [{ cm, gn, … }], gn, gr, gl, gme } ; s'arrête à la
 * première étape en erreur (`erreur` : code de FG_erreurs).
 */
export function grouper(smr, sejour) {
  const resultat = { rhs: [], erreur: null, erreurs: [] };
  const liste = sejour.hospitalisation === "HTP" ? sejour.rhs.slice(0, 1) : sejour.rhs;
  for (const r of liste) {
    const erreurs = controlerDiagnostics(smr, r);
    const bloquant = erreurs.find((e) => smr.classification._erreurs.get(e.code)?.bloquant !== false);
    if (bloquant) {
      resultat.rhs.push({ erreurs, cm: null, gn: null });
      continue;
    }
    const cm = orienterCm(smr, r);
    const gn = orienterGn(smr, cm.cm, r);
    resultat.rhs.push({ erreurs, cm, gn });
  }
  const gns = resultat.rhs.map((r) => r.gn?.gn ?? null);
  const gn = sejour.hospitalisation === "HTP" ? gns[0] : gnDuSejour(gns);
  if (!gn) {
    const premier = resultat.rhs.find((r) => r.erreurs.length || r.gn?.erreur);
    resultat.erreur = premier?.erreurs[0]?.code ?? premier?.gn?.erreur ?? 300;
    return resultat;
  }
  resultat.gn = gn;
  // Codes ayant orienté un RHS du séjour dans le GN retenu.
  const orientants = [
    ...new Set(resultat.rhs.filter((r) => r.gn?.gn === gn).flatMap((r) => r.gn.orientants.map((o) => o.code))),
  ];
  resultat.orientants = orientants;
  const gr = grouperReadaptation(smr, gn, sejour);
  resultat.gr = gr;
  const gl = grouperLourdeur(smr, gr.gr, sejour);
  resultat.gl = gl;
  if (gl.erreur) {
    resultat.erreur = gl.erreur;
    return resultat;
  }
  const gme = grouperSeverite(smr, gl.gl, { hospitalisation: sejour.hospitalisation, rhs: liste, orientants });
  resultat.gme = gme;
  if (!smr.classification.groupes.GME[gme.gme]) resultat.erreur = 402;
  return resultat;
}
