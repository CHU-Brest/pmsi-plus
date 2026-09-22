// Actes CCAM — recherche, filtre par caractéristique, tableau.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Code acte", "Libellé acte", "Sous-Paragraphe", "_caracteristiques"];

/** Caractéristiques disponibles, lues sur les données et non déclarées en
 *  dur : toute colonne booléenne du fichier entre dans le filtre — pendant
 *  de `entree.caracteristiques()`, qui lit le schéma polars. */
function caracteristiques(lignes) {
  if (!lignes.length) return [];
  return Object.keys(lignes[0]).filter(
    (c) => !c.startsWith("_") && typeof lignes[0][c] === "boolean"
  );
}

export async function rendre(conteneur) {
  const jeu = await chargerJeu("actes", "actes", "actes CCAM et leurs caractéristiques");
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Actes CCAM"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el("hr", { class: "separateur" })
  );

  const selection = new Set();
  let requete = "";
  const zoneResultats = el("div", {});

  const champ = champMotsClefs({
    id: "actes_recherche",
    exemple: "ex. : arthroscopie genou",
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });

  const puces = caracteristiques(jeu.lignes).map((c) => {
    const id = `actes_car_${c.replace(/\W+/g, "_")}`;
    const case_ = el("input", {
      type: "checkbox",
      id,
      onchange: (e) => {
        if (e.target.checked) selection.add(c);
        else selection.delete(c);
        puce.classList.toggle("coche", e.target.checked);
        afficher();
      },
    });
    const puce = el("label", { class: "puce", for: id }, case_, c);
    return puce;
  });

  const blocFiltres = el(
    "div",
    { class: "champ" },
    el("label", {}, "Filtre(s) :"),
    el("div", { class: "puces" }, ...puces),
    el(
      "p",
      { class: "champ-aide" },
      "Ne garde que les actes portant au moins une des caractéristiques choisies."
    )
  );

  conteneur.append(el("div", { class: "barre-outils" }, champ, blocFiltres), zoneResultats);

  function afficher() {
    const filtreTexte = recherche.filtre(requete);
    const lignes = jeu.lignes.filter(
      (l) =>
        filtreTexte(l) &&
        (selection.size === 0 || [...selection].some((c) => l[c] === true))
    );
    resultats(zoneResultats, lignes, { total: jeu.lignes.length });
  }
  afficher();
}
