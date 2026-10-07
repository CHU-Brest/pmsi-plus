// Chargement des jeux JSON produits par scripts/build_data.py, avec cache
// mémoire : un thème visité deux fois ne retélécharge pas son JSON.

const cache = new Map();

/** `build_data.py` écrit les lignes en format colonnaire (`colonnes` +
 *  `valeurs`) pour ne pas répéter les clefs sur chaque ligne côté réseau.
 *  On les reconstitue en objets ici, une seule fois par jeu chargé : tout le
 *  reste du site continue de manipuler des lignes `{ colonne: valeur }`.
 *  Exportée pour qui lit le JSON sans passer par chargerJeu (sous Node). */
export function reconstituerLignes({ colonnes, valeurs }) {
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

/** Garde la promesse de `charger()` sous `cle`, sauf si elle échoue : une
 *  coupure passagère ne condamne pas le jeu jusqu'au rechargement de la
 *  page, la visite suivante le redemande. */
function memoriser(cle, charger) {
  if (!cache.has(cle)) {
    cache.set(
      cle,
      charger().catch((erreur) => {
        cache.delete(cle);
        throw erreur;
      })
    );
  }
  return cache.get(cle);
}

/** Charge un JSON qui n'est pas un tableau colonnaire (l'arbre de la
 *  fonction groupage, produit par scripts/build_arbre.py) et le rend tel
 *  quel, gardé en cache comme les jeux. */
export function chargerJson(theme, fichier) {
  const url = `assets/data/${theme}/${fichier}.json`;
  return memoriser(`brut:${url}`, () => recuperer(url));
}

/** Charge `assets/data/<theme>/<fichier>.json` et rend `{ libelle,
 *  millesime, campagne, lignes }` — `campagne` pour l'arrêté tarifaire
 *  seulement, `undefined` ailleurs. Lève si la requête échoue : chaque
 *  thème l'attrape pour afficher un message plutôt qu'une page blanche. */
export function chargerJeu(theme, fichier, libelle) {
  const url = `assets/data/${theme}/${fichier}.json`;
  // Seules les lignes reconstituées restent en cache, pas le format
  // colonnaire téléchargé : il serait gardé en double pour rien.
  return memoriser(url, () =>
    recuperer(url).then((payload) => ({
      libelle,
      millesime: payload.millesime,
      campagne: payload.campagne,
      lignes: reconstituerLignes(payload),
    }))
  );
}
