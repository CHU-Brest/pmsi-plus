// Arbres de décision de la fonction groupage SMR (volume 1 du Manuel des
// GME), en nœuds de arbre_vue.js : orientation en CM (2.2.1, figure 4),
// tests d'entrée en GN de chaque CM (2.2.2, annexe 7.2), puis, dans chaque
// GN, type de réadaptation (3.4, figures 6 et 7, annexes 7.3 et 7.4),
// niveau de lourdeur (4.2, figure 8, annexe 7.5) et niveau de sévérité
// (5.2.3, figure 9). L'ATIH livre les tables de ces arbres (GN_liste_tests,
// GR_infos, GL_infos), que build_smr.py reprend telles quelles dans
// classification.json ; les règles qui les enchaînent sont celles du volume
// 1, et c'est `construire` qui en fait des nœuds : une règle qui change
// dans une nouvelle version du manuel se reporte ici.
//
// Le profil que lisent arbre_graphe.js et arbre_vue.js — légendes des
// tests et des critères, feuilles et codes d'un nœud, lecture d'une
// requête, adresses, chemins et codes des listes — est ici aussi, avec ce
// que les notes de l'arbre d'un GN calculent.
//
// Rien ici ne touche au DOM : le dessin est celui de themes/smr/arbre.js.

import { nombre } from "./interface.js";
import { cle, gnSansSeverite2, libelleGroupe, TYPES_READAPTATION } from "./smr.js";

export const ORIENTATION = "orientation";
// CM 90 « Erreurs et recueils inclassables » : aucune liste n'y oriente,
// aucun test d'entrée en GN ; elle n'est que l'issue de l'orientation.
export const CM_ERREURS = "90";
// Figure 4 : schéma de groupage en CM.
export const PAGE_ORIENTATION = 19;
const TYPES_HC = ["P", "S", "T", "U"];

// Variables de GL_infos, dans l'ordre du fichier et de l'annexe 7.5, et
// leurs classes : bornes des scores de dépendance (1.2.3.6, 1.2.3.7),
// intervention remontant à plus ou moins de 90 jours (1.2.3.8). Les
// classes d'âge sont celles du fichier (classification.classesAge).
const LOURDEUR = [
  { cle: "age", nom: "âge" },
  { cle: "cog", nom: "dépendance cognitive", classes: [[2, 6], [7, 8]] },
  { cle: "phy", nom: "dépendance physique", classes: [[4, 8], [9, 12], [13, 16]] },
  { cle: "chir", nom: "statut post-chirurgical", classes: ["non", "oui"] },
];

// ==== Textes ====

/** « 4 », « 4 et 9 », « 4, 7 et 9 » ; `mot` lie les deux derniers. */
export function enumeration(elements, mot = "et") {
  if (elements.length < 2) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} ${mot} ${elements.at(-1)}`;
}

/** Une tranche d'âge d'une règle combinée : « de 18 à 70 ans »,
 *  « jusqu'à 80 ans », « à partir de 71 ans ». */
function libelleTranche([min, max]) {
  if (max == null) return `à partir de ${min} ans`;
  if (min === 0) return `jusqu'à ${max} ans`;
  return `de ${min} à ${max} ans`;
}

/** Libellé de la liste d'un test : celui que porte le test dans
 *  GN_liste_tests (« MMP ou AE D-0103 - États… »), à défaut celui de la
 *  liste dans CIM_infos_SMR. */
function libelleListe(k, test) {
  const lu = test.texte.replace(/^.*?D-\d{4}\s*-?\s*/, "").trim();
  return lu || k.listes[test.liste] || "";
}

/** Condition d'un test sur un couple de seuils [séjour, jour] (tableau 5) :
 *  positive quand les deux scores atteignent leur seuil ; un seuil absent
 *  de GR_infos ne s'y oppose pas. */
