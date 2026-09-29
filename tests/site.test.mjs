// Tests des fonctions sans DOM du site : `node --test tests/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  codesGhm,
  couvre,
  couvreRacine,
  exclusionParDp,
  frontieresActes,
  frontieresDp,
  ligneCma,
  racinesAtteintes,
  racinesDepuis,
} from "../docs/assets/js/groupage_mco.js";
import { filtre, indexer, normaliser } from "../docs/assets/js/recherche.js";
import { estExclue, gnSansSeverite2, graphie, normaliserActe, tailleListeExclusion } from "../docs/assets/js/smr.js";
import { casDeLourdeur, construire } from "../docs/assets/js/smr_arbre.js";

// ==== Exclusions des CMA MCO (volume 1, annexe 5) ====

test("couvre : un code vaut toutes ses extensions", () => {
  assert.equal(couvre("A00", "A00.1"), true);
  assert.equal(couvre("A00", "A01.0"), false);
});

test("couvre : une plage inclut les extensions de sa borne haute", () => {
  assert.equal(couvre("R05-R07", "R06"), true);
  assert.equal(couvre("R05-R07", "R07.1"), true);
  assert.equal(couvre("R05-R07", "R04"), false);
  assert.equal(couvre("R05-R07", "R08"), false);
});

test("couvre : l'étoile écarte l'extension 0", () => {
  assert.equal(couvre("M62.89*", "M62.890"), false);
  assert.equal(couvre("M62.89*", "M62.891"), true);
});

test("couvreRacine : CMD, type de racine, sous-CMD, racine", () => {
  assert.equal(couvreRacine("CMD05", "05M09"), true);
  assert.equal(couvreRacine("Racines_en_C", "01C03"), true);
  assert.equal(couvreRacine("Racines_en_C", "01K03"), false);
  assert.equal(couvreRacine("Sous_CMD05_K", "05K06"), true);
  assert.equal(couvreRacine("Sous_CMD05_K", "06K06"), false);
  assert.equal(couvreRacine("05K06", "05K07"), false);
});

const exclusions = {
  cma: [["A46", 3, 1, null], ["C16.1", 2, 2, 1], ["U82.100", 4, null, null]],
  dp: { 1: ["A3-A4", "R05-R07"], 2: ["C15-C2", "C16"] },
  racines: { 1: ["CMD06"] },
};

test("ligneCma : la ligne d'une CMA par son code, sans rien poser sur le jeu", () => {
  assert.deepEqual(ligneCma(exclusions, "C16.1"), ["C16.1", 2, 2, 1]);
  assert.equal(ligneCma(exclusions, "Z99"), undefined);
  assert.deepEqual(Object.keys(exclusions), ["cma", "dp", "racines"]);
});

test("exclusionParDp : le premier élément de la liste de DP qui couvre le DP", () => {
  assert.equal(exclusionParDp(exclusions, "A46", "A46"), "A3-A4");
  assert.equal(exclusionParDp(exclusions, "A46", "R06.1"), "R05-R07");
  assert.equal(exclusionParDp(exclusions, "C16.1", "C16.2"), "C15-C2"); // avant « C16 »
  assert.equal(exclusionParDp(exclusions, "A46", "N18.5"), null);
  assert.equal(exclusionParDp(exclusions, "U82.100", "A00"), null); // CMA sans liste de DP
  assert.equal(exclusionParDp(exclusions, "Z99", "A00"), null); // pas une CMA
});

// ==== Arbre MCO ====

test("codesGhm : « 1 » en bas vaut les niveaux 1 à 4, le haut ajoute sa lettre", () => {
  assert.deepEqual(codesGhm({ racine: "05K06", bas: "1", haut: "J" }), ["05K061", "05K062", "05K063", "05K064", "05K06J"]);
  assert.deepEqual(codesGhm({ racine: "14Z02", bas: "Z", haut: null }), ["14Z02Z"]);
});

const arbre = {
  listes: { "D-0101": { libelle: "liste 1" }, "D-0102": { libelle: "liste 2" } },
  noeuds: {
    dp: { genre: "test", symbole: "DP", cmd: "01", branches: [{ vers: "g1", listes: ["D-0101"] }, { vers: "g2", listes: ["D-0102"] }], sinon: { vers: "r" } },
    g1: { genre: "ghm", racine: "01C03" },
    g2: { genre: "ghm", racine: "01M04" },
    r: { genre: "renvoi", texte: "CMD 02" },
  },
};

test("racinesAtteintes : GHM et renvois de toutes les sorties", () => {
  assert.deepEqual([...racinesAtteintes(arbre, "dp", new Map())].sort(), ["01C03", "01M04", "orientation CMD 02"]);
});

