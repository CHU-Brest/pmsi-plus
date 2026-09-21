# PMSI+ — site public

Version statique, publiable sur **GitHub Pages**, des référentiels d'aide au codage de
l'application interne **PMSI+** du CHU de Brest (dépôt `pmsi_plus`, Streamlit).

## Ce qui est publié, ce qui ne l'est pas

Seuls les thèmes d'**aide au codage** — des référentiels qu'on cherche, sans donnée
individuelle — sont repris ici :

| Section | Thème | Contenu |
|---|---|---|
| CIM-10 | Intox CIM-10 | médicaments → codes CIM-10 d'intoxication ; effets nocifs par substance |
| CIM-10 | Germes CIM-10 | germes → code CIM-10, avec et sans sepsis |
| HDJ | Actes CCAM | actes et caractéristiques (classants annexe 8, FFM, SE1-SE8) |
| HDJ | Médicaments de la RH et LES | mode d'emploi du VIDAL Hoptimal (aucune donnée tabulée) |
| HDJ | Contexte patient | codes CIM-10 de contexte et justification |
| Référentiels | Acronymes & abréviations | sigles médicaux et leur signification |

La rubrique **Analyse DIM** du dépôt d'origine (« Durée de séjour », « Occupation des
lits ») **n'a pas de contrepartie ici et ne doit jamais en avoir une** : ce sont des
agrégats calculés sur les séjours réels du CHU de Brest, pas des référentiels génériques.
Même censurés (seuil de diffusion à onze séjours), ce sont des données d'établissement qui
n'ont rien à faire sur une page publique. Si un thème futur touche, même indirectement, à
l'activité ou aux séjours du CHU, il ne doit pas rejoindre ce dépôt.

Les référentiels publiés ici (intoxications, germes, actes CCAM, contexte patient,
acronymes) sont des tables de correspondance codes/référentiels maintenues par le DIM —
aucune ne porte de donnée patient. En cas de doute sur un futur ajout, trancher avant
de committer, pas après.

## Architecture

Aucun serveur, aucune génération à la volée : **un site 100 % statique**, HTML/CSS/JS
natifs (pas de framework, pas de bundler), et les données au format JSON à côté du code —
le même principe que `pmsi_plus`, où « les données sont versionnées avec le code ».

```
data/                        sources de vérité : xlsx tels que fournis par le DIM
  intox/medicaments.xlsx
  intox/substances.xlsx
  germes/germes.xlsx
  actes/actes.xlsx
  contextes/contextes.xlsx
  acronymes/acronymes.xlsx
  medicaments/{rh,les}.png    captures VIDAL Hoptimal, sans donnée tabulée

scripts/
  build_data.py               xlsx → JSON, seule dépendance : openpyxl
  requirements.txt

docs/                         racine servie par GitHub Pages
  index.html                  coquille : barre latérale + zone de contenu
  assets/
    css/style.css             jetons repris de .streamlit/config.toml (pmsi_plus)
    js/
      main.js                 routage par hash (#/slug) et barre de navigation
      registry.js             sections/thèmes — jumeau de src/registre.py
      recherche.js             normalisation + filtre multi mots clefs — port de
                               src/recherche.py
      interface.js             drapeau de fraîcheur, champ de recherche, tableau —
                               port de src/interface.py
      donnees.js               chargement JSON avec cache mémoire
      themes/<slug>.js         une vue par thème — jumeau de src/themes/<nom>/page.py
    data/<theme>/<jeu>.json    généré par build_data.py, ne pas éditer à la main
    img/{rh,les}.png           copies de data/medicaments/ servies par le site
```

Pas de bundler ni de `node_modules` : les modules JS sont chargés nativement par le
navigateur (`<script type="module">`, `import` standard). Rien à installer pour modifier
le site — un éditeur de texte et un serveur statique local suffisent.

### Pourquoi pas Streamlit tel quel

GitHub Pages ne sert que des fichiers statiques, sans interpréteur Python côté serveur :
`streamlit run` est donc hors de portée. Comme chaque thème gardé ici est une recherche
plein texte sur un petit référentiel (moins de 24 000 lignes, quelques centaines de
kilo-octets par jeu), la reproduire en JavaScript pur — recherche câblée dans le
navigateur, aucun aller-retour serveur — est plus simple à maintenir qu'un pipeline de
build (Pyodide, export Streamlit, etc.) pour un résultat équivalent.

## Mettre à jour un référentiel

1. Remplacer le fichier dans `data/<theme>/<fichier>.xlsx` (même nom, mêmes colonnes).
2. `pip install -r scripts/requirements.txt` (une fois).
3. `python scripts/build_data.py` — régénère tout `docs/assets/data/`.
4. Vérifier en local (`python -m http.server 8000 --directory docs`, puis
   http://localhost:8000).
5. Committer **le xlsx et le JSON généré ensemble**, pousser.

Le drapeau « Données du JJ/MM/AAAA » de chaque thème est déduit de la date du dernier
commit **git** touchant ce xlsx (`git log`), pas du mtime du fichier sur disque : à la
différence de `pmsi_plus` (déployé par rsync incrémental, où le mtime est fiable), un
`git clone` réinitialise le mtime de tous les fichiers au moment du clone, ce qui aurait
rendu le drapeau toujours daté d'aujourd'hui. C'est l'écart assumé le plus important par
rapport à l'application d'origine.

Ajouter un thème : créer `data/<theme>/`, une ligne dans `JEUX` de `build_data.py`, un
fichier `docs/assets/js/themes/<slug>.js` exportant une fonction `rendre(conteneur)`, et
une ligne dans `docs/assets/js/registry.js`. Pas de contrat de colonnes formel comme
`socle.Jeu` dans `pmsi_plus` — l'échelle ne le justifie pas ici — mais chaque thème garde
le même déroulé qu'une page de `pmsi_plus` : entrée (`chargerJeu`), transformation
(`recherche.filtre`), sortie (`interface.resultats`/`tableau`).

## Déploiement

Réglage unique, à faire une fois sur GitHub : **Settings → Pages → Build and deployment
→ Deploy from a branch**, brancher sur `main` et le dossier `/docs`. Aucun workflow
GitHub Actions : le site déployé est exactement ce qui est commité dans `docs/`, sans
étape de build intermédiaire à maintenir ni à déboguer.

## Écarts assumés avec `pmsi_plus`

- **Analyse DIM absente**, pas seulement masquée — cf. plus haut.
- **Millésime déduit de `git log`**, pas du mtime du fichier — cf. « Mettre à jour un
  référentiel ».
- **Pas d'icônes Material** : elles sont embarquées dans Streamlit, indisponibles ici
  sans charger une police externe. Choix : aucune icône plutôt qu'un emoji coloré
  dépendant de la police du système — `pmsi_plus` fait le même arbitrage, pour la même
  raison (rendu identique sur tous les postes).
- **Recherche en JavaScript natif** (`normalize("NFD")` + `\p{Diacritic}`) plutôt
  qu'`unidecode` : couvre les mêmes cas d'usage (accents, apostrophes typographiques)
  pour un référentiel médical français, sans étude de parité caractère par caractère.
- **Tri des tableaux au clic sur l'en-tête**, absent de `pmsi_plus` : `st.dataframe`
  l'offre nativement, sa reconstruction en JavaScript pur était peu coûteuse.
- **Pas de tests automatisés** : `pmsi_plus` vérifie son contrat de données
  (`tests/test_socle.py`) à chaque remplacement de parquet ; ici, `build_data.py` échoue
  bruyamment si un xlsx est absent ou illisible, et la vérification visuelle après
  régénération (étape 4 ci-dessus) en tient lieu.