function conditionSeuils([sejour, jour]) {
  const parties = [];
  if (sejour != null) parties.push(`≥ ${nombre(sejour)} par séjour`);
  if (jour != null) parties.push(`≥ ${nombre(jour)} par jour`);
  if (!parties.length) return "sans seuil dans GR_infos";
  const absent = sejour == null ? "par séjour" : jour == null ? "par jour" : null;
  return `${parties.join(" et ")}${absent ? ` (pas de seuil ${absent})` : ""}`;
}

/** « 0_3 » → [0, 3], « 86_plus » → [86, null]. */
function bornesAge(classe) {
  const [min, max] = classe.split("_");
  return [Number(min), max === "plus" ? null : Number(max)];
}

/** Des classes voisines d'une variable de lourdeur, de `de` à `a` :
 *  « âge de 0 à 3 ans », « âge ≥ 76 ans », « dépendance physique de 9 à
 *  16 », « statut post-chirurgical ». */
function libelleClasses(v, de, a) {
  if (v.cle === "chir") {
    if (de !== a) return "tout statut post-chirurgical";
    return de === "oui" ? "statut post-chirurgical" : "statut non post-chirurgical";
  }
  const [min, max] = [de[0], a[1]];
  if (v.cle === "age") return max == null ? `âge ≥ ${min} ans` : `âge de ${min} à ${max} ans`;
  return `${v.nom} de ${min} à ${max}`;
}

// ==== Lourdeur (volume 1, 4.2) ====

/** Les caractéristiques qui mettent un séjour du GR en niveau C, puis en
 *  niveau B (4.2.1, figure 8) ; `plancher` : le niveau que tout séjour du
 *  GR atteint, celui du GL quand aucune ne joue. Chaque variable donne un
 *  niveau à chacune de ses classes (GL_infos), par tranche d'âge pour une
 *  règle combinée (4.2.2.1) ; des classes voisines de même niveau se lisent
 *  d'un tenant (« dépendance physique de 9 à 16 »). Les classes d'âge de
 *  moins de 18 ans portent les règles pédiatriques (4.2.2.2). */
export function casDeLourdeur(k, gr) {
  const regles = k.gl[gr];
  const conditions = { B: [], C: [] };
  let plancher = "A";
  for (const v of LOURDEUR) {
    const classes = v.cle === "age" ? k.classesAge.map(bornesAge) : v.classes;
    let minimum = "C";
    let courant = null;
    const clore = () => {
      if (courant && courant.niveau in conditions) conditions[courant.niveau].push(libelleClasses(v, courant.de, courant.a));
      courant = null;
    };
    regles[v.cle].forEach((valeur, i) => {
      // Sans objet : âge adulte d'un GR pédiatrique, ou l'inverse.
      if (valeur == null) return clore();
      if (Array.isArray(valeur)) {
        clore();
        for (const [min, max, niveau] of valeur) {
          if (niveau < minimum) minimum = niveau;
          if (niveau in conditions) {
            conditions[niveau].push(`${libelleClasses(v, classes[i], classes[i])} et âge ${libelleTranche([min, max])}`);
          }
        }
        return undefined;
      }
      if (valeur < minimum) minimum = valeur;
      if (courant?.niveau === valeur) courant.a = classes[i];
      else {
        clore();
        courant = { niveau: valeur, de: classes[i], a: classes[i] };
      }
      return undefined;
    });
    clore();
    if (minimum > plancher) plancher = minimum;
  }
  // Une caractéristique qui ne dépasse pas le plancher ne change rien.
  const niveaux = ["C", "B"]
    .filter((n) => n > plancher && conditions[n].length)
    .map((n) => ({ niveau: n, conditions: conditions[n] }));
  return { plancher, niveaux };
}

// ==== Graphe ====

/** Ajoute le nœud `noeud` sous `id` et rend `id`. */
function ajouter(noeuds, id, noeud) {
  noeuds[id] = noeud;
  return id;
}

