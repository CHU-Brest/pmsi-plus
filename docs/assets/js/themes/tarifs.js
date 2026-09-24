// Tarifs des GHS — la feuille « Tarifs public » de l'arrêté tarifaire MCO :
// une ligne par couple GHS-GHM, avec le tarif, les bornes et les extrêmes.
// L'adresse #/tarifs/<recherche> pré-remplit le champ : la fiche code et
// l'algorithme y renvoient pour une racine (« #/tarifs/01C03 »).

import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";
import { chargerTarifs, euros, jours } from "../tarifs.js";

const COLONNES_CHERCHABLES = ["GHM", "GHS", "Libellé"];

const FORMATS = {
  Tarif: euros,
  "Borne basse": jours,
  "Borne haute": jours,
  "Forfait EXB": euros,
  "Tarif EXB": euros,
  "Tarif EXH": euros,
};

/** Lignes du tableau, une fois par jeu : GHS d'un même GHM à la suite,
 *  plutôt que dans l'ordre du classeur, qui range à part les GHS des
 *  séjours courts de chaque racine. */
function lignesAffichees(jeu) {
  if (!jeu._affichage) {
    // Le forfait EXB est le plus souvent nul partout : pas de colonne vide.
    const avecForfait = jeu.lignes.some((l) => l["Forfait EXB"]);
    jeu._affichage = jeu.lignes
      .map((l) => ({
        GHM: l.GHM,
        GHS: l.GHS,
        "Libellé": l["Libellé"],
        Tarif: l.Tarif,
        "Borne basse": l["Borne basse"],
        "Borne haute": l["Borne haute"],
        ...(avecForfait ? { "Forfait EXB": l["Forfait EXB"] } : {}),
        "Tarif EXB": l["Tarif EXB"],
        "Tarif EXH": l["Tarif EXH"],
      }))
      .sort((a, b) => (a.GHM === b.GHM ? a.GHS - b.GHS : a.GHM < b.GHM ? -1 : 1));
    recherche.indexer(jeu._affichage, COLONNES_CHERCHABLES);
  }
  return jeu._affichage;
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const jeu = await chargerTarifs();
  const lignes = lignesAffichees(jeu);
  conteneur.innerHTML = "";

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "tarifs_recherche",
    exemple: "ex. : 01C03, 23Z02Z, craniotomie",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h1", {}, "Tarifs des GHS"),
    el("p", { class: "sous-titre" }, "Arrêté tarifaire MCO de l'ATIH — secteur public"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      "Le tarif de chaque GHS, avec le GHM qu'il couvre, ses bornes basse et haute et ses extrêmes. Ce sont les tarifs nationaux : avant coefficients (géographique, Ségur…) et hors suppléments (réanimation, soins intensifs…)."
    ),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Bornes en jours. Sous la borne basse, le tarif est minoré du forfait EXB, ou du tarif EXB par journée manquante ; au-delà de la borne haute, chaque journée ajoute le tarif EXH. Un tiret : pas de borne, pas de montant."
      ),
      el(
        "li",
        {},
        "Un GHM peut relever de plusieurs GHS : le GHS facturé dépend de conditions fixées par l'arrêté « prestations » (arrêté du 19 février 2015, articles 6 à 6 quater) — GHS intermédiaire d'un séjour de moins d'une journée (gradation des prises en charge ambulatoires), GHS des séjours en UHCD, GHS d'une prise en charge particulière (unité ou lit identifié de soins palliatifs, infection ostéo-articulaire complexe en centre de référence, acte particulier…). Le tableau de l'ATIH donne les tarifs, pas ces conditions."
      )
    ),
    el("div", { class: "barre-outils" }, champ),
    zoneResultats
  );

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, lignes.filter(filtre), { total: lignes.length, formats: FORMATS });
  }

  // Lien profond : le champ est rempli comme par une saisie, pour que son
  // bouton d'effacement et son rappel du raccourci suivent.
  const [demande] = chemin;
  const saisie = champ.querySelector("input");
  if (demande) {
    saisie.value = demande;
    saisie.dispatchEvent(new Event("input"));
  }
  afficher(demande ?? "");
}