test("racinesDepuis : racinesAtteintes mémorisées par arbre, sans rien poser sur l'arbre", () => {
  const racines = racinesDepuis(arbre, "dp");
  assert.deepEqual([...racines].sort(), ["01C03", "01M04", "orientation CMD 02"]);
  assert.equal(racinesDepuis(arbre, "dp"), racines);
  assert.deepEqual([...racinesDepuis(arbre, "g2")], ["01M04"]);
  assert.deepEqual(Object.keys(arbre), ["listes", "noeuds"]);
});

test("frontieresDp : deux codes d'une catégorie vers deux cas différents", () => {
  const diagnostics = [
    { Liste: "D-0101", Code: "A00.0", "Libellé code": "a" },
    { Liste: "D-0102", Code: "A00.1", "Libellé code": "b" },
    { Liste: "D-0102", Code: "B01.0", "Libellé code": "c" },
  ];
  const lignes = frontieresDp(arbre, diagnostics);
  assert.deepEqual(lignes.map((l) => [l.Code, l.Racines]), [["A00.0", "01C03"], ["A00.1", "01M04"]]);
});

test("frontieresDp : calculé une fois par arbre et par listes, sans rien poser sur l'arbre", () => {
  const diagnostics = [
    { Liste: "D-0101", Code: "A00.0", "Libellé code": "a" },
    { Liste: "D-0102", Code: "A00.1", "Libellé code": "b" },
  ];
  const lignes = frontieresDp(arbre, diagnostics);
  assert.equal(frontieresDp(arbre, diagnostics), lignes);
  assert.deepEqual(frontieresDp(arbre, [diagnostics[0]]), []); // autres listes, autre calcul
  assert.deepEqual(Object.keys(arbre), ["listes", "noeuds"]);
});

test("frontieresActes : une famille d'actes vers des racines de types différents", () => {
  const arbreActes = {
    noeuds: {
      a: { genre: "test", symbole: "A", cmd: "05", branches: [{ vers: "c", listes: ["A-1"] }, { vers: "k", listes: ["A-2"] }] },
      c: { genre: "ghm", racine: "05C02" },
      k: { genre: "ghm", racine: "05K06" },
    },
  };
  const actes = [
    { Liste: "A-1", Code: "EBLA001", "Libellé code": "x" },
    { Liste: "A-2", Code: "EBLA003", "Libellé code": "y" },
  ];
  const lignes = frontieresActes(arbreActes, actes);
  assert.deepEqual(lignes.map((l) => [l.Code, l.Racines, l._typeChange]), [["EBLA001", "05C02", true], ["EBLA003", "05K06", true]]);
  assert.equal(frontieresActes(arbreActes, actes), lignes); // calculé une fois
  assert.deepEqual(Object.keys(arbreActes), ["noeuds"]);
});

// ==== Recherche ====

test("normaliser et filtre : sans casse ni accents, tous les mots", () => {
  assert.equal(normaliser("Épilepsie GRAVE"), "epilepsie grave");
  const lignes = indexer([{ L: "Épilepsie grave" }, { L: "Épilepsie" }], ["L"]);
  assert.deepEqual(lignes.filter(filtre("grave epi")).map((l) => l.L), ["Épilepsie grave"]);
  assert.equal(lignes.filter(filtre("")).length, 2);
});

// ==== SMR ====

test("graphie et normaliserActe SMR", () => {
  assert.equal(graphie("i634"), "I63.4");
  assert.equal(graphie("B24+0"), "B24.+0");
  assert.equal(normaliserActe("alq247"), "ALQ+247");
  assert.equal(normaliserActe("EBLA0030"), "EBLA003");
  assert.equal(normaliserActe("11E11"), "11E11");
});

test("estExclue : plages de clefs, codes de CIM_infos_SMR seulement", () => {
  const smr = {
    exclusions: { cma: { "A00.0": 0, "B00.0": null }, listes: [[["A000", "A009"]]] },
    diagnostics: { _parCle: new Map([["A001", {}], ["A010", {}]]) },
  };
  assert.equal(estExclue(smr, "A00.0", "A00.1"), true);
  assert.equal(estExclue(smr, "A00.0", "A01.0"), false);
  assert.equal(estExclue(smr, "A00.0", "A00.5"), false); // absent de CIM_infos_SMR
  assert.equal(estExclue(smr, "B00.0", "A00.1"), false); // CMA sans liste
});

