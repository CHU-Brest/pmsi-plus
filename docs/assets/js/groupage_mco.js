// Fonction groupage MCO — ce que les thèmes MCO calculent de l'arbre
// (arbre.json) et des listes : graphie des codes saisis, racines atteintes
// depuis un nœud, par toutes ses sorties ou par le parcours d'un séjour
// dont le code est le DP, étapes qui testent une liste, codes GHM d'une
// case ou d'une racine, codes et actes frontières, ligne d'une CMA, ses
// listes d'exclusion (volume 1, annexes 4 et 5) et leur vérificateur ;
// légende et profil de l'arbre de l'algorithme, codes des listes qu'il
// ouvre ; fiche d'un diagnostic ou d'un acte et suggestions de sa saisie ;
// lignes du tableau des tarifs.
//
// Rien ici ne touche au DOM : les fonctions reçoivent l'arbre et les jeux
// chargés en argument. Pendant MCO de smr.js. Partagé par la fiche code,
// l'algorithme, les CMA, les codes et actes frontières, les tarifs.

import { comparer, normaliser } from "./recherche.js";

// ==== Graphie des codes ====

/** Un code CCAM : quatre lettres, trois chiffres. */
export const RE_CCAM = /^[A-Z]{4}\d{3}/;

/** Une racine de GHM : « 01C03 ». */
export const RE_RACINE = /^\d{2}[CKMZ]\d{2}$/;

/** « g409 », « G40.9 » → « G40.9 » ; « aafa001 », « EBLA0030 » (chiffre de
 *  phase), « AAFA001-00/0 » (forme des listes) → le code CCAM, 7 caractères. */
export function graphie(saisie) {
  const c = saisie.trim().toUpperCase().replace(/\s+/g, "");
  if (RE_CCAM.test(c)) return c.slice(0, 7);
  const sansPoint = c.replace(/\./g, "");
  return sansPoint.length <= 3 ? sansPoint : `${sansPoint.slice(0, 3)}.${sansPoint.slice(3)}`;
}

/** Code d'acte des listes (« AAFA001-00/0 ») ramené à son code CCAM. */
export const codeCcam = (code) => code.split("-")[0];

/** « 11m04 », « 11M04Z » → « 11M04 » : la racine d'un GHM saisi, null si
 *  la saisie n'en est pas une. */
export function graphieRacine(saisie) {
  const racine = saisie.trim().toUpperCase().slice(0, 5);
  return RE_RACINE.test(racine) ? racine : null;
}

// ==== Arbre ====

/** Les sorties d'un nœud : ses cas, son « sinon » et sa suite. */
export const sorties = (n) => [...(n.branches ?? []).map((b) => b.vers), n.sinon?.vers, n.suite?.vers].filter(Boolean);

/** Racines de GHM (et groupes d'erreur, renvois) atteignables depuis un
 *  nœud, en suivant toutes ses sorties, ou celles que `suivre` retient. */
export function racinesAtteintes(arbre, depart, memo, suivre = sorties) {
  if (memo.has(depart)) return memo.get(depart);
  memo.set(depart, new Set()); // garde-fou : l'arbre n'a pas de boucle
  const n = arbre.noeuds[depart];
  let resultat;
  if (n.genre === "ghm" || n.genre === "erreur") resultat = new Set([n.racine]);
  else if (n.genre === "renvoi") resultat = new Set([`orientation ${n.texte}`]);
  else {
    resultat = new Set();
    for (const s of suivre(n)) for (const r of racinesAtteintes(arbre, s, memo, suivre)) resultat.add(r);
  }
  memo.set(depart, resultat);
  return resultat;
}

// Racines atteintes par toutes les sorties, mémorisées une fois par arbre
// chargé, sans toucher à l'objet que partagent les thèmes : l'algorithme,
// la fiche code et les frontières font le même parcours.
const memosParArbre = new WeakMap();

/** racinesAtteintes() par toutes les sorties, mémorisées par arbre. */
export function racinesDepuis(arbre, depart) {
  if (!memosParArbre.has(arbre)) memosParArbre.set(arbre, new Map());
  return racinesAtteintes(arbre, depart, memosParArbre.get(arbre));
}

/** Codes GHM couverts par une case : « 1 » en bas vaut les niveaux 1 à 4,
 *  une lettre vaut elle-même ; la case du haut ajoute J ou T. */
export function codesGhm(f) {
  const codes = [];
  if (f.bas === "1") codes.push(...["1", "2", "3", "4"].map((n) => f.racine + n));
  else if (f.bas) codes.push(f.racine + f.bas);
  if (f.haut) codes.push(f.racine + f.haut);
  return codes;
}

// GHM de chaque racine d'après les cases, indexés une fois par arbre
// chargé, sans toucher à l'objet que partagent les thèmes.
const ghmParArbre = new WeakMap();

/** Les GHM d'une racine d'après les cases de l'arbre, y compris ceux que
 *  l'arrêté ne tarife pas (09Z02A) : ils doivent figurer, sans tarif, dans
 *  le tableau de leur racine plutôt que d'en disparaître. Une racine
 *  qu'aucune case ne porte garde les GHM que l'arrêté lui tarife,
 *  `ghmTarifes` (ghmDeRacine de tarifs.js). */