/** Orientation en CM (2.2.1, figure 4). */
function ajouterOrientation(k, noeuds) {
  const o = { cmd: ORIENTATION, page: PAGE_ORIENTATION };
  const oriente = "Oriente dans une CM";
  ajouter(noeuds, "o-mmp-2e", {
    ...o,
    genre: "test",
    symbole: "MMP",
    branches: [{ libelle: "Code orientant en deuxième intention", listes: [], vers: "o-ae-2e" }],
    sinon: { vers: "o-mmp" },
  });
  // Deuxième intention : l'AE testée d'abord, sinon retour à la MMP.
  ajouter(noeuds, "o-ae-2e", {
    ...o,
    genre: "test",
    symbole: "AE",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-ae" }],
    sinon: { vers: "o-mmp", rejoint: true },
  });
  ajouter(noeuds, "o-mmp", {
    ...o,
    genre: "test",
    symbole: "MMP",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-mmp" }],
    sinon: { vers: "o-ae" },
  });
  ajouter(noeuds, "o-ae", {
    ...o,
    genre: "test",
    symbole: "AE",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-ae" }],
    sinon: { vers: "o-cm-90" },
  });
  ajouter(noeuds, "o-cm-mmp", { ...o, genre: "grille", texte: "CM de la MMP" });
  ajouter(noeuds, "o-cm-ae", { ...o, genre: "renvoi", texte: "CM de l'AE" });
  const e300 = k._erreurs.get(300);
  ajouter(noeuds, "o-cm-90", {
    ...o,
    genre: "erreur",
    etiquette: `CM ${CM_ERREURS}`,
    titre: `${libelleGroupe(k, CM_ERREURS)}, erreur 300${e300 ? ` « ${e300.libelle} »` : ""}`,
    erreur: 300,
  });
}

/** Tests d'entrée en GN de chaque CM (2.2.2, annexe 7.2). */
function ajouterTestsEntree(k, cms, noeuds) {
  // Un nœud à deux tests se dessine en deux étapes : le second test ne se
  // fait que si le premier est positif, et son « non » rejoint le nœud
  // suivant.
  const symbole = (test) => (test.positions.length === 2 ? "MMPAE" : test.positions[0]);
  const branche = (test, vers) => ({
    libelle: `${libelleListe(k, test)} (D-${test.liste})`,
    listes: [`D-${test.liste}`],
    vers,
  });
  for (const cm of cms) {
    const tests = k._testsParCm.get(cm);
    const erreur = k.erreurs.find(([, libelle]) => libelle.endsWith(`dans la CM ${cm}`));
    const idErreur = ajouter(noeuds, `${cm}-erreur`, {
      genre: "erreur",
      cmd: cm,
      page: k.pages.noeuds[`${cm}-${tests.at(-1).ordre}`],
      etiquette: erreur ? `Erreur ${erreur[0]}` : "Non groupé",
      titre: erreur ? erreur[1] : `aucun code erreur de FG_erreurs ne nomme la CM ${cm}`,
      erreur: erreur?.[0] ?? null,
    });
    tests.forEach((t, j) => {
      const id = `${cm}-${t.ordre}`;
      const suivant = j + 1 < tests.length ? `${cm}-${tests[j + 1].ordre}` : idErreur;
      const base = { genre: "test", cmd: cm, page: k.pages.noeuds[id] };
      // Une feuille prend la page du premier test qui y mène.
      const gn = noeuds[t.gn] ? t.gn : ajouter(noeuds, t.gn, { genre: "gn", cmd: cm, page: base.page, code: t.gn });
      const [t1, t2] = t.tests;
      ajouter(noeuds, id, {
        ...base,
        symbole: symbole(t1),
        branches: [branche(t1, t2 ? `${id}-2` : gn)],
        sinon: { vers: suivant },
        conditions: t.conditions ?? [],
        // L'annexe 7.2 et GN_liste_tests.xlsx n'écrivent pas toujours le
        // nœud de même (build_smr.py) : l'arbre suit le fichier.
        ecart: k.ecartsAnnexe?.[id] ?? null,
      });
      if (t2) {
        ajouter(noeuds, `${id}-2`, {
          ...base,
          symbole: symbole(t2),
          branches: [branche(t2, gn)],
          sinon: { vers: suivant, rejoint: suivant !== idErreur },
        });
      }
    });
  }
}

