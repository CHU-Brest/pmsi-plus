// Chargement des jeux JSON produits par scripts/build_data.py, avec cache
// mémoire — pendant du `@st.cache_data` de `socle._lire()` : un thème visité
// deux fois ne retélécharge pas son JSON.

const cache = new Map();

/** Charge `assets/data/<theme>/<fichier>.json` et rend `{ libelle,
 *  millesime, lignes }`. Lève si la requête échoue : chaque thème l'attrape
 *  pour afficher un message plutôt qu'une page blanche. */
export function chargerJeu(theme, fichier, libelle) {
  const url = `assets/data/${theme}/${fichier}.json`;
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((reponse) => {
        if (!reponse.ok) {
          throw new Error(`${url} : HTTP ${reponse.status}`);
        }
        return reponse.json();
      }).then((payload) => ({
        libelle,
        millesime: payload.millesime,
        lignes: payload.lignes,
      }))
    );
  }
  return cache.get(url);
}
