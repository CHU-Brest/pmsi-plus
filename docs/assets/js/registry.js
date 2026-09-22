// La table des matières du site : sections et thèmes de la barre latérale.
//
// C'est la seule liste à tenir à jour pour ajouter, renommer ou réordonner un
// thème. `module` nomme le fichier dans assets/js/themes/ qui exporte une
// fonction `rendre(conteneur)`, cf. main.js pour le contrat exact.
//
// Aucun thème ne doit porter d'agrégat tiré des séjours réels du CHU (durée
// de séjour, occupation des lits...) : ce site ne publie que des
// référentiels de codage, jamais de donnée d'activité ou d'établissement.

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
