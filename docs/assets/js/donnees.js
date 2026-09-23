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

function chargerUrl(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((reponse) => {
        if (!reponse.ok) {
          throw new Error(`${url} : HTTP ${reponse.status}`);
        }
        return reponse.json();
      })
    );
  }
  return cache.get(url);
}

/** Charge un JSON qui n'est pas un tableau colonnaire (l'arbre de la
 *  fonction groupage, produit par scripts/build_arbre.py) et le rend tel
 *  quel. Même cache que `chargerJeu`. */
export function chargerJson(theme, fichier) {
  return chargerUrl(`assets/data/${theme}/${fichier}.json`);
}

/** Charge `assets/data/<theme>/<fichier>.json` et rend `{ libelle,
 *  millesime, lignes }`. Lève si la requête échoue : chaque thème l'attrape
 *  pour afficher un message plutôt qu'une page blanche. */
export function chargerJeu(theme, fichier, libelle) {
  const url = `assets/data/${theme}/${fichier}.json`;
  const cle = `${url}#lignes`;
  if (!cache.has(cle)) {
    cache.set(
      cle,
      chargerUrl(url).then((payload) => ({
        libelle,
        millesime: payload.millesime,
        lignes: reconstituerLignes(payload),
      }))
    );
  }
  return cache.get(cle);
}
