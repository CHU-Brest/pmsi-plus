// Niveaux de sévérité (CMA) — la liste des complications ou morbidités
// associées de la fonction groupage, et le niveau (2 à 4) que chacune
// apporte au séjour quand elle est codée en diagnostic associé.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const NIVEAUX = [2, 3, 4];

export async function rendre(conteneur) {
  const jeu = await chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage");
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, ["Code", "Libellé"]);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  const zoneResultats = el("div", {});
  const choisis = new Set();
  let requete = "";

  const champ = champMotsClefs({
    id: "cma_recherche",
    exemple: "ex. : E87.1, insuffisance rénale",
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });
  const puces = NIVEAUX.map((n) => {
    const id = `cma_niveau_${n}`;
    const puce = el(
      "label",
      { class: "puce", for: id },
      el("input", {
        type: "checkbox",
        id,
        onchange: (e) => {
          if (e.target.checked) choisis.add(n);
          else choisis.delete(n);
          puce.classList.toggle("coche", e.target.checked);
          afficher();
        },
      }),
      `Niveau ${n}`
    );
    return puce;
  });

  conteneur.append(
    el("h1", {}, "Niveaux de sévérité (CMA)"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      "Les diagnostics qui, codés en diagnostic associé significatif, sont des complications ou morbidités associées (CMA) : chacun porte un niveau, de 2 à 4, qui peut élever le niveau de sévérité du GHM (le chiffre final de 01M241 à 01M244)."
    ),
    el(
      "p",
      { class: "message-avertissement" },
      "Niveau nominal seulement : les exclusions (une CMA sans effet selon le DP ou la racine du GHM) et les conditions de durée de séjour, décrites au volume 1 du Manuel des GHM, ne sont pas reprises ici."
    ),
    el(
      "div",
      { class: "barre-outils" },
      champ,
      el(
        "div",
        { class: "champ" },
        el("label", {}, "Niveau(x) :"),
        el("div", { class: "puces" }, ...puces),
        el("p", { class: "champ-aide" }, "Ne garde que les CMA des niveaux choisis.")
      )
    ),
    zoneResultats
  );

  function afficher() {
    const filtre = recherche.filtre(requete);
    const lignes = jeu.lignes.filter((l) => filtre(l) && (!choisis.size || choisis.has(l.Niveau)));
    resultats(zoneResultats, lignes, { total: jeu.lignes.length });
  }
  afficher();
}
