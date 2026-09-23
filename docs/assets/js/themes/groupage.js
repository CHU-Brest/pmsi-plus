// Listes de la fonction groupage — deux sections de recherche indépendantes,
// diagnostics puis actes. Les deux jeux partagent exactement les mêmes
// colonnes (CMD, Liste, Libellé liste, Code, Libellé code) : une seule
// section paramétrée suffit donc pour les deux.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

// « CMD » est volontairement hors de l'index : c'est un entier, et le
// chercher en plein texte ferait remonter toutes les lignes dont un code ou
// un libellé contient le même chiffre. La colonne reste affichée et triable.
const COLONNES_CHERCHABLES = ["Liste", "Libellé liste", "Code", "Libellé code"];

function section(conteneur, jeu, { id, titre, exemple }) {
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id,
    exemple,
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h2", {}, titre),
    el("div", { class: "barre-outils" }, champ),
    zoneResultats
  );

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}

export async function rendre(conteneur) {
  const diagnostics = await chargerJeu(
    "groupage",
    "diagnostics",
    "listes de diagnostics de la fonction groupage"
  );

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Listes de la fonction groupage"),
    fraicheur([{ libelle: diagnostics.libelle, millesime: diagnostics.millesime }]),
    el(
      "p",
      {},
      "Les listes de codes auxquelles la fonction groupage se réfère pour classer " +
        "un séjour : un code appartient à une liste, une liste appartient à une CMD. " +
        "Chercher un code y répond donc à la question « dans quelle liste ce code " +
        "entre-t-il ? », et chercher un libellé de liste donne tous les codes qu'elle " +
        "contient. Les tests qui emploient chaque liste, et les GHM auxquels ils mènent, " +
        "sont dans ",
      el("a", { class: "lien-texte", href: "#/arbre" }, "l'algorithme de la fonction groupage"),
      "."
    ),
    el("hr", { class: "separateur" })
  );

  section(conteneur, diagnostics, {
    id: "groupage_diagnostics",
    titre: "Listes de diagnostics",
    exemple: "ex. : migraine",
  });
  conteneur.append(el("hr", { class: "separateur" }));

  // Jeu secondaire : son absence ne coûte que cette section, pas la page.
  try {
    const actes = await chargerJeu(
      "groupage",
      "actes",
      "listes d'actes de la fonction groupage"
    );
    section(conteneur, actes, {
      id: "groupage_actes",
      titre: "Listes d'actes",
      exemple: "ex. : craniotomie",
    });
  } catch (erreur) {
    console.error(erreur);
    conteneur.append(
      el(
        "p",
        { class: "message-avertissement" },
        "Listes d'actes indisponibles pour le moment."
      )
    );
  }
}
