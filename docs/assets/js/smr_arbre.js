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
// Rien ici ne touche au DOM : le dessin est celui de themes/smr/arbre.js.

import { nombre } from "./interface.js";
import { libelleGroupe, TYPES_READAPTATION } from "./smr.js";

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