export function ghmDeRacineDansArbre(arbre, racine, ghmTarifes = []) {
  if (!ghmParArbre.has(arbre)) {
    const index = new Map();
    for (const n of Object.values(arbre.noeuds)) {
      if (n.genre !== "ghm") continue;
      if (!index.has(n.racine)) index.set(n.racine, new Set());
      for (const g of codesGhm(n)) index.get(n.racine).add(g);
    }
    ghmParArbre.set(arbre, index);
  }
  const dansArbre = [...(ghmParArbre.get(arbre).get(racine) ?? [])].sort();
  return dansArbre.length ? dansArbre : ghmTarifes;
}

/** Libellé de chaque racine de GHM (racine → libellé), d'après les lignes
 *  de la liste des racines. */
export const libellesRacines = (lignes) => new Map(lignes.map((l) => [l.ListeRacineGHM, l["Libellé liste"]]));

// ==== Parcours d'un code dans l'arbre (fiche code) ====

// Étapes de chaque liste, indexées une fois par arbre chargé, sans toucher
// à l'objet que partagent les thèmes.
const indexParArbre = new WeakMap();

/** Les étapes qui testent chaque liste : `parListe`, liste → [{ id, n, i }],
 *  le nœud `n` d'identifiant `id` et le rang `i` du cas qui la cite. */
export function indexerEtapes(arbre) {
  if (indexParArbre.has(arbre)) return indexParArbre.get(arbre);
  const parListe = new Map(); // liste → [{ id, n, i }]
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    (n.branches ?? []).forEach((b, i) => {
      for (const l of b.listes) {
        if (!parListe.has(l)) parListe.set(l, []);
        parListe.get(l).push({ id, n, i });
      }
    });
  }
  indexParArbre.set(arbre, { parListe });
  return indexParArbre.get(arbre);
}

/** Le parcours d'un séjour dont le code est le DP. Un test sur le DP ne
 *  suit que le premier cas qui contient le code, ou son « sinon » ; un test
 *  sur l'un des diagnostics du RSS (D, ou DP et DAS sauf DR) que le code
 *  satisfait ne va pas au-delà de son cas ; l'inversion du DP et du DR n'a
 *  pas eu lieu, puisque le code est resté le DP. Les autres tests (actes,
 *  autres diagnostics, âge, durée de séjour…) restent ouverts. */
export function parcoursEnDp(listes) {
  const contient = (b) => b.listes.some((l) => listes.includes(l));
  const suivre = (n) => {
    const branches = n.branches ?? [];
    if (n.genre === "test" && n.symbole === "DP") {
      const b = branches.find(contient);
      return [b ? b.vers : n.sinon?.vers].filter(Boolean);
    }
    if (n.genre === "test" && (n.symbole === "D" || n.symbole === "DRbarre")) {
      const i = branches.findIndex(contient);
      if (i >= 0) return branches.slice(0, i + 1).map((b) => b.vers);
    }
    if (n.genre === "critere" && n.variable === "Inversion DP/DR") return [n.sinon.vers];
    return sorties(n);
  };
  return { suivre, memo: new Map() };
}

/** Les racines de GHM que le séjour peut atteindre depuis `vers` : par
 *  toutes les sorties, ou selon le parcours d'un DP (parcoursEnDp). */
export function racinesDe(arbre, vers, parcours) {
  const atteintes = parcours ? racinesAtteintes(arbre, vers, parcours.memo, parcours.suivre) : racinesDepuis(arbre, vers);
  return [...atteintes].filter((r) => RE_RACINE.test(r)).sort();
}

/** Les racines que peuvent atteindre les étapes, sans doublon. */
export function racinesDesEtapes(arbre, etapes, parcours) {
  return [...new Set(etapes.flatMap((e) => racinesDe(arbre, e.n.branches[e.i].vers, parcours)))].sort();
}

/** L'étape qui oriente le séjour en DP vers une CMD dont le code est un
 *  diagnostic d'entrée (volume 2) : la racine de l'arbre de la CMD. Un code
 *  des appareils génitaux entre dans deux CMD, 12 et 13, selon le sexe. La
 *  ligne dit « DP » même en CMD 15, dont la racine teste l'âge. */
export function etapeCmd(arbre, cmd) {
  const c = arbre.cmd.find((x) => x.cmd === cmd);
  return c ? { id: c.racine, n: arbre.noeuds[c.racine], i: 0, test: `DP : CMD ${c.cmd} ${c.titre}` } : null;
}

/** Marque `nonAtteinte` les étapes sur le DP dont le séjour ne prend pas le
 *  cas avec ce DP. L'orientation (séances, transplantation, traumatismes
 *  multiples, VIH, nouveau-nés) précède la CMD du DP ; hors d'elle, une
 *  étape n'est atteinte que depuis cette CMD. Sans CMD connue, rien n'est
 *  marqué. */
export function marquerAtteintes(arbre, etapes, cmds, parcours) {
  if (!cmds.length) return etapes;
  const orientation = new Set(arbre.orientation.map((o) => o.cmd));
  const atteints = new Set();
  const pile = cmds.map((e) => e.n.branches[e.i].vers);
  while (pile.length) {
    const id = pile.pop();
    if (atteints.has(id)) continue;
    atteints.add(id);
    pile.push(...parcours.suivre(arbre.noeuds[id]));
  }
  const prise = (e) => atteints.has(e.id) && parcours.suivre(e.n).includes(e.n.branches[e.i].vers);
  return etapes.map((e) => (orientation.has(e.n.cmd) || prise(e) ? e : { ...e, nonAtteinte: true }));
}