/** Arbre de chaque GN (3.4, 4.2, 5.2.3) ; rend, par GN, le départ de
 *  l'arbre d'HC, celui de l'arbre d'HTP et les types de réadaptation
 *  d'adultes du GN. */
function ajouterArbresGn(k, noeuds) {
  const gmesParGl = new Map();
  for (const gme of Object.keys(k.groupes.GME).sort()) {
    const gl = gme.slice(0, 6);
    if (!gmesParGl.has(gl)) gmesParGl.set(gl, []);
    gmesParGl.get(gl).push(gme);
  }
  const departs = new Map();
  for (const gn of Object.keys(k.groupes.GN).sort()) {
    const e = k.gr[gn];
    const cmd = gn;
    const [pageHc, pageHtp] = [k.pages.grHc[gn], k.pages.grHtp[gn]];
    const critere = (id, variable, libelle, vers, sinon, page, extra = {}) =>
      ajouter(noeuds, id, {
        genre: "critere",
        cmd,
        page,
        variable,
        branches: [{ libelle, listes: [], vers, ...(extra.rejoint ? { rejoint: true } : {}) }],
        sinon: { vers: sinon },
        ...(extra.listeSpe ? { listeSpe: extra.listeSpe } : {}),
      });
    // Un GL d'HC se lit à la page de son GR dans l'annexe 7.5, un GL d'HTP
    // à celle de son GN dans l'annexe 7.4.
    const feuilleGl = (gl) =>
      noeuds[gl]
        ? gl
        : ajouter(noeuds, gl, {
            genre: "gl",
            cmd,
            page: k.pages.gl[gl.slice(0, 5)] ?? pageHtp,
            code: gl,
            gmes: gmesParGl.get(gl) ?? [],
          });

    // HC : pédiatrique, spécialisée, globale, autre (3.4.1, figure 6).
    const adultes = TYPES_HC.filter((t) => t !== "P" && e.hc.includes(t));
    const etapeGr = (type) => {
      const gr = gn + type;
      if (noeuds[gr]) return gr;
      // Lourdeur : niveau C, puis B, sinon le plancher (4.2.1, figure 8).
      const { plancher, niveaux } = casDeLourdeur(k, gr);
      let suite = feuilleGl(gr + plancher);
      for (const { niveau, conditions } of [...niveaux].reverse()) {
        suite = critere(`${gr}-${niveau}`, `Niveau ${niveau} si`, enumeration(conditions, "ou"), feuilleGl(gr + niveau), suite, k.pages.gl[gr]);
      }
      ajouter(noeuds, gr, { genre: "gr", cmd, page: pageHc, code: gr, suite: { vers: suite }, unique: type !== "P" && adultes.length === 1 });
      return gr;
    };
    let suiteAdultes;
    if (adultes.length === 1) {
      // GN non subdivisé sur la réadaptation : type unique (3.4.1.2).
      suiteAdultes = etapeGr(adultes[0]);
    } else {
      suiteAdultes = etapeGr("U");
      if (adultes.includes("T")) {
        suiteAdultes = critere(`${gn}-hc-T`, "Score R global", conditionSeuils(e.glob), etapeGr("T"), suiteAdultes, pageHc);
      }
      if (adultes.includes("S")) {
        suiteAdultes = critere(`${gn}-hc-S`, "Score R spécialisé", conditionSeuils(e.spe), etapeGr("S"), suiteAdultes, pageHc, {
          listeSpe: k.gnListeSpe?.[gn]?.liste,
        });
      }
    }
    let hc = suiteAdultes;
    if (e.hc.includes("P")) {
      hc = critere(`${gn}-hc-age`, "Âge", "< 18 ans", etapeGr("P"), suiteAdultes, pageHc);
    } else if (adultes.length > 1) {
      // Sans type pédiatrique, l'enfant va dans le premier type du GN,
      // sans test sur les scores (3.4.1.2).
      hc = critere(
        `${gn}-hc-age`,
        "Âge",
        `< 18 ans, le GN n'ayant pas de type pédiatrique : ${TYPES_READAPTATION[adultes[0]]}, sans test sur les scores (3.4.1.2)`,
        gn + adultes[0],
        suiteAdultes,
        pageHc,
        { rejoint: true }
      );
    }

    // HTP : pédiatrique, puis très intense, intense, modérée, ou
    // indifférenciée (3.4.2, figure 7) ; lourdeur A et sévérité 0.
    const feuilleHtp = (type) => feuilleGl(`${gn}${type}A`);
    let suiteHtp = feuilleHtp("L");
    if (e.htp.includes("I")) {
      const [intense, tresIntense] = e.htpSeuils;
      const j = critere(`${gn}-htp-J`, "Score R global par jour", `≥ ${nombre(intense)} (seuil intense)`, feuilleHtp("J"), feuilleHtp("K"), pageHtp);
      suiteHtp = critere(`${gn}-htp-I`, "Score R global par jour", `≥ ${nombre(tresIntense)} (seuil très intense)`, feuilleHtp("I"), j, pageHtp);
    }
    let htp = suiteHtp;
    if (e.htp.includes("H")) {
      htp = critere(`${gn}-htp-age`, "Âge", "< 18 ans", feuilleHtp("H"), suiteHtp, pageHtp);
    } else if (e.htp.includes("I")) {
      htp = critere(
        `${gn}-htp-age`,
        "Âge",
        "< 18 ans, le GN n'ayant pas de type pédiatrique : réadaptation très intense, sans test sur le score (3.4.2.2)",
        feuilleHtp("I"),
        suiteHtp,
        pageHtp
      );
    }
    departs.set(gn, { hc, htp, adultes });
  }
  return departs;
}

