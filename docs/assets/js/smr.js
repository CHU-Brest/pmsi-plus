// Fonction groupage SMR — chargement des jeux produits par
// scripts/build_smr.py et leurs index ; ce que plusieurs thèmes SMR lisent
// de la même façon : graphie des codes, libellés des groupes et des
// modalités CSAR, modulateurs de lieu CSARR, positions permises d'un
// diagnostic et erreurs qu'il lève, exclusions des CMA, GN sans niveau de
// sévérité 2, caractère spécialisé d'un acte ; et ce que chaque thème en
// calcule : lignes de ses tableaux, recherche et réécriture des saisies,
// verdicts (CMA, code orientant), résolution d'un code saisi et suggestions
// de la fiche code, ce que disent les fiches d'un diagnostic, d'un acte et
// d'un acte CSAR. Les règles du groupage elles-mêmes (volume 1 du Manuel
// des GME, data/smr/groupage/manuel_gme_volume_1.pdf) sont mises en arbres
// par smr_arbre.js, que dessine l'algorithme.
//
// Rien ici ne touche au DOM : les fonctions reçoivent les jeux chargés en
// argument (`smr`, cf. chargerSmr). Les thèmes SMR — fiche code, listes,
// algorithme, tarifs, pondérations, transcodage CSAR, CMA, erreurs — n'en
// gardent que le dessin.

import { chargerJeu, chargerJson } from "./donnees.js";
import { nombre } from "./interface.js";
import * as recherche from "./recherche.js";

// Ordre de deux chaînes, pour sort().
const comparer = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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

// ==== Codes erreur de FG_erreurs ====

const COLONNES_ERREURS = ["Code", "Libellé"];

/** Une ligne par code erreur de FG_erreurs, une fois par classification :
 *  code, libellé, gravité. */
export function lignesErreurs(k) {
  if (!k._erreursTableau) {
    k._erreursTableau = k.erreurs.map(([code, libelle, bloquant]) => ({
      Code: String(code),
      "Libellé": libelle,
      "Gravité": bloquant ? "bloquante" : "non bloquante",
      _bloquant: bloquant,
    }));
    recherche.indexer(k._erreursTableau, COLONNES_ERREURS);
  }
  return k._erreursTableau;
}

/** Les erreurs dont FG_erreurs donne la liste des actes concernés (162,
 *  163) : [{ code, libelle, actes }], `actes` en couples [acte, libellé]. */
