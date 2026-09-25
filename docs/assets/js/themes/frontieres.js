// Codes frontières en DP — les catégories CIM-10 dont les codes, placés en
// diagnostic principal, partent vers des cas différents d'une même colonne
// de tests sur le DP : à un caractère près, la racine de GHM change.
//
// Calculé dans le navigateur, sans étape de build : l'arbre de la fonction
// groupage (arbre.json) croisé avec les listes de diagnostics publiées.

import { chargerJeu, chargerJson } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["CMD", "Code", "Racines", "Liste", "Libellé code", "_libelleListe"];

/** Racines de GHM (et groupes d'erreur, renvois) atteignables depuis un
 *  nœud, en suivant toutes ses sorties. */
export function racinesAtteintes(arbre, depart, memo) {
  if (memo.has(depart)) return memo.get(depart);
  memo.set(depart, new Set()); // garde-fou : l'arbre n'a pas de boucle
  const n = arbre.noeuds[depart];
  let resultat;
  if (n.genre === "ghm" || n.genre === "erreur") resultat = new Set([n.racine]);
  else if (n.genre === "renvoi") resultat = new Set([`orientation ${n.texte}`]);
  else {
    resultat = new Set();
    const suites = [...(n.branches ?? []).map((b) => b.vers), n.sinon?.vers, n.suite?.vers].filter(Boolean);
    for (const s of suites) for (const r of racinesAtteintes(arbre, s, memo)) resultat.add(r);
  }
  memo.set(depart, resultat);
  return resultat;
}

export function calculer(arbre, diagnostics) {
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

export async function rendre(conteneur) {
  const [arbre, diagnostics] = await Promise.all([
    chargerJson("groupage", "arbre"),
    chargerJeu("groupage", "diagnostics", "listes de diagnostics de la fonction groupage"),
  ]);
  if (!arbre._frontieres) {
    arbre._frontieres = recherche.indexer(calculer(arbre, diagnostics.lignes), COLONNES_CHERCHABLES);
  }
  const lignes = arbre._frontieres;
  const categories = new Set(lignes.map((l) => `${l.CMD}/${l._categorie}`)).size;

  conteneur.innerHTML = "";
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "frontieres_recherche",
    exemple: "ex. : K25, 06M04, diabète",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h1", {}, "Codes frontières en DP"),
    fraicheur([
      { libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime },
      { libelle: diagnostics.libelle, millesime: diagnostics.millesime },
    ]),
    el(
      "p",
      {},
      `Les ${categories} catégories CIM-10 dont les codes, en diagnostic principal, partent vers des cas différents d'une même colonne de tests sur le DP : à un caractère près, le séjour change de racine de GHM. Une ligne par code ; « Racines » donne les racines que le cas peut atteindre selon les tests suivants (âge, actes…).`
    ),
    el(
      "p",
      { class: "sous-titre" },
      "Limites : seuls les tests sur le DP de l'arbre sont examinés, sans valorisation (elle est dans la fiche de chaque code et dans les ",
      el("a", { class: "lien-texte", href: "#/mco/tarifs" }, "tarifs des GHS"),
      ") ; le choix de la CMD par le DP, fait en amont de l'arbre, n'est pas couvert. Voir aussi ",
      el("a", { class: "lien-texte", href: "#/mco/arbre" }, "l'algorithme de la fonction groupage"),
      "."
    ),
    el("div", { class: "barre-outils" }, champ),
    zoneResultats
  );

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, lignes.filter(filtre), { total: lignes.length });
  }
  afficher("");
}
