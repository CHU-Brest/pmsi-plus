// Page d'accueil : ce que le site contient, et comment s'y chercher.

import { REGISTRY } from "../registry.js";
import { el } from "../interface.js";

function carte(theme) {
  return el(
    "a",
    { class: "carte-theme", href: `#/${theme.slug}` },
    el("span", { class: "etiquette" }, theme.section),
    el("span", { class: "titre" }, theme.titre),
    theme.resume ? el("span", { class: "resume" }, theme.resume) : null
  );
}

export async function rendre(conteneur) {
  conteneur.innerHTML = "";

  const cartes = REGISTRY.filter((t) => t.slug !== "accueil").map(carte);

  conteneur.append(
    el("h1", {}, "PMSI+"),
    el(
      "p",
      { class: "sous-titre" },
      "Aide au codage PMSI — Département d'information médicale, CHU de Brest"
    ),
    el(
      "p",
      {},
      "PMSI+ rassemble les référentiels d'aide au codage utilisés au quotidien par le ",
      el("strong", {}, "DIM"),
      " du CHU de Brest. Chaque thème porte ses propres données, avec la date du dernier rafraîchissement."
    ),
    el(
      "p",
      {},
      "La recherche est la même partout : insensible à la casse et aux accents, et ",
      el("strong", {}, "plusieurs mots clefs séparés par un espace sont cumulatifs"),
      ". Chercher « arthroscopie genou » ne demande pas que les deux mots se suivent, ni même qu'ils soient dans la même colonne. La touche ",
      el("kbd", {}, "/"),
      " ramène au champ de recherche, et un clic sur un en-tête de colonne trie le tableau."
    ),
    el("h2", {}, "Thèmes disponibles"),
    el("div", { class: "grille-themes" }, ...cartes),
    el(
      "p",
      { class: "pied-page" },
      "Département d'information médicale et Centre de Données Cliniques, CHU de Brest. ",
      "Ce site publie uniquement des référentiels d'aide au codage."
    )
  );
}
