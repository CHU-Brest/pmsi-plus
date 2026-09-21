// Acronymes & abréviations médicales — recherche et tableau.
// Port de src/themes/acronymes/page.py.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Abréviation", "Signification", "Spécialité"];

export async function rendre(conteneur) {
  const jeu = await chargerJeu(
    "acronymes",
    "acronymes",
    "acronymes et abréviations médicales, avec leur signification"
  );
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Acronymes & abréviations médicales"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el("hr", { class: "separateur" })
  );

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "acronymes_recherche",
    exemple: "ex. : AAP",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(el("div", { class: "barre-outils" }, champ), zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}
