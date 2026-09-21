// Germes CIM-10 — recherche et tableau. Port de src/themes/germes/page.py.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Germe", "Code du germe", "Code si sepsis"];

export async function rendre(conteneur) {
  const jeu = await chargerJeu(
    "germes",
    "germes",
    "germes et codes CIM-10 associés, avec et sans sepsis"
  );
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Germes CIM-10"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el("hr", { class: "separateur" })
  );

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "germes_recherche",
    exemple: "ex. : staphylocoque",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(el("div", { class: "barre-outils" }, champ), zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}
