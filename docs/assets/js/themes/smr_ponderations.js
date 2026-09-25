// Pondérations des actes de réadaptation — ACTES_ponderations.xlsx (actes.json)
// : une ligne par acte CSARR ou CCAM, avec sa pondération (unique, ou selon
// l'intervenant), les modulateurs de lieu qui la majorent et son caractère
// spécialisé (ACTES_listes_SPE). Les pondérations servent aux scores de
// réadaptation, qui décident du groupe de réadaptation (volume 1, 3.3).
//
// Le détail d'un acte différencié selon l'intervenant — une pondération par
// intervenant, 0 pour un intervenant non attendu — est dans sa fiche code.
// L'adresse #/smr/ponderations/<recherche> pré-remplit le champ.

import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats, nombre } from "../interface.js";
import { chargerActes, chargerActesSpe, chargerClassification } from "../smr.js";
import { lienFiche } from "../smr_interface.js";

const COLONNES_CHERCHABLES = ["Code", "Libellé", "Spécialisé"];
const NOMENCLATURES = ["CSARR", "CCAM"];
const MODULATEURS_LIEU = ["HW", "LJ", "XH", "L3"];
// Au-delà, la ligne de liens vers les fiches se tait : la recherche doit
// d'abord être affinée.
const LIENS_MAX = 12;

// Types d'acte, d'après le lisez-moi de ACTES_ponderations.xlsx.
const TYPES = {
  D: "acte dédié",
  "D/ND": "acte dédié ou non dédié",
  C: "acte collectif",
  A: "appareillage avec étapes",
  PP: "acte pluriprofessionnel",
  CCAM: "acte CCAM de réadaptation",
};

/** Une ligne par acte, une fois par jeu (nom préfixé : le jeu est partagé
 *  avec la fiche code). */
function lignesTableau(actes, spe, k) {
  if (!actes._ponderationsTableau) {
    actes._ponderationsTableau = [...actes._parCode.entries()]
      .map(([code, lignes]) => {
        const l = lignes[0];
        const valeurs = lignes.map((x) => x["Pondération"]);
        const min = Math.min(...valeurs);
        const max = Math.max(...valeurs);
        const listes = [...(spe._parCode.get(code) ?? [])].sort();
        return {
          Code: code,
          Nomenclature: l.Nomenclature,
          Type: l.Type,
          "Pondération": lignes.length === 1 || min === max ? String(min) : `${min} à ${max} selon l'intervenant`,
          "Spécialisé": listes.map((liste) => k.listesSpe[liste]?.libelle ?? liste).join(", "),
          "Lieu": MODULATEURS_LIEU.filter((m) => l[m]).join(" "),
          "Validité": l.Valide ? "valide" : l.Fin ? `supprimé en ${l.Fin}` : "supprimé",
          "Libellé": l["Libellé"],
          _valide: l.Valide,
        };
      })
      .sort((a, b) => (a.Code < b.Code ? -1 : 1));
    recherche.indexer(actes._ponderationsTableau, COLONNES_CHERCHABLES);
  }
  return actes._ponderationsTableau;
}

