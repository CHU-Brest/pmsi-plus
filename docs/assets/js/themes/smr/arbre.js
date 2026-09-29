// Algorithme de la fonction groupage SMR — les arbres de décision du volume
// 1 du Manuel des GME, dessinés comme ceux du volume 3 du Manuel des GHM :
// le dessin est celui de arbre_vue.js, commun avec l'algorithme MCO.
//
// Le manuel décrit l'orientation en CM (2.2.1, figure 4), les tests
// d'entrée en GN de chaque CM (2.2.2, annexe 7.2), puis, dans chaque GN, le
// type de réadaptation (3.4, figures 6 et 7, annexes 7.3 et 7.4), le niveau
// de lourdeur (4.2, figure 8, annexe 7.5) et le niveau de sévérité (5.2.3,
// figure 9). L'ATIH livre les tables de ces arbres (GN_liste_tests,
// GR_infos, GL_infos), que build_smr.py reprend telles quelles dans
// classification.json, avec la page de l'annexe où se lit chaque ligne ;
// les règles qui les enchaînent sont celles du volume 1, et c'est
// `construire` qui en fait des nœuds : une règle qui change dans une
// nouvelle version du manuel se reporte là.
//
// Adresses : #/smr/arbre/orientation, #/smr/arbre/<CM> et
// #/smr/arbre/<GN>, suivies d'un nœud le cas échéant ; #/smr/arbre/<GR, GL
// ou GME> ouvre l'arbre du GN sur ce groupe (liens des autres thèmes).

import { el, fraicheur, nombre } from "../../interface.js";
import { dessinerArbre } from "../../arbre_vue.js";
import {
  chargerClassification,
  chargerDiagnostics,
  chargerTarifsSmr,
  cle,
  libelleGroupe,
  TYPES_READAPTATION,
} from "../../smr.js";
import { lienCode, lienTarifs, noteTarifsSmr, sourceFg, tableTarifsGme } from "../../smr_interface.js";

const ORIENTATION = "orientation";
// CM 90 « Erreurs et recueils inclassables » : aucune liste n'y oriente,
// aucun test d'entrée en GN ; elle n'est que l'issue de l'orientation.
const CM_ERREURS = "90";
// Figure 4 : schéma de groupage en CM.
const PAGE_ORIENTATION = 19;
const TYPES_HC = ["P", "S", "T", "U"];

// Positions des tests d'entrée en GN (annexe 7.2), en cercle comme celles
// du volume 3 du Manuel des GHM.
const SYMBOLES = {
  MMP: { texte: "MMP", titre: "La manifestation morbide principale (MMP) du RHS", variante: "serre" },
  AE: { texte: "AE", titre: "L'affection étiologique (AE) du RHS" },
  MMPAE: { texte: "MMP ou AE", lignes: ["MMP", "AE"], titre: "La MMP ou l'AE du RHS", variante: "empile" },
  DAS: { texte: "DAS", titre: "L'un au moins des diagnostics associés significatifs (DAS) du RHS", variante: "serre" },
};