// ==== Codes et actes frontières ====

// Codes et actes frontières, calculés une fois par arbre et par jeu de
// listes chargés : la fiche code et les vues d'ensemble lisent les mêmes
// lignes. Ils restent ici, sans toucher aux objets que partagent les
// thèmes ; les vues d'ensemble ajoutent `_recherche` aux lignes
// (recherche.indexer), que la fiche ne lit pas.
const frontieresDpParArbre = new WeakMap();
const frontieresActesParArbre = new WeakMap();

/** Codes frontières en DP : pour chaque colonne de tests sur le DP, les
 *  codes d'une même catégorie CIM-10 qui partent vers des cas différents. */
export function frontieresDp(arbre, diagnostics) {
  if (!frontieresDpParArbre.has(arbre)) frontieresDpParArbre.set(arbre, new WeakMap());
  const calculees = frontieresDpParArbre.get(arbre);
  if (!calculees.has(diagnostics)) calculees.set(diagnostics, calculerFrontieresDp(arbre, diagnostics));
  return calculees.get(diagnostics);
}

function calculerFrontieresDp(arbre, diagnostics) {
  const codesDeListe = new Map();
  const libelleCode = new Map();
  for (const l of diagnostics) {
    if (!codesDeListe.has(l.Liste)) codesDeListe.set(l.Liste, new Set());
    codesDeListe.get(l.Liste).add(l.Code);
    libelleCode.set(l.Code, l["Libellé code"]);
  }
  const lignes = [];
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    if (n.genre !== "test" || n.symbole !== "DP" || n.branches.length < 2) continue;
    // Pour chaque code : le premier cas de la colonne qui le contient.
    const casDuCode = new Map();
    n.branches.forEach((b, i) => {
      for (const liste of b.listes) {
        for (const code of codesDeListe.get(liste) ?? []) {
          if (!casDuCode.has(code)) casDuCode.set(code, { i, liste });
        }
      }
    });
    const parCategorie = new Map();
    for (const [code, cas] of casDuCode) {
      const cat = code.slice(0, 3);
      if (!parCategorie.has(cat)) parCategorie.set(cat, []);
      parCategorie.get(cat).push({ code, ...cas });
    }
    for (const [cat, codes] of parCategorie) {
      if (new Set(codes.map((c) => c.i)).size < 2) continue;
      for (const c of codes.sort((a, b) => comparer(a.code, b.code))) {
        const racines = [...racinesDepuis(arbre, n.branches[c.i].vers)].sort();
        lignes.push({
          CMD: n.cmd,
          Code: c.code,
          Racines: racines.join(", "),
          Liste: c.liste,
          "Libellé code": libelleCode.get(c.code) ?? "",
          _categorie: cat,
          _libelleListe: arbre.listes[c.liste]?.libelle ?? "",
          _noeud: id,
        });
      }
    }
  }
  lignes.sort((a, b) => comparer(a.CMD, b.CMD) || comparer(a._categorie, b._categorie) || comparer(a.Code, b.Code));
  return lignes;
}

const SYMBOLES_ACTES = new Set(["A", "A2", "Atous"]);

function typesDe(racines) {
  return [...new Set(racines.split(", ").map((r) => (/^\d{2}[CKMZ]/.test(r) ? r[2] : "?")))].sort().join("");
}

/** Actes frontières : dans chaque CMD, les actes d'une même famille (4
 *  premières lettres du code CCAM) qui mènent à des racines différentes. */
export function frontieresActes(arbre, actes) {
  if (!frontieresActesParArbre.has(arbre)) frontieresActesParArbre.set(arbre, new WeakMap());
  const calculees = frontieresActesParArbre.get(arbre);
  if (!calculees.has(actes)) calculees.set(actes, calculerFrontieresActes(arbre, actes));
  return calculees.get(actes);
}

function calculerFrontieresActes(arbre, actes) {
  const codesDeListe = new Map();
  const libelleCode = new Map();
  for (const l of actes) {
    if (!codesDeListe.has(l.Liste)) codesDeListe.set(l.Liste, new Set());
    codesDeListe.get(l.Liste).add(l.Code);
    libelleCode.set(l.Code, l["Libellé code"]);
  }
  // CMD → code → { listes, racines } sur tous les tests d'actes qui le citent.
  const parCmd = new Map();
  for (const n of Object.values(arbre.noeuds)) {
    if (n.genre !== "test" || !SYMBOLES_ACTES.has(n.symbole)) continue;
    if (!parCmd.has(n.cmd)) parCmd.set(n.cmd, new Map());
    const codes = parCmd.get(n.cmd);
    for (const b of n.branches) {
      const racines = racinesDepuis(arbre, b.vers);
      for (const liste of b.listes) {
        for (const code of codesDeListe.get(liste) ?? []) {
          if (!codes.has(code)) codes.set(code, { listes: new Set(), racines: new Set() });
          const fiche = codes.get(code);
          fiche.listes.add(liste);
          for (const r of racines) fiche.racines.add(r);
        }
      }
    }
  }
  const lignes = [];
  for (const [cmd, codes] of parCmd) {
    const familles = new Map();
    for (const [code, fiche] of codes) {
      const famille = code.slice(0, 4);
      if (!familles.has(famille)) familles.set(famille, []);
      familles.get(famille).push({ code, racines: [...fiche.racines].sort().join(", "), listes: [...fiche.listes].sort().join(", ") });
    }
    for (const [famille, membres] of familles) {
      if (new Set(membres.map((m) => m.racines)).size < 2) continue;
      // Le type de la racine (3e caractère : C chirurgical, K
      // interventionnel, M médical, Z indifférencié) change-t-il au sein de
      // la famille ? C'est la frontière qui pèse le plus sur la valorisation.
      const types = new Set(membres.map((m) => typesDe(m.racines)));
      for (const m of membres) {
        lignes.push({
          CMD: cmd,
          Code: m.code,
          Racines: m.racines,
          "Liste(s)": m.listes,
          "Libellé code": libelleCode.get(m.code) ?? "",
          _famille: famille,
          _typeChange: types.size > 1,
        });
      }
    }
  }
  lignes.sort((a, b) => comparer(a.CMD, b.CMD) || comparer(a.Code, b.Code));
  return lignes;
}