test("tailleListeExclusion : clefs de CIM_infos_SMR entre les bornes, plage à borne inconnue ignorée", () => {
  const smr = {
    exclusions: { cma: {}, listes: [[["A000", "A009"], ["B01", "B01"]], [["A000", "A005"], ["B01", "B01"]]] },
    diagnostics: { _parCle: new Map([["B01", {}], ["A009", {}], ["A001", {}], ["A000", {}]]) },
  };
  assert.equal(tailleListeExclusion(smr, 0), 4); // A000, A001, A009 ; B01
  assert.equal(tailleListeExclusion(smr, 1), 1); // A005 inconnue : seule B01 compte
  assert.deepEqual(Object.keys(smr.exclusions), ["cma", "listes"]);
});

test("gnSansSeverite2 : GME d'HC en niveau 1 seulement", () => {
  const k = {
    groupes: {
      GN: { "0103": [], "2303": [], "9999": [] },
      GME: { "0103LA0": [], "0103SC1": [], "0103SC2": [], "2303LA0": [], "2303TA1": [], "2303UA1": [], "9999LA0": [] },
    },
  };
  assert.deepEqual(gnSansSeverite2(k), ["2303"]); // 9999 : HTP seulement
});

// ==== Arbres de la fonction groupage SMR (volume 1 du Manuel des GME) ====

/** La classification réelle, assemblée comme le fait chargerClassification
 *  (smr.js) : référentiel de la réadaptation, tests par CM, erreurs. */
function classificationSmr() {
  const lire = (chemin) => JSON.parse(fs.readFileSync(new URL(`../docs/assets/data/smr/${chemin}.json`, import.meta.url), "utf8"));
  const k = lire("groupage/classification");
  const r = lire("readaptation/referentiel");
  Object.assign(k, r, { millesimes: { ...k.millesimes, ...r.millesimes } });
  k._testsParCm = new Map();
  for (const t of k.tests) {
    if (!k._testsParCm.has(t.cm)) k._testsParCm.set(t.cm, []);
    k._testsParCm.get(t.cm).push(t);
  }
  for (const liste of k._testsParCm.values()) liste.sort((a, b) => a.ordre - b.ordre);
  k._cmaCcam = new Map(k.cmaCcam.map(([code, libelle]) => [code, libelle]));
  k._erreurs = new Map(k.erreurs.map(([code, libelle, bloquant]) => [code, { code, libelle, bloquant }]));
  k._listeSpeParGn = new Map(Object.entries(k.gnListeSpe).map(([gn, e]) => [gn, e.liste]));
  return k;
}

test("construire : nœuds de l'orientation, des tests d'entrée et des GN, gardés sur la classification", () => {
  const k = classificationSmr();
  const { arbre, cms, gnsParCm, departs } = construire(k);
  assert.equal(Object.keys(arbre.noeuds).length, 1880);
  assert.equal(cms.length, 15);
  assert.ok(!cms.includes("90")); // CM des erreurs : issue de l'orientation seulement
  assert.equal(arbre.noeuds["o-cm-90"].erreur, 300);
  assert.equal(arbre.listes["D-0103"].nature, "diagnostics");
  assert.equal(construire(k), construire(k));
  // GN 0103 : un seul type de réadaptation en HC, indifférencié en HTP.
  assert.deepEqual(arbre.noeuds["0103"], { genre: "gn", cmd: "01", page: 50, code: "0103" });
  assert.ok(gnsParCm.get("01").includes("0103"));
  assert.deepEqual(departs.get("0103"), { hc: "0103S", htp: "0103LA", adultes: ["S"] });
  assert.equal(arbre.noeuds["0103S"].unique, true);
  // GN 1006 : type pédiatrique, puis scores ; en HTP, pédiatrique puis intensité.
  assert.deepEqual(departs.get("1006"), { hc: "1006-hc-age", htp: "1006-htp-age", adultes: ["S", "T", "U"] });
});

test("casDeLourdeur : niveaux C puis B au-dessus du plancher, règles combinées avec l'âge", () => {
  const k = classificationSmr();
  assert.deepEqual(casDeLourdeur(k, "0103S"), { plancher: "C", niveaux: [] });
  assert.deepEqual(casDeLourdeur(k, "0109T"), {
    plancher: "A",
    niveaux: [
      { niveau: "C", conditions: ["dépendance physique de 13 à 16 et âge de 18 à 70 ans"] },
      { niveau: "B", conditions: ["dépendance physique de 9 à 12 et âge de 18 à 70 ans", "dépendance physique de 13 à 16 et âge à partir de 71 ans"] },
    ],
  });
  assert.deepEqual(casDeLourdeur(k, "1006P"), {
    plancher: "A",
    niveaux: [{ niveau: "B", conditions: ["âge de 0 à 12 ans", "dépendance physique de 9 à 16"] }],
  });
});
