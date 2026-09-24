// La table des matières du site : sections et thèmes de la barre latérale.
//
// C'est la seule liste à tenir à jour pour ajouter, renommer ou réordonner un
// thème. `module` nomme le fichier dans assets/js/themes/ qui exporte une
// fonction `rendre(conteneur)`, cf. main.js pour le contrat exact ; `resume`
// est la phrase affichée sur la carte du thème en page d'accueil ; `travaux`
// signale dans la barre latérale un thème encore en chantier ; `cache` garde
// un thème joignable par son adresse (liens depuis la fiche code) sans
// l'afficher dans la barre latérale ni en page d'accueil.
//
// Un thème ne porte qu'un référentiel de codage : jamais de donnée patient,
// jamais de donnée d'activité de l'établissement.

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
    section: "HDJ",
    slug: "acte",
    titre: "Actes CCAM",
    module: "actes",
    resume: "Actes et caractéristiques : classants annexe 8, FFM, SE1-SE8.",
  },
  {
    section: "HDJ",
    slug: "rh",
    titre: "Médicaments de la RH et LES",
    module: "medicaments",
    resume: "Lire le statut réserve hospitalière / liste en sus dans le VIDAL Hoptimal.",
  },
  {
    section: "HDJ",
    slug: "ctxt",
    titre: "Contexte patient",
    module: "contextes",
    resume: "Codes CIM-10 de contexte patient et leur justification.",
  },
  {
    section: "Groupage",
    slug: "fiche",
    titre: "Fiche code",
    module: "fiche",
    travaux: true,
    resume: "Un code CIM-10 ou CCAM : ses tests dans l'arbre, ses racines de GHM, son niveau de CMA et ses exclusions.",
  },
  {
    section: "Groupage",
    slug: "groupage",
    titre: "Listes de la fonction groupage",
    module: "groupage",
    resume: "Listes de diagnostics et d'actes de la fonction groupage, par CMD.",
  },
  {
    section: "Groupage",
    slug: "arbre",
    titre: "Algorithme de la fonction groupage",
    module: "arbre",
    travaux: true,
    resume: "Arbres de décision du Manuel des GHM, CMD par CMD : tests, listes et racines de GHM.",
  },
  {
    section: "Groupage",
    slug: "tarifs",
    titre: "Tarifs des GHS",
    module: "tarifs",
    resume: "Arrêté tarifaire, secteur public : tarif de chaque GHS, bornes basse et haute, extrêmes bas et haut.",
  },
  {
    section: "Groupage",
    slug: "frontieres",
    cache: true,
    titre: "Codes frontières en DP",
    module: "frontieres",
    travaux: true,
    resume: "Catégories CIM-10 dont un caractère change la racine de GHM quand le code est en DP.",
  },
  {
    section: "Groupage",
    slug: "actes-frontieres",
    cache: true,
    titre: "Actes frontières",
    module: "actes_frontieres",
    travaux: true,
    resume: "Actes CCAM voisins (mêmes 4 lettres) qui mènent à des racines de GHM différentes.",
  },
  {
    section: "Groupage",
    slug: "cma",
    cache: true,
    titre: "Niveaux de sévérité (CMA)",
    module: "cma",
    travaux: true,
    resume: "Liste des CMA de la fonction groupage et leur niveau, de 2 à 4.",
  },
  {
    section: "Référentiels",
    slug: "acronymes",
    titre: "Acronymes & abréviations médicales",
    module: "acronymes",
    resume: "Sigles médicaux courants et leur signification.",
  },
];

export function themeParDefaut() {
  return REGISTRY.find((t) => t.defaut) ?? REGISTRY[0];
}

export function themeParSlug(slug) {
  return REGISTRY.find((t) => t.slug === slug);
}
