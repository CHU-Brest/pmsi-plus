// La table des matières du site : champs, sections et thèmes de la barre
// latérale.
//
// C'est la seule liste à tenir à jour pour ajouter, renommer ou réordonner un
// thème ; son ordre est celui de la barre latérale et de la page d'accueil.
// `module` nomme le fichier dans assets/js/themes/ qui exporte une fonction
// `rendre(conteneur)` (« smr/fiche » : dans le sous-dossier du champ), cf.
// main.js pour le contrat exact ; `resume`
// est la phrase affichée sur la carte du thème en page d'accueil ; `travaux`
// signale dans la barre latérale un thème encore en chantier ; `cache` garde
// un thème joignable par son adresse (liens depuis la fiche code) sans
// l'afficher dans la barre latérale ni en page d'accueil.
//
// `champ` range un thème dans un champ du PMSI (`CHAMPS`) : la barre latérale
// n'affiche que les thèmes du champ choisi, et ceux sans `champ`, communs aux
// deux. Un slug est unique dans un champ, mais un thème du SMR peut reprendre
// le slug de son pendant MCO (`fiche`, `arbre`…) : changer de champ mène
// alors de l'un à l'autre. `cheminCommun` y garde ce qui suit le slug dans
// l'adresse (le code affiché par la fiche code), quand les deux pendants le
// déclarent.
//
// Un thème ne porte qu'un référentiel de codage : jamais de donnée patient,
// jamais de donnée d'activité de l'établissement.

export const CHAMPS = [
  { id: "mco", titre: "MCO", libelle: "Médecine, chirurgie, obstétrique et odontologie" },
  { id: "smr", titre: "SMR", libelle: "Soins médicaux et de réadaptation" },
];

export const REGISTRY = [
  {
    section: "PMSI+",
    slug: "accueil",
    titre: "Bienvenue !",
    module: "accueil",
    defaut: true,
  },
  {
    section: "CIM-10",
    slug: "intox",
    titre: "Intox CIM-10",
    module: "intox",
    resume: "Médicaments et substances → codes CIM-10 d'intoxication et effets nocifs.",
  },
  {
    section: "CIM-10",
    slug: "germe",
    titre: "Germes CIM-10",
    module: "germes",
    resume: "Germes et leurs codes CIM-10, avec et sans sepsis.",
  },
  {
    champ: "mco",
    section: "HDJ",
    slug: "acte",
    titre: "Actes CCAM",
    module: "actes",
    resume: "Actes et caractéristiques : classants annexe 8, FFM, SE1-SE8.",
  },
  {
    champ: "mco",
    section: "HDJ",
    slug: "rh",
    titre: "Médicaments de la RH et LES",
    module: "medicaments",
    resume: "Lire le statut réserve hospitalière / liste en sus dans le VIDAL Hoptimal.",
  },
  {
    champ: "mco",
    section: "HDJ",
    slug: "ctxt",
    titre: "Contexte patient",
    module: "contextes",
    resume: "Codes CIM-10 de contexte patient et leur justification.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "fiche",
    titre: "Fiche code",
    module: "fiche",
    cheminCommun: true,
    travaux: true,
    resume: "Un code CIM-10 ou CCAM : ses tests dans l'arbre, ses racines de GHM, son niveau de CMA et ses exclusions.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "groupage",
    titre: "Listes de la fonction groupage",
    module: "groupage",
    resume: "Listes de diagnostics et d'actes de la fonction groupage, par CMD.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "arbre",
    titre: "Algorithme de la fonction groupage",
    module: "arbre",
    travaux: true,
    resume: "Arbres de décision du Manuel des GHM, CMD par CMD : tests, listes et racines de GHM.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "tarifs",
    titre: "Tarifs des GHS",
    module: "tarifs",
    resume: "Arrêté tarifaire, secteur public : tarif de chaque GHS, bornes basse et haute, extrêmes bas et haut.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "frontieres",
    cache: true,
    titre: "Codes frontières en DP",
    module: "frontieres",
    travaux: true,
    resume: "Catégories CIM-10 dont un caractère change la racine de GHM quand le code est en DP.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "actes-frontieres",
    cache: true,
    titre: "Actes frontières",
    module: "actes_frontieres",
    travaux: true,
    resume: "Actes CCAM voisins (mêmes 4 lettres) qui mènent à des racines de GHM différentes.",
  },
  {
    champ: "mco",
    section: "Groupage",
    slug: "cma",
    cache: true,
    titre: "Niveaux de sévérité (CMA)",
    module: "cma",
    travaux: true,
    resume: "Liste des CMA de la fonction groupage et leur niveau, de 2 à 4.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "fiche",
    titre: "Fiche code",
    module: "smr/fiche",
    cheminCommun: true,
    resume: "Un code CIM-10, CSARR, CCAM ou CSAR : CM et listes de GN, positions permises, CMA et exclusions, pondérations, actes spécialisés.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "groupage",
    titre: "Listes de la fonction groupage",
    module: "smr/groupage",
    resume: "Listes de diagnostics d'entrée dans les GN et listes d'actes spécialisés.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "arbre",
    titre: "Algorithme de la fonction groupage",
    module: "smr/arbre",
    resume: "De la CM au GME : tests d'entrée dans les GN, types de réadaptation et seuils, règles de lourdeur, sévérité.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "tarifs",
    titre: "Tarifs des GME",
    module: "smr/tarifs",
    resume: "Arrêté tarifaire SMR, annexe I : tarifs des GMT de chaque GME, zones basse, forfaitaire et haute.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "erreurs",
    titre: "Erreurs de la fonction groupage",
    module: "smr/erreurs",
    resume: "Codes erreur de la fonction groupage SMR, bloquants ou non.",
  },
  {
    champ: "smr",
    section: "Groupage",
    slug: "cma",
    cache: true,
    titre: "CMA et exclusions",
    module: "smr/cma",
    resume: "Liste des CMA SMR (diagnostics et actes CCAM) et vérificateur d'exclusion.",
  },
  {
    champ: "smr",
    section: "Réadaptation",
    slug: "ponderations",
    titre: "Pondérations des actes",
    module: "smr/ponderations",
    resume: "Actes CSARR et CCAM de réadaptation : pondération, par intervenant le cas échéant, modulateurs de lieu, caractère spécialisé.",
  },
  {
    champ: "smr",
    section: "Réadaptation",
    slug: "csar",
    titre: "Transcodage CSAR ↔ CSARR",
    module: "smr/csar",
    resume: "L'acte CSARR que la fonction groupage retient pour chaque acte CSAR, et les actes CSAR qui aboutissent à chaque acte CSARR.",
  },
  {
    section: "Référentiels",
    slug: "acronymes",
    titre: "Acronymes & abréviations médicales",
    module: "acronymes",
    resume: "Sigles médicaux courants et leur signification.",
  },
];

export function champParId(id) {
  return CHAMPS.find((c) => c.id === id);
}

/** Les thèmes d'un champ : les siens, et les thèmes communs. */
export function themesDuChamp(champ) {
  return REGISTRY.filter((t) => !t.champ || t.champ === champ);
}

export function themeParDefaut() {
  return REGISTRY.find((t) => t.defaut) ?? REGISTRY[0];
}

/** Le thème `slug` du champ `champ` : le sien, ou un thème commun. Sans
 *  champ, le premier thème de ce slug, quel que soit son champ. */
export function themeParSlug(slug, champ) {
  return REGISTRY.find((t) => t.slug === slug && (!champ || !t.champ || t.champ === champ));
}
