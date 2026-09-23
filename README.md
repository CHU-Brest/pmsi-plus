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
| Référentiels | Listes de la fonction groupage | listes de diagnostics et d'actes de la fonction groupage, par CMD |
| Référentiels | Algorithme de la fonction groupage | arbres de décision du Manuel des GHM (volume 3), CMD par CMD, reliés aux listes |
| Référentiels | Actes frontières | actes CCAM voisins (mêmes 4 lettres) qui mènent à des racines de GHM différentes, avec un filtre « le type de GHM change » |
| Référentiels | Niveaux de sévérité (CMA) | liste des CMA de la fonction groupage et leur niveau nominal (2 à 4) ; aussi affiché dans les listes de diagnostics de l'algorithme |
| Référentiels | Codes frontières en DP | catégories CIM-10 dont les codes, en DP, mènent à des racines de GHM différentes (calculé dans le navigateur depuis l'arbre et les listes) |
| Référentiels | Acronymes & abréviations | sigles médicaux et leur signification |

Ce dépôt est public : rien de ce qui touche à l'activité de l'établissement ou à un
patient n'y a sa place, même agrégé ou censuré. Un thème qui n'est pas un référentiel
générique de codage ne rejoint pas ce dépôt.

Les référentiels publiés ici (intoxications, germes, actes CCAM, contexte patient,
listes de la fonction groupage, acronymes) sont des tables de correspondance codes/référentiels maintenues par le DIM —
aucune ne porte de donnée patient. L'algorithme de la fonction groupage est la transcription
du volume 3 du Manuel des GHM, document public de l'ATIH. En cas de doute sur un futur ajout, trancher avant
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
  groupage/diagnostics.xlsx
  groupage/actes.xlsx
  groupage/cma.csv            liste des CMA de l'ATIH, telle que livrée (csv ; Windows-1252)
  groupage/manuel_ghm_volume_3.pdf   Manuel des GHM, volume 3, tel que livré par l'ATIH
  medicaments/{rh,les}.png    captures VIDAL Hoptimal, sans donnée tabulée

scripts/
  build_data.py               xlsx (et cma.csv) → JSON, seule dépendance : openpyxl
  build_arbre.py              PDF du manuel → arbre.json, seule dépendance : pymupdf
  millesime.py                date du drapeau de fraîcheur, commune aux deux scripts
  requirements.txt

docs/                         racine servie par GitHub Pages
  index.html                  coquille : barre latérale + zone de contenu
  assets/
    css/style.css             jetons du système de design du CDC, puis composants
    js/
      main.js                 routage par hash (#/slug), navigation, tiroir mobile
      registry.js             sections/thèmes
      recherche.js             normalisation + filtre multi mots clefs
      interface.js             drapeau de fraîcheur, champ de recherche, tableau
      donnees.js               chargement JSON avec cache mémoire
      themes/<module>.js       une vue par thème (`module` de registry.js)
    data/<theme>/<jeu>.json    généré par build_data.py, ne pas éditer à la main
    data/groupage/arbre.json   généré par build_arbre.py, ne pas éditer à la main
    img/{rh,les}.png           copies de data/medicaments/ servies par le site
    img/chu-brest.jpg          logo institutionnel, fourni par la charte — jamais redessiné
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

Le site suit le **système de design du CDC** (Entrepôt de Données de Santé, CHU de
Brest). Ses jetons — couleurs, typographie, formes, espacement, ombres — sont repris en
tête de `docs/assets/css/style.css`, sous les mêmes noms que dans la charte, pour qu'une
évolution de celle-ci se reporte ici d'un coup d'œil. Aucun composant n'écrit de couleur
en dur.

Trois partis pris de la charte gouvernent tout le reste, et ne doivent pas être
contournés au cas par cas :

- **angles droits partout** (`--radius-0`) ; le seul rayon admis est la pastille d'état
  du drapeau de fraîcheur — et, sur l'algorithme de la fonction groupage, les pictogrammes
  qui reprennent la notation du Manuel des GHM (cercle : test sur les données médicales,
  losange : test sur les autres données, trapèze : test spécial), qu'on ne peut pas
  redessiner carrés sans leur faire perdre leur sens ; leurs tailles et traits ont leurs
  propres jetons, `--picto-*` ;
- **une seule famille de police**, IBM Plex Sans — le rôle « données » (codes CIM-10 et
  CCAM, compteurs, pagination) n'est pas une chasse fixe mais la même police en chiffres
  tabulaires (`--num-tabular`) ;
- **ombres sans flou**, décalage plein (`--shadow-*`), bordures hairline 1px et filet
  d'accent 3px.

Les polices ne sont pas embarquées dans le dépôt : `--font-sans` demande IBM Plex Sans
puis retombe sur la pile système déclarée par la charte. Les icônes sont des tracés
Lucide posés en masque CSS (`--i-*`), donc toujours de la couleur du texte courant —
aucun emoji sur le site, sauf le 🚧 qui signale dans la barre latérale un thème en
travaux (`travaux: true` dans `registry.js`).

Côté clavier : `/` ramène au champ de recherche, `Échap` l'efface (et referme le tiroir
sur petit écran), les en-têtes de colonnes se trient à `Entrée` ou `Espace`.

**En cas de changement visuel du site, incrémenter `?v=` sur le lien vers `style.css`
dans `docs/index.html`.** GitHub Pages sert les fichiers statiques avec un cache de
quelques minutes : sans ce numéro, un navigateur peut afficher le nouveau HTML avec
l'ancienne feuille de style — page à moitié mise en forme, logo à sa taille naturelle.
Le logo porte d'ailleurs sa taille d'affichage en attributs `width`/`height` pour rester
correct même sans CSS.

## Mettre à jour un référentiel

1. Remplacer le fichier dans `data/<theme>/<fichier>.xlsx` (même nom, mêmes colonnes).
2. `pip install -r scripts/requirements.txt` (une fois).
3. `python scripts/build_data.py` — régénère le JSON de chaque xlsx déclaré dans `JEUX`.
   Si ce sont les listes de la fonction groupage (`data/groupage/*.xlsx`) qui ont changé,
   lancer ensuite `python scripts/build_arbre.py` : l'arbre embarque le nom et le nombre
   de codes de chaque liste qu'il cite.
4. Vérifier en local (`python -m http.server 8000 --directory docs`, puis
   http://localhost:8000).
5. Committer **le xlsx et les JSON générés ensemble**, pousser.

Le drapeau « Données du JJ/MM/AAAA » de chaque thème est déduit de **git**, pas du mtime
du fichier sur disque (un `git clone` réinitialise le mtime de tous les fichiers au moment
du clone, ce qui aurait rendu le drapeau toujours daté d'aujourd'hui) : c'est la date du
dernier commit touchant la source, ou la date du jour si la source diffère de ce qui est
committé — la mise à jour en cours, remplacée mais pas encore committée.

## Mettre à jour l'algorithme de la fonction groupage

L'ATIH ne livre les arbres de décision qu'en PDF (volume 3 du Manuel des GHM). Ce PDF est
dessiné, pas scanné : `scripts/build_arbre.py` le relit comme un schéma — chaque symbole
(DP, A, losange, case de GHM, sablier de renvoi…) y est une image reconnue par l'empreinte
de ses pixels, chaque trait un segment suivi d'un symbole au suivant, chaque libellé un
texte rattaché au trait qu'il surmonte.

1. Remplacer `data/groupage/manuel_ghm_volume_3.pdf` par le volume 3 du nouveau manuel
   (même nom).
2. `python scripts/build_arbre.py` — régénère `docs/assets/data/groupage/arbre.json`.
   Lancer d'abord `build_data.py` si les listes de la fonction groupage ont changé : le
   script y lit le nom de chaque liste citée, et s'arrête si l'arbre cite une liste
   absente des listes publiées (sauf celles de `LISTES_NON_PUBLIEES`, comme A-001).
3. Si le script s'arrête, il nomme la page et la position en cause : un symbole inconnu
   (à ajouter à `SYMBOLES`), un test sans sortie, un libellé qui ne surmonte aucun trait,
   un renvoi de page sans vis-à-vis. Il ne devine jamais : mieux vaut un arrêt qu'un arbre
   faux.
4. Vérifier en local quelques CMD contre le PDF, en particulier les pages remaniées par
   la nouvelle version.
5. Committer **le PDF et le JSON généré ensemble**, pousser.

La page d'orientation (page 9) n'emploie aucun des symboles des autres pages : ses six
étapes sont transcrites dans `ORIENTATION` du script, qui vérifie contre le texte de la
page le test et le libellé de chacune, la CM/CMD écrite face à ce libellé, et leur ordre.

Ajouter un thème : créer `data/<theme>/`, une ligne dans `JEUX` de `build_data.py`, un
fichier `docs/assets/js/themes/<module>.js` exportant une fonction `rendre(conteneur)`, et
une ligne dans `docs/assets/js/registry.js` dont le champ `module` nomme ce fichier (il
peut différer du `slug`, qui fait l'adresse du thème).

## Déploiement

Réglage unique, à faire une fois sur GitHub : **Settings → Pages → Build and deployment
→ Deploy from a branch**, brancher sur `main` et le dossier `/docs`. Aucun workflow
GitHub Actions : le site déployé est exactement ce qui est commité dans `docs/`, sans
étape de build intermédiaire à maintenir ni à déboguer.
