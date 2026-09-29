// Codes frontières en DP — les catégories CIM-10 dont les codes, placés en
// diagnostic principal, partent vers des cas différents d'une même colonne
// de tests sur le DP : à un caractère près, la racine de GHM change.
//
// Calculé dans le navigateur, sans étape de build : l'arbre de la fonction
// groupage (arbre.json) croisé avec les listes de diagnostics publiées.

import { chargerJeu, chargerJson } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";
import { frontieresDp } from "../groupage_mco.js";

const COLONNES_CHERCHABLES = ["CMD", "Code", "Racines", "Liste", "Libellé code", "_libelleListe"];

export async function rendre(conteneur) {
  const [arbre, diagnostics] = await Promise.all([
    chargerJson("groupage", "arbre"),
    chargerJeu("groupage", "diagnostics", "listes de diagnostics de la fonction groupage"),
  ]);
  if (!arbre._frontieres) {
    arbre._frontieres = recherche.indexer(frontieresDp(arbre, diagnostics.lignes), COLONNES_CHERCHABLES);
  }
  const lignes = arbre._frontieres;
  const categories = new Set(lignes.map((l) => `${l.CMD}/${l._categorie}`)).size;

  conteneur.innerHTML = "";
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "frontieres_recherche",
    exemple: "ex. : K25, 06M04, diabète",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h1", {}, "Codes frontières en DP"),
    fraicheur([
      { libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime },
      { libelle: diagnostics.libelle, millesime: diagnostics.millesime },
    ]),
    el(
      "p",
      {},
      `Les ${categories} catégories CIM-10 dont les codes, en diagnostic principal, partent vers des cas différents d'une même colonne de tests sur le DP : à un caractère près, le séjour change de racine de GHM. Une ligne par code ; « Racines » donne les racines que le cas peut atteindre selon les tests suivants (âge, actes…).`
    ),
    el(
      "p",
      { class: "sous-titre" },
      "Limites : seuls les tests sur le DP de l'arbre sont examinés, sans valorisation (elle est dans la fiche de chaque code et dans les ",
      el("a", { class: "lien-texte", href: "#/mco/tarifs" }, "tarifs des GHS"),
      ") ; le choix de la CMD par le DP, fait en amont de l'arbre, n'est pas couvert. Voir aussi ",
      el("a", { class: "lien-texte", href: "#/mco/arbre" }, "l'algorithme de la fonction groupage"),
      "."
    ),
    el("div", { class: "barre-outils" }, champ),
    zoneResultats
  );

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, lignes.filter(filtre), { total: lignes.length });
  }
  afficher("");
}
