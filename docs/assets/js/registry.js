// La table des matières du site : sections et thèmes de la barre latérale.
//
// C'est la seule liste à tenir à jour pour ajouter, renommer ou réordonner un
// thème — jumeau de `src/registre.py` dans pmsi_plus. `module` nomme le
// fichier dans assets/js/themes/ qui exporte une fonction `rendre(conteneur)`,
// cf. main.js pour le contrat exact.
//
// La rubrique « Analyse DIM » du dépôt d'origine (durée de séjour, occupation
// des lits) n'a pas de contrepartie ici : ce sont des agrégats tirés des
// séjours réels du CHU de Brest, qui n'ont pas vocation à être publiés.

export const REGISTRY = [
  { section: "PMSI+", slug: "accueil", titre: "Bienvenue !", module: "accueil", defaut: true },
  { section: "CIM-10", slug: "intox", titre: "Intox CIM-10", module: "intox" },
  { section: "CIM-10", slug: "germe", titre: "Germes CIM-10", module: "germes" },
  { section: "HDJ", slug: "acte", titre: "Actes CCAM", module: "actes" },
  { section: "HDJ", slug: "rh", titre: "Médicaments de la RH et LES", module: "medicaments" },
  { section: "HDJ", slug: "ctxt", titre: "Contexte patient", module: "contextes" },
  { section: "Référentiels", slug: "acronymes", titre: "Acronymes & abréviations médicales", module: "acronymes" },
];

export function themeParDefaut() {
  return REGISTRY.find((t) => t.defaut) ?? REGISTRY[0];
}

export function themeParSlug(slug) {
  return REGISTRY.find((t) => t.slug === slug);
}
