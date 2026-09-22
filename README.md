# PMSI+ — site public

Version statique, publiable sur **GitHub Pages**, des référentiels d'aide au codage PMSI
du CHU de Brest.

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

Aucun agrégat calculé sur les séjours réels du CHU de Brest (durée de séjour, occupation
des lits...) ne doit jamais être publié ici, même censuré (seuil de diffusion à onze
séjours) : ce sont des données d'établissement, pas des référentiels génériques. Si un
thème futur touche, même indirectement, à l'activité ou aux séjours du CHU, il ne doit pas
rejoindre ce dépôt.

Les référentiels publiés ici (intoxications, germes, actes CCAM, contexte patient,
acronymes) sont des tables de correspondance codes/référentiels maintenues par le DIM —
aucune ne porte de donnée patient. En cas de doute sur un futur ajout, trancher avant
de committer, pas après.

## Architecture

Aucun serveur, aucune génération à la volée : **un site 100 % statique**, HTML/CSS/JS
natifs (pas de framework, pas de bundler), et les données au format JSON à côté du code.

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
    css/style.css             jetons de conception (couleurs, rayons, typo) puis composants
    js/
      main.js                 routage par hash (#/slug), navigation, tiroir mobile
      theme.js                bascule clair/sombre, retenue dans localStorage
      registry.js             sections/thèmes
      recherche.js             normalisation + filtre multi mots clefs
      interface.js             drapeau de fraîcheur, champ de recherche, tableau
      donnees.js               chargement JSON avec cache mémoire
      themes/<slug>.js         une vue par thème
    data/<theme>/<jeu>.json    généré par build_data.py, ne pas éditer à la main
    img/{rh,les}.png           copies de data/medicaments/ servies par le site
```

Pas de bundler ni de `node_modules` : les modules JS sont chargés nativement par le
navigateur (`<script type="module">`, `import` standard). Rien à installer pour modifier
le site — un éditeur de texte et un serveur statique local suffisent.

GitHub Pages ne sert que des fichiers statiques, sans interpréteur côté serveur. Comme
chaque thème gardé ici est une recherche plein texte sur un petit référentiel (moins de
24 000 lignes, quelques centaines de kilo-octets par jeu), une recherche câblée dans le
navigateur — sans aller-retour serveur — est plus simple à maintenir qu'un pipeline de
build pour un résultat équivalent.

## Interface

Le thème visuel tient dans les variables CSS en tête de `docs/assets/css/style.css` :
une palette pour le mode clair, la même redéfinie une fois pour le mode sombre. Aucun
composant n'écrit de couleur en dur — ajouter une couleur littérale, c'est ajouter un
endroit qui ne suivra pas le thème.

Le site suit par défaut le réglage clair/sombre du système ; la bascule en bas de la
barre latérale pose un choix explicite, retenu dans `localStorage` et relu par le petit
script en tête d'`index.html`, avant le premier rendu — sans lui, une page en mode
sombre clignoterait en clair au chargement.

Côté clavier : `/` ramène au champ de recherche, `Échap` l'efface (et referme le tiroir
sur petit écran), les en-têtes de colonnes se trient à `Entrée` ou `Espace`.

## Mettre à jour un référentiel

1. Remplacer le fichier dans `data/<theme>/<fichier>.xlsx` (même nom, mêmes colonnes).
2. `pip install -r scripts/requirements.txt` (une fois).
3. `python scripts/build_data.py` — régénère tout `docs/assets/data/`.
4. Vérifier en local (`python -m http.server 8000 --directory docs`, puis
   http://localhost:8000).
5. Committer **le xlsx et le JSON généré ensemble**, pousser.

Le drapeau « Données du JJ/MM/AAAA » de chaque thème est déduit de la date du dernier
commit **git** touchant ce xlsx (`git log`), pas du mtime du fichier sur disque : un
`git clone` réinitialise le mtime de tous les fichiers au moment du clone, ce qui aurait
rendu le drapeau toujours daté d'aujourd'hui.

Ajouter un thème : créer `data/<theme>/`, une ligne dans `JEUX` de `build_data.py`, un
fichier `docs/assets/js/themes/<slug>.js` exportant une fonction `rendre(conteneur)`, et
une ligne dans `docs/assets/js/registry.js`.

## Déploiement

Réglage unique, à faire une fois sur GitHub : **Settings → Pages → Build and deployment
→ Deploy from a branch**, brancher sur `main` et le dossier `/docs`. Aucun workflow
GitHub Actions : le site déployé est exactement ce qui est commité dans `docs/`, sans
étape de build intermédiaire à maintenir ni à déboguer.
