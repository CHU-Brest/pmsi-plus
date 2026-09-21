// Page d'accueil : ce que le site contient, et comment s'y chercher.

import { REGISTRY } from "../registry.js";
import { el } from "../interface.js";

export async function rendre(conteneur) {
  conteneur.innerHTML = "";

  const lignesTable = REGISTRY.filter((t) => t.slug !== "accueil").map((t) =>
    el("tr", {}, el("td", {}, t.section), el("td", {}, t.titre))
  );

  conteneur.append(
    el("h1", {}, "PMSI+"),
    el("p", { class: "sous-titre" }, "Aide au codage PMSI — Département d'information médicale, CHU de Brest"),
    el(
      "p",
      {},
      "PMSI+ rassemble les référentiels d'aide au codage utilisés au quotidien par le ",
      el("strong", {}, "DIM"),
      " du CHU de Brest. Chaque thème de la barre latérale porte ses propres données."
    ),
    el(
      "p",
      {},
      "La recherche est la même partout : insensible à la casse et aux accents, et ",
      el("strong", {}, "plusieurs mots clefs séparés par un espace sont cumulatifs"),
      ". Chercher « arthroscopie genou » ne demande pas que les deux mots se suivent, ni même qu'ils soient dans la même colonne."
    ),
    el("h2", {}, "Thèmes disponibles"),
    el(
      "table",
      { class: "themes" },
      el("thead", {}, el("tr", {}, el("th", {}, "Section"), el("th", {}, "Thème"))),
      el("tbody", {}, ...lignesTable)
    ),
    el("hr", { class: "separateur" }),
    el(
      "p",
      { class: "sous-titre" },
      "Département d'information médicale et Centre de Données Cliniques, CHU de Brest. ",
      "Ce site republie les référentiels d'aide au codage de l'application interne PMSI+ ; ",
      "les analyses tirées des séjours du CHU (durée de séjour, occupation des lits) ne sont pas publiées ici."
    )
  );
}
