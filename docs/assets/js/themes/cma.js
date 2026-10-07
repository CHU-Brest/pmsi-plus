// Niveaux de sévérité (CMA) — la liste des complications ou morbidités
// associées de la fonction groupage, et le niveau (2 à 4) que chacune
// apporte au séjour quand elle est codée en diagnostic associé.

import { chargerJeu, chargerJson } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";
import { graphie, graphieRacine, verifierCma } from "../groupage_mco.js";

const NIVEAUX = [2, 3, 4];

export async function rendre(conteneur) {
  const [jeu, exclusions] = await Promise.all([
    chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage"),
    chargerJson("groupage", "cma_exclusions"),
  ]);
  if (!jeu._indexe) {
    recherche.indexer(jeu.lignes, ["Code", "Libellé"]);
    jeu._indexe = true;
  }

  conteneur.innerHTML = "";
  const zoneResultats = el("div", {});
  const choisis = new Set();
  let requete = "";

  const champ = champMotsClefs({
    id: "cma_recherche",
    exemple: "ex. : E87.1, insuffisance rénale",
    onInput: (valeur) => {
      requete = valeur;
      afficher();
    },
  });
  const puces = NIVEAUX.map((n) => {
    const id = `cma_niveau_${n}`;
    const puce = el(
      "label",
      { class: "puce", for: id },
      el("input", {
        type: "checkbox",
        id,
        onchange: (e) => {
          if (e.target.checked) choisis.add(n);
          else choisis.delete(n);
          puce.classList.toggle("coche", e.target.checked);
          afficher();
        },
      }),
      `Niveau ${n}`
    );
    return puce;
  });

  conteneur.append(
    el("h1", {}, "Niveaux de sévérité (CMA)"),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      "Les diagnostics qui, codés en diagnostic associé significatif, sont des complications ou morbidités associées (CMA) : chacun porte un niveau, de 2 à 4, qui peut élever le niveau de sévérité du GHM (le chiffre final de 01M241 à 01M244)."
    ),
    el(
      "p",
      {},
      "Une CMA est sans effet quand le DP du séjour, ou la racine de son GHM, figure dans sa liste d'exclusion (volume 1 du Manuel des GHM, annexes 4 et 5) : le vérificateur ci-dessous l'applique. Les conditions de durée de séjour attachées aux niveaux ne sont pas reprises."
    ),
    verificateur(exclusions),
    el(
      "div",
      { class: "barre-outils" },
      champ,
      el(
        "div",
        { class: "champ" },
        el("label", {}, "Niveau(x) :"),
        el("div", { class: "puces" }, ...puces),
        el("p", { class: "champ-aide" }, "Ne garde que les CMA des niveaux choisis.")
      )
    ),
    zoneResultats
  );

  function afficher() {
    const filtre = recherche.filtre(requete);
    const lignes = jeu.lignes.filter((l) => filtre(l) && (!choisis.size || choisis.has(l.Niveau)));
    resultats(zoneResultats, lignes, { total: jeu.lignes.length });
  }
  afficher();
}

// ==== Vérificateur DAS × DP × racine ====

function verificateur(exclusions) {
  const champ = (id, libelle, exemple) =>
    el(
      "div",
      { class: "champ" },
      el("label", { for: id }, libelle),
      el("input", { type: "text", id, placeholder: exemple, autocomplete: "off", spellcheck: "false", oninput: () => evaluer() })
    );
  const zone = el("div", { class: "verdict-cma", role: "status" });

  function evaluer() {
    const das = graphie(document.getElementById("cma_das").value);
    const dpSaisi = document.getElementById("cma_dp").value.trim();
    zone.innerHTML = "";
    if (!das) return;
    const dp = dpSaisi ? graphie(dpSaisi) : null;
    const racine = graphieRacine(document.getElementById("cma_racine").value);
    const v = verifierCma(exclusions, das, dp, racine);
    if (!v.cma) {
      zone.append(el("p", { class: "message-info" }, `${das} n'est pas une CMA : il ne modifie pas le niveau de sévérité.`));
      return;
    }
    const lignes = [el("strong", {}, `${das} : CMA de niveau ${v.niveau}.`)];
    if (v.parDp) lignes.push(` Exclue par le DP ${dp} (liste ${v.listeDp}, élément « ${v.parDp} »).`);
    if (v.parRacine) lignes.push(` Exclue par la racine ${racine} (liste de racines ${v.listeRacine}, élément « ${v.parRacine} »).`);
    const exclue = v.parDp || v.parRacine;
    if (!exclue) {
      lignes.push(
        dp || racine
          ? ` Retenue${dp ? ` avec le DP ${dp}` : ""}${racine ? ` dans la racine ${racine}` : ""}.`
          : " Saisir un DP (et une racine) pour vérifier ses exclusions."
      );
    }
    const details = el(
      "p",
      { class: "sous-titre" },
      v.listeDp != null ? `Liste d'exclusion par le DP n° ${v.listeDp} : ${exclusions.dp[v.listeDp].join("  ")}` : "Aucune exclusion par le DP.",
      v.listeRacine != null ? ` — Liste d'exclusion par la racine n° ${v.listeRacine} : ${exclusions.racines[v.listeRacine].join("  ")}` : ""
    );
    zone.append(el("p", { class: exclue ? "message-avertissement" : "message-succes" }, ...lignes), details);
  }

  return el(
    "section",
    { class: "barre-outils outil-cma", "aria-labelledby": "cma_verif_titre" },
    el("h2", { id: "cma_verif_titre" }, "Cette CMA compte-t-elle ?"),
    el(
      "div",
      { class: "outil-cma-champs" },
      champ("cma_das", "Diagnostic associé :", "ex. : E87.1"),
      champ("cma_dp", "DP du séjour :", "ex. : N18.5"),
      champ("cma_racine", "Racine de GHM (facultatif) :", "ex. : 11M04")
    ),
    zone
  );
}