/** Les arbres du volume 1 en nœuds de arbre_vue.js, construits une fois par
 *  chargement de la classification et gardés sur elle : orientation en CM,
 *  tests d'entrée en GN de chaque CM, arbre de chaque GN. */
export function construire(k) {
  if (k._arbreSmr) return k._arbreSmr;
  const noeuds = {};
  const cms = Object.keys(k.groupes.CM)
    .filter((cm) => cm !== CM_ERREURS && k._testsParCm.has(cm))
    .sort();

  ajouterOrientation(k, noeuds);
  ajouterTestsEntree(k, cms, noeuds);
  const departs = ajouterArbresGn(k, noeuds);

  const listes = Object.fromEntries(
    Object.entries(k.listes).map(([num, libelle]) => [
      `D-${num}`,
      { libelle: libelle || null, nature: "diagnostics", codes: k.effectifsListes?.[num] ?? 0 },
    ])
  );
  const gnsParCm = new Map(cms.map((cm) => [cm, Object.keys(k.groupes.GN).filter((gn) => gn.startsWith(cm)).sort()]));
  k._arbreSmr = { arbre: { noeuds, listes }, cms, gnsParCm, departs };
  return k._arbreSmr;
}

// ==== Profil de l'algorithme (arbre_graphe.js) ====

// Positions des tests d'entrée en GN (annexe 7.2), en cercle comme celles
// du volume 3 du Manuel des GHM.
export const SYMBOLES = {
  MMP: { texte: "MMP", titre: "La manifestation morbide principale (MMP) du RHS", variante: "serre" },
  AE: { texte: "AE", titre: "L'affection étiologique (AE) du RHS" },
  MMPAE: { texte: "MMP ou AE", lignes: ["MMP", "AE"], titre: "La MMP ou l'AE du RHS", variante: "empile" },
  DAS: { texte: "DAS", titre: "L'un au moins des diagnostics associés significatifs (DAS) du RHS", variante: "serre" },
};

