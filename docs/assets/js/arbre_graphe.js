// Lecture d'un arbre de décision de fonction groupage, sans DOM : index des
// parents, chemin d'un nœud jusqu'à la racine, recherche des étapes et des
// feuilles, textes d'une ligne. Le dessin est celui de arbre_vue.js, qui
// passe ici le profil du champ (`P`, cf. dessinerArbre) : l'arbre et ce que
// le champ sait de ses nœuds (symboles, feuilles, codes de groupe…).

import * as recherche from "./recherche.js";

/** Index construits une fois par graphe : parents de chaque nœud (pour
 *  remonter le chemin jusqu'à la racine) et texte de recherche. Ils sont
 *  posés sur l'arbre partagé (`_pret`, `_parents`, et `_id`, `_recherche`
 *  sur chaque nœud), que les profils lisent aussi (`n._id`). */
export function preparer(P) {
  const arbre = P.arbre;
  if (arbre._pret) return arbre;
  const parents = new Map();
  const ajouter = (vers, lien) => {
    if (!parents.has(vers)) parents.set(vers, []);
    parents.get(vers).push(lien);
  };
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    (n.branches ?? []).forEach((b, i) =>
      ajouter(b.vers, { de: id, role: "oui", i, rejoint: Boolean(b.rejoint) })
    );
    if (n.sinon) ajouter(n.sinon.vers, { de: id, role: "non", rejoint: Boolean(n.sinon.rejoint) });
    if (n.suite) ajouter(n.suite.vers, { de: id, role: "suite", rejoint: Boolean(n.suite.rejoint) });
  }
  arbre._parents = parents;
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    n._id = id;
    n._recherche = recherche.normaliser(texteDeRecherche(P, n));
  }
  arbre._pret = true;
  return arbre;
}

function texteDeRecherche(P, n) {
  const codes = P.codesNoeud(n);
  if (P.feuilles.has(n.genre)) {
    const texte = P.texteFeuille(n);
    return [texte, ...codes.filter((c) => c !== texte)].join(" ");
  }
  // Pour un test, le seul code de son symbole (« A », « DP ») : sa légende
  // fixe (« L'un au moins des actes du RSS ») ferait remonter tous les
  // tests du même symbole à chaque mot courant.
  const morceaux = [n.genre === "test" ? P.symboles[n.symbole].texte : intituleCourt(P, n), ...codes];
  for (const b of n.branches ?? []) {
    morceaux.push(b.libelle);
    for (const code of b.listes) morceaux.push(code, P.arbre.listes[code]?.libelle ?? "");
  }
  return morceaux.join(" ");
}

/** Texte ou fonction du nœud : les étapes propres à un champ décrivent
 *  leurs textes par l'un ou l'autre. */
function special(P, n, cle) {
  const valeur = P.special?.[n.genre]?.[cle];
  return typeof valeur === "function" ? valeur(n) : valeur;
}

/** Ce que teste un nœud, en quelques mots, sans ses listes. */
function intituleCourt(P, n) {
  switch (n.genre) {
    case "test":
      return `${P.symboles[n.symbole].texte} — ${P.symboles[n.symbole].titre}`;
    case "critere":
      return n.variable;
    default:
      return special(P, n, "court") ?? "";
  }
}

/** Un nœud en une ligne, pour un renvoi ou un résultat de recherche. */
export function resume(P, n) {
  const b = n.branches ?? [];
  const prefixe =
    n.genre === "test" ? P.symboles[n.symbole].texte : n.genre === "critere" ? n.variable : "";
  if (n.genre === "test" || n.genre === "critere") {
    if (b.length === 1) return `${prefixe} ${b[0].libelle}`.trim();
    return `${prefixe} — ${b.length} cas`;
  }
  if (P.feuilles.has(n.genre)) return P.texteFeuille(n);
  return intituleCourt(P, n);
}

