// Actes frontières — les actes CCAM qui, pour un même organe, une même
// action et une même voie d'abord (les 4 lettres du code), n'emmènent pas
// le séjour vers les mêmes racines de GHM : un acte voisin fait passer,
// par exemple, d'un GHM chirurgical (C) à un GHM interventionnel (K).
//
// Calculé dans le navigateur, comme les codes frontières en DP : l'arbre
// de la fonction groupage croisé avec les listes d'actes publiées.

import { chargerJeu, chargerJson } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";
import { frontieresActes } from "../groupage_mco.js";

export async function rendre(conteneur) {
  const [arbre, actes] = await Promise.all([
    chargerJson("groupage", "arbre"),
    chargerJeu("groupage", "actes", "listes d'actes de la fonction groupage"),
  ]);
  // Lignes calculées une fois (groupage_mco.js), partagées avec la fiche
  // code ; les indexer à chaque visite ne prend qu'une vingtaine de ms.
  const lignes = recherche.indexer(frontieresActes(arbre, actes.lignes), ["CMD", "Code", "Racines", "Liste(s)", "Libellé code"]);
  const familles = new Set(lignes.map((l) => `${l.CMD}/${l._famille}`)).size;

  conteneur.innerHTML = "";
  const zoneResultats = el("div", {});
  let requete = "";
  let typeSeulement = false;
  const champ = champMotsClefs({
    id: "actes_frontieres_recherche",
    exemple: "ex. : AAFA, 05K, coronarographie",
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });
  const puce = el(
    "label",
    { class: "puce", for: "actes_frontieres_type" },
    el("input", {
      type: "checkbox",
      id: "actes_frontieres_type",
      onchange: (e) => {
        typeSeulement = e.target.checked;
        puce.classList.toggle("coche", typeSeulement);
        afficher();
      },
    }),
    "Le type de GHM change (C, K, M)"
  );

  conteneur.append(
    el("h1", {}, "Actes frontières"),
    fraicheur([
      { libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime },
      { libelle: actes.libelle, millesime: actes.millesime },
    ]),
    el(
      "p",
      {},
      `Les ${familles} familles d'actes CCAM (mêmes 4 lettres : organe, action, voie d'abord) dont les actes, dans une même CMD, n'emmènent pas le séjour vers les mêmes racines de GHM. Une ligne par acte ; « Racines » réunit les racines que les tests d'actes qui le citent peuvent atteindre.`
    ),
    el(
      "p",
      { class: "sous-titre" },
      "Limites : les racines sont celles de tous les tests d'actes de la CMD qui citent l'acte, sans l'ordre dans lequel l'arbre les examine ; un acte absent des listes publiées (non classant) n'apparaît pas. Voir aussi ",
      el("a", { class: "lien-texte", href: "#/mco/arbre" }, "l'algorithme de la fonction groupage"),
      "."
    ),
    el(
      "div",
      { class: "barre-outils" },
      champ,
      el(
        "div",
        { class: "champ" },
        el("label", {}, "Filtre :"),
        el("div", { class: "puces" }, puce),
        el("p", { class: "champ-aide" }, "Ne garde que les familles où un acte voisin change de type de GHM : chirurgical, interventionnel ou médical.")
      )
    ),
    zoneResultats
  );

  function afficher() {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, lignes.filter((l) => filtre(l) && (!typeSeulement || l._typeChange)), { total: lignes.length });
  }
  afficher();
}