export const VARIABLES = {
  Âge: "âge du patient, au premier RHS du séjour en HC, à chaque RHS en HTP (1.2.3.5)",
  "Score R spécialisé":
    "score de réadaptation spécialisée : pondérations des actes de la liste d'actes spécialisés du GN, par séjour et par jour (3.3.2.1)",
  "Score R global":
    "score de réadaptation globale : pondérations des actes CSARR, codés ou transcodés du CSAR, et CCAM de réadaptation, par séjour et par jour (3.3.2.1)",
  "Score R global par jour": "score de réadaptation globale de la semaine, par jour de présence (3.3.2.2)",
  "Niveau C si": "le patient a-t-il une de ses caractéristiques en niveau C ? (4.2.1, figure 8)",
  "Niveau B si": "le patient a-t-il une de ses caractéristiques en niveau B ? (4.2.1, figure 8)",
};

// Conditions du seul test écrit en toutes lettres (GN 0871, fractures
// multiples), telles que les donne GN_liste_tests.xlsx ; build_smr.py les
// réduit à ces deux mots-clefs.
export const CONDITIONS = {
  mmpPrioritaire: "si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant",
  quatreCaracteresDifferents:
    "les 4 premiers caractères du code classant en DAS doivent différer de ceux du code classant en MMP ou AE",
};

// Les genres des feuilles : GN (tests d'une CM), GL (arbre d'un GN), code
// erreur, et les CM où mène l'orientation.
export const FEUILLES = new Set(["gn", "gl", "erreur", "renvoi", "grille"]);

// L'étape propre au SMR : le groupe de réadaptation (GR), en quelques mots.
export const SPECIAL = {
  gr: { court: (n) => `GR ${n.code}` },
};

/** Code ou texte d'une feuille. */
export const texteFeuille = (n) => n.code ?? n.etiquette ?? n.texte;

/** Les codes de groupe que porte un nœud, pour la recherche : un GL et ses
 *  GME, un GN, un GR. */
export const codesNoeud = (n) => (n.genre === "gl" ? [n.code, ...n.gmes] : n.genre === "gn" || n.genre === "gr" ? [n.code] : []);

/** La requête (compactée, en minuscules) lue comme un code de groupe,
 *  entier ou en partie : « 01 », « 0147 », « 0147S », « 0147SC »,
 *  « 0147SC2 » ; null sinon. */
export const groupeDeRequete = (compact) => (/^\d{2}(?:\d{2}(?:[a-z](?:[a-z]\d?)?)?)?$/.test(compact) ? compact : null);

/** « diagnostics » pour une requête qui a la forme d'un code CIM-10, null
 *  sinon. */
export const natureDeCode = (requete) =>
  /^[A-Z]\d{2}(\.?\d*)?[+]?\d*$/.test(requete.trim().toUpperCase().replace(/\s+/g, "")) ? "diagnostics" : null;

/** Le profil de l'algorithme SMR tel que le lit arbre_graphe.js, sans DOM :
 *  l'arbre construit (construire), les légendes, les feuilles et leurs
 *  codes, la lecture d'une requête. Le thème y ajoute le dessin. */
export function profilArbre(k) {
  return {
    arbre: construire(k).arbre,
    symboles: SYMBOLES,
    variables: VARIABLES,
    special: SPECIAL,
    feuilles: FEUILLES,
    texteFeuille,
    codesNoeud,
    groupeDeRequete,
    natureDeCode,
  };
}

// ==== Adresses et chemins ====

/** Un GL d'HTP : réadaptation pédiatrique, très intense, intense, modérée
 *  ou indifférenciée (3.4.2). */
const htp = (n) => "HIJKL".includes(n.code?.[4]);

/** Les catégories de l'algorithme, dans l'ordre du manuel : l'orientation,
 *  puis chaque CM et ses GN. */
export function idsCategories(k) {
  const { cms, gnsParCm } = construire(k);
  return [ORIENTATION, ...cms.flatMap((cm) => [cm, ...gnsParCm.get(cm)])];
}

/** L'adresse : une catégorie et, le cas échéant, un nœud ; ou un code de
 *  GR, de GL ou de GME, qui ouvre son GN sur l'étape du GR ou la case du
 *  GL. Une adresse illisible retombe sur l'orientation. */
