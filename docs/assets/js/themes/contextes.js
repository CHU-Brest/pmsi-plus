// Contexte patient — recherche et tableau.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Code CIM-10", "Libellé", "Justification"];

export async function rendre(conteneur) {
  const jeu = await chargerJeu(
    "contextes",
    "contextes",
    "codes CIM-10 de contexte patient et leur justification"
  );
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Contexte patient"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el("hr", { class: "separateur" })
  );

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "contextes_recherche",
    exemple: "ex. : tabac",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(el("div", { class: "barre-outils" }, champ), zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}
