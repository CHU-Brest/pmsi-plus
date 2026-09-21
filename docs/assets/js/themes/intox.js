// Intox CIM-10 — deux sections de recherche indépendantes.
// Port de src/themes/intox/page.py.

import { chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const COLONNES_CHERCHABLES = ["Nom", "DCI", "SUBSTANCE"];

function sectionMedicaments(conteneur, jeu) {
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, COLONNES_CHERCHABLES);
    jeu._indexe = true;
  }

  let exactes = true;
  let requete = "";
  const zoneResultats = el("div", {});

  const champ = champMotsClefs({
    id: "intox_medicaments",
    exemple: "ex. : paracetamol",
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });

  const idToggle = "intox_full_match";
  const toggle = el(
    "label",
    { class: "toggle", for: idToggle },
    el("input", {
      type: "checkbox",
      id: idToggle,
      checked: "",
      onchange: (e) => {
        exactes = e.target.checked;
        afficher();
      },
    }),
    "Afficher les correspondances exactes"
  );

  conteneur.append(
    el("h2", {}, "Médicaments — codes CIM-10"),
    el("div", { class: "barre-outils" }, champ, toggle),
    zoneResultats
  );

  function afficher() {
    const filtreTexte = recherche.filtre(requete);
    const lignes = jeu.lignes.filter(
      (l) => filtreTexte(l) && (!exactes || l._full_match === true)
    );
    resultats(zoneResultats, lignes, { total: jeu.lignes.length });
  }
  afficher();
}

function sectionSubstances(conteneur, jeu) {
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, ["SUBSTANCE"]);
    jeu._indexe = true;
  }

  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "intox_substances",
    exemple: "ex. : opiaces",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h2", {}, "Table des effets nocifs"),
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
  const medicaments = await chargerJeu(
    "intox",
    "medicaments",
    "médicaments et leurs codes CIM-10 d'intoxication"
  );

  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Intox CIM-10"),
    fraicheur([{ libelle: medicaments.libelle, millesime: medicaments.millesime }]),
    el("hr", { class: "separateur" })
  );

  sectionMedicaments(conteneur, medicaments);
  conteneur.append(el("hr", { class: "separateur" }));

  // Jeu secondaire : son absence ne coûte que cette section, pas la page.
  try {
    const substances = await chargerJeu(
      "intox",
      "substances",
      "table CIM-10 des effets nocifs, par substance"
    );
    sectionSubstances(conteneur, substances);
  } catch (erreur) {
    console.error(erreur);
    conteneur.append(
      el(
        "p",
        { class: "message-avertissement" },
        "Table des effets nocifs indisponible pour le moment."
      )
    );
  }
}