/** Nombre de catégories CIM-10 des codes frontières en DP, comptées dans
 *  chaque CMD où elles le sont. */
export const nombreCategoriesFrontieres = (lignes) => new Set(lignes.map((l) => `${l.CMD}/${l._categorie}`)).size;

/** Nombre de familles des actes frontières, comptées dans chaque CMD où
 *  elles le sont. */
export const nombreFamillesFrontieres = (lignes) => new Set(lignes.map((l) => `${l.CMD}/${l._famille}`)).size;

// ==== Exclusions des CMA (volume 1, annexes 4 et 5) ====

const cle = (code) => code.replace(/\./g, "");

/** Un élément de liste de DP de l'annexe 5 couvre-t-il `code` ? « A00 »
 *  vaut A00 et toutes ses extensions ; « R05-R07 », tous les codes compris
 *  entre les deux dans l'ordre alphabétique, extensions de R07 comprises ;
 *  l'étoile (« M62.89* ») écarte l'extension 0 que le manuel en exclut. */
export function couvre(element, code) {
  const c = cle(code);
  const dedans = (borne) => {
    const etoile = borne.endsWith("*");
    const b = cle(borne.replace("*", ""));
    return c.startsWith(b) && !(etoile && c === `${b}0`);
  };
  if (!element.includes("-")) return dedans(element);
  const [debut, fin] = element.split("-");
  return c >= cle(debut.replace("*", "")) && (c <= cle(fin.replace("*", "")) || dedans(fin));
}

/** Un élément de liste de DP de l'annexe 5 en clair, pour son infobulle :
 *  ce qu'il couvre (couvre). */
export function titreElement(e) {
  if (e.includes("-")) {
    const [a, b] = e.split("-");
    return `Tous les codes de ${a} à ${b.replace("*", "")}${b.endsWith("*") ? " (sauf l'extension 0)" : ", extensions comprises"}`;
  }
  return e.endsWith("*") ? `${e.slice(0, -1)} et ses extensions, sauf l'extension 0` : `${e} et toutes ses extensions`;
}

/** Un élément de liste de racines couvre-t-il la racine `r` (« 01C03 ») ? */
export function couvreRacine(element, r) {
  let m;
  if ((m = element.match(/^CMD(\d{2})$/))) return r.slice(0, 2) === m[1];
  if ((m = element.match(/^Racines_en_([CKMZ])$/))) return r[2] === m[1];
  if ((m = element.match(/^Sous_CMD(\d{2})_([CKMZ])$/))) return r.slice(0, 2) === m[1] && r[2] === m[2];
  return element === r;
}

// Index code → ligne de CMA, construit une fois par cma_exclusions.json
// chargé : il reste ici, sans toucher à l'objet que partagent les thèmes.
const lignesParJeu = new WeakMap();

/** La ligne de la CMA `code` — [code, niveau, n° de liste de DP, n° de
 *  liste de racines] —, undefined si le code n'est pas une CMA. */
export function ligneCma(exclusions, code) {
  if (!lignesParJeu.has(exclusions)) lignesParJeu.set(exclusions, new Map(exclusions.cma.map((c) => [c[0], c])));
  return lignesParJeu.get(exclusions).get(code);
}

/** L'élément de sa liste de DP qui exclut la CMA `cma` quand `dp` est le
 *  DP du séjour, null si ce DP ne l'exclut pas. */
export function exclusionParDp(exclusions, cma, dp) {
  const listeDp = ligneCma(exclusions, cma)?.[2];
  if (listeDp == null) return null;
  return exclusions.dp[listeDp].find((e) => couvre(e, dp)) ?? null;
}

/** La CMA `code` et ses listes d'exclusion : son niveau, ses numéros de
 *  liste de DP et de liste de racines (null si elle n'en a pas) et leurs
 *  éléments ; null si le code n'est pas une CMA. */
export function ficheCma(exclusions, code) {
  const fiche = ligneCma(exclusions, code);
  if (!fiche) return null;
  const [, niveau, listeDp, listeRacine] = fiche;
  const elementsDp = listeDp != null ? exclusions.dp[listeDp] : [];
  const elementsRacines = listeRacine != null ? exclusions.racines[listeRacine] : [];
  return { niveau, listeDp, listeRacine, elementsDp, elementsRacines };
}

