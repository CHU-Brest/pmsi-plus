// Page d'accueil : ce que le site contient dans le champ affiché, et comment
// s'y chercher.

import { champParId, themesDuChamp } from "../registry.js";
import { el } from "../interface.js";

function carte(theme, champ) {
  return el(
    "a",
    { class: "carte-theme", href: `#/${champ}/${theme.slug}` },
    el("span", { class: "etiquette" }, theme.section),
    el("span", { class: "titre" }, theme.titre),
    theme.resume ? el("span", { class: "resume" }, theme.resume) : null
  );
}

export async function rendre(conteneur, { champ }) {
  conteneur.innerHTML = "";

  const titreChamp = champParId(champ).titre;
  const themes = themesDuChamp(champ).filter((t) => t.slug !== "accueil" && !t.cache);
  const sansThemePropre = !themes.some((t) => t.champ === champ);

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
      "Le sélecteur ",
      el("strong", {}, "MCO · SMR"),
      ", en tête de la barre latérale, choisit le champ : la barre latérale et cette page n'affichent que ses thèmes, et ceux communs aux deux champs."
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
    el("h2", {}, `Thèmes disponibles en ${titreChamp}`),
    ...(sansThemePropre
      ? [
          el(
            "p",
            { class: "message-info" },
            `Aucun thème propre au ${titreChamp} pour l'instant : seuls les thèmes communs aux deux champs sont affichés.`
          ),
        ]
      : []),
    el("div", { class: "grille-themes" }, ...themes.map((t) => carte(t, champ))),
    el(
      "p",
      { class: "pied-page" },
      "Département d'information médicale et Centre de Données Cliniques, CHU de Brest. ",
      "Ce site publie uniquement des référentiels d'aide au codage."
    )
  );
}
