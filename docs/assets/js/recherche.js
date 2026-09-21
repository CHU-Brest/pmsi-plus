// Recherche plein texte : insensible à la casse, aux accents, multi mots
// clefs cumulatifs. Port direct de `src/recherche.py` de pmsi_plus.
//
// `normaliser()` s'applique aux données comme à la saisie : ne normaliser
// que la saisie revient à ne rien normaliser.

const COLONNE_CLE = "_recherche";

export function normaliser(texte) {
  return (texte ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // isolés par la décomposition NFD ci-dessus
    .toLowerCase();
}

/** Ajoute `_recherche` à chaque ligne, construite sur `colonnes`. Fait une
 *  seule fois par jeu chargé — jamais recalculée à la frappe. */
export function indexer(lignes, colonnes) {
  for (const ligne of lignes) {
    ligne[COLONNE_CLE] = normaliser(
      colonnes.map((c) => (ligne[c] ?? "")).join(" ")
    );
  }
  return lignes;
}

/** Prédicat gardant les lignes contenant *tous* les mots clefs de `requete`.
 *  Une requête vide ne filtre rien. */
export function filtre(requete) {
  const motsClefs = normaliser(requete).trim().split(/\s+/).filter(Boolean);
  if (motsClefs.length === 0) return () => true;
  return (ligne) => motsClefs.every((mot) => ligne[COLONNE_CLE].includes(mot));
}