/** Le vérificateur des CMA : `das` est-il une CMA (`cma`) ; si oui, son
 *  niveau, ses numéros de listes d'exclusion, et l'élément de chacune qui
 *  l'exclut avec le DP `dp` (`parDp`) ou dans la racine `racine`
 *  (`parRacine`), s'il y en a ; `dp` et `racine` peuvent manquer. */
export function verifierCma(exclusions, das, dp, racine) {
  const fiche = ligneCma(exclusions, das);
  if (!fiche) return { cma: false };
  const [, niveau, listeDp, listeRacine] = fiche;
  const parDp = dp ? exclusionParDp(exclusions, das, dp) : null;
  const parRacine =
    racine && listeRacine != null ? exclusions.racines[listeRacine].find((e) => couvreRacine(e, racine)) : null;
  return { cma: true, niveau, listeDp, listeRacine, parDp, parRacine };
}

// ==== Algorithme : légende et profil de l'arbre ====

/** « CMD 01 », mais « CM 15 » et « CM 27 », comme les nomme le volume 3. */
export function titreCmd(c) {
  const prefixe = ["15", "27"].includes(c.cmd) ? "CM" : "CMD";
  return `${prefixe} ${c.cmd}`;
}

/** Les CMD que détermine le DP, dernière étape de l'orientation : de 01 à
 *  23, sauf la CM 15, que l'orientation teste avant. */
export const cmdsDuDp = (arbre) => arbre.cmd.filter((c) => Number(c.cmd) <= 23 && c.cmd !== "15");

// Légende du volume 3, pages 6 à 8.
export const SYMBOLES = {
  DP: { texte: "DP", titre: "Le diagnostic principal du RSS" },
  DR: { texte: "DR", titre: "Le diagnostic relié au DP du RSS" },
  DAS: { texte: "DAS", titre: "L'un au moins des diagnostics associés significatifs du RSS" },
  D: { texte: "D", titre: "L'un au moins des diagnostics du RSS" },
  D2: { texte: "D", titre: "Deux au moins des diagnostics du RSS", variante: "double" },
  Dtous: { texte: "D", titre: "Tous les diagnostics du RSS", variante: "epais" },
  A: { texte: "A", titre: "L'un au moins des actes du RSS" },
  A2: { texte: "A", titre: "Deux au moins des actes du RSS", variante: "double" },
  Atous: { texte: "A", titre: "Tous les actes du RSS", variante: "epais" },
  AG: { texte: "AG", titre: "Anesthésie générale" },
  DRDP: { texte: "DR/DP", titre: "Inversion du diagnostic principal avec le diagnostic relié", variante: "inversion" },
  DRbarre: {
    texte: "DR",
    titre: "Au moins un diagnostic parmi le DP et les DAS, sauf le DR",
    variante: "barre",
  },
};

// Les données non médicales que testent les critères (losanges).
export const VARIABLES = {
  DS: "durée de séjour",
  MS: "mode de sortie",
  ME: "mode d'entrée",
  Dest: "destination",
  Âge: "âge à l'entrée",
  Poids: "poids à l'entrée dans l'unité médicale",
  GNN: "groupe de nouveau-nés",
  Durée: "durée de séjour",
  Sexe: "sexe",
  "Nb Séances": "nombre de séances",
  "Inversion DP/DR": "y a-t-il eu inversion du DP et du DR ?",
};

// Ce que dit la couleur d'une case de GHM.
export const COULEURS = {
  age: "l'âge intervient comme marqueur de sévérité",
  age_gestationnel: "l'âge gestationnel intervient comme marqueur de sévérité",
};

/** Une racine de GHM ou un code de GHM, entier ou en partie. */
const RE_REQUETE_GHM = /^\d{2}[ckmz]\d{0,2}[a-z0-9]?$/;

/** « G40.9 » ou « g409 » → diagnostics ; « AAFA001 » → actes. */
export function natureDeCode(requete) {
  const r = requete.trim().toUpperCase().replace(/\s+/g, "");
  if (RE_CCAM.test(r)) return "actes";
  if (/^[A-Z]\d{2}(\.?\d*)?[+]?\d*$/.test(r)) return "diagnostics";
  return null;
}

/** Ce que l'arbre MCO apporte au profil de arbre_graphe.js et de
 *  arbre_vue.js (cf. dessinerArbre), hors dessin : légende des symboles et
 *  des variables, intitulé court des étapes propres au MCO, genres des
 *  feuilles et leur texte, codes de GHM que porte un nœud, requête lue
 *  comme un code de GHM, nature d'un code cherché. Le thème Algorithme y
 *  ajoute l'arbre chargé et le dessin. */
export const PROFIL_MCO = {
  symboles: SYMBOLES,
  variables: VARIABLES,
  special: {
    sans_relation: { court: "Actes sans relation avec le diagnostic principal" },
    gnn: { court: "Détermination du groupe du nouveau-né" },
    inversion: { court: "Inversion DP/DR" },
  },
  feuilles: new Set(["ghm", "erreur", "renvoi"]),
  texteFeuille: (n) => n.racine ?? n.texte,
  codesNoeud: (n) => (n.genre === "ghm" ? codesGhm(n) : n.genre === "erreur" ? [n.racine] : []),
  groupeDeRequete: (compact) => (RE_REQUETE_GHM.test(compact) ? compact : null),
  natureDeCode,
};

