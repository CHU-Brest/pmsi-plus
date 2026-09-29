// Tests des fonctions sans DOM du site : `node --test tests/`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { codesGhm, couvre, couvreRacine, frontieresActes, frontieresDp, racinesAtteintes } from "../docs/assets/js/groupage_mco.js";
import { filtre, indexer, normaliser } from "../docs/assets/js/recherche.js";
import { estExclue, graphie, normaliserActe } from "../docs/assets/js/smr.js";

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

test("frontieresDp : deux codes d'une catégorie vers deux cas différents", () => {
  const diagnostics = [
    { Liste: "D-0101", Code: "A00.0", "Libellé code": "a" },
    { Liste: "D-0102", Code: "A00.1", "Libellé code": "b" },
    { Liste: "D-0102", Code: "B01.0", "Libellé code": "c" },
  ];
  const lignes = frontieresDp(arbre, diagnostics);
  assert.deepEqual(lignes.map((l) => [l.Code, l.Racines]), [["A00.0", "01C03"], ["A00.1", "01M04"]]);
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
