// Fonction groupage MCO — ce que plusieurs thèmes lisent de la même façon
// dans l'arbre (arbre.json) et les listes : racines atteintes depuis un
// nœud, codes GHM d'une case, codes et actes frontières, éléments des
// listes d'exclusion des CMA (volume 1, annexes 4 et 5).
//
// Rien ici ne touche au DOM : les fonctions reçoivent l'arbre et les jeux
// chargés en argument. Pendant MCO de smr.js. Partagé par la fiche code,
// l'algorithme, les CMA, les codes et actes frontières.

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

/** Codes GHM couverts par une case : « 1 » en bas vaut les niveaux 1 à 4,
 *  une lettre vaut elle-même ; la case du haut ajoute J ou T. */
export function codesGhm(f) {
  const codes = [];
  if (f.bas === "1") codes.push(...["1", "2", "3", "4"].map((n) => f.racine + n));
  else if (f.bas) codes.push(f.racine + f.bas);
  if (f.haut) codes.push(f.racine + f.haut);
  return codes;
}

// ==== Codes frontières en DP ====

/** Codes frontières en DP : pour chaque colonne de tests sur le DP, les
 *  codes d'une même catégorie CIM-10 qui partent vers des cas différents. */
export function frontieresDp(arbre, diagnostics) {
  const codesDeListe = new Map();
  const libelleCode = new Map();
  for (const l of diagnostics) {
    if (!codesDeListe.has(l.Liste)) codesDeListe.set(l.Liste, new Set());
    codesDeListe.get(l.Liste).add(l.Code);
    libelleCode.set(l.Code, l["Libellé code"]);
  }
  const memo = new Map();
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
      for (const c of codes.sort((a, b) => a.code.localeCompare(b.code))) {
        const racines = [...racinesAtteintes(arbre, n.branches[c.i].vers, memo)].sort();
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
  lignes.sort((a, b) => a.CMD.localeCompare(b.CMD) || a._categorie.localeCompare(b._categorie) || a.Code.localeCompare(b.Code));
  return lignes;
}

// ==== Actes frontières ====

const SYMBOLES_ACTES = new Set(["A", "A2", "Atous"]);

function typesDe(racines) {
  return [...new Set(racines.split(", ").map((r) => (/^\d{2}[CKMZ]/.test(r) ? r[2] : "?")))].sort().join("");
}

/** Actes frontières : dans chaque CMD, les actes d'une même famille (4
 *  premières lettres du code CCAM) qui mènent à des racines différentes. */
export function frontieresActes(arbre, actes) {
  const codesDeListe = new Map();
  const libelleCode = new Map();
  for (const l of actes) {
    if (!codesDeListe.has(l.Liste)) codesDeListe.set(l.Liste, new Set());
    codesDeListe.get(l.Liste).add(l.Code);
    libelleCode.set(l.Code, l["Libellé code"]);
  }
  const memo = new Map();
  // CMD → code → { listes, racines } sur tous les tests d'actes qui le citent.
  const parCmd = new Map();
  for (const n of Object.values(arbre.noeuds)) {
    if (n.genre !== "test" || !SYMBOLES_ACTES.has(n.symbole)) continue;
    if (!parCmd.has(n.cmd)) parCmd.set(n.cmd, new Map());
    const codes = parCmd.get(n.cmd);
    for (const b of n.branches) {
      const racines = racinesAtteintes(arbre, b.vers, memo);
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
  lignes.sort((a, b) => a.CMD.localeCompare(b.CMD) || a.Code.localeCompare(b.Code));
  return lignes;
}

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

/** Un élément de liste de racines couvre-t-il la racine `r` (« 01C03 ») ? */
export function couvreRacine(element, r) {
  let m;
  if ((m = element.match(/^CMD(\d{2})$/))) return r.slice(0, 2) === m[1];
  if ((m = element.match(/^Racines_en_([CKMZ])$/))) return r[2] === m[1];
  if ((m = element.match(/^Sous_CMD(\d{2})_([CKMZ])$/))) return r.slice(0, 2) === m[1] && r[2] === m[2];
  return element === r;
}