// ==== Algorithme : listes ouvertes depuis l'arbre ====

/** Le test d'où la liste est ouverte, et ce qu'il en découle pour les
 *  exclusions de CMA : les racines que sa branche `b` peut atteindre, et,
 *  si `n` est un test sur le DP, les DP possibles (les codes de la liste). */
export function contexteDeListe(arbre, n, b) {
  const racines = [...racinesDepuis(arbre, b.vers)].filter((r) => RE_RACINE.test(r));
  return { racines, dp: n.genre === "test" && n.symbole === "DP" };
}

/** Les codes de la liste `code`, sans doublon, d'après les lignes des
 *  listes publiées : une même liste y apparaît sous plusieurs CMD, avec le
 *  même contenu. */
export function codesDeListe(lignes, code) {
  const vus = new Set();
  const resultat = [];
  for (const l of lignes) {
    if (l.Liste !== code || vus.has(l.Code)) continue;
    vus.add(l.Code);
    resultat.push({ Code: l.Code, "Libellé code": l["Libellé code"] });
  }
  return resultat;
}

/** Les diagnostics d'entrée dans la CMD `cmd` (« 09 »), tels que les donne
 *  le volume 2 (entrees.json), sous la forme des lignes de codesDeListe. */
export function diagnosticsDEntree(lignes, cmd) {
  return lignes.filter((l) => l.CMD === cmd).map((l) => ({ Code: l.Code, "Libellé code": l["Libellé"] }));
}

/** Le niveau de CMA de chaque diagnostic d'une liste (codesDeListe) et ses
 *  exclusions à l'étape d'où elle est ouverte (`contexte`, cf.
 *  contexteDeListe), posés en `_cma` sur sa ligne (statutCma). */
export function cmaDesCodes(exclusions, resultat, contexte) {
  const dps = contexte?.dp ? resultat.map((r) => r.Code) : [];
  const racines = contexte?.racines ?? [];
  for (const r of resultat) r._cma = statutCma(exclusions, r.Code, dps, racines);
  return resultat;
}

/** Niveau d'une CMA et ce qu'en retiennent les exclusions : `exclue` si
 *  toutes les racines atteignables, ou tous les DP possibles, l'excluent ;
 *  `partielle` si certains seulement ; `retenue` sinon. */
export function statutCma(exclusions, code, dps, racines) {
  const fiche = ligneCma(exclusions, code);
  if (!fiche) return null;
  const [, niveau, , listeRacine] = fiche;
  const parRacine =
    listeRacine == null ? [] : racines.filter((r) => exclusions.racines[listeRacine].some((e) => couvreRacine(e, r)));
  const parDp = dps.filter((d) => exclusionParDp(exclusions, code, d));
  const toutes = (parRacine.length && parRacine.length === racines.length) || (parDp.length && parDp.length === dps.length);
  const statut = toutes ? "exclue" : parRacine.length || parDp.length ? "partielle" : "retenue";
  const details = [`CMA de niveau ${niveau}`];
  if (parRacine.length) details.push(`exclue dans ${parRacine.length === racines.length ? "toutes les racines atteignables" : parRacine.join(", ")}`);
  if (parDp.length) details.push(`exclue avec ${parDp.length === dps.length ? "tous les" : `${parDp.length} des ${dps.length}`} DP de cette liste`);
  if (statut === "retenue") details.push(racines.length || dps.length ? "retenue à cette étape" : "exclusions non évaluées ici");
  return { niveau, statut, detail: details.join(" ; ") };
}

/** Les listes qui contiennent les codes commençant par la requête (un code
 *  CIM-10 ou CCAM, entier ou en partie), d'après les lignes des listes
 *  publiées : code → { libelle, listes }. */
export function listesDuCode(lignes, requete) {
  const cle = cleDeCode(requete);
  const parCode = new Map();
  for (const l of lignes) {
    if (!cleDeCode(l.Code).startsWith(cle)) continue;
    if (!parCode.has(l.Code)) parCode.set(l.Code, { libelle: l["Libellé code"], listes: new Set() });
    parCode.get(l.Code).listes.add(l.Liste);
  }
  return parCode;
}

function cleDeCode(code) {
  return String(code).toUpperCase().replace(/[\s.]/g, "");
}

// ==== Fiche code ====

/** Ce que teste chaque symbole du volume 3, en clair, dans la colonne
 *  « Test » des étapes de la fiche code. */
export const SYMBOLES_EN_CLAIR = {
  DP: "DP",
  DR: "DR",
  DAS: "DAS",
  D: "un diagnostic",
  D2: "deux diagnostics",
  Dtous: "tous les diagnostics",
  DRbarre: "DP ou DAS (sauf DR)",
  A: "un acte",
  A2: "deux actes",
  Atous: "tous les actes",
};

/** Les lignes du tableau des étapes de la fiche code : l'étape (`id`,
 *  `cmd`, `page`, et `cas`, le rang du cas quand le test en a plusieurs),
 *  ce qu'elle teste en clair, et les racines que le séjour peut atteindre
 *  par ce cas, par toutes les sorties ou selon `parcours` (parcoursEnDp) ;
 *  aucune pour une étape `nonAtteinte` avec ce DP (marquerAtteintes). */