export function resoudre(k, [premier, noeud, cas]) {
  const { arbre } = construire(k);
  const ids = new Set(idsCategories(k));
  const brut = String(premier ?? "");
  if (!brut) return {};
  if (ids.has(brut)) return { cmd: brut, noeud, cas: cas != null && /^\d+$/.test(cas) ? Number(cas) : null };
  const code = brut.toUpperCase();
  if (/^\d{4}[A-Z]{1,2}\d?$/.test(code) && ids.has(code.slice(0, 4))) {
    const cible = code.length === 5 ? (arbre.noeuds[code] ? code : `${code}A`) : code.slice(0, 6);
    return { cmd: code.slice(0, 4), noeud: arbre.noeuds[cible] ? cible : undefined };
  }
  return { cmd: brut };
}

/** D'où part le chemin d'une feuille : le premier test de l'orientation, la
 *  racine de la CM, ou l'arbre du GN en HC ou en HTP ; un GL d'HTP sans
 *  test, quand le GN n'est pas subdivisé en HTP. */
export function origineChemin(k, n) {
  if (n.cmd === ORIENTATION) return "Chemin depuis le premier test de l'orientation :";
  if (n.genre !== "gl") return `Chemin depuis la racine de la CM ${n.cmd} :`;
  if (construire(k).departs.get(n.cmd).htp === n._id) {
    return "Le GN n'est pas subdivisé en HTP : chaque RHS d'HTP y va dans ce groupe, sans test (3.4.2.2).";
  }
  return `Chemin dans l'arbre du GN ${n.cmd}, ${htp(n) ? "hospitalisation à temps partiel" : "hospitalisation complète"} :`;
}

// ==== Listes et codes ====

/** Les codes CIM-10 d'une liste d'entrée en GN (« D-0112 »). */
export function codesDeListe(diagnostics, code) {
  const num = code.slice(2);
  return diagnostics.lignes.filter((l) => l.Listes.includes(num)).map((l) => ({ Code: l.Code, "Libellé code": l.Libellé }));
}

/** Les listes d'entrée en GN des codes CIM-10 qui commencent par la
 *  requête : code → { libelle, listes }. */
export function listesDuCode(diagnostics, requete) {
  const debut = cle(requete);
  const parCode = new Map();
  for (const l of diagnostics.lignes) {
    if (!l.Listes.length || !cle(l.Code).startsWith(debut)) continue;
    parCode.set(l.Code, { libelle: l.Libellé, listes: new Set(l.Listes.map((num) => `D-${num}`)) });
  }
  return parCode;
}

// ==== Arbre d'un GN : notes ====

/** Les rangs des nœuds de sa CM dont un test d'entrée mène au GN. */
export function rangsDuGn(k, gn) {
  return k.tests.filter((t) => t.gn === gn).map((t) => String(t.ordre));
}

/** Ce que les notes de l'arbre d'un GN en disent : `adultes`, ses types de
 *  réadaptation d'adultes en HC ; `seuilManquant`, entre plusieurs types,
 *  un couple de seuils (tableau 5) dont GR_infos ne donne qu'un ;
 *  `combinees`, ses GR dont une règle de lourdeur combine l'âge et la
 *  dépendance physique (4.2.2.1) ; `sansSeverite2` (gnSansSeverite2) ;
 *  `intensite`, ses types d'HTP selon l'intensité (3.4.2). */
export function particularitesGn(k, gn) {
  const { adultes } = construire(k).departs.get(gn);
  const e = k.gr[gn];
  return {
    adultes,
    seuilManquant: adultes.length > 1 && [e.spe, e.glob].some(([sejour, jour]) => (sejour == null) !== (jour == null)),
    combinees: [...adultes, ...(e.hc.includes("P") ? ["P"] : [])]
      .map((t) => gn + t)
      .filter((gr) => Object.values(k.gl[gr] ?? {}).some((valeurs) => valeurs.some(Array.isArray))),
    sansSeverite2: gnSansSeverite2(k).includes(gn),
    intensite: e.htp.includes("I"),
  };
}
