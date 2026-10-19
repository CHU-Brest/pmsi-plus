// Codes O → P (mère → nouveau-né) — recherche et tableau.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Code O", "Libellé O", "Équivalents", "Code P", "Libellé P"];

export async function rendre(conteneur) {
  const jeu = await chargerJeu(
    "codes_op",
    "codes_op",
    "codes O de la mère et codes P du nouveau-né correspondants"
  );
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Codes O → P (mère → nouveau-né)"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el("hr", { class: "separateur" })
  );

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "codes_op_recherche",
    exemple: "ex. : siège",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(el("div", { class: "barre-outils" }, champ), zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}