export function lignesEtapes(arbre, etapes, parcours) {
  return etapes.map((e) => {
    const b = e.n.branches[e.i];
    const symbole = e.n.genre === "test" ? SYMBOLES_EN_CLAIR[e.n.symbole] ?? e.n.symbole : e.n.variable;
    return {
      id: e.id,
      cmd: e.n.cmd,
      page: e.n.page,
      cas: e.n.branches.length > 1 ? e.i : null,
      test: e.test ?? `${symbole} : ${b.libelle}`,
      nonAtteinte: Boolean(e.nonAtteinte),
      racines: e.nonAtteinte ? [] : racinesDe(arbre, b.vers, parcours),
    };
  });
}

// Type de racine, 3e caractère de son code.
export const TYPES_RACINE = { C: "chirurgicale", K: "interventionnelle", M: "médicale", Z: "indifférenciée" };

/** « 27 racines : 22 chirurgicales, 3 interventionnelles, 2 médicales ». */
export function decompte(racines) {
  const parType = Object.entries(TYPES_RACINE).flatMap(([type, nom]) => {
    const n = racines.filter((r) => r[2] === type).length;
    return n ? [`${n} ${nom}${n > 1 ? "s" : ""}`] : [];
  });
  return `${racines.length} racines : ${parType.join(", ")}`;
}

// Au plus tant de voisins dans l'encadré d'un code ou d'un acte frontière :
// les vues d'ensemble des frontières les donnent tous.
export const VOISINS_MAX = 15;

/** Les listes d'un code, chacune avec son libellé : celui de l'arbre, à
 *  défaut celui des lignes du code dans les listes publiées. */
function listesLibellees(arbre, listes, lignes) {
  return listes.map((l) => ({ liste: l, libelle: arbre.listes[l]?.libelle ?? lignes.find((x) => x.Liste === l)?.["Libellé liste"] ?? "" }));
}

/** La fiche d'un diagnostic, en données, d'après les lignes des jeux
 *  chargés (`diagnostics`, listes de la fonction groupage ; `cma` ;
 *  `entrees`, diagnostics d'entrée des CMD) et `exclusions`
 *  (cma_exclusions.json). Son libellé est lu dans les listes, à défaut
 *  parmi les CMA, puis parmi les diagnostics d'entrée ; null s'il n'est
 *  nulle part. En DP : les CMD dont il est un diagnostic d'entrée, les
 *  étapes (lignesEtapes) de ces CMD puis des tests sur le DP, et les
 *  racines que le séjour peut atteindre par celles qu'il prend ; ses lignes
 *  de codes frontières, et les codes voisins de sa catégorie qui mènent à
 *  d'autres racines (VOISINS_MAX, et combien en plus). En DAS : sa CMA
 *  (ficheCma). Puis les autres tests de l'arbre sur ce diagnostic, et ses
 *  listes. */
export function donneesFicheDiagnostic(arbre, code, { diagnostics, cma, entrees, exclusions }) {
  const lignes = diagnostics.filter((l) => l.Code === code);
  const entreesDuCode = entrees.filter((l) => l.Code === code);
  const libelle =
    lignes[0]?.["Libellé code"] ?? cma.find((l) => l.Code === code)?.["Libellé"] ?? entreesDuCode[0]?.["Libellé"];
  if (!libelle) return null;
  const listes = [...new Set(lignes.map((l) => l.Liste))].sort();
  const { parListe } = indexerEtapes(arbre);
  const etapes = listes.flatMap((l) => (parListe.get(l) ?? []).map((e) => ({ ...e, liste: l })));
  const surLeDp = (e) => e.n.genre === "test" && e.n.symbole === "DP";
  const cmds = entreesDuCode.map((e) => etapeCmd(arbre, e.CMD)).filter(Boolean);
  const parcours = parcoursEnDp(listes);
  const enDp = [...cmds, ...marquerAtteintes(arbre, etapes.filter(surLeDp), cmds, parcours)];
  const autres = etapes.filter((e) => !surLeDp(e));

  const frontieres = frontieresDp(arbre, diagnostics);
  const frontiere = frontieres.filter((f) => f.Code === code);
  const voisins = frontiere.length
    ? frontieres.filter(
        (f) => f._categorie === code.slice(0, 3) && frontiere.some((x) => x.CMD === f.CMD) && f.Code !== code
      )
    : [];
  const racinesDuCode = new Set(frontiere.flatMap((f) => f.Racines.split(", ")));
  const ailleurs = voisins.filter((v) => v.Racines.split(", ").some((r) => !racinesDuCode.has(r)));

  return {
    libelle,
    cmds: cmds.map((e) => e.n.cmd),
    enDp: lignesEtapes(arbre, enDp, parcours),
    frontiere,
    voisins: ailleurs.slice(0, VOISINS_MAX),
    voisinsEnPlus: Math.max(0, ailleurs.length - VOISINS_MAX),
    racines: racinesDesEtapes(arbre, enDp.filter((e) => !e.nonAtteinte), parcours),
    cma: ficheCma(exclusions, code),
    autres: lignesEtapes(arbre, autres),
    listes: listesLibellees(arbre, listes, lignes),
  };
}