/** « D-0103 », « d0103 », « A 180 » → le code de liste canonique, ou null. */
function codeDeListe(requete) {
  const m = requete.trim().match(/^([ad])\s*-?\s*(\d{3,4})$/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

// ==== Chemin ====

/** Les étapes qui mènent au trait `depuis`, de la racine de la catégorie
 *  vers la feuille. On remonte par le trait qui porte chaque étape
 *  (jamais par un renvoi « rejoint »), si bien que le chemin est celui du
 *  dessin. L'arbre doit être préparé (`preparer`). */
export function cheminVers(arbre, depuis) {
  // Une feuille en tête de colonne (un GN du SMR que rien ne subdivise en
  // HTP) : aucun test n'y mène.
  if (!depuis) return [];
  const etapes = [depuis];
  let courant = depuis.de;
  const vus = new Set([courant]);
  for (;;) {
    const entrants = arbre._parents.get(courant) ?? [];
    const lien = entrants.find((p) => !p.rejoint) ?? entrants[0];
    if (!lien || vus.has(lien.de)) break;
    etapes.unshift(lien);
    courant = lien.de;
    vus.add(courant);
  }
  return etapes;
}

/** Une étape de chemin en texte : « Âge <18 ans : oui ». */
function texteEtape(P, n, e) {
  const b = n.branches ?? [];
  const prefixe = n.genre === "critere" ? `${n.variable} ` : "";
  if (e.role === "oui") return `${prefixe}${b[e.i]?.libelle ?? ""}`.trim();
  if (e.role === "non") return `${prefixe}${b.length === 1 ? b[0].libelle : resume(P, n)} : non`.trim();
  return intituleCourt(P, n);
}

// ==== Recherche ====

/** Les étapes et feuilles qui répondent à la requête, en entrées
 *  `{ n, i }` : `i` désigne le cas d'une colonne de cas qui répond, pour
 *  montrer ce cas plutôt que tout le test (le DP de la CMD 01 en compte
 *  27). L'arbre du profil doit être préparé (`preparer`). */
export function noeudsCorrespondants(P, requete) {
  const arbre = P.arbre;
  const compact = recherche.normaliser(requete).replace(/\s+/g, "");
  // Un code de groupe, entier ou en partie (« 01M », « 01M24 »,
  // « 0147SC ») : comparé aux codes que porte chaque nœud, si bien que
  // « 25M02C » ne rend que la case C.
  const groupe = P.groupeDeRequete(compact);
  // Un code de liste, avec ou sans tiret : comparé code pour code, faute
  // de quoi « D-030 » ramènerait aussi D-0301 à D-0309.
  const liste = codeDeListe(requete);
  const filtre = recherche.filtre(requete);
  const entrees = [];
  for (const n of Object.values(arbre.noeuds)) {
    const codes = P.codesNoeud(n);
    if (groupe) {
      if (codes.some((c) => recherche.normaliser(c).startsWith(groupe))) entrees.push({ n, i: null });
      continue;
    }
    if (P.feuilles.has(n.genre)) {
      // Une feuille qui porte un code ne répond qu'à son code.
      if (!codes.length && !liste && filtre({ _recherche: n._recherche })) entrees.push({ n, i: null });
      continue;
    }
    const b = n.branches ?? [];
    const cas = b
      .map((x, i) => ({ x, i }))
      .filter(({ x }) =>
        liste ? x.listes.includes(liste) : filtre({ _recherche: recherche.normaliser(texteDeBranche(arbre, x)) })
      );
    if (liste) {
      entrees.push(...cas.map(({ i }) => ({ n, i: b.length > 1 ? i : null })));
      continue;
    }
    if (!filtre({ _recherche: n._recherche })) continue;
    if (b.length > 1 && cas.length) entrees.push(...cas.map(({ i }) => ({ n, i })));
    else entrees.push({ n, i: null });
  }
  return entrees;
}

function texteDeBranche(arbre, b) {
  return [b.libelle, ...b.listes.flatMap((l) => [l, arbre.listes[l]?.libelle ?? ""])].join(" ");
}

/** Les cas qui testent l'une des `listes` (un Set de codes de liste), en
 *  entrées `{ n, i }` comme noeudsCorrespondants, sauf ceux de `deja`. */
export function casDesListes(arbre, listes, deja) {
  const vus = new Set(deja.map((e) => `${e.n._id}/${e.i}`));
  const ajouts = [];
  for (const n of Object.values(arbre.noeuds)) {
    const b = n.branches ?? [];
    b.forEach((x, i) => {
      if (!x.listes.some((l) => listes.has(l))) return;
      const entree = { n, i: b.length > 1 ? i : null };
      if (!vus.has(`${n._id}/${entree.i}`)) ajouts.push(entree);
    });
  }
  return ajouts;
}

/** Un résultat de recherche en une ligne. Une feuille qui porte un code
 *  est située par les deux dernières conditions de son chemin. */
export function resumeResultat(P, n, i) {
  const arbre = P.arbre;
  const codes = P.codesNoeud(n);
  if (P.feuilles.has(n.genre) && codes.length) {
    // Les deux dernières conditions du chemin situent la case mieux que
    // son seul code : « Épilepsie (D-0103) · Âge <18 ans ».
    const parent = (arbre._parents.get(n._id) ?? [])[0];
    const contexte = parent
      ? cheminVers(arbre, parent)
          .slice(-2)
          .map((e) => texteEtape(P, arbre.noeuds[e.de], e))
          .join(" · ")
      : "";
    const texte = P.texteFeuille(n);
    const autres = codes.filter((c) => c !== texte);
    return `${texte}${autres.length ? ` (${autres.join(", ")})` : ""}${contexte ? ` — ${contexte}` : ""}`;
  }
  const b = n.branches ?? [];
  if (i != null) {
    const cible = arbre.noeuds[b[i].vers];
    const prefixe = n.genre === "critere" ? `${n.variable} ` : `${P.symboles[n.symbole]?.texte ?? ""} `;
    const suite = P.feuilles.has(cible.genre) ? ` → ${P.texteFeuille(cible)}` : "";
    return `${prefixe}${b[i].libelle}${suite}`;
  }
  const cible = b.length === 1 ? arbre.noeuds[b[0].vers] : null;
  const suite = cible && P.feuilles.has(cible.genre) ? ` → ${P.texteFeuille(cible)}` : "";
  return `${resume(P, n)}${suite}`;
}
