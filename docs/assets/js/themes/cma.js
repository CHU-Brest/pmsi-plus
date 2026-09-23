// Niveaux de sévérité (CMA) — la liste des complications ou morbidités
// associées de la fonction groupage, et le niveau (2 à 4) que chacune
// apporte au séjour quand elle est codée en diagnostic associé.

import { chargerJeu, chargerJson } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, resultats } from "../interface.js";

const NIVEAUX = [2, 3, 4];

// ==== Exclusions (volume 1, annexes 4 et 5) ====

/** « e871 », « E87.1 » → « E87.1 » : la graphie des listes. */
function graphie(saisie) {
  const c = saisie.trim().toUpperCase().replace(/[\s.]/g, "");
  return c.length <= 3 ? c : `${c.slice(0, 3)}.${c.slice(3)}`;
}

const cle = (code) => code.replace(/\./g, "");

/** Un élément de liste de DP de l'annexe 5 couvre-t-il `code` ? « A00 »
 *  vaut A00 et toutes ses extensions ; « R05-R07 », tous les codes compris
 *  entre les deux dans l'ordre alphabétique, extensions de R07 comprises ;
 *  l'étoile (« M62.89* ») écarte l'extension 0 que le manuel en exclut. */
function couvre(element, code) {
  const c = cle(code);
  const dedans = (borne) => {
    const etoile = borne.endsWith("*");
    const b = cle(borne.replace("*", ""));
    return c.startsWith(b) && !(etoile && c === `${b}0`);
  };
  if (!element.includes("-")) return dedans(element);
  const [debut, fin] = element.split("-");
  return c >= cle(debut.replace("*", "")) && (c <= cle(fin.replace("*", "")) || dedans(fin));
}

/** Un élément de liste de racines couvre-t-il la racine `r` (« 01C03 ») ? */
function couvreRacine(element, r) {
  let m;
  if ((m = element.match(/^CMD(\d{2})$/))) return r.slice(0, 2) === m[1];
  if ((m = element.match(/^Racines_en_([CKMZ])$/))) return r[2] === m[1];
  if ((m = element.match(/^Sous_CMD(\d{2})_([CKMZ])$/))) return r.slice(0, 2) === m[1] && r[2] === m[2];
  return element === r;
}

function verifierCma(exclusions, das, dp, racine) {
  const fiche = exclusions.parCode.get(das);
  if (!fiche) return { cma: false };
  const [, niveau, listeDp, listeRacine] = fiche;
  const parDp = dp && listeDp != null ? exclusions.dp[listeDp].find((e) => couvre(e, dp)) : null;
  const parRacine =
    racine && listeRacine != null ? exclusions.racines[listeRacine].find((e) => couvreRacine(e, racine)) : null;
  return { cma: true, niveau, listeDp, listeRacine, parDp, parRacine };
}

export async function rendre(conteneur) {
  const [jeu, exclusions] = await Promise.all([
    chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage"),
    chargerJson("groupage", "cma_exclusions"),
  ]);
  if (!exclusions.parCode) exclusions.parCode = new Map(exclusions.cma.map((c) => [c[0], c]));
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
    const racineSaisie = document.getElementById("cma_racine").value.trim().toUpperCase().slice(0, 5);
    zone.innerHTML = "";
    if (!das) return;
    const dp = dpSaisi ? graphie(dpSaisi) : null;
    const racine = /^\d{2}[CKMZ]\d{2}$/.test(racineSaisie) ? racineSaisie : null;
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
