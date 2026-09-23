// Chargement des jeux JSON produits par scripts/build_data.py, avec cache
// mémoire : un thème visité deux fois ne retélécharge pas son JSON.

const cache = new Map();

/** `build_data.py` écrit les lignes en format colonnaire (`colonnes` +
 *  `valeurs`) pour ne pas répéter les clefs sur chaque ligne côté réseau.
 *  On les reconstitue en objets ici, une seule fois par jeu chargé : tout le
 *  reste du site continue de manipuler des lignes `{ colonne: valeur }`. */
function reconstituerLignes({ colonnes, valeurs }) {
  return valeurs.map((v) => Object.fromEntries(colonnes.map((c, i) => [c, v[i]])));
}

function recuperer(url) {
  return fetch(url).then((reponse) => {
    if (!reponse.ok) {
      throw new Error(`${url} : HTTP ${reponse.status}`);
    }
    return reponse.json();
  });
}

/** Charge un JSON qui n'est pas un tableau colonnaire (l'arbre de la
 *  fonction groupage, produit par scripts/build_arbre.py) et le rend tel
 *  quel, gardé en cache comme les jeux. */
export function chargerJson(theme, fichier) {
  const url = `assets/data/${theme}/${fichier}.json`;
  const cle = `brut:${url}`;
  if (!cache.has(cle)) cache.set(cle, recuperer(url));
  return cache.get(cle);
}

/** Charge `assets/data/<theme>/<fichier>.json` et rend `{ libelle,
 *  millesime, lignes }`. Lève si la requête échoue : chaque thème l'attrape
 *  pour afficher un message plutôt qu'une page blanche. */
export function chargerJeu(theme, fichier, libelle) {
  const url = `assets/data/${theme}/${fichier}.json`;
  // Seules les lignes reconstituées restent en cache, pas le format
  // colonnaire téléchargé : il serait gardé en double pour rien.
  const cle = url;
  if (!cache.has(cle)) {
    cache.set(
      cle,
      recuperer(url).then((payload) => ({
        libelle,
        millesime: payload.millesime,
        lignes: reconstituerLignes(payload),
      }))
    );
  }
  return cache.get(cle);
}