/** La fiche d'un acte, en données, d'après les lignes des listes d'actes
 *  de la fonction groupage (`actes`), dont le code est ramené à son code
 *  CCAM : son libellé, null s'il n'est dans aucune liste ; les étapes qui
 *  le testent (lignesEtapes) et les racines qu'elles peuvent atteindre ;
 *  ses lignes d'actes frontières, et si le type de GHM y change ; les actes
 *  voisins (même CMD, mêmes 4 lettres) qui mènent à d'autres racines
 *  (VOISINS_MAX, et combien en plus) ; ses listes. */
export function donneesFicheActe(arbre, code, actes) {
  const lignes = actes.filter((l) => codeCcam(l.Code) === code);
  if (!lignes.length) return null;
  const libelle = lignes[0]["Libellé code"];
  const listes = [...new Set(lignes.map((l) => l.Liste))].sort();
  const { parListe } = indexerEtapes(arbre);
  const etapes = listes.flatMap((l) => (parListe.get(l) ?? []).map((e) => ({ ...e, liste: l })));
  const frontieres = frontieresActes(arbre, actes);
  const moi = frontieres.filter((f) => codeCcam(f.Code) === code);
  const voisins = frontieres.filter(
    (f) => moi.some((m) => m.CMD === f.CMD && m._famille === f._famille && m.Racines !== f.Racines) && codeCcam(f.Code) !== code
  );
  return {
    libelle,
    etapes: lignesEtapes(arbre, etapes),
    frontiere: moi,
    typeChange: moi.some((m) => m._typeChange),
    voisins: voisins.slice(0, VOISINS_MAX),
    voisinsEnPlus: Math.max(0, voisins.length - VOISINS_MAX),
    racines: racinesDesEtapes(arbre, etapes),
    listes: listesLibellees(arbre, listes, lignes),
  };
}

// ==== Suggestions de la fiche code ====

/** Au plus tant de codes suggérés pour une saisie. */
export const SUGGESTIONS_MAX = 12;

// Libellés normalisés de chaque jeu, calculés une fois : les recalculer à
// chaque frappe, sur les 74 000 lignes des quatre jeux, prenait 100 à 250 ms.
const normalisesParJeu = new WeakMap();
function libellesNormalises(jeu) {
  if (!normalisesParJeu.has(jeu)) {
    normalisesParJeu.set(jeu, jeu.lignes.map((l) => normaliser(l["Libellé code"] ?? l["Libellé"])));
  }
  return normalisesParJeu.get(jeu);
}

/** Les jeux où chercher la saisie `q`, dans l'ordre : un début de code
 *  CCAM dans les actes ; un début de code CIM-10 dans les diagnostics, les
 *  CMA et les diagnostics d'entrée des CMD ; des mots dans les quatre. */
export function jeuxOuChercher(q) {
  const ccam = /^[a-z]{4}\d/i.test(q.replace(/\s+/g, ""));
  return ccam
    ? ["actes"]
    : /^[a-z]\d/i.test(q)
      ? ["diagnostics", "cma", "entrees"]
      : ["diagnostics", "cma", "entrees", "actes"];
}

/** Ajoute à `trouves` (code → libellé) les codes du jeu `nom` qui
 *  répondent à la saisie `q`, sans doublon, jusqu'à SUGGESTIONS_MAX : ceux
 *  dont le code commence par la saisie ou, dès trois caractères, dont le
 *  libellé contient tous ses mots. Un acte des listes est ramené à son
 *  code CCAM. */
export function chercher(q, nom, jeu, trouves) {
  const code = graphie(q);
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const prefixe = code.replace(/\./g, "");
  const normalises = libellesNormalises(jeu);
  for (const [i, l] of jeu.lignes.entries()) {
    const c = nom === "actes" ? codeCcam(l.Code) : l.Code;
    if (trouves.has(c)) continue;
    const parCode = c.replace(/\./g, "").startsWith(prefixe);
    const parTexte = !parCode && q.length >= 3 && mots.length && mots.every((m) => normalises[i].includes(m));
    if (parCode || parTexte) trouves.set(c, l["Libellé code"] ?? l["Libellé"]);
    if (trouves.size >= SUGGESTIONS_MAX) break;
  }
  return trouves;
}

// ==== Tarifs des GHS (thème Tarifs) ====

/** Lignes du tableau des tarifs, d'après celles de l'arrêté : GHS d'un
 *  même GHM à la suite, plutôt que dans l'ordre du classeur, qui range à
 *  part les GHS UHCD de chaque racine. Le libellé vient en dernier :
 *  colonne la plus large, il repousserait sinon les montants hors de
 *  l'écran. */
export function lignesTarifs(lignes) {
  // Le forfait EXB est le plus souvent nul partout : pas de colonne vide.
  const avecForfait = lignes.some((l) => l["Forfait EXB"]);
  return lignes
    .map((l) => ({
      GHM: l.GHM,
      GHS: l.GHS,
      Tarif: l.Tarif,
      "Borne basse": l["Borne basse"],
      "Borne haute": l["Borne haute"],
      ...(avecForfait ? { "Forfait EXB": l["Forfait EXB"] } : {}),
      "Tarif EXB": l["Tarif EXB"],
      "Tarif EXH": l["Tarif EXH"],
      "Libellé": l["Libellé"],
    }))
    .sort((a, b) => (a.GHM === b.GHM ? a.GHS - b.GHS : a.GHM < b.GHM ? -1 : 1));
}
