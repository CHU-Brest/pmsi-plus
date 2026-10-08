// Cas communs au site et à la skill : chaque cas appelle une fonction exportée
// d'un module pur du site, avec des arguments écrits en JSON, et compare son
// résultat à celui qu'attend tests/cas_communs/<module>.json. La skill
// (Python) rejoue les mêmes fichiers sur ses ports : les deux implémentations
// des règles ne peuvent pas diverger sans qu'un des deux côtés échoue.
//
//   node --test                                          rejoue les cas
//   ECRIRE_CAS=1 node --test tests/cas_communs.test.mjs  réécrit les « attendu »
//   CAS_COMMUNS=smr.json …                               ne lit que ce fichier
//
// Réécrire les résultats attendus n'est permis qu'après un changement voulu
// (règle du site, nouvelle campagne) : relire alors le diff du fichier.
//
// ==== Format d'un fichier ====
//
// { "module": "groupage_mco",
//   "non_portes": { "<export>": "<pourquoi la skill n'en a pas besoin>" },
//   "cas": [ { "nom": "…", "fonction": "<export>", "arguments": [ … ],
//              "puis": [[ … ], …]?, "extrait": [ … ]?, "attendu": … }
//          | { "nom": "…", "constante": "<export>", "attendu": … } ] }
//
// Chaque export du module figure dans un cas ou dans « non_portes ».
//
// Un argument est une valeur JSON, ou une référence (objet à une seule clef
// commençant par « $ », plus « arguments » pour $appel) :
//   {"$json": "groupage/arbre"}          un fichier de docs/assets/data, brut
//   {"$jeu": "groupage/tarifs"}          { millesime, campagne, lignes }, comme chargerJeu
//   {"$lignes": "groupage/diagnostics"}  les lignes seules
//   {"$smr": "classification" | "diagnostics" | "exclusions" | "actes"
//            | "actesSpe" | "csar" | "tarifs" | "tout"}
//                                        les jeux SMR indexés comme les chargent les
//                                        thèmes ; « tout » : l'objet de chargerSmr
//   {"$profil": "mco" | "smr"}           le profil de l'arbre lu par arbre_graphe, préparé
//   {"$noeud": "p10-5", "arbre": "mco" | "smr"}   un nœud de l'arbre (préparé)
//   {"$appel": "module.fonction", "arguments": [ … ]}   le résultat d'un autre appel
//   {"$set": [ … ]}, {"$map": [[clef, valeur], …]}
// Les références de données sont chargées une fois et partagées entre les
// cas, comme le site garde ses jeux en cache ; les deux arbres (MCO et SMR)
// sont préparés (arbre_graphe.preparer) avant le premier cas.
//
// « puis » appelle le résultat (une fonction, comme celle que rend
// recherche.filtre) avec chacune des listes d'arguments, et garde la liste
// des résultats. « extrait » choisit ensuite une partie du résultat avant la
// comparaison : une suite de pas, chacun une clef (objet, Map), un rang
// (tableau), ou un objet {champ: valeur, …} qui prend le premier élément
// (tableau, Set, valeurs d'une Map) dont ces champs ont ces valeurs ; on
// désigne ainsi une ligne par son code plutôt que par son rang, qui change
// d'une campagne à l'autre.
//
// Le résultat est ramené à du JSON avant d'être comparé, des deux côtés de
// la même façon :
//   - Set → tableau, dans l'ordre d'itération ; Map → objet (clefs en texte) ;
//   - nœud d'un arbre → {"$noeud": id} ; fonction → "$fonction" ;
//     expression régulière → {"$regex": source} ; exception → {"$erreur": true} ;
//   - clef d'objet valant null ou undefined : omise ; undefined dans un
//     tableau : null ;
//   - clefs de cache posées par le site (CLES_IGNOREES) : omises.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as recherche from "../docs/assets/js/recherche.js";
import * as arbre_graphe from "../docs/assets/js/arbre_graphe.js";
import * as groupage_mco from "../docs/assets/js/groupage_mco.js";
import * as tarifs from "../docs/assets/js/tarifs.js";
import * as smr from "../docs/assets/js/smr.js";
import * as smr_arbre from "../docs/assets/js/smr_arbre.js";
import { reconstituerLignes } from "../docs/assets/js/donnees.js";