function tableModulateurs(k) {
  // Seuls les modulateurs qui majorent la pondération (3.3.1.4) ; les
  // autres (EZ, ME, plateaux techniques…) sont sans effet sur elle.
  const majorants = k.modulateurs.filter(([code]) => MODULATEURS_LIEU.includes(code));
  const ligne = (...cellules) => el("tr", {}, ...cellules);
  return el(
    "div",
    { class: "codes-liste" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        ligne(
          el("th", { scope: "col" }, "Modulateur de lieu"),
          el("th", { scope: "col", class: "nombre" }, "Acte individuel"),
          el("th", { scope: "col", class: "nombre" }, "Acte collectif")
        )
      ),
      el(
        "tbody",
        {},
        ...majorants.map(([code, libelle, individuel, collectif]) =>
          ligne(
            el("th", { scope: "row" }, el("span", { class: "code" }, code), ` ${libelle}`),
            el("td", { class: "nombre" }, `+${individuel}`),
            el("td", { class: "nombre" }, collectif == null ? "sans objet" : `+${collectif}`)
          )
        )
      )
    )
  );
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const [actes, spe, k] = await Promise.all([chargerActes(), chargerActesSpe(), chargerClassification()]);
  const lignes = lignesTableau(actes, spe, k);
  conteneur.innerHTML = "";

  const [demande = ""] = chemin;
  let requete = demande;
  const nomenclatures = new Set();
  let validesSeulement = true;
  const zoneLiens = el("p", { class: "liens-fiches" });
  const zoneResultats = el("div", {});

  const champ = champMotsClefs({
    id: "ponderations_recherche",
    exemple: "ex. : ALQ+183, déglutition, marche",
    valeur: demande,
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });
  const puces = NOMENCLATURES.map((n) => {
    const id = `ponderations_${n}`;
    const puce = el(
      "label",
      { class: "puce", for: id },
      el("input", {
        type: "checkbox",
        id,
        onchange: (e) => {
          if (e.target.checked) nomenclatures.add(n);
          else nomenclatures.delete(n);
          puce.classList.toggle("coche", e.target.checked);
          afficher();
        },
      }),
      n
    );
    return puce;
  });
  const caseValides = el("input", {
    type: "checkbox",
    id: "ponderations_valides",
    checked: "",
    onchange: (e) => {
      validesSeulement = e.target.checked;
      puceValides.classList.toggle("coche", validesSeulement);
      afficher();
    },
  });
  const puceValides = el("label", { class: "puce coche", for: "ponderations_valides" }, caseValides, "Actes valides seulement");

  conteneur.append(
    el("h1", {}, "Pondérations des actes"),
    fraicheur([
      { libelle: actes.libelle, millesime: actes.millesime },
      { libelle: spe.libelle, millesime: spe.millesime },
    ]),
    el(
      "p",
      {},
      "Chaque acte de réadaptation, CSARR ou CCAM, porte une pondération. La somme des pondérations des actes du séjour fait le score de réadaptation globale ; celle des seuls actes spécialisés pour le GN du séjour, le score de réadaptation spécialisée ; rapportés aux jours de présence, ils décident du groupe de réadaptation (volume 1, 3.3 et 3.4). Un acte différencié selon l'intervenant a une pondération par intervenant, 0 pour un intervenant non attendu : sa fiche code les donne toutes."
    ),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Un modulateur de lieu majore la pondération d'un acte qui l'accepte (colonne Lieu), de la valeur du tableau ci-dessous ; il est sans effet pour un intervenant non attendu (3.3.1.4)."
      ),
      el(
        "li",
        {},
        `En CSAR, l'acte prend la pondération de son CSARR transcodé ; s'il accepte le modulateur de temps (${k.csar.temps.map(([m, , p]) => `${m} ${p}`).join(", ")}), la plus élevée des deux est retenue (3.3.1.3). Voir le `,
        el("a", { class: "lien-texte", href: "#/smr/csar" }, "transcodage CSAR ↔ CSARR"),
        "."
      ),
      el(
        "li",
        {},
        "Types : ",
        Object.entries(TYPES)
          .map(([code, libelle]) => `${code}, ${libelle}`)
          .join(" ; "),
        "."
      )
    ),
    tableModulateurs(k),
    el(
      "div",
      { class: "barre-outils" },
      champ,
      el(
        "div",
        { class: "champ" },
        el("label", {}, "Filtre(s) :"),
        el("div", { class: "puces" }, ...puces, puceValides),
        el("p", { class: "champ-aide" }, "Nomenclature (aucune cochée : toutes) ; les actes supprimés ne sont montrés que si la dernière case est décochée.")
      )
    ),
    zoneLiens,
    zoneResultats
  );

  function afficher() {
    const garde = recherche.filtre(requete);
    const trouvees = lignes.filter(
      (l) => garde(l) && (!nomenclatures.size || nomenclatures.has(l.Nomenclature)) && (!validesSeulement || l._valide)
    );
    // Le tableau partagé n'affiche que du texte : les liens vers les fiches
    // suivent la barre de recherche, quand la recherche est assez précise.
    zoneLiens.replaceChildren();
    if (requete.trim() && trouvees.length && trouvees.length <= LIENS_MAX) {
      zoneLiens.append(
        "Fiche : ",
        ...trouvees.flatMap((l, i) => [i ? " · " : "", el("a", { href: lienFiche(l.Code) }, l.Code)])
      );
    }
    resultats(zoneResultats, trouvees, { total: lignes.length });
    const cible = requete.trim() ? `#/smr/ponderations/${encodeURIComponent(requete.trim())}` : "#/smr/ponderations";
    if (location.hash !== cible) history.replaceState(null, "", cible);
  }
  afficher();
}
