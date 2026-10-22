// Complications des actes — code CIM-10 d'une complication d'acte médical ou
// chirurgical et codes à lui associer, puis les tables des codes T et des
// codes Y de circonstances.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = [
  "Libellé complication",
  "Code CIM10",
  "Type de codes",
  "Codes à associer systématiquement",
  "Proposition de code plus précis le cas échéant à associer ou substituer",
  "Référence",
  "Extrait AGORA",
];

/** Le niveau de CMA saisi dans le classeur cède la place à celui de la
 *  liste des CMA de l'ATIH en vigueur, code par code quand la cellule en
 *  porte plusieurs (« L08.8 ou L08.0 », « G62.8 +G72.8 ») : vide pour un
 *  code qui n'est pas une CMA, un code non terminal (« T81.3 ») et une
 *  famille de codes (« I21.- », « S% »). */
function poserNiveauxCma(lignes, cma) {
  const niveaux = new Map(cma.lignes.map((l) => [l.Code, l.Niveau]));
  for (const l of lignes) {
    const trouves = l["Code CIM10"].split(/\s*(?:\+|ou)\s*/).map((c) => niveaux.get(c)).filter(Boolean);
    l.CMA = [...new Set(trouves)].join(" / ") || null;
  }
}

/** Champ de recherche et tableau d'un jeu, sous `titre`. */
function sectionCherchable(conteneur, jeu, { titre, id, exemple, raccourci = true }) {
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({ id, exemple, raccourci, onInput: (valeur) => afficher(valeur) });

  conteneur.append(el("h2", {}, titre), el("div", { class: "barre-outils" }, champ), zoneResultats);

  function afficher(requete) {
    const filtre = recherche.filtre(requete);
    resultats(zoneResultats, jeu.lignes.filter(filtre), { total: jeu.lignes.length });
  }
  afficher("");
}

export async function rendre(conteneur) {
  const [complications, codesT, codesY, cma] = await Promise.all([
    chargerJeu("complications", "complications", "complications des actes et codes à associer"),
    chargerJeu("complications", "codes_t", "codes T des complications de soins"),
    chargerJeu("complications", "codes_y", "codes Y de circonstances"),
    chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage"),
  ]);
  if (!complications._indexe) {
    poserNiveauxCma(complications.lignes, cma);
    recherche.indexer(complications.lignes, COLONNES_CHERCHABLES);
    complications._indexe = true;
  }
  if (!codesY._indexe) {
    recherche.indexer(codesY.lignes, ["Code Y", "Circonstance et nature réaction", "Précision contexte"]);
    codesY._indexe = true;
  }

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Complications des actes"),
    fraicheur([
      { libelle: complications.libelle, millesime: complications.millesime },
      { libelle: cma.libelle, millesime: cma.millesime },
    ]),
    el(
      "p",
      {},
      "Code CIM-10 d'une complication d'acte médical ou chirurgical, type de ce code et codes à lui associer : code T, code Y de circonstance, code plus précis."
    ),
    el(
      "p",
      {},
      "Niveau de CMA : celui de la liste des CMA de la fonction groupage MCO en vigueur, pour chaque code de la cellule ; vide pour un code qui n'est pas une CMA, un code non terminal (« T81.3 ») ou une famille de codes (« I21.- », « S% »)."
    ),
    el(
      "p",
      { class: "message-avertissement" },
      "Les libellés des codes CIM-10 habituels ne sont pas ici leurs libellés exacts."
    ),
    el("hr", { class: "separateur" })
  );

  sectionCherchable(conteneur, complications, {
    titre: "Complications et codes à associer",
    id: "complications_recherche",
    exemple: "ex. : hématome, T81.0",
  });

  conteneur.append(el("hr", { class: "separateur" }), el("h2", {}, "Codes T (T80-T88)"));
  const zoneCodesT = el("div", {});
  conteneur.append(zoneCodesT);
  resultats(zoneCodesT, codesT.lignes);

  conteneur.append(el("hr", { class: "separateur" }));
  sectionCherchable(conteneur, codesY, {
    titre: "Codes Y de circonstances",
    id: "complications_codes_y",
    exemple: "ex. : endoscopie",
    raccourci: false,
  });
}