const MODULES = { recherche, arbre_graphe, groupage_mco, tarifs, smr, smr_arbre };
const DOSSIER_CAS = new URL("./cas_communs/", import.meta.url);
const DOSSIER_DONNEES = new URL("../docs/assets/data/", import.meta.url);
const CLES_IGNOREES = new Set(["_recherche", "_id", "_parents", "_pret"]);
const ECRIRE = Boolean(process.env.ECRIRE_CAS);

// ==== Données ====

const memoire = new Map();
const unefois = (clef, f) => {
  if (!memoire.has(clef)) memoire.set(clef, f());
  return memoire.get(clef);
};

const lireJson = (chemin) =>
  unefois(`json:${chemin}`, () => JSON.parse(fs.readFileSync(new URL(`${chemin}.json`, DOSSIER_DONNEES), "utf8")));

const lireJeu = (chemin) =>
  unefois(`jeu:${chemin}`, () => {
    const brut = lireJson(chemin);
    return { millesime: brut.millesime, campagne: brut.campagne, lignes: reconstituerLignes(brut) };
  });

const JEUX_SMR = {
  classification: () => smr.indexerClassification(lireJson("smr/groupage/classification"), lireJson("smr/readaptation/referentiel")),
  diagnostics: () => smr.indexerDiagnostics(lireJeu("smr/groupage/diagnostics")),
  exclusions: () => lireJson("smr/groupage/exclusions"),
  actes: () => smr.indexerActes(lireJeu("smr/readaptation/actes")),
  actesSpe: () => smr.indexerActesSpe(lireJeu("smr/readaptation/actes_spe")),
  csar: () => smr.indexerCsar(lireJeu("smr/readaptation/csar")),
  tarifs: () => smr.indexerTarifsSmr(lireJeu("smr/groupage/tarifs")),
  tout: () =>
    Object.fromEntries(["classification", "diagnostics", "exclusions", "actes", "actesSpe", "csar"].map((j) => [j, jeuSmr(j)])),
};
const jeuSmr = (nom) => unefois(`smr:${nom}`, JEUX_SMR[nom]);

// Les nœuds des deux arbres, pour rendre un nœud par son identifiant.
const idsDesNoeuds = new Map();

function profil(champ) {
  return unefois(`profil:${champ}`, () => {
    const P =
      champ === "mco"
        ? { ...groupage_mco.PROFIL_MCO, arbre: lireJson("groupage/arbre") }
        : smr_arbre.profilArbre(jeuSmr("classification"));
    arbre_graphe.preparer(P);
    for (const [id, n] of Object.entries(P.arbre.noeuds)) idsDesNoeuds.set(n, id);
    return P;
  });
}

// Les deux arbres sont préparés avant tout cas, quel que soit l'ordre des
// cas : un nœud rendu par une fonction se lit alors toujours {"$noeud": id}.
profil("mco");
profil("smr");

// ==== Arguments ====

function fonctionNommee(nom, moduleParDefaut) {
  const [m, f] = nom.includes(".") ? nom.split(".") : [moduleParDefaut, nom];
  const fn = MODULES[m]?.[f];
  if (typeof fn !== "function") throw new Error(`fonction inconnue : ${nom}`);
  return fn;
}

function resoudre(v, module) {
  if (Array.isArray(v)) return v.map((x) => resoudre(x, module));
  if (v === null || typeof v !== "object") return v;
  const [clef] = Object.keys(v);
  if (!clef?.startsWith("$")) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resoudre(x, module)]));
  switch (clef) {
    case "$json":
      return lireJson(v.$json);
    case "$jeu":
      return lireJeu(v.$jeu);
    case "$lignes":
      return lireJeu(v.$lignes).lignes;
    case "$smr":
      if (!JEUX_SMR[v.$smr]) throw new Error(`jeu SMR inconnu : ${v.$smr}`);
      return jeuSmr(v.$smr);
    case "$profil":
      return profil(v.$profil);
    case "$noeud": {
      const n = profil(v.arbre ?? "mco").arbre.noeuds[v.$noeud];
      if (!n) throw new Error(`nœud inconnu : ${v.$noeud}`);
      return n;
    }
    case "$appel":
      return fonctionNommee(v.$appel, module)(...resoudre(v.arguments ?? [], module));
    case "$set":
      return new Set(resoudre(v.$set, module));
    case "$map":
      return new Map(resoudre(v.$map, module));
    default:
      throw new Error(`référence inconnue : ${clef}`);
  }
}

