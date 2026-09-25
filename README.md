# PMSI+ — site public

Version statique, publiable sur **GitHub Pages**, des référentiels d'aide au codage PMSI
du CHU de Brest.

## Ce qui est publié, ce qui ne l'est pas

Seuls les thèmes d'**aide au codage** — des référentiels qu'on cherche, sans donnée
individuelle — sont repris ici :

| Champ | Section | Thème | Contenu |
|---|---|---|---|
| commun | CIM-10 | Intox CIM-10 | médicaments → codes CIM-10 d'intoxication ; effets nocifs par substance |
| commun | CIM-10 | Germes CIM-10 | germes → code CIM-10, avec et sans sepsis |
| MCO | HDJ | Actes CCAM | actes et caractéristiques (classants annexe 8, FFM, SE1-SE8) |
| MCO | HDJ | Médicaments de la RH et LES | mode d'emploi du VIDAL Hoptimal (aucune donnée tabulée) |
| MCO | HDJ | Contexte patient | codes CIM-10 de contexte et justification |
| MCO | Groupage | Fiche code | un code CIM-10 ou CCAM sur une page : étapes de l'arbre qui le testent, racines possibles et leurs tarifs, code ou acte frontière, niveau de CMA et DP/racines qui l'excluent, avec vérificateur |
| MCO | Groupage | Listes de la fonction groupage | listes de diagnostics et d'actes de la fonction groupage, par CMD |
| MCO | Groupage | Algorithme de la fonction groupage | arbres de décision du Manuel des GHM (volume 3), CMD par CMD, reliés aux listes ; chemin et tarifs de chaque case de GHM |
| MCO | Groupage | Tarifs des GHS | arrêté tarifaire MCO, secteur public : tarif de chaque GHS, bornes basse et haute, extrêmes bas et haut |
| MCO | Groupage (depuis la fiche) | Actes frontières | actes CCAM voisins (mêmes 4 lettres) qui mènent à des racines de GHM différentes, avec un filtre « le type de GHM change » |
| MCO | Groupage (depuis la fiche) | Niveaux de sévérité (CMA) | CMA et leur niveau (2 à 4), et un vérificateur « ce DAS compte-t-il avec ce DP, dans cette racine ? » d'après les listes d'exclusion (volume 1, annexes 4 et 5) ; niveau aussi affiché dans les listes de diagnostics de l'algorithme |
| MCO | Groupage (depuis la fiche) | Codes frontières en DP | catégories CIM-10 dont les codes, en DP, mènent à des racines de GHM différentes (calculé dans le navigateur depuis l'arbre et les listes) |
| SMR | Groupage | Fiche code | un code CIM-10, CSARR, CCAM ou CSAR sur une page : CM, positions permises, orientation en deuxième intention, listes et tests d'entrée en GN, CMA et exclusions ; pondérations, actes spécialisés, transcodage CSAR |
| SMR | Groupage | Listes de la fonction groupage | listes de diagnostics d'entrée dans les GN, listes d'actes spécialisés |
| SMR | Groupage | Algorithme de la fonction groupage | Manuel des GME, volume 1 : orientation en CM, tests d'entrée dans les GN, types de réadaptation et seuils, règles de lourdeur, sévérité ; GME et tarifs de chaque GN |
| SMR | Groupage | Tarifs des GME | arrêté tarifaire SMR, annexe I (établissements des a, b et c de l'article L. 162-22 du CSS) : GMT de chaque GME |
| SMR | Groupage | Erreurs de la fonction groupage | codes erreur de la fonction groupage SMR |
| SMR | Groupage (depuis la fiche) | CMA et exclusions | CMA SMR (diagnostics et actes CCAM) et vérificateur d'exclusion par les codes orientant dans le GN |
| SMR | Réadaptation | Pondérations des actes | pondération des actes CSARR et CCAM de réadaptation, modulateurs de lieu et de temps |
| SMR | Réadaptation | Transcodage CSAR ↔ CSARR | acte CSARR que la fonction groupage retient pour chaque acte CSAR, intervenant et modalité ; lecture inverse (actes CSAR qui aboutissent à un acte CSARR) ; écarts entre le fichier de pondérations CSAR et le CSARR transcodé |
| commun | Référentiels | Acronymes & abréviations | sigles médicaux et leur signification |

Ce dépôt est public : rien de ce qui touche à l'activité de l'établissement ou à un
patient n'y a sa place, même agrégé ou censuré. Un thème qui n'est pas un référentiel
générique de codage ne rejoint pas ce dépôt.

Les référentiels publiés ici (intoxications, germes, actes CCAM, contexte patient,
listes de la fonction groupage, acronymes) sont des tables de correspondance codes/référentiels maintenues par le DIM —
aucune ne porte de donnée patient. L'algorithme de la fonction groupage est la transcription
du volume 3 du Manuel des GHM, document public de l'ATIH ; les tarifs des GHS sont ceux de l'arrêté
tarifaire MCO, publié au Journal officiel et diffusé par l'ATIH. Côté SMR, le groupage reprend le Manuel des GME
(volume 1) et ses fichiers associés, et les tarifs l'annexe I de l'arrêté tarifaire SMR, tous publics. En cas de doute sur un futur ajout, trancher avant
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
  groupage/racines.xlsx       libellés des racines de GHM (ATIH), affichés dans la fiche code et l'algorithme
  groupage/tarifs.xlsx        arrêté tarifaire MCO, tel que publié par l'ATIH ; seule la feuille « Tarifs public » est reprise
  groupage/cma.csv            liste des CMA de l'ATIH, telle que livrée (csv ; Windows-1252)
  groupage/manuel_ghm_volume_1_annexe_{4,5}.pdf   CMA × listes d'exclusion (ATIH)
  groupage/manuel_ghm_volume_3.pdf   Manuel des GHM, volume 3, tel que livré par l'ATIH
  medicaments/{rh,les}.png    captures VIDAL Hoptimal, sans donnée tabulée
  smr/*.xlsx, smr/FG_erreurs.TXT   fichiers associés au Manuel des GME, sous les noms de l'ATIH
  smr/ACTES_ponderations_CSAR_transcodage.xlsx   actes CSAR et modulateurs qu'ils acceptent (ATIH)
  smr/tarifs.xlsx             annexes de l'arrêté tarifaire SMR ; seule l'annexe I (« Tarifs GMT - DAF ») est reprise
  smr/manuel_gme_volume_1.pdf   Manuel des GME, volume 1 : les règles transcrites dans smr.js

scripts/
  build_data.py               xlsx (et cma.csv) → JSON, seule dépendance : openpyxl
  build_arbre.py              PDF du manuel → arbre.json, seule dépendance : pymupdf
  build_cma.py                annexes 4 et 5 du volume 1 → cma_exclusions.json (pymupdf)
  build_smr.py                fichiers de la fonction groupage SMR → data/smr/*.json (openpyxl)
  millesime.py                date du drapeau de fraîcheur, commune aux deux scripts
  requirements.txt

docs/                         racine servie par GitHub Pages
  index.html                  coquille : barre latérale + zone de contenu
  assets/
    css/style.css             jetons du système de design du CDC, puis composants
    js/
      main.js                 routage par hash (#/champ/slug), sélecteur de champ, navigation, tiroir mobile
      registry.js             champs, sections et thèmes
      recherche.js             normalisation + filtre multi mots clefs
      interface.js             drapeau de fraîcheur, champ de recherche, tableau
      donnees.js               chargement JSON avec cache mémoire
      tarifs.js                tarifs des GHS : index par GHM, table compacte (thème, fiche code, algorithme)
      smr.js                   fonction groupage SMR : chargement des jeux et algorithme (CM, GN, GR, GL, GME), sans DOM
      smr_interface.js         composants partagés par les thèmes SMR (liens, libellés, tarifs d'un GME)
      themes/<module>.js       une vue par thème (`module` de registry.js)
    data/<theme>/<jeu>.json    généré par build_data.py, ne pas éditer à la main
    data/groupage/arbre.json   généré par build_arbre.py, ne pas éditer à la main
    data/smr/<jeu>.json        généré par build_smr.py, ne pas éditer à la main
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

Le sélecteur **MCO · SMR**, en tête de la barre latérale, choisit le champ PMSI : la barre
latérale et la page d'accueil n'affichent que les thèmes du champ choisi (`champ: "mco"` ou
`"smr"` dans `registry.js`) et les thèmes communs, sans `champ`. Le champ fait partie de
l'adresse (`#/mco/fiche/I10`, `#/smr/arbre`). Une adresse qui n'en nomme pas — arrivée sur
le site, lien d'avant le SMR comme `#/arbre/01` — le reçoit : le MCO pour un thème propre au
MCO, le dernier champ affiché (retenu dans le navigateur) pour un thème commun. Changer de
champ garde la page quand l'autre champ a un thème de même slug, et ce qui suit le slug
quand les deux thèmes le déclarent `cheminCommun` (le code de la fiche code) ; sinon, il
mène à l'accueil du champ. Un thème propre à un champ rappelle celui-ci au-dessus de son
titre.

L'icône GitHub en haut à droite mène au dépôt. Le bouton « Signaler un problème » au pied
de la barre latérale ouvre un mail à basile.fuchs@chu-brest.fr, prérempli avec l'adresse de
la page. Les deux adresses sont écrites dans `docs/index.html`.

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

L'arrêté tarifaire suit le même chemin, à chaque campagne : remplacer
`data/groupage/tarifs.xlsx` par le classeur de l'ATIH (même nom), puis lancer
`build_data.py`. Le script n'en lit que la feuille « Tarifs public » et s'arrête plutôt
que de deviner :

- classeur remplacé sans que sa campagne soit déclarée : le classeur de l'ATIH ne nomme
  pas l'année qu'il tarife, que le thème Tarifs affiche. La reporter dans `CAMPAGNES`
  (`build_data.py`), avec l'empreinte SHA-256 que donne le message d'arrêt ;
- en-tête inattendu (colonne ajoutée, ôtée ou renommée par l'ATIH) : reporter le
  changement dans `COLONNES_XLSX`, ou `LIGNE_ENTETE` si l'en-tête a changé de ligne ;
- ligne illisible ou incohérente (couple GHS-GHM en double, borne ou montant illisible,
  GHS à deux tarifs, GHM à deux libellés) : le message nomme le GHS et le GHM ;
- racine de l'arrêté absente de `racines.xlsx`, ou racine de `racines.xlsx` sans aucun
  GHS : l'arrêté et la classification ne sont pas de la même campagne, les mettre à jour
  ensemble. Une racine volontairement sans tarif (IVG de moins de 3 jours, mort-nés…) se
  déclare dans `RACINES_SANS_TARIF`.

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

Les exclusions de CMA suivent le même chemin : remplacer
`data/groupage/manuel_ghm_volume_1_annexe_4.pdf` et `…_annexe_5.pdf`, puis
`python scripts/build_cma.py`. Le script vérifie que chaque liste citée par l'annexe 4
existe dans l'annexe 5, que la numérotation ne saute pas, que chaque élément de liste
est lisible, et que les niveaux sont ceux de `cma.csv`.

La page d'orientation (page 9) n'emploie aucun des symboles des autres pages : ses six
étapes sont transcrites dans `ORIENTATION` du script, qui vérifie contre le texte de la
page le test et le libellé de chacune, la CM/CMD écrite face à ce libellé, et leur ordre.

Ajouter un thème : créer `data/<theme>/`, une ligne dans `JEUX` de `build_data.py`, un
fichier `docs/assets/js/themes/<module>.js` exportant une fonction `rendre(conteneur)`, et
une ligne dans `docs/assets/js/registry.js` dont l'attribut `module` nomme ce fichier (il
peut différer du `slug`, qui fait l'adresse du thème) et `champ` le champ PMSI (`"mco"`
ou `"smr"` ; sans `champ`, le thème est commun aux deux). L'ordre de cette liste est celui
de la barre latérale.

## Mettre à jour la fonction groupage SMR

Les tables du groupage SMR viennent des fichiers associés au Manuel des GME, que l'ATIH
publie à chaque version de la fonction groupage ; les règles qui les relient (ordre des
tests, seuils « par jour ET par séjour », pondération des actes CSAR, exclusions des CMA…)
viennent du volume 1 du manuel et sont transcrites dans `docs/assets/js/smr.js`, chaque
fonction citant le paragraphe qu'elle applique.

1. Remplacer les fichiers de `data/smr/` par ceux de la nouvelle version, sous les mêmes
   noms (ceux de l'ATIH ; `tarifs.xlsx` pour les annexes de l'arrêté tarifaire).
2. `python scripts/build_smr.py`. Le script vérifie les en-têtes, que chaque liste citée
   par un test d'entrée en GN existe, que les GN, GR, GL et GME concordent d'un fichier à
   l'autre, que les règles de lourdeur se lisent et ne donnent que des niveaux connus, que
   chaque acte des listes spécialisées et du transcodage CSAR a une pondération, et que
   chaque GME a un tarif. Il s'arrête plutôt que de deviner. L'arrêté tarifaire suit la
   règle du MCO : sa campagne est déclarée dans `CAMPAGNE_TARIFS`, avec l'empreinte que
   donne le message d'arrêt.
3. Relire le volume 1 de la nouvelle version : une règle qui change se reporte dans
   `smr.js` et dans l'algorithme (`themes/smr_arbre.js`), qui la présente.
4. Committer les fichiers de l'ATIH et les JSON générés ensemble.

Particularités des fichiers de l'ATIH, relevées par le script : dans
`CMA_exclusion.xlsx`, « Compteur » est la longueur du texte de la cellule, pas le nombre de
codes ; quelques codes de `CIM_infos_SMR.xlsx` arrivent avec leur point (« U11.9 ») ou un
espace invisible ; pour sept couples acte CSAR / intervenant, la pondération du fichier CSAR
diffère de celle du CSARR transcodé, que la fonction groupage retient — le thème
« Transcodage CSAR ↔ CSARR » les signale.

## Déploiement

Réglage unique, à faire une fois sur GitHub : **Settings → Pages → Build and deployment
→ Deploy from a branch**, brancher sur `main` et le dossier `/docs`. Aucun workflow
GitHub Actions : le site déployé est exactement ce qui est commité dans `docs/`, sans
étape de build intermédiaire à maintenir ni à déboguer.
