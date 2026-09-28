// Erreurs de la fonction groupage SMR — FG_erreurs.TXT (classification.json) :
// chaque code erreur, son libellé et sa gravité, et pour les erreurs 162 et
// 163 la liste des actes concernés que le fichier donne à sa suite.
//
// Une erreur bloquante empêche le groupage du RHS ou du séjour ; une erreur
// non bloquante est signalée sans l'arrêter. L'adresse
// #/smr/erreurs/<recherche> pré-remplit le champ (« 162 », « intervenant »).

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../../interface.js";
import { chargerClassification } from "../../smr.js";
import { lienFiche, sourceFg } from "../../smr_interface.js";

const COLONNES_CHERCHABLES = ["Code", "Libellé"];

function lignesTableau(k) {
  if (!k._erreursTableau) {
    k._erreursTableau = k.erreurs.map(([code, libelle, bloquant]) => ({
      Code: String(code),
      "Libellé": libelle,
      "Gravité": bloquant ? "bloquante" : "non bloquante",
      _bloquant: bloquant,
    }));
    recherche.indexer(k._erreursTableau, COLONNES_CHERCHABLES);
  }
  return k._erreursTableau;
}

/** Les actes concernés par une erreur, liens vers leur fiche. */
function blocActes(k, code, actes) {
  const libelle = k._erreurs.get(Number(code))?.libelle ?? "";
  return el(
    "section",
    { "aria-labelledby": `erreur_${code}_titre` },
    el("h3", { id: `erreur_${code}_titre` }, `Erreur ${code} — ${libelle}`),
    el(
      "div",
      { class: "codes-liste" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Acte CSARR"), el("th", { scope: "col" }, "Libellé"))),
        el(
          "tbody",
          {},
          ...actes.map(([acte, texte]) =>
            el("tr", {}, el("td", { class: "code" }, el("a", { href: lienFiche(acte), title: "Fiche du code" }, acte)), el("td", {}, texte))
          )
        )
      )
    )
  );
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const k = await chargerClassification();
  const lignes = lignesTableau(k);
  conteneur.innerHTML = "";

  const [demande = ""] = chemin;
  let requete = demande;
  let bloquantesSeulement = false;
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "erreurs_recherche",
    exemple: "ex. : 162, intervenant, CSAR",
    valeur: demande,
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });
  const caseBloquantes = el("input", {
    type: "checkbox",
    id: "erreurs_bloquantes",
    onchange: (e) => {
      bloquantesSeulement = e.target.checked;
      puce.classList.toggle("coche", bloquantesSeulement);
      afficher();
    },
  });
  const puce = el("label", { class: "puce", for: "erreurs_bloquantes" }, caseBloquantes, "Bloquantes seulement");
  const bloquantes = lignes.filter((l) => l._bloquant).length;

  conteneur.append(
    el("h1", {}, "Erreurs de la fonction groupage"),
    sourceFg(),
    fraicheur([{ libelle: "erreurs de la fonction groupage (FG_erreurs.TXT)", millesime: k.millesimes["FG_erreurs.TXT"] }]),
    el(
      "p",
      {},
      `Les ${lignes.length} codes erreur que la fonction groupage SMR peut rendre, dont ${bloquantes} bloquants : une erreur bloquante empêche le groupage du RHS ou du séjour, une erreur non bloquante est signalée sans l'arrêter. Les erreurs 300 à 314 disent qu'aucune CM, ou aucun GN dans une CM, n'a été trouvé ; 401 et 402, qu'aucun groupe de réadaptation ou de lourdeur ne l'a été.`
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
        el("p", { class: "champ-aide" }, "Ne garde que les erreurs qui empêchent le groupage.")
      )
    ),
    zoneResultats,
    ...Object.entries(k.actesErreurs).map(([code, actes]) => blocActes(k, code, actes))
  );

  function afficher() {
    const garde = recherche.filtre(requete);
    resultats(zoneResultats, lignes.filter((l) => garde(l) && (!bloquantesSeulement || l._bloquant)), { total: lignes.length });
    const cible = requete.trim() ? `#/smr/erreurs/${encodeURIComponent(requete.trim())}` : "#/smr/erreurs";
    if (location.hash !== cible) history.replaceState(null, "", cible);
  }
  afficher();
}