// ==== Résultat ====

function extraire(v, chemin = []) {
  for (const pas of chemin) {
    if (pas !== null && typeof pas === "object") {
      const elements = v instanceof Map ? [...v.values()] : [...(v ?? [])];
      v = elements.find((x) => Object.entries(pas).every(([k, y]) => x?.[k] === y));
    } else v = v instanceof Map ? v.get(pas) : v?.[pas];
  }
  return v;
}

function projeter(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "function") return "$fonction";
  if (v instanceof RegExp) return { $regex: v.source };
  if (v instanceof Set) return [...v].map(projeter);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), projeter(x)]));
  if (Array.isArray(v)) return v.map(projeter);
  if (typeof v === "object") {
    if (idsDesNoeuds.has(v)) return { $noeud: idsDesNoeuds.get(v) };
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined || x === null || CLES_IGNOREES.has(k)) continue;
      o[k] = projeter(x);
    }
    return o;
  }
  return v;
}

function executer(c, module) {
  if (c.constante) return projeter(MODULES[module][c.constante]);
  const fn = fonctionNommee(c.fonction, module);
  const args = resoudre(c.arguments ?? [], module);
  let resultat;
  try {
    resultat = fn(...args);
    if (c.puis) resultat = c.puis.map((a) => resultat(...resoudre(a, module)));
  } catch {
    return { $erreur: true };
  }
  return projeter(extraire(resultat, c.extrait));
}

// ==== Écriture ====

/** JSON lisible dans un diff : une valeur courte sur une ligne, une longue
 *  dépliée, un élément ou une clef par ligne. */
function formater(v, retrait = "") {
  const court = JSON.stringify(v);
  if (court.length + retrait.length <= 100 || v === null || typeof v !== "object") return court;
  const dedans = retrait + " ";
  const elements = Array.isArray(v)
    ? v.map((x) => dedans + formater(x, dedans))
    : Object.entries(v).map(([k, x]) => `${dedans}${JSON.stringify(k)}: ${formater(x, dedans)}`);
  return `${Array.isArray(v) ? "[" : "{"}\n${elements.join(",\n")}\n${retrait}${Array.isArray(v) ? "]" : "}"}`;
}

// ==== Cas ====

const fichiers = fs
  .readdirSync(DOSSIER_CAS)
  .filter((f) => f.endsWith(".json") && (!process.env.CAS_COMMUNS || f === process.env.CAS_COMMUNS))
  .sort();

for (const f of fichiers) {
  const url = new URL(f, DOSSIER_CAS);
  const contenu = JSON.parse(fs.readFileSync(url, "utf8"));
  const { module } = contenu;

  test(`cas communs ${f} : chaque export de ${module}.js a un cas, ou une raison de ne pas être porté`, () => {
    assert.ok(MODULES[module], `module inconnu : ${module}`);
    const couverts = new Set([...contenu.cas.map((c) => c.constante ?? c.fonction), ...Object.keys(contenu.non_portes ?? {})]);
    const manquants = Object.keys(MODULES[module]).filter((e) => !couverts.has(e));
    assert.deepEqual(manquants, []);
  });

  for (const c of contenu.cas) {
    test(`cas communs ${module} : ${c.nom}`, () => {
      const obtenu = executer(c, module);
      if (ECRIRE) c.attendu = obtenu;
      else assert.deepEqual(obtenu, c.attendu);
    });
  }

  if (ECRIRE) test.after(() => fs.writeFileSync(url, formater(contenu) + "\n"));
}
