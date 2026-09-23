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
import { racinesAtteintes } from "./frontieres.js";

const SYMBOLES_ACTES = new Set(["A", "A2", "Atous"]);

function typesDe(racines) {
  return [...new Set(racines.split(", ").map((r) => (/^\d{2}[CKMZ]/.test(r) ? r[2] : "?")))].sort().join("");
}

export function calculer(arbre, actes) {
  const codesDeListe = new Map();
  const libelleCode = new Map();
  for (const l of actes) {
    if (!codesDeListe.has(l.Liste)) codesDeListe.set(l.Liste, new Set());
    codesDeListe.get(l.Liste).add(l.Code);
    libelleCode.set(l.Code, l["Libellé code"]);
  }
  const memo = new Map();
  // CMD → code → { listes, racines } sur tous les tests d'actes qui le citent.
  const parCmd = new Map();
  for (const n of Object.values(arbre.noeuds)) {
    if (n.genre !== "test" || !SYMBOLES_ACTES.has(n.symbole)) continue;
    if (!parCmd.has(n.cmd)) parCmd.set(n.cmd, new Map());
    const codes = parCmd.get(n.cmd);
    for (const b of n.branches) {
      const racines = racinesAtteintes(arbre, b.vers, memo);
      for (const liste of b.listes) {
        for (const code of codesDeListe.get(liste) ?? []) {
          if (!codes.has(code)) codes.set(code, { listes: new Set(), racines: new Set() });
          const fiche = codes.get(code);
          fiche.listes.add(liste);
          for (const r of racines) fiche.racines.add(r);
        }
      }
    }
  }
  const lignes = [];
  for (const [cmd, codes] of parCmd) {
    const familles = new Map();
    for (const [code, fiche] of codes) {
      const famille = code.slice(0, 4);
      if (!familles.has(famille)) familles.set(famille, []);
      familles.get(famille).push({ code, racines: [...fiche.racines].sort().join(", "), listes: [...fiche.listes].sort().join(", ") });
    }
    for (const [famille, membres] of familles) {
      if (new Set(membres.map((m) => m.racines)).size < 2) continue;
      // Le type de la racine (3e caractère : C chirurgical, K
      // interventionnel, M médical, Z indifférencié) change-t-il au sein de
      // la famille ? C'est la frontière qui pèse le plus sur la valorisation.
      const types = new Set(membres.map((m) => typesDe(m.racines)));
      for (const m of membres) {
        lignes.push({
          CMD: cmd,
          Code: m.code,
          Racines: m.racines,
          "Liste(s)": m.listes,
          "Libellé code": libelleCode.get(m.code) ?? "",
          _famille: famille,
          _typeChange: types.size > 1,
        });
      }
    }
  }
  lignes.sort((a, b) => a.CMD.localeCompare(b.CMD) || a.Code.localeCompare(b.Code));
  return lignes;
}

export async function rendre(conteneur) {
  const [arbre, actes] = await Promise.all([
    chargerJson("groupage", "arbre"),
    chargerJeu("groupage", "actes", "listes d'actes de la fonction groupage"),
  ]);
  if (!arbre._actesFrontieres) {
    arbre._actesFrontieres = recherche.indexer(calculer(arbre, actes.lignes), ["CMD", "Code", "Racines", "Liste(s)", "Libellé code"]);
  }
  const lignes = arbre._actesFrontieres;
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
      el("a", { class: "lien-texte", href: "#/arbre" }, "l'algorithme de la fonction groupage"),
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