const VARIABLES = {
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
const CONDITIONS = {
  mmpPrioritaire: "si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant",
  quatreCaracteresDifferents:
    "les 4 premiers caractères du code classant en DAS doivent différer de ceux du code classant en MMP ou AE",
};

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
function enumeration(elements, mot = "et") {
  if (elements.length < 2) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} ${mot} ${elements.at(-1)}`;
}

/** « page 52 », « pages 50 à 52 ». */
function pages(numeros) {
  const [premiere, derniere] = [Math.min(...numeros), Math.max(...numeros)];
  return premiere === derniere ? `page ${premiere}` : `pages ${premiere} à ${derniere}`;
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
function casDeLourdeur(k, gr) {
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

/** Les arbres du volume 1 en nœuds de arbre_vue.js, construits une fois par
 *  chargement de la classification et gardés sur elle : orientation en CM,
 *  tests d'entrée en GN de chaque CM, arbre de chaque GN. */
function construire(k) {
  if (k._arbreSmr) return k._arbreSmr;
  const noeuds = {};
  const ajouter = (id, noeud) => {
    noeuds[id] = noeud;
    return id;
  };
  const gmesParGl = new Map();
  for (const gme of Object.keys(k.groupes.GME).sort()) {
    const gl = gme.slice(0, 6);
    if (!gmesParGl.has(gl)) gmesParGl.set(gl, []);
    gmesParGl.get(gl).push(gme);
  }
  const cms = Object.keys(k.groupes.CM)
    .filter((cm) => cm !== CM_ERREURS && k._testsParCm.has(cm))
    .sort();

  // ---- Orientation en CM (2.2.1, figure 4) ----
  const o = { cmd: ORIENTATION, page: PAGE_ORIENTATION };
  const oriente = "Oriente dans une CM";
  ajouter("o-mmp-2e", {
    ...o,
    genre: "test",
    symbole: "MMP",
    branches: [{ libelle: "Code orientant en deuxième intention", listes: [], vers: "o-ae-2e" }],
    sinon: { vers: "o-mmp" },
  });
  // Deuxième intention : l'AE testée d'abord, sinon retour à la MMP.
  ajouter("o-ae-2e", {
    ...o,
    genre: "test",
    symbole: "AE",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-ae" }],
    sinon: { vers: "o-mmp", rejoint: true },
  });
  ajouter("o-mmp", {
    ...o,
    genre: "test",
    symbole: "MMP",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-mmp" }],
    sinon: { vers: "o-ae" },
  });
  ajouter("o-ae", {
    ...o,
    genre: "test",
    symbole: "AE",
    branches: [{ libelle: oriente, listes: [], vers: "o-cm-ae" }],
    sinon: { vers: "o-cm-90" },
  });
  ajouter("o-cm-mmp", { ...o, genre: "grille", texte: "CM de la MMP" });
  ajouter("o-cm-ae", { ...o, genre: "renvoi", texte: "CM de l'AE" });
  const e300 = k._erreurs.get(300);
  ajouter("o-cm-90", {
    ...o,
    genre: "erreur",
    etiquette: `CM ${CM_ERREURS}`,
    titre: `${libelleGroupe(k, CM_ERREURS)}, erreur 300${e300 ? ` « ${e300.libelle} »` : ""}`,
    erreur: 300,
  });

  // ---- Tests d'entrée en GN (2.2.2, annexe 7.2) ----
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
    const idErreur = ajouter(`${cm}-erreur`, {
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
      const gn = noeuds[t.gn] ? t.gn : ajouter(t.gn, { genre: "gn", cmd: cm, page: base.page, code: t.gn });
      const [t1, t2] = t.tests;
      ajouter(id, {
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
        ajouter(`${id}-2`, {
          ...base,
          symbole: symbole(t2),
          branches: [branche(t2, gn)],
          sinon: { vers: suivant, rejoint: suivant !== idErreur },
        });
      }
    });
  }

  // ---- Arbre de chaque GN (3.4, 4.2, 5.2.3) ----
  const departs = new Map();
  for (const gn of Object.keys(k.groupes.GN).sort()) {
    const e = k.gr[gn];
    const cmd = gn;
    const [pageHc, pageHtp] = [k.pages.grHc[gn], k.pages.grHtp[gn]];
    const critere = (id, variable, libelle, vers, sinon, page, extra = {}) =>
      ajouter(id, {
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
        : ajouter(gl, {
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
      ajouter(gr, { genre: "gr", cmd, page: pageHc, code: gr, suite: { vers: suite }, unique: type !== "P" && adultes.length === 1 });
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

// ==== Pictogrammes ====

function pictogramme(n) {
  if (n.genre === "test") {
    const s = SYMBOLES[n.symbole];
    return el(
      "span",
      {
        class: ["picto", "cercle", s.variante].filter(Boolean).join(" "),
        role: "img",
        "aria-label": `${s.texte} : ${s.titre}`,
        title: s.titre,
      },
      el("span", { "aria-hidden": "true" }, ...(s.lignes ? [s.lignes[0], el("br"), s.lignes[1]] : [s.texte]))
    );
  }
  if (n.genre === "critere") {
    return el("span", {
      class: "picto losange",
      role: "img",
      "aria-label": "Test sur une variable du séjour",
      title: `Test sur une variable du séjour : ${VARIABLES[n.variable] ?? n.variable}`,
    });
  }
  if (n.genre === "gr") {
    return el(
      "span",
      {
        class: "picto boite",
        role: "img",
        "aria-label": "Groupe de réadaptation",
        title: "Groupe de réadaptation (GR) : la suite de l'arbre en détermine le niveau de lourdeur",
      },
      el("span", { "aria-hidden": "true" }, "GR")
    );
  }
  return null;
}

// ==== Légende ====

function legende() {
  const ligne = (picto, texte) => el("li", {}, picto, el("span", {}, texte));
  const cercle = (symbole) => pictogramme({ genre: "test", symbole });
  const groupe = (racine, cases, classe = "ghm") =>
    el(
      "span",
      { class: classe },
      el("span", { class: "ghm-racine" }, racine),
      cases ? el("span", { class: "ghm-cases" }, el("span", {}, cases[0]), el("span", {}, cases[1])) : null
    );
  return el(
    "details",
    { class: "legende-arbre" },
    el("summary", {}, "Légende des symboles"),
    el(
      "div",
      { class: "legende-grille" },
      el(
        "div",
        {},
        el("p", { class: "legende-titre" }, "Tests d'entrée en GN, sur les diagnostics du RHS"),
        el(
          "ul",
          {},
          ...["MMP", "AE", "MMPAE", "DAS"].map((s) => ligne(cercle(s), `${SYMBOLES[s].titre} appartient à la liste nommée.`))
        )
      ),
      el(
        "div",
        {},
        el("p", { class: "legende-titre" }, "Tests sur les autres données"),
        el(
          "ul",
          {},
          ligne(
            pictogramme({ genre: "critere", variable: "Âge" }),
            "Variable du séjour ou du RHS : âge, scores de réadaptation, caractéristiques du patient qui font le niveau de lourdeur (âge, dépendances physique et cognitive, statut post-chirurgical)."
          ),
          ligne(pictogramme({ genre: "gr" }), "Groupe de réadaptation (GR) retenu ; la suite de l'arbre en détermine le niveau de lourdeur.")
        ),
        el("p", { class: "legende-titre" }, "Groupes"),
        el(
          "ul",
          {},
          ligne(groupe("0147"), "Groupe nosologique (GN) : un clic donne le chemin qui y mène et ouvre son arbre."),
          ligne(
            groupe("0147SC", ["2", "1"]),
            "Groupe de lourdeur (GL). En bas, le niveau de sévérité 1 (0 en HTP) ; en haut, le niveau 2 quand il existe. Le GME est le GL suivi de son niveau de sévérité."
          ),
          ligne(groupe("Erreur 301", null, "ghm erreur"), "RHS non groupé : code erreur de la fonction groupage.")
        )
      )
    )
  );
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  // Les tarifs ne servent qu'à l'ouverture d'une case de GL : l'arbre
  // s'affiche sans les attendre, et leur absence ne coûte que leur bloc.
  // diagnostics.json (4 Mo) n'est chargé qu'à la première liste ouverte ou
  // au premier code cherché.
  const promesseTarifs = chargerTarifsSmr().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const k = await chargerClassification();
  const { arbre, cms, gnsParCm, departs } = construire(k);

  // Le drapeau porte les fichiers de l'ATIH d'où viennent les arbres ; il
  // prend la date des tarifs quand ils arrivent.
  const jeux = [
    ["TOTAL_listes_groupes.xlsx", "libellés des groupes"],
    ["GN_liste_tests.xlsx", "tests d'entrée dans les GN"],
    ["GR_infos.xlsx", "types de réadaptation et seuils"],
    ["GL_infos.xlsx", "règles de lourdeur"],
  ]
    .map(([fichier, libelle]) => ({ libelle, millesime: k.millesimes?.[fichier] }))
    .filter((j) => j.millesime);
  let drapeau = fraicheur(jeux);
  promesseTarifs.then((tarifs) => {
    if (!tarifs || !drapeau.isConnected) return;
    const complet = fraicheur([...jeux, { libelle: tarifs.libelle, millesime: tarifs.millesime }]);
    drapeau.replaceWith(complet);
    drapeau = complet;
  });

  const note = (...enfants) => el("p", { class: "note" }, ...enfants);
  const htp = (n) => "HIJKL".includes(n.code?.[4]);

  // ---- Feuilles ----

  function titreFeuille(n) {
    if (n.genre === "erreur") return `${n.etiquette} : ${n.titre}`;
    return `${n.code} ${libelleGroupe(k, n.code)}${n.genre === "gl" ? `\n${n.gmes.join(", ")}` : ""}`;
  }

  /** Un GN (tests d'une CM), un GL et ses niveaux de sévérité (arbre d'un
   *  GN), un code erreur, ou les CM où mène l'orientation. */
  function feuille(n, depuis, { afficher, basculerChemin }) {
    if (n.genre === "renvoi") {
      return el("span", { class: "renvoi", "data-feuille": n._id, tabindex: "-1" }, n.texte);
    }
    if (n.genre === "grille") {
      return el(
        "span",
        { class: "grille-cmd", "data-feuille": n._id, tabindex: "-1", role: "group", "aria-label": n.texte },
        ...cms.map((cm) =>
          el(
            "button",
            { type: "button", class: "renvoi-cmd", title: libelleGroupe(k, cm), onclick: () => afficher(cm) },
            `CM ${cm}`
          )
        )
      );
    }
    const bouton = el(
      "button",
      {
        type: "button",
        class: n.genre === "erreur" ? "ghm erreur" : "ghm",
        title: titreFeuille(n),
        "aria-expanded": "false",
        "data-feuille": n._id,
        onclick: () => basculerChemin(bouton, n, depuis),
      },
      el("span", { class: "ghm-racine" }, n.etiquette ?? n.code)
    );
    if (n.genre === "gl") {
      // En bas, la sévérité 1 (0 en HTP) ; en haut, la 2 quand elle existe.
      const niveaux = new Set(n.gmes.map((g) => g.at(-1)));
      bouton.append(
        el(
          "span",
          { class: "ghm-cases", "aria-hidden": "true" },
          el("span", {}, niveaux.has("2") ? "2" : ""),
          el("span", {}, niveaux.has("1") ? "1" : niveaux.has("0") ? "0" : "")
        ),
        el("span", { class: "visuellement-cache" }, ` : GME ${n.gmes.join(", ")}`)
      );
    }
    return bouton;
  }

  function titreChemin(n) {
    if (n.genre === "erreur") return [el("strong", {}, n.etiquette), ` — ${n.titre}`];
    const titre = [el("strong", {}, n.code), ` ${libelleGroupe(k, n.code)}`];
    if (n.genre === "gl") titre.push(` — GME ${n.gmes.join(", ")}`);
    return titre;
  }

  function origineChemin(n) {
    if (n.cmd === ORIENTATION) return "Chemin depuis le premier test de l'orientation :";
    if (n.genre !== "gl") return `Chemin depuis la racine de la CM ${n.cmd} :`;
    if (departs.get(n.cmd).htp === n._id) {
      return "Le GN n'est pas subdivisé en HTP : chaque RHS d'HTP y va dans ce groupe, sans test (3.4.2.2).";
    }
    return `Chemin dans l'arbre du GN ${n.cmd}, ${htp(n) ? "hospitalisation à temps partiel" : "hospitalisation complète"} :`;
  }

  function complementChemin(n, { afficher }) {
    if (n.genre === "gn") {
      return [
        el(
          "p",
          { class: "compteur" },
          el(
            "button",
            { type: "button", class: "renvoi-cmd", onclick: () => afficher(n.code) },
            `Arbre du GN ${n.code} : type de réadaptation, lourdeur et sévérité`
          )
        ),
      ];
    }
    if (n.genre === "erreur") {
      return n.erreur == null
        ? []
        : [
            el(
              "p",
              { class: "compteur" },
              el("a", { class: "lien-texte", href: `#/smr/erreurs/${n.erreur}` }, `L'erreur ${n.erreur} dans les erreurs de la fonction groupage`)
            ),
          ];
    }
    if (n.genre !== "gl") return [];
    // Les GMT des GME de la case, remplis dès que les tarifs sont là.
    const zone = el("div", {}, el("p", { class: "compteur" }, "Chargement des tarifs…"));
    promesseTarifs.then((tarifs) => {
      zone.replaceChildren(
        ...(tarifs
          ? [el("p", { class: "compteur" }, "Tarifs des GME :"), tableTarifsGme(tarifs, n.gmes), noteTarifsSmr(lienTarifs(n.cmd))]
          : [el("p", { class: "message-avertissement" }, "Tarifs des GME indisponibles pour le moment.")])
      );
    });
    return [zone];
  }

  // ---- Listes et codes ----

  async function codesDeListe(code) {
    const { lignes } = await chargerDiagnostics();
    const num = code.slice(2);
    return lignes.filter((l) => l.Listes.includes(num)).map((l) => ({ Code: l.Code, "Libellé code": l.Libellé }));
  }

  /** Les listes d'entrée en GN des codes CIM-10 qui commencent par la
   *  requête. */
  async function listesDuCode(requete) {
    const { lignes } = await chargerDiagnostics();
    const debut = cle(requete);
    const parCode = new Map();
    for (const l of lignes) {
      if (!l.Listes.length || !cle(l.Code).startsWith(debut)) continue;
      parCode.set(l.Code, { libelle: l.Libellé, listes: new Set(l.Listes.map((num) => `D-${num}`)) });
    }
    return parCode;
  }

  // ---- Catégories ----

  const noteOrientation = () =>
    note(
      `Un code oriente dans une CM quand il appartient à une liste d'entrée dans une CM : CIM_infos_SMR lui en donne une, autre que la ${CM_ERREURS}. ` +
        "La liste des codes orientant en deuxième intention, des symptômes pour la plupart, est dans le même fichier ; " +
        "la deuxième intention n'existe que pour la MMP. Exemple du manuel : dyspnée (",
      lienCode("R06.0"),
      ") en MMP, code orientant en deuxième intention, et insuffisance cardiaque (",
      lienCode("I50.9"),
      ") en AE : le RHS va dans la CM 05."
    );

  const noteCm = () =>
    note(
      "Un test est positif quand l'un des codes aux positions qu'il nomme appartient à sa liste ; un nœud à deux tests ne l'est que si " +
        "les deux le sont. Un GN peut revenir à plusieurs rangs, avec d'autres listes ou d'autres positions. En HC, le séjour prend ensuite " +
        "le GN le plus fréquent de ses 10 premiers RHS (de tous s'il en compte moins), le premier dans l'ordre chronologique en cas " +
        "d'égalité ; en HTP, chaque RHS garde le sien (2.2.2)."
    );

  function sousTitreGn(gn, { afficher }) {
    const cm = gn.slice(0, 2);
    const rangs = k.tests.filter((t) => t.gn === gn).map((t) => String(t.ordre));
    const pluriel = rangs.length > 1;
    return [
      `Test${pluriel ? "s" : ""} d'entrée au${pluriel ? "x" : ""} rang${pluriel ? "s" : ""} ${enumeration(rangs)} de la `,
      el("button", { type: "button", class: "renvoi-cmd", onclick: () => afficher(cm) }, `CM ${cm}`),
      `. Volume 1 : type de réadaptation, 3.4 et annexes 7.3 (page ${k.pages.grHc[gn]}) et 7.4 (page ${k.pages.grHtp[gn]}) ; ` +
        "lourdeur, 4.2 et annexe 7.5 ; sévérité, 5.2.3.",
    ];
  }

  function notesGn(gn) {
    const { adultes } = departs.get(gn);
    const e = k.gr[gn];
    const notes = [];
    if (adultes.length > 1) {
      const scores = [];
      if (adultes.includes("S")) {
        scores.push("score spécialisé : somme des pondérations des actes de la liste d'actes spécialisés du GN réalisés pendant le séjour");
      }
      if (adultes.includes("T")) {
        scores.push("score global : de tous les actes CSARR, codés ou transcodés du CSAR, et CCAM de réadaptation");
      }
      const seuilManquant = [e.spe, e.glob].some(([sejour, jour]) => (sejour == null) !== (jour == null));
      notes.push(
        note(
          `Scores de réadaptation en HC — ${scores.join(" ; ")}. Par jour : divisé par le nombre de jours de présence du lundi au ` +
            "vendredi, à défaut de week-end (3.3.2.1). Un test est positif quand le score par séjour et le score par jour atteignent " +
            `leur seuil (tableau 5)${seuilManquant ? " ; un seuil absent de GR_infos ne s'y oppose pas" : ""}.`
        )
      );
    }
    const combinees = [...adultes, ...(e.hc.includes("P") ? ["P"] : [])]
      .map((t) => gn + t)
      .filter((gr) => Object.values(k.gl[gr] ?? {}).some((valeurs) => valeurs.some(Array.isArray)));
    notes.push(
      note(
        "Lourdeur, en HC : le niveau du séjour est le plus lourd de ceux que donnent ses caractéristiques (4.2.1), d'où les tests du " +
          "niveau C, puis du niveau B. Âge au premier RHS ; dépendances physique et cognitive : le maximum des RHS du séjour ; statut " +
          "post-chirurgical : intervention datée dans le premier RHS, de 90 jours au plus — plus ancienne ou absente, le séjour n'est " +
          "pas post-chirurgical (1.2.3.5 à 1.2.3.8). Les niveaux de chaque caractéristique sont ceux de GL_infos (annexe 7.5) ; les " +
          `classes d'âge de moins de 18 ans y portent les règles pédiatriques (4.2.2.2).${
            combinees.length ? ` Règle combinant l'âge et la dépendance physique (4.2.2.1) : GR ${enumeration(combinees)}.` : ""
          }`
      )
    );
    const sans2 = Object.keys(k.groupes.GL).some((gl) => gl.startsWith(gn) && TYPES_HC.includes(gl[4])) &&
      !Object.keys(k.groupes.GME).some((gme) => gme.startsWith(gn) && gme.endsWith("2"));
    notes.push(
      note(
        "Sévérité, en HC : le GME est le GL suivi du niveau 2 quand au moins un marqueur de sévérité est retenu — un code CIM-10 CMA " +
          "en MMP ou en DAS d'un RHS, qu'aucun des codes ayant orienté un RHS du séjour dans ce GN n'exclut, ou un acte CCAM CMA — et " +
          "que le niveau 2 existe ; du niveau 1 sinon (5.2.3). ",
        sans2 ? el("strong", {}, `Le GN ${gn} n'a pas de niveau de sévérité 2 : tout séjour d'HC y est en sévérité 1. `) : null,
        "En HTP, lourdeur A et sévérité 0, par convention (4.1, 5.1)."
      )
    );
    if (e.htp.includes("I")) {
      notes.push(
        note(
          "Score global par jour, en HTP : somme des pondérations de tous les actes CSARR, codés ou transcodés, et CCAM de la semaine, " +
            "divisée par le nombre de jours de présence dans la semaine (3.3.2.2)."
        )
      );
    }
    return notes;
  }

  const categories = [
    {
      id: ORIENTATION,
      option: "Orientation en CM",
      etiquette: "Orientation",
      titre: "Orientation en catégorie majeure",
      sousTitre: `Volume 1, 2.2.1 et figure 4, page ${PAGE_ORIENTATION}. Les tests sont faits dans cet ordre, sur chaque RHS.`,
      racines: [{ depart: "o-mmp-2e" }],
      notes: () => [noteOrientation()],
    },
  ];
  for (const cm of cms) {
    const groupe = `CM ${cm} — ${libelleGroupe(k, cm)}`;
    const tests = k._testsParCm.get(cm);
    categories.push({
      id: cm,
      groupe,
      option: `CM ${cm} — tests d'entrée en GN`,
      etiquette: `CM ${cm}`,
      titre: groupe,
      sousTitre:
        `Volume 1, 2.2.2 et annexe 7.2, ${pages(tests.map((t) => k.pages.noeuds[`${cm}-${t.ordre}`]))}. ` +
        `${nombre(tests.length)} nœud${tests.length > 1 ? "s" : ""}, testé${tests.length > 1 ? "s" : ""} dans l'ordre sur chaque RHS ; le premier dont tous les tests sont positifs donne le GN.`,
      racines: [{ depart: `${cm}-${tests[0].ordre}` }],
      notes: () => [noteCm()],
    });
    for (const gn of gnsParCm.get(cm)) {
      categories.push({
        id: gn,
        groupe,
        option: `GN ${gn} — ${libelleGroupe(k, gn)}`,
        etiquette: `GN ${gn}`,
        titre: `GN ${gn} — ${libelleGroupe(k, gn)}`,
        sousTitre: (outils) => sousTitreGn(gn, outils),
        racines: [
          {
            titre: "Hospitalisation complète",
            note: "Le séjour, dans le GN le plus fréquent de ses 10 premiers RHS (2.2.2). Type de réadaptation : figure 6 ; lourdeur : figure 8 ; sévérité : figure 9.",
            depart: departs.get(gn).hc,
          },
          {
            titre: "Hospitalisation à temps partiel",
            note: "Chaque RHS, groupé sans égard aux autres RHS de la suite (2.2.2). Type de réadaptation : figure 7 ; lourdeur A et sévérité 0, par convention.",
            depart: departs.get(gn).htp,
          },
        ],
        notes: () => notesGn(gn),
      });
    }
  }
  const ids = new Set(categories.map((c) => c.id));

  /** L'adresse : une catégorie et, le cas échéant, un nœud ; ou un code de
   *  GR, de GL ou de GME, qui ouvre son GN sur l'étape du GR ou la case du
   *  GL. Une adresse illisible retombe sur l'orientation. */
  function resoudre([premier, noeud, cas]) {
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

  return dessinerArbre(
    conteneur,
    {
      champ: "smr",
      arbre,
      parDefaut: ORIENTATION,
      categories,
      resoudre,
      entete: [
        el("h1", {}, "Algorithme de la fonction groupage"),
        sourceFg(),
        drapeau,
        el(
          "p",
          {},
          "Les arbres de décision de la classification en GME, tels que les décrit le volume 1 du ",
          el("strong", {}, "Manuel des GME 2026"),
          " (ATIH, version provisoire) : orientation en CM, tests d'entrée en GN de chaque CM, puis, pour chaque GN, type de réadaptation, niveau de lourdeur et niveau de sévérité. Chaque test s'enchaîne sous le précédent quand sa condition n'est pas satisfaite, et ouvre en retrait ce qui suit quand elle l'est. Un clic sur un code de liste en montre les codes ; un clic sur un GN donne le chemin qui y mène et ouvre son arbre ; un clic sur une case de GL donne le chemin qui y mène et les tarifs de ses GME."
        ),
        legende(),
      ],
      selecteur: {
        id: "smr_arbre_cm",
        libelle: "Catégorie majeure ou GN :",
        aide: "Dans l'ordre du manuel : l'orientation d'abord, puis chaque CM et ses GN.",
      },
      recherche: { id: "smr_arbre_recherche", exemple: "ex. : 0147SC, D-0112, I63.4, hémiplégies" },
      titrePage: "Page du volume 1 du Manuel des GME",
      symboles: SYMBOLES,
      variables: VARIABLES,
      special: {
        gr: {
          court: (n) => `GR ${n.code}`,
          intitule: (n) => [
            el("strong", {}, n.code),
            ` ${TYPES_READAPTATION[n.code[4]]}`,
            n.unique ? el("span", { class: "etape-precision" }, " — GN non subdivisé sur la réadaptation (3.4.1.2)") : null,
          ],
        },
      },
      note: (n) => {
        if (n.ecart) {
          return [
            `Écart entre les sources de l'ATIH : l'annexe 7.2 du manuel (page ${n.page}) écrit ce nœud « ${n.ecart.annexe} », ` +
              `GN_liste_tests.xlsx, que suit l'arbre, « ${n.ecart.fichier} ».`,
          ];
        }
        if (n.conditions?.length) {
          return [`Conditions supplémentaires : ${n.conditions.map((c) => CONDITIONS[c]).filter(Boolean).join(" ; ")}.`];
        }
        if (n.listeSpe) {
          const fiche = k.listesSpe?.[n.listeSpe];
          return [
            "Actes de la liste d'actes spécialisés du GN : ",
            el("a", { class: "code", href: `#/smr/groupage/${encodeURIComponent(n.listeSpe)}`, title: "Actes de la liste" }, n.listeSpe),
            fiche?.libelle ? ` (« ${fiche.libelle} »)` : "",
            ".",
          ];
        }
        return null;
      },
      pictogramme,
      feuilles: new Set(["gn", "gl", "erreur", "renvoi", "grille"]),
      feuille,
      texteFeuille: (n) => n.code ?? n.etiquette ?? n.texte,
      codesNoeud: (n) => (n.genre === "gl" ? [n.code, ...n.gmes] : n.genre === "gn" || n.genre === "gr" ? [n.code] : []),
      nomFeuille: ["groupe", "groupes"],
      titreChemin,
      origineChemin,
      complementChemin,
      codesDeListe,
      // Un code de groupe, entier ou en partie : « 01 », « 0147 »,
      // « 0147S », « 0147SC », « 0147SC2 ».
      groupeDeRequete: (compact) => (/^\d{2}(?:\d{2}(?:[a-z](?:[a-z]\d?)?)?)?$/.test(compact) ? compact : null),
      natureDeCode: (requete) =>
        /^[A-Z]\d{2}(\.?\d*)?[+]?\d*$/.test(requete.trim().toUpperCase().replace(/\s+/g, "")) ? "diagnostics" : null,
      listesDuCode,
    },
    chemin
  );
}