export function actesDesErreurs(k) {
  return Object.entries(k.actesErreurs).map(([code, actes]) => ({
    code,
    libelle: k._erreurs.get(Number(code))?.libelle ?? "",
    actes,
  }));
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

// Au-delà, la liste des intervenants d'une condition se résume.
const INTERVENANTS_CITES_MAX = 4;

/** Pour un acte CSAR : ses CSARR transcodés, chacun avec la condition qui y
 *  mène (modalité, intervenants), la plus fréquente d'abord. */
export function transcodages(lignes, k) {
  const modalites = [...new Set(lignes.map((l) => l["Modalité"]))].sort();
  const resultat = [];
  for (const m of modalites) {
    const deLaModalite = lignes.filter((l) => l["Modalité"] === m);
    const tous = new Set(deLaModalite.map((l) => l.Intervenant));
    const parCsarr = new Map();
    for (const l of deLaModalite) {
      if (!parCsarr.has(l["Code CSARR"])) parCsarr.set(l["Code CSARR"], { lignes: [], intervenants: new Set() });
      const g = parCsarr.get(l["Code CSARR"]);
      g.lignes.push(l);
      g.intervenants.add(l.Intervenant);
    }
    const groupes = [...parCsarr.entries()].sort((a, b) => b[1].intervenants.size - a[1].intervenants.size);
    groupes.forEach(([csarr, g], i) => {
      const morceaux = [];
      if (modalites.length > 1) morceaux.push(MODALITES[m] ?? m);
      if (g.intervenants.size < tous.size) {
        // Le groupe le plus nombreux d'une modalité à plusieurs CSARR :
        // « les autres intervenants », plus lisible que leur liste.
        if (i === 0) morceaux.push("les autres intervenants");
        else morceaux.push(citerIntervenants([...g.intervenants].sort(), k));
      }
      resultat.push({
        csarr,
        libelleCsarr: g.lignes[0]["Libellé CSARR"],
        condition: morceaux.join(", "),
        equivalent: g.lignes.some((l) => l["Équivalent"]),
        ecart: g.lignes.some((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]),
      });
    });
  }
  return resultat;
}

/** Les intervenants d'une condition, « libellé (code) » séparés de
 *  virgules ; au-delà de INTERVENANTS_CITES_MAX, les premiers et le nombre
 *  des autres. */
export function citerIntervenants(codes, k) {
  const noms = codes.map((iv) => `${(k.intervenants[iv] ?? iv).toLowerCase()} (${iv})`);
  if (noms.length <= INTERVENANTS_CITES_MAX) return noms.join(", ");
  return `${noms.slice(0, INTERVENANTS_CITES_MAX).join(", ")} et ${nombre(noms.length - INTERVENANTS_CITES_MAX)} autres`;
}

/** Les deux tables du thème Transcodage et les écarts, une fois par jeu
 *  (gardés sur le jeu, sous un nom préfixé pour ne pas croiser les index
 *  des autres thèmes) : `actes`, chaque acte CSAR et ses CSARR transcodés
 *  (transcodages) ; `csarrs`, la même table lue à l'envers ; `ecarts`, les
 *  lignes dont la pondération du fichier CSAR diffère de celle du CSARR. */
export function preparerCsar(jeu, k) {
  if (jeu._csarVue) return jeu._csarVue;
  const parCsar = new Map();
  for (const l of jeu.lignes) {
    if (!parCsar.has(l["Code CSAR"])) parCsar.set(l["Code CSAR"], []);
    parCsar.get(l["Code CSAR"]).push(l);
  }
  const actes = [...parCsar.entries()]
    .sort((a, b) => comparer(a[0], b[0]))
    .map(([code, lignes]) => {
      const cibles = transcodages(lignes, k);
      return {
        code,
        libelle: lignes[0]["Libellé CSAR"],
        modalites: new Set(lignes.map((l) => l["Modalité"])),
        cibles,
        equivalent: cibles.some((c) => c.equivalent),
        ecart: cibles.some((c) => c.ecart),
      };
    });
  // Sens inverse : chaque CSARR et les actes CSAR qui y mènent, avec la
  // même condition que dans le sens direct.
  const parCsarr = new Map();
  for (const a of actes) {
    for (const c of a.cibles) {
      if (!parCsarr.has(c.csarr)) parCsarr.set(c.csarr, { code: c.csarr, libelle: c.libelleCsarr, sources: [] });
      parCsarr.get(c.csarr).sources.push({ code: a.code, libelle: a.libelle, condition: c.condition, equivalent: c.equivalent });
    }
  }
  const csarrs = [...parCsarr.values()].sort((a, b) => comparer(a.code, b.code));
  for (const a of actes) {
    a._recherche = recherche.normaliser(
      [a.code, a.libelle, ...a.cibles.flatMap((c) => [c.csarr, c.libelleCsarr])].join(" ")
    );
  }
  for (const c of csarrs) {
    c._recherche = recherche.normaliser([c.code, c.libelle, ...c.sources.flatMap((s) => [s.code, s.libelle])].join(" "));
  }
  const ecarts = jeu.lignes.filter((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]);
  jeu._csarVue = { actes, csarrs, ecarts };
  return jeu._csarVue;
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

// ==== Pondérations des actes (volume 1, 3.3) ====

const COLONNES_PONDERATIONS = ["Code", "Libellé", "Spécialisé"];

/** Les modulateurs de lieu qui majorent la pondération (3.3.1.4), dans
 *  l'ordre du référentiel ; les autres (EZ, ME, plateaux techniques…) sont
 *  sans effet sur elle. */
export function modulateursMajorants(k) {
  return k.modulateurs.filter(([code]) => MODULATEURS_LIEU.includes(code));
}

/** Une ligne par acte du thème Pondérations, une fois par jeu (nom
 *  préfixé : le jeu est partagé avec la fiche code) : pondération, unique
 *  ou de min à max selon l'intervenant, listes d'actes spécialisés,
 *  modulateurs de lieu acceptés, validité. */
export function lignesPonderations(actes, spe, k) {
  if (!actes._ponderationsTableau) {
    actes._ponderationsTableau = [...actes._parCode.entries()]
      .map(([code, lignes]) => {
        const l = lignes[0];
        const valeurs = lignes.map((x) => x["Pondération"]);
        const min = Math.min(...valeurs);
        const max = Math.max(...valeurs);
        const listes = [...(spe._parCode.get(code) ?? [])].sort();
        return {
          Code: code,
          Nomenclature: l.Nomenclature,
          Type: l.Type,
          "Pondération": lignes.length === 1 || min === max ? String(min) : `${min} à ${max} selon l'intervenant`,
          "Spécialisé": listes.map((liste) => k.listesSpe[liste]?.libelle ?? liste).join(", "),
          "Lieu": MODULATEURS_LIEU.filter((m) => l[m]).join(" "),
          "Validité": l.Valide ? "valide" : l.Fin ? `supprimé en ${l.Fin}` : "supprimé",
          "Libellé": l["Libellé"],
          _valide: l.Valide,
        };
      })
      .sort((a, b) => (a.Code < b.Code ? -1 : 1));
    recherche.indexer(actes._ponderationsTableau, COLONNES_PONDERATIONS);
  }
  return actes._ponderationsTableau;
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

/** Lignes du tableau des CMA CIM-10, une fois par jeu : code, libellé et
 *  nombre de codes de sa liste d'exclusion (« Codes qui l'excluent »). */
export function lignesCma(diagnostics, exclusions) {
  if (!diagnostics._cmaTableau) {
    diagnostics._cmaTableau = diagnostics.lignes
      .filter((l) => l.CMA)
      .map((l) => {
        const index = exclusions.cma[l.Code];
        return {
          Code: l.Code,
          "Libellé": l["Libellé"],
          "Codes qui l'excluent": index == null ? 0 : tailleListeExclusion(diagnostics, exclusions, index),
        };
      });
    recherche.indexer(diagnostics._cmaTableau, ["Code", "Libellé"]);
  }
  return diagnostics._cmaTableau;
}

/** Codes saisis, séparés par des espaces, des virgules ou des points-virgules. */
export const codesSaisis = (texte) =>
  String(texte ?? "")
    .split(/[\s,;]+/)
    .filter(Boolean);

/** Verdict du vérificateur « Cette CMA compte-t-elle ? » (5.2) sur les
 *  saisies : `candidat`, code CIM-10 ou acte CCAM ; `orientantsSaisis`, les
 *  codes ayant orienté le RHS dans le GN. Null sans candidat ; sinon `cas` :
 *  - « acteCma » : acte CCAM CMA (phase écartée, normaliserActe), marqueur
 *    de sévérité sans exclusion possible ; `code`, l'acte ;
 *  - « inconnu » : ni code de CIM_infos_SMR, ni acte CCAM CMA ; `code` dans
 *    la graphie CIM-10 s'il en a la forme, dans celle d'un acte sinon ;
 *  - « pasCma » : code CIM-10 sans effet sur le niveau de sévérité ;
 *  - « cma » : `orientants` saisis, `excluant` (ceux qui l'excluent),
 *    `inconnus` (absents de CIM_infos_SMR, non vérifiés), `taille` de sa
 *    liste d'exclusion et `exclueParElleMeme`.
 *  `code` (« pasCma », « cma ») et les orientants sont des clefs. */
export function evaluerCma(smr, candidat, orientantsSaisis) {
  const { classification: k, diagnostics, exclusions } = smr;
  const D = diagnostics._parCle;
  const saisie = String(candidat ?? "").trim();
  const orientants = codesSaisis(orientantsSaisis).map(cle);
  if (!saisie) return null;

  const acte = normaliserActe(saisie).slice(0, 7);
  if (k._cmaCcam.has(acte)) return { cas: "acteCma", code: acte };
  const c = cle(saisie);
  const diag = D.get(c);
  if (!diag) {
    // Graphie CIM-10 pour un code qui en a la forme seulement : un acte
    // garde la sienne (« AHQP002 », pas « AHQ.P002 »).
    return { cas: "inconnu", code: RE_CIM.test(c) ? graphie(c) : normaliserActe(saisie) };
  }
  if (!diag.CMA) return { cas: "pasCma", code: c };
  const index = exclusions.cma[graphie(c)];
  return {
    cas: "cma",
    code: c,
    orientants,
    inconnus: orientants.filter((o) => !D.has(o)),
    excluant: orientants.filter((o) => D.has(o) && estExclue({ diagnostics, exclusions }, c, o)),
    taille: index == null ? 0 : tailleListeExclusion(diagnostics, exclusions, index),
    exclueParElleMeme: D.has(c) && estExclue({ diagnostics, exclusions }, c, c),
  };
}

// ==== Listes de la fonction groupage ====

// Colonne GN des listes que n'emploie aucun test d'entrée (D-9001, D-9090).
export const SANS_GN = "Aucun";

// Numéros de GN séparés d'une espace, sans virgule : le tableau partagé
// dimensionne une colonne d'identifiants sur sa valeur la plus longue tant
// qu'aucune ne passe 20 caractères, et sur la longueur moyenne au-delà. Les
// quatre GN de D-0831 font 19 caractères ainsi, 22 avec des virgules : la
// colonne se serait alors réglée sur la moyenne (un seul GN) et tronquée
// jusqu'au numéro seul (« 0… »).
const SEPARATEUR_GN = " ";

// « GN » est volontairement hors de l'index, comme « CMD » en MCO : les
// listes portent le plus souvent le numéro du GN qu'elles ouvrent (D-0103,
// GN 0103), et une liste peut servir à un GN voisin (D-0830 entre dans les
// tests du GN 0831) — chercher « 0831 » ramènerait alors D-0830 à côté de
// D-0831. La colonne reste affichée et triable ; une saisie qui est un
// numéro de GN renvoie à l'algorithme (indicationGnDiagnostics du thème).
const COLONNES_DIAGNOSTICS = ["Liste", "Libellé liste", "Code", "Libellé code"];

/** Liste → GN dont un test d'entrée l'emploie, triés. Gardé sur la
 *  classification, partagée par les thèmes SMR : le nom est préfixé pour
 *  ne pas croiser l'index d'un autre thème. */
export function gnParListe(k) {
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

/** Les listes de diagnostics que n'emploie aucun test d'entrée en GN
 *  (D-9001, D-9090), lues dans les données plutôt qu'écrites en dur. */
export function listesSansTest(k) {
  const gns = gnParListe(k);
  return Object.keys(k.listes)
    .filter((liste) => !gns.has(liste))
    .sort();
}

/** Une ligne par code et par liste, listes dans l'ordre de leur numéro et
 *  codes dans celui de CIM_infos_SMR. Construite et indexée une fois par
 *  jeu chargé (près de 13 000 lignes tirées de 43 000 codes), jamais à la frappe. */
export function lignesDiagnostics(diagnostics, k) {
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
export function corrigerDiagnostics(diagnostics, requete) {
  return requete
    .split(/\s+/)
    .map((mot) => {
      if (/^d-?\d{4}$/i.test(mot) && !diagnostics._parCle.has(cle(mot))) return `D-${mot.slice(-4)}`;
      if (/^[a-z]\d{2}[0-9+]+$/i.test(mot)) return graphie(mot);
      return mot;
    })
    .join(" ");
}

// Ici les GN couverts entrent dans l'index : un code d'acte n'a que trois
// chiffres (ALQ+183, ZZQM004), et les listes ne portent pas de numéro de
// diagnostic avec lequel les confondre. Chercher « 0147 » donne donc les
// actes spécialisés de ce GN, même quand sa liste s'appelle autrement
// (« 0106_09_15_30_45_47_48 », « tous_05 »).
const COLONNES_ACTES = ["Liste", "Libellé liste", "GN couverts", "Code", "Nomenclature", "Libellé"];

/** Une ligne par acte et par liste d'actes spécialisés, listes par CM puis
 *  par nom. */
export function lignesActes(jeu, k) {
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
export function corrigerActes(requete) {
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
export function situationSansListe(k, gn) {
  if (k.gnListeSpe[gn].speUnique) return "unique";
  return k.gr[gn]?.hc.includes("S") ? "specialise" : "sansType";
}

// Les situations de situationSansListe, dans l'ordre où la page les donne.
export const SITUATIONS = {
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

/** Les GN sans liste d'actes spécialisés (« PAS DE LISTE » dans
 *  ACTES_listes_SPE), regroupés par situation : situation → GN triés, dans
 *  l'ordre de SITUATIONS. */
export function gnSansListe(k) {
  const groupes = new Map(Object.keys(SITUATIONS).map((s) => [s, []]));
  for (const [gn, rattachement] of Object.entries(k.gnListeSpe)) {
    if (!rattachement.liste) groupes.get(situationSansListe(k, gn)).push(gn);
  }
  for (const gns of groupes.values()) gns.sort();
  return groupes;
}

// ==== Tarifs des GME (arrêté tarifaire SMR, annexe I) ====

// Colonnes de l'annexe, dans son ordre : bornes en jours, puis montants.
export const DUREES = ["DZF", "FZF"];
export const MONTANTS = ["TZB", "SZB", "TZF1", "TZF2", "TZF3", "SZH"];

const COLONNES_TARIFS = ["GMT", "GME", "Nature", "Libellé"];

// Code de groupe, entier ou en partie : CM (« 01 »), GN (« 0147 »), GR
// (« 0147S »), GL (« 0147SC ») ou GME (« 0147SC2 »). Même forme que dans
// la recherche de l'algorithme (groupeDeRequete, smr_arbre.js).
const RE_CODE_GROUPE = /^\d{2}(?:\d{2}(?:[A-Z](?:[A-Z]\d?)?)?)?$/;
const RE_GMT = /^\d{4}$/;
// Nombre ordinaire de GMT d'un GME d'HC : principal, GMT2, séjours courts.
const GMT_PAR_GME_HC = 3;

const estHtp = (gme) => gme.endsWith("0");

/** Nature d'un GMT, d'après sa tranche de numéros et son libellé : chaque
 *  GME d'HC relève de trois GMT, chaque GME d'HTP d'un seul. */
export function natureGmt(ligne) {
  const n = Number(ligne.GMT);
  if (ligne.GME.endsWith("0")) return "HTP, par journée";
  if (n >= 8000) return "Séjour de moins de 8 jours avec transfert ou décès";
  if (n >= 7000) return "GMT2";
  return "GMT principal";
}

/** Lignes du tableau des tarifs et index de la recherche, une fois par
 *  jeu : le jeu reste en cache d'une page à l'autre, et l'algorithme le
 *  partage (nom préfixé pour ne pas croiser ses index). */
export function preparerTarifs(jeu) {
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
    recherche.indexer(lignes, COLONNES_TARIFS);

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
export function exceptionsHc(jeu) {
  const hcParGn = new Map();
  const groupes = new Map();
  const doublons = new Set();
  for (const [gme, lignes] of jeu._parGme) {
    if (estHtp(gme)) continue;
    const gn = gme.slice(0, 4);
    hcParGn.set(gn, (hcParGn.get(gn) ?? 0) + 1);
    if (lignes.length === GMT_PAR_GME_HC) continue;
    const clef = `${gn} ${lignes.length}`;
    if (!groupes.has(clef)) groupes.set(clef, { gn, nombre: lignes.length, gmes: [] });
    groupes.get(clef).gmes.push(gme);
    const natures = lignes.map(natureGmt);
    if (new Set(natures).size < natures.length) doublons.add(gn);
  }
  const liste = [...groupes.values()]
    .map((g) => ({ ...g, gmes: g.gmes.sort(), complet: g.gmes.length === hcParGn.get(g.gn) }))
    .sort((a, b) => comparer(a.gn, b.gn) || a.nombre - b.nombre);
  return { liste, doublons: [...doublons].sort() };
}

/** Prédicat de la recherche dans les tarifs (`index` : preparerTarifs) :
 *  mots clefs cumulatifs, comme recherche.filtre, sauf qu'un code de groupe
 *  se compare au début du GME et un numéro de GMT (qui n'est pas un début
 *  de GME) au GMT entier. */
export function filtreTarifs(index, requete) {
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

/** « 0147 » saisi seul est lu comme un GN (filtreTarifs) ; s'il est aussi un
 *  numéro de GMT : `{ code, gmes }`, les GME de ce GMT. Null sinon. */
export function homonymeGmt(index, requete) {
  const code = requete.trim().toUpperCase();
  if (!RE_GMT.test(code) || !index.prefixes.has(code) || !index.gmeParGmt.has(code)) return null;
  return { code, gmes: [...new Set(index.gmeParGmt.get(code))] };
}

/** Plus long début commun des GME trouvés, s'il désigne un groupe de
 *  l'algorithme (GN au moins) : l'algorithme s'ouvre sur un GN, placé sur
 *  le GR, le GL ou le GME quand on le lui donne. */
export function groupeCommun(trouvees) {
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
export function erreursActe(k, c) {
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
