// Algorithme de la fonction groupage — les arbres de décision du volume 3 du
// Manuel des GHM, CMD par CMD, relus dans le PDF de l'ATIH par
// scripts/build_arbre.py.
//
// Un arbre se lit comme dans le manuel : chaque test s'enchaîne sous le
// précédent quand sa condition n'est pas satisfaite (« non », la colonne
// qui descend), et ouvre en retrait ce qui suit quand elle l'est (« oui »,
// le trait qui part à droite dans le PDF). Un trait qui en rejoint un autre
// par une pointe de flèche devient un renvoi cliquable vers l'étape
// rejointe, dessinée une seule fois.

import { chargerJson, chargerJeu } from "../donnees.js";
import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, nombre } from "../interface.js";

const ORIENTATION = "orientation";
// Un code de liste dans un libellé, avec ses parenthèses s'il en a : la
// puce cliquable qui le remplace tient lieu de parenthèses.
const RE_LISTE = /\(\s*([AD]-\d{3,4})\s*\)|\b([AD]-\d{3,4})\b/g;
// Au-delà, la liste de résultats demande d'affiner la recherche plutôt que
// de dérouler des centaines de lignes.
const RESULTATS_MAX = 40;

// Légende du volume 3, pages 6 à 8.
const SYMBOLES = {
  DP: { texte: "DP", titre: "Le diagnostic principal du RSS" },
  DR: { texte: "DR", titre: "Le diagnostic relié au DP du RSS" },
  DAS: { texte: "DAS", titre: "L'un au moins des diagnostics associés significatifs du RSS" },
  D: { texte: "D", titre: "L'un au moins des diagnostics du RSS" },
  D2: { texte: "D", titre: "Deux au moins des diagnostics du RSS", variante: "double" },
  Dtous: { texte: "D", titre: "Tous les diagnostics du RSS", variante: "epais" },
  A: { texte: "A", titre: "L'un au moins des actes du RSS" },
  A2: { texte: "A", titre: "Deux au moins des actes du RSS", variante: "double" },
  Atous: { texte: "A", titre: "Tous les actes du RSS", variante: "epais" },
  AG: { texte: "AG", titre: "Anesthésie générale" },
  DRDP: { texte: "DR/DP", titre: "Inversion du diagnostic principal avec le diagnostic relié", variante: "inversion" },
  DRbarre: {
    texte: "DR",
    titre: "Au moins un diagnostic parmi le DP et les DAS, sauf le DR",
    variante: "barre",
  },
};

const VARIABLES = {
  DS: "durée de séjour",
  MS: "mode de sortie",
  ME: "mode d'entrée",
  Dest: "destination",
  Âge: "âge à l'entrée",
  Poids: "poids à l'entrée dans l'unité médicale",
  GNN: "groupe de nouveau-nés",
  Durée: "durée de séjour",
  Sexe: "sexe",
  "Nb Séances": "nombre de séances",
  "Inversion DP/DR": "y a-t-il eu inversion du DP et du DR ?",
};

const COULEURS = {
  age: "l'âge intervient comme marqueur de sévérité",
  age_gestationnel: "l'âge gestationnel intervient comme marqueur de sévérité",
};

const FEUILLES = new Set(["ghm", "erreur", "renvoi"]);

// ==== Lecture de l'arbre ====

/** Index construits une fois par chargement : parents de chaque nœud (pour
 *  remonter le chemin jusqu'à la racine) et texte de recherche. */
function preparer(arbre) {
  if (arbre._pret) return arbre;
  const parents = new Map();
  const ajouter = (vers, lien) => {
    if (!parents.has(vers)) parents.set(vers, []);
    parents.get(vers).push(lien);
  };
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    (n.branches ?? []).forEach((b, i) =>
      ajouter(b.vers, { de: id, role: "oui", i, rejoint: Boolean(b.rejoint) })
    );
    if (n.sinon) ajouter(n.sinon.vers, { de: id, role: "non", rejoint: Boolean(n.sinon.rejoint) });
    if (n.suite) ajouter(n.suite.vers, { de: id, role: "suite", rejoint: Boolean(n.suite.rejoint) });
  }
  arbre._parents = parents;
  arbre._cmd = new Map(arbre.cmd.map((c) => [c.cmd, c]));
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    n._id = id;
    n._recherche = recherche.normaliser(texteDeRecherche(arbre, n));
  }
  arbre._pret = true;
  return arbre;
}

function texteDeRecherche(arbre, n) {
  if (n.genre === "ghm") return `${n.racine} ${codesGhm(n).join(" ")}`;
  if (n.genre === "erreur") return n.racine;
  if (n.genre === "renvoi") return n.texte;
  // Pour un test, le seul code de son symbole (« A », « DP ») : sa légende
  // fixe (« L'un au moins des actes du RSS ») ferait remonter tous les
  // tests du même symbole à chaque mot courant.
  const morceaux = [n.genre === "test" ? SYMBOLES[n.symbole].texte : intituleCourt(n)];
  for (const b of n.branches ?? []) {
    morceaux.push(b.libelle);
    for (const code of b.listes) morceaux.push(code, arbre.listes[code]?.libelle ?? "");
  }
  return morceaux.join(" ");
}

/** Codes GHM couverts par une case : « 1 » en bas vaut les niveaux 1 à 4,
 *  une lettre vaut elle-même ; la case du haut ajoute J ou T. */
function codesGhm(f) {
  const codes = [];
  if (f.bas === "1") codes.push(...["1", "2", "3", "4"].map((n) => f.racine + n));
  else if (f.bas) codes.push(f.racine + f.bas);
  if (f.haut) codes.push(f.racine + f.haut);
  return codes;
}

function titreCmd(c) {
  const prefixe = ["15", "27"].includes(c.cmd) ? "CM" : "CMD";
  return `${prefixe} ${c.cmd}`;
}

function pages(c) {
  const [premiere, derniere] = [c.pages[0], c.pages[c.pages.length - 1]];
  return premiere === derniere ? `page ${premiere}` : `pages ${premiere} à ${derniere}`;
}

/** Ce que teste un nœud, en quelques mots, sans ses listes. */
function intituleCourt(n) {
  switch (n.genre) {
    case "test":
      return `${SYMBOLES[n.symbole].texte} — ${SYMBOLES[n.symbole].titre}`;
    case "critere":
      return n.variable;
    case "sans_relation":
      return "Actes sans relation avec le diagnostic principal";
    case "gnn":
      return "Détermination du groupe du nouveau-né";
    case "inversion":
      return "Inversion DP/DR";
    default:
      return "";
  }
}

/** Un nœud en une ligne, pour un renvoi ou un résultat de recherche. */
function resume(n) {
  const b = n.branches ?? [];
  const prefixe =
    n.genre === "test" ? SYMBOLES[n.symbole].texte : n.genre === "critere" ? n.variable : "";
  if (n.genre === "test" || n.genre === "critere") {
    if (b.length === 1) return `${prefixe} ${b[0].libelle}`.trim();
    return `${prefixe} — ${b.length} cas`;
  }
  if (n.genre === "ghm") return n.racine;
  if (n.genre === "erreur") return n.racine;
  if (n.genre === "renvoi") return n.texte;
  return intituleCourt(n);
}

// ==== Pictogrammes ====

function pictogramme(n) {
  if (n.genre === "test" || n.genre === "inversion") {
    const s = SYMBOLES[n.genre === "inversion" ? "DRDP" : n.symbole];
    return el(
      "span",
      {
        class: ["picto", "cercle", s.variante].filter(Boolean).join(" "),
        role: "img",
        "aria-label": `${s.texte} : ${s.titre}`,
        title: s.titre,
      },
      el("span", { "aria-hidden": "true" }, s.texte)
    );
  }
  if (n.genre === "critere") {
    const inversion = n.variable === "Inversion DP/DR";
    return el("span", {
      class: inversion ? "picto losange epais" : "picto losange",
      role: "img",
      "aria-label": "Test sur une donnée non médicale",
      title: `Test sur une donnée non médicale : ${VARIABLES[n.variable] ?? n.variable}`,
    });
  }
  if (n.genre === "sans_relation") {
    return el(
      "span",
      {
        class: "picto trapeze",
        role: "img",
        "aria-label": "Test spécial : actes sans relation avec le diagnostic principal",
        title: "Test spécial : actes sans relation avec le diagnostic principal",
      },
      el("span", { "aria-hidden": "true" }, "A")
    );
  }
  if (n.genre === "gnn") {
    return el(
      "span",
      {
        class: "picto boite",
        role: "img",
        "aria-label": "Détermination du groupe du nouveau-né",
        title: "Détermination du groupe du nouveau-né",
      },
      el("span", { "aria-hidden": "true" }, "GNN")
    );
  }
  return null;
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const arbre = preparer(await chargerJson("groupage", "arbre"));

  conteneur.innerHTML = "";
  const etat = { cmd: null, requete: "" };

  const selecteur = el(
    "select",
    { id: "arbre_cmd", onchange: (e) => afficherCmd(e.target.value) },
    el("option", { value: ORIENTATION }, "Orientation vers les CM et CMD"),
    ...arbre.cmd.map((c) => el("option", { value: c.cmd }, `${titreCmd(c)} — ${c.titre}`))
  );
  const blocCmd = el(
    "div",
    { class: "champ" },
    el("label", { for: "arbre_cmd" }, "Catégorie majeure :"),
    selecteur,
    el(
      "p",
      { class: "champ-aide" },
      "Dans l'ordre du manuel : l'orientation d'abord, puis les CM et CMD que la fonction groupage teste avant les autres."
    )
  );
  const champ = champMotsClefs({
    id: "arbre_recherche",
    exemple: "ex. : 01M24, D-0103, G40.9, épilepsie",
    onInput: (valeur) => chercher(valeur),
  });

  const zoneRecherche = el("div", { class: "resultats-arbre" });
  const zoneArbre = el("div", { class: "zone-arbre" });

  conteneur.append(
    el("h1", {}, "Algorithme de la fonction groupage"),
    fraicheur([{ libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime }]),
    el(
      "p",
      {},
      "Les arbres de décision de la classification en GHM, tels que les dessine le volume 3 du ",
      el("strong", {}, arbre.version ?? "Manuel des GHM"),
      " (ATIH), transcrits page à page. Chaque test s'enchaîne sous le précédent quand sa condition n'est pas satisfaite, et ouvre en retrait ce qui suit quand elle l'est. Un clic sur un code de liste en montre les codes ; un clic sur une case de GHM donne le chemin qui y mène."
    ),
    legende(),
    el("div", { class: "barre-outils" }, blocCmd, champ),
    zoneRecherche,
    zoneArbre
  );

  // ---- Navigation entre CMD ----

  function afficherCmd(cmd, { noeud, cas = null, historique = true } = {}) {
    if (cmd !== ORIENTATION && !arbre._cmd.has(cmd)) cmd = ORIENTATION;
    etat.cmd = cmd;
    selecteur.value = cmd;
    zoneArbre.innerHTML = "";
    if (cmd === ORIENTATION) zoneArbre.append(vueOrientation());
    else zoneArbre.append(vueCmd(arbre._cmd.get(cmd)));
    // L'adresse suit la CMD affichée, sans ajouter d'entrée d'historique ni
    // déclencher le routeur (replaceState ne lève pas `hashchange`).
    if (historique) {
      const cible = `#/arbre/${cmd}${noeud ? `/${noeud}` : ""}${noeud && cas != null ? `/${cas}` : ""}`;
      if (location.hash !== cible) history.replaceState(null, "", cible);
    }
    return noeud ? montrer(noeud, cas) : false;
  }

  function vueOrientation() {
    const ol = el("ol", { class: "colonne" });
    arbre.orientation.forEach((etape, i) => {
      const cible = etape.cmd ? arbre._cmd.get(etape.cmd) : null;
      // Un test en cercle (A, DP) porte le libellé de sa condition, comme
      // dans les CMD ; un losange ou un cadre porte son propre texte.
      const cercle = etape.forme === "A" || etape.forme === "DP";
      const picto =
        etape.forme === "critere"
          ? pictogramme({ genre: "critere", variable: etape.test })
          : cercle
            ? pictogramme({ genre: "test", symbole: etape.forme })
            : el("span", { class: "picto cadre", "aria-hidden": "true" });
      const intitule = cercle
        ? [etape.libelle]
        : etape.forme === "critere"
          ? [el("strong", {}, etape.test), " ", etape.libelle]
          : [etape.test];
      const suite = cible
        ? el(
            "button",
            { type: "button", class: "renvoi-cmd", onclick: () => afficherCmd(cible.cmd) },
            `${titreCmd(cible)} — ${cible.titre}`
          )
        : el(
            "span",
            { class: "grille-cmd" },
            ...arbre.cmd
              .filter((c) => Number(c.cmd) <= 23 && c.cmd !== "15")
              .map((c) =>
                el(
                  "button",
                  { type: "button", class: "renvoi-cmd", title: c.titre, onclick: () => afficherCmd(c.cmd) },
                  titreCmd(c)
                )
              )
          );
      ol.append(
        el(
          "li",
          { class: "etape" },
          marqueEntree(i ? "non" : null),
          el(
            "div",
            { class: "etape-tete" },
            picto,
            el("span", { class: "etape-intitule" }, ...intitule),
            el("span", { class: "etape-page" }, "p. 9")
          ),
          el(
            "div",
            { class: "branche" },
            el(
              "div",
              { class: "branche-condition" },
              el("span", { class: "issue oui" }, "oui"),
              cercle || etape.forme === "critere" ? null : el("span", { class: "branche-libelle" }, etape.libelle),
              flecheVers(),
              suite
            )
          )
        )
      );
    });
    return el(
      "section",
      { class: "arbre", "aria-labelledby": "arbre-titre" },
      el("h2", { id: "arbre-titre" }, "Orientation vers les CM et CMD"),
      el(
        "p",
        { class: "sous-titre" },
        "Volume 3, page 9. Les tests sont faits dans cet ordre ; le premier satisfait oriente le séjour, et le DP détermine la CMD en dernier recours."
      ),
      ol
    );
  }

  function vueCmd(c) {
    const racine = colonne(c.racine, null);
    const outils = el(
      "div",
      { class: "arbre-outils" },
      el(
        "button",
        { type: "button", class: "bouton-icone", onclick: () => replierTout(true) },
        "Tout replier"
      ),
      el(
        "button",
        { type: "button", class: "bouton-icone", onclick: () => replierTout(false) },
        "Tout déplier"
      )
    );
    return el(
      "section",
      { class: "arbre", "aria-labelledby": "arbre-titre" },
      el("h2", { id: "arbre-titre" }, `${titreCmd(c)} — ${c.titre}`),
      el("p", { class: "sous-titre" }, `Volume 3, ${pages(c)}.`),
      outils,
      racine
    );
  }

  function replierTout(replier) {
    zoneArbre.querySelectorAll(".branche[data-repliable]").forEach((b) => replierBranche(b, replier));
  }

  function replierBranche(branche, replier) {
    branche.classList.toggle("repliee", replier);
    const bouton = branche.querySelector(":scope > .branche-condition > .replier");
    if (bouton) {
      bouton.setAttribute("aria-expanded", String(!replier));
      bouton.title = replier ? "Déplier" : "Replier";
    }
  }

  // ---- Colonnes, étapes et branches ----

  /** Une colonne : l'enchaînement des étapes tant que la condition n'est
   *  pas satisfaite, jusqu'à une feuille ou un renvoi. `entree` dit comment
   *  on arrive à la première étape (null en tête d'arbre). */
  function colonne(depart, entree) {
    const ol = el("ol", { class: "colonne" });
    let lien = { vers: depart };
    let arrivee = entree;
    for (;;) {
      const n = arbre.noeuds[lien.vers];
      if (lien.rejoint) {
        ol.append(el("li", { class: "fin" }, marqueEntree(arrivee), renvoiInterne(n)));
        break;
      }
      if (FEUILLES.has(n.genre)) {
        ol.append(el("li", { class: "fin" }, marqueEntree(arrivee), feuille(n, lien.depuis)));
        break;
      }
      ol.append(etape(n, arrivee));
      const suite = suiteDeColonne(n);
      if (!suite) break;
      lien = suite.lien;
      arrivee = suite.entree;
    }
    return ol;
  }

  /** Ce qui prolonge la colonne sous un nœud : le cas « non », la suite
   *  d'un test spécial, ou la seule issue d'un test qui n'a pas de cas
   *  « non » (la racine « DP de la CMD »). */
  function suiteDeColonne(n) {
    const depuis = { de: n._id };
    if (n.sinon) return { lien: { ...n.sinon, depuis: { ...depuis, role: "non" } }, entree: "non" };
    if (n.suite) return { lien: { ...n.suite, depuis: { ...depuis, role: "suite" } }, entree: "puis" };
    if (n.branches?.length === 1) {
      return { lien: { ...n.branches[0], depuis: { ...depuis, role: "oui", i: 0 } }, entree: "oui" };
    }
    return null;
  }

  function etape(n, entree) {
    const b = n.branches ?? [];
    const seuleIssue = b.length === 1 && !n.sinon;
    const li = el("li", { class: "etape", "data-noeud": n._id }, marqueEntree(entree));
    const tete = el(
      "div",
      { class: "etape-tete", id: `n-${n._id}`, tabindex: "-1" },
      pictogramme(n),
      el("span", { class: "etape-intitule" }, ...intitule(n)),
      el("span", { class: "etape-page", title: "Page du volume 3 du Manuel des GHM" }, `p. ${n.page}`)
    );
    li.append(tete);
    if (b.length === 1 && !seuleIssue) li.append(branche(n, 0, false));
    if (b.length > 1) {
      li.append(
        el(
          "p",
          { class: "etape-note" },
          `${b.length} cas, examinés de haut en bas${n.sinon ? " ; aucun ne convient : « non »" : ""}.`
        )
      );
      b.forEach((_, i) => li.append(branche(n, i, true)));
    }
    return li;
  }

  /** L'intitulé d'une étape. Un test à une seule branche porte le libellé
   *  de sa condition ; un test à plusieurs cas ne dit que ce qu'il teste,
   *  chaque cas portant son libellé. */
  function intitule(n) {
    const b = n.branches ?? [];
    const unCas = b.length === 1;
    switch (n.genre) {
      case "test":
        if (unCas) return libelleAvecListes(b[0].libelle || SYMBOLES[n.symbole].titre);
        return [el("strong", {}, SYMBOLES[n.symbole].texte), ` — ${SYMBOLES[n.symbole].titre}`];
      case "critere": {
        const variable = el(
          "strong",
          { title: VARIABLES[n.variable] ?? n.variable },
          n.variable
        );
        return unCas ? [variable, " ", ...libelleAvecListes(b[0].libelle)] : [variable];
      }
      case "sans_relation":
        return [
          "Actes sans relation avec le diagnostic principal",
          el("span", { class: "etape-precision" }, " — tests spéciaux, volume 3 page 8"),
        ];
      case "gnn":
        return ["Détermination du groupe du nouveau-né (GNN)"];
      case "inversion":
        return ["Inversion du DP et du DR, s'il y a lieu"];
      default:
        return [];
    }
  }

  function branche(n, i, avecLibelle) {
    const b = n.branches[i];
    const cible = arbre.noeuds[b.vers];
    const depuis = { de: n._id, role: "oui", i };
    const condition = el("div", { class: "branche-condition" });
    const div = el("div", { class: "branche" }, condition);
    if (avecLibelle) {
      condition.id = `n-${n._id}-c${i}`;
      condition.tabIndex = -1;
      condition.append(el("span", { class: "branche-libelle" }, ...libelleAvecListes(b.libelle)));
    } else {
      condition.append(el("span", { class: "issue oui" }, "oui"));
    }
    if (b.rejoint) {
      condition.append(flecheVers(), renvoiInterne(cible));
    } else if (FEUILLES.has(cible.genre)) {
      condition.append(flecheVers(), feuille(cible, depuis));
    } else {
      div.dataset.repliable = "";
      const bouton = el(
        "button",
        {
          type: "button",
          class: "replier",
          "aria-expanded": "true",
          title: "Replier",
          onclick: () => replierBranche(div, !div.classList.contains("repliee")),
        },
        el("span", { class: "icone", "aria-hidden": "true" }),
        el("span", { class: "visuellement-cache" }, "Replier ou déplier cette branche")
      );
      condition.prepend(bouton);
      div.append(colonne(b.vers, null));
    }
    return div;
  }

  /** « non », « oui » ou « puis », posé sur le filet au-dessus de l'étape :
   *  du vrai texte, lu avant l'étape par un lecteur d'écran, et non un
   *  contenu CSS qui ne serait lu qu'après tout son sous-arbre. */
  function marqueEntree(entree) {
    if (!entree) return null;
    return el("span", { class: "entree" }, entree, el("span", { class: "visuellement-cache" }, " :"));
  }

  function flecheVers() {
    return el("span", { class: "fleche", "aria-hidden": "true" }, "→");
  }

  function renvoiInterne(n) {
    return el(
      "button",
      {
        type: "button",
        class: "rejoint",
        title: "Ce trait rejoint une étape dessinée ailleurs dans l'arbre",
        onclick: () => montrer(n._id),
      },
      el("span", { class: "rejoint-mot" }, "rejoint l'étape"),
      el("span", {}, resume(n)),
      el("span", { class: "etape-page" }, `p. ${n.page}`)
    );
  }

  /** Une case de GHM, un groupe d'erreur ou un renvoi vers d'autres CMD.
   *  `depuis` dit par quel trait on y arrive, pour en donner le chemin. */
  function feuille(n, depuis) {
    if (n.genre === "renvoi") {
      return el(
        "span",
        {
          class: "renvoi",
          title: "Le séjour n'est pas classé dans cette catégorie : l'orientation se poursuit",
          "data-feuille": n._id,
          tabindex: "-1",
        },
        "Orientation vers ",
        n.texte
      );
    }
    const classes = ["ghm", n.genre === "erreur" ? "erreur" : n.couleur].filter(Boolean);
    const codes = n.genre === "ghm" ? codesGhm(n) : [n.racine];
    const titre =
      n.genre === "erreur"
        ? `${n.racine} : groupe comportant au moins une erreur ou inclassable`
        : `${codes.join(", ")}${n.couleur ? ` — ${COULEURS[n.couleur]}` : ""}`;
    const bouton = el(
      "button",
      {
        type: "button",
        class: classes.join(" "),
        title: titre,
        "aria-expanded": "false",
        "data-feuille": n._id,
        onclick: () => basculerChemin(bouton, n, depuis),
      },
      el("span", { class: "ghm-racine" }, n.racine)
    );
    if (n.genre === "ghm") {
      bouton.append(
        el(
          "span",
          { class: "ghm-cases", "aria-hidden": "true" },
          el("span", {}, n.haut ?? ""),
          el("span", {}, n.bas ?? "")
        ),
        el("span", { class: "visuellement-cache" }, ` : ${codes.join(", ")}`)
      );
    }
    return bouton;
  }

  function libelleAvecListes(texte) {
    const morceaux = [];
    let fin = 0;
    for (const m of texte.matchAll(RE_LISTE)) {
      if (m.index > fin) morceaux.push(texte.slice(fin, m.index));
      morceaux.push(puceListe(m[1] ?? m[2]));
      fin = m.index + m[0].length;
    }
    if (fin < texte.length) morceaux.push(texte.slice(fin));
    return morceaux;
  }

  function puceListe(code) {
    const fiche = arbre.listes[code];
    const titre = fiche?.libelle
      ? `${fiche.libelle} — ${nombre(fiche.codes)} ${fiche.nature === "actes" ? "acte" : "diagnostic"}${fiche.codes > 1 ? "s" : ""}`
      : "Liste absente des listes publiées de la fonction groupage";
    const bouton = el(
      "button",
      {
        type: "button",
        class: "puce-liste",
        title: titre,
        "aria-expanded": "false",
        onclick: () => basculerListe(bouton, code),
      },
      code
    );
    return bouton;
  }

  // ---- Panneaux : codes d'une liste, chemin vers une feuille ----

  /** Ouvre ou referme le panneau attaché à `bouton`, posé juste sous la
   *  ligne qui le porte. */
  function basculerPanneau(bouton, construire) {
    if (bouton._panneau?.isConnected) {
      bouton._panneau.remove();
      bouton._panneau = null;
      bouton.setAttribute("aria-expanded", "false");
      return;
    }
    // Un code de liste cliqué dans le chemin d'un GHM ouvre sa liste dans
    // ce panneau-là, qui l'emporte en se refermant.
    const hote = bouton.closest(".panneau");
    const ligne = hote
      ? bouton.closest(".panneau li") ?? hote
      : bouton.closest(".etape-tete, .branche-condition, li.fin");
    const panneau = construire(() => {
      panneau.remove();
      bouton._panneau = null;
      bouton.setAttribute("aria-expanded", "false");
      if (bouton.isConnected) bouton.focus();
    });
    if (hote || ligne.matches("li.fin")) ligne.append(panneau);
    else ligne.after(panneau);
    bouton._panneau = panneau;
    bouton.setAttribute("aria-expanded", "true");
  }

  function entetePanneau(titre, fermer) {
    return el(
      "div",
      { class: "panneau-entete" },
      el("p", { class: "panneau-titre" }, ...titre),
      el(
        "button",
        { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer },
        el("span", { class: "icone", "aria-hidden": "true" })
      )
    );
  }

  function basculerListe(bouton, code) {
    basculerPanneau(bouton, (fermer) => {
      const fiche = arbre.listes[code];
      const nature = fiche?.nature ?? (code.startsWith("A") ? "actes" : "diagnostics");
      const zone = el("div", {}, el("p", { class: "compteur" }, "Chargement de la liste…"));
      const panneau = el(
        "div",
        { class: "panneau panneau-liste" },
        entetePanneau(
          [el("strong", {}, code), fiche?.libelle ? ` — ${fiche.libelle}` : ""],
          fermer
        ),
        zone
      );
      if (!fiche?.libelle) {
        zone.innerHTML = "";
        zone.append(
          el(
            "p",
            { class: "message-info" },
            code === "A-001"
              ? "A-001 désigne l'ensemble des actes classants opératoires : elle ne figure pas parmi les listes publiées de la fonction groupage."
              : "Cette liste ne figure pas parmi les listes publiées de la fonction groupage."
          )
        );
        return panneau;
      }
      codesDeListe(nature, code)
        .then((lignes) => {
          zone.innerHTML = "";
          const zoneTable = el("div", {});
          if (lignes.length > 10) {
            const indexees = recherche.indexer(lignes, ["Code", "Libellé code"]);
            zone.append(
              el(
                "div",
                { class: "filtre-liste" },
                champMotsClefs({
                  id: `liste_${code}_${Math.floor(performance.now())}`,
                  libelle: `Filtrer la liste ${code} :`,
                  raccourci: false,
                  exemple: nature === "actes" ? "ex. : arthroscopie" : "ex. : sans précision",
                  onInput: (v) => tableCodes(zoneTable, indexees.filter(recherche.filtre(v)), lignes.length),
                })
              )
            );
          }
          zone.append(zoneTable);
          tableCodes(zoneTable, lignes, lignes.length);
        })
        .catch((erreur) => {
          console.error(erreur);
          zone.innerHTML = "";
          zone.append(el("p", { class: "message-avertissement" }, "Liste indisponible pour le moment."));
        });
      return panneau;
    });
  }

  /** Les codes d'une liste, en entier : deux colonnes qui tiennent dans le
   *  panneau (le libellé passe à la ligne), sans pagination — au-delà de
   *  quelques écrans, la zone défile d'elle-même. */
  function tableCodes(zone, lignes, total) {
    zone.innerHTML = "";
    if (!lignes.length) {
      zone.append(el("p", { class: "compteur", role: "status" }, "Aucun code pour ce filtre."));
      return;
    }
    zone.append(
      el(
        "p",
        { class: "compteur", role: "status" },
        el("strong", {}, nombre(lignes.length)),
        lignes.length === total ? ` code${total > 1 ? "s" : ""}` : ` code${lignes.length > 1 ? "s" : ""} sur ${nombre(total)}`
      ),
      el(
        "div",
        { class: "codes-liste" },
        el(
          "table",
          {},
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Code"), el("th", { scope: "col" }, "Libellé"))),
          el(
            "tbody",
            {},
            ...lignes.map((l) => el("tr", {}, el("td", { class: "code" }, l.Code), el("td", {}, l["Libellé code"])))
          )
        )
      )
    );
  }

  function basculerChemin(bouton, n, depuis) {
    basculerPanneau(bouton, (fermer) => {
      const etapes = cheminVers(depuis);
      const codes = n.genre === "ghm" ? codesGhm(n) : [n.racine];
      const titre = [el("strong", {}, n.racine)];
      if (n.genre === "ghm") {
        titre.push(` — GHM ${codes.join(", ")}`);
        if (n.couleur) titre.push(` ; ${COULEURS[n.couleur]}`);
      } else {
        titre.push(" — groupe comportant au moins une erreur ou inclassable");
      }
      const ol = el("ol", { class: "chemin" });
      for (const e of etapes) {
        const noeud = arbre.noeuds[e.de];
        ol.append(
          el(
            "li",
            {},
            pictogramme(noeud),
            el("span", { class: "chemin-libelle" }, ...libelleEtape(noeud, e)),
            el("span", { class: `issue ${e.role === "non" ? "non" : "oui"}` }, issue(e))
          )
        );
      }
      return el(
        "div",
        { class: "panneau panneau-chemin" },
        entetePanneau(titre, fermer),
        el("p", { class: "compteur" }, `Chemin depuis la racine de la ${titreCmd(arbre._cmd.get(n.cmd))} :`),
        ol
      );
    });
  }

  /** Les étapes qui mènent au trait `depuis`, de la racine de la CMD vers
   *  la feuille. On remonte par le trait qui porte chaque étape (jamais par
   *  un renvoi « rejoint »), si bien que le chemin est celui du dessin. */
  function cheminVers(depuis) {
    const etapes = [depuis];
    let courant = depuis.de;
    const vus = new Set([courant]);
    for (;;) {
      const entrants = arbre._parents.get(courant) ?? [];
      const lien = entrants.find((p) => !p.rejoint) ?? entrants[0];
      if (!lien || vus.has(lien.de)) break;
      etapes.unshift(lien);
      courant = lien.de;
      vus.add(courant);
    }
    return etapes;
  }

  function libelleEtape(n, e) {
    const b = n.branches ?? [];
    if (e.role === "oui" && (n.genre === "test" || n.genre === "critere")) {
      const prefixe = n.genre === "critere" ? [el("strong", {}, n.variable), " "] : [];
      return [...prefixe, ...libelleAvecListes(b[e.i].libelle || SYMBOLES[n.symbole]?.titre || "")];
    }
    if (e.role === "non" && b.length === 1) {
      const prefixe = n.genre === "critere" ? [el("strong", {}, n.variable), " "] : [];
      return [...prefixe, ...libelleAvecListes(b[0].libelle || SYMBOLES[n.symbole]?.titre || "")];
    }
    if (e.role === "non") {
      return [`${resume(n)} : aucun des cas (${b.map((x) => x.listes.join(", ") || x.libelle).join(" ; ")})`];
    }
    return intitule(n);
  }

  function issue(e) {
    if (e.role === "non") return "non";
    if (e.role === "suite") return "puis";
    return "oui";
  }

  // ---- Aller à une étape ----

  function montrer(id, cas = null) {
    // Une étape a son ancre sur son en-tête, chaque cas d'une colonne de cas
    // sur sa ligne ; une feuille, répétée à chaque trait qui y mène, se
    // montre à sa première occurrence.
    const cible =
      (cas != null ? zoneArbre.querySelector(`#n-${CSS.escape(id)}-c${cas}`) : null) ??
      zoneArbre.querySelector(`#n-${CSS.escape(id)}`) ??
      zoneArbre.querySelector(`[data-feuille="${CSS.escape(id)}"]`);
    if (!cible) return false;
    // Une étape dans une branche repliée : on déplie ses ancêtres.
    for (let b = cible.closest(".branche.repliee"); b; b = b.parentElement?.closest(".branche.repliee")) {
      replierBranche(b, false);
    }
    cible.scrollIntoView({ block: "center", behavior: "smooth" });
    cible.focus({ preventScroll: true });
    cible.classList.remove("surbrillance");
    // Relancer l'animation si on montre deux fois la même étape.
    void cible.offsetWidth;
    cible.classList.add("surbrillance");
    return true;
  }

  // ---- Recherche ----

  let jeton = 0;

  async function chercher(valeur) {
    etat.requete = valeur;
    const monJeton = ++jeton;
    zoneRecherche.innerHTML = "";
    const requete = valeur.trim();
    if (!requete) return;

    const trouves = noeudsCorrespondants(requete);
    const blocCodes = el("div", {});
    zoneRecherche.append(blocCodes);
    afficherResultats(trouves, zoneRecherche);

    // Un code CIM-10 ou CCAM : on cherche aussi les listes qui le contiennent,
    // ce qui demande les listes complètes (chargées à la première demande).
    const nature = natureDeCode(requete);
    if (!nature) return;
    blocCodes.append(el("p", { class: "compteur", role: "status" }, "Recherche du code dans les listes…"));
    try {
      const { lignes } = await chargerJeu(
        "groupage",
        nature,
        nature === "actes" ? "listes d'actes de la fonction groupage" : "listes de diagnostics de la fonction groupage"
      );
      if (monJeton !== jeton) return;
      const cle = cleDeCode(requete);
      const parCode = new Map();
      for (const l of lignes) {
        if (!cleDeCode(l.Code).startsWith(cle)) continue;
        if (!parCode.has(l.Code)) parCode.set(l.Code, { libelle: l["Libellé code"], listes: new Set() });
        parCode.get(l.Code).listes.add(l.Liste);
      }
      blocCodes.innerHTML = "";
      if (!parCode.size) {
        // « a180 » est la liste A-180 comme le code A18.0 : l'absence de
        // code ne s'annonce que si rien d'autre n'a répondu.
        if (!trouves.length) {
          blocCodes.append(
            el(
              "p",
              { class: "message-info", role: "status" },
              `Aucune étape ni aucun GHM, et aucune liste de la fonction groupage ne contient de code commençant par « ${requete} ».`
            )
          );
        }
        return;
      }
      const listes = new Set([...parCode.values()].flatMap((c) => [...c.listes]));
      const codesAffiches = [...parCode].slice(0, 12);
      blocCodes.append(
        el(
          "div",
          { class: "panneau panneau-codes" },
          el(
            "p",
            { class: "panneau-titre", role: "status" },
            `${nombre(parCode.size)} code${parCode.size > 1 ? "s" : ""} dans ${nombre(listes.size)} liste${listes.size > 1 ? "s" : ""} :`
          ),
          el(
            "ul",
            { class: "codes-trouves" },
            ...codesAffiches.map(([code, c]) =>
              el(
                "li",
                {},
                el("strong", { class: "code" }, code),
                ` ${c.libelle} — `,
                ...[...c.listes].sort().flatMap((l, i) => [i ? ", " : "", el("span", { class: "code" }, l)])
              )
            ),
            parCode.size > codesAffiches.length
              ? el("li", { class: "compteur" }, `… et ${nombre(parCode.size - codesAffiches.length)} autres codes : précisez le code.`)
              : null
          )
        )
      );
      const deja = new Set(trouves.map((e) => `${e.n._id}/${e.i}`));
      const ajouts = [];
      for (const n of Object.values(arbre.noeuds)) {
        const b = n.branches ?? [];
        b.forEach((x, i) => {
          if (!x.listes.some((l) => listes.has(l))) return;
          const entree = { n, i: b.length > 1 ? i : null };
          if (!deja.has(`${n._id}/${entree.i}`)) ajouts.push(entree);
        });
      }
      if (ajouts.length || !trouves.length) {
        zoneRecherche.querySelector(".liste-resultats-bloc")?.remove();
        afficherResultats([...trouves, ...ajouts], zoneRecherche);
      }
    } catch (erreur) {
      console.error(erreur);
      if (monJeton !== jeton) return;
      blocCodes.innerHTML = "";
      blocCodes.append(el("p", { class: "message-avertissement" }, "Listes indisponibles pour le moment."));
    }
  }

  /** Les étapes et feuilles qui répondent à la requête, en entrées
   *  `{ n, i }` : `i` désigne le cas d'une colonne de cas qui répond, pour
   *  montrer ce cas plutôt que tout le test (le DP de la CMD 01 en compte
   *  27). */
  function noeudsCorrespondants(requete) {
    const compact = recherche.normaliser(requete).replace(/\s+/g, "");
    // Un code GHM, entier ou en partie : « 01M », « 01M24 », « 01M241 »,
    // « 90Z02Z ». Comparé aux codes de chaque case, si bien que « 25M02C »
    // ne rend que la case C.
    const ghm = RE_REQUETE_GHM.test(compact) ? compact : null;
    // Un code de liste, avec ou sans tiret : comparé code pour code, faute
    // de quoi « D-030 » ramènerait aussi D-0301 à D-0309.
    const liste = codeDeListe(requete);
    const filtre = recherche.filtre(requete);
    const entrees = [];
    for (const n of Object.values(arbre.noeuds)) {
      if (n.genre === "ghm" || n.genre === "erreur") {
        const codes = n.genre === "ghm" ? codesGhm(n) : [n.racine];
        if (ghm && codes.some((c) => recherche.normaliser(c).startsWith(ghm))) entrees.push({ n, i: null });
        continue;
      }
      if (ghm) continue;
      if (n.genre === "renvoi") {
        if (!liste && filtre({ _recherche: n._recherche })) entrees.push({ n, i: null });
        continue;
      }
      const b = n.branches ?? [];
      const cas = b
        .map((x, i) => ({ x, i }))
        .filter(({ x }) =>
          liste ? x.listes.includes(liste) : filtre({ _recherche: recherche.normaliser(texteDeBranche(x)) })
        );
      if (liste) {
        entrees.push(...cas.map(({ i }) => ({ n, i: b.length > 1 ? i : null })));
        continue;
      }
      if (!filtre({ _recherche: n._recherche })) continue;
      if (b.length > 1 && cas.length) entrees.push(...cas.map(({ i }) => ({ n, i })));
      else entrees.push({ n, i: null });
    }
    return entrees;
  }

  function texteDeBranche(b) {
    return [b.libelle, ...b.listes.flatMap((l) => [l, arbre.listes[l]?.libelle ?? ""])].join(" ");
  }

  function afficherResultats(entrees, zone) {
    const bloc = el("div", { class: "liste-resultats-bloc" });
    zone.append(bloc);
    if (!entrees.length) {
      if (!natureDeCode(etat.requete)) {
        bloc.append(el("p", { class: "message-info", role: "status" }, "Aucune étape ni aucun GHM pour cette recherche."));
      }
      return;
    }
    const ordre = new Map(arbre.cmd.map((c, i) => [c.cmd, i]));
    entrees.sort(
      (a, b) => ordre.get(a.n.cmd) - ordre.get(b.n.cmd) || a.n.page - b.n.page || (a.i ?? -1) - (b.i ?? -1)
    );
    const affiches = entrees.slice(0, RESULTATS_MAX);
    bloc.append(
      el(
        "p",
        { class: "compteur", role: "status" },
        el("strong", {}, nombre(entrees.length)),
        ` étape${entrees.length > 1 ? "s" : ""} ou GHM`,
        entrees.length > affiches.length
          ? ` — les ${RESULTATS_MAX} premiers ; précisez la recherche pour les autres`
          : ""
      ),
      el(
        "ol",
        { class: "liste-resultats" },
        ...affiches.map(({ n, i }) =>
          el(
            "li",
            {},
            el(
              "button",
              { type: "button", onclick: () => afficherCmd(n.cmd, { noeud: n._id, cas: i }) },
              el("span", { class: "resultat-cmd" }, titreCmd(arbre._cmd.get(n.cmd))),
              el("span", { class: "etape-page" }, `p. ${n.page}`),
              FEUILLES.has(n.genre) ? null : pictogramme(n),
              el("span", { class: "resultat-libelle" }, resumeResultat(n, i))
            )
          )
        )
      )
    );
  }

  function resumeResultat(n, i) {
    if (n.genre === "ghm" || n.genre === "erreur") {
      // Les deux dernières conditions du chemin situent la case mieux que
      // son seul code : « Épilepsie (D-0103) · Âge <18 ans ».
      const parent = (arbre._parents.get(n._id) ?? [])[0];
      const contexte = parent
        ? cheminVers(parent)
            .slice(-2)
            .map((e) => texteEtape(arbre.noeuds[e.de], e))
            .join(" · ")
        : "";
      const codes = n.genre === "ghm" ? ` (${codesGhm(n).join(", ")})` : "";
      return `${n.racine}${codes}${contexte ? ` — ${contexte}` : ""}`;
    }
    const b = n.branches ?? [];
    if (i != null) {
      const cible = arbre.noeuds[b[i].vers];
      const prefixe = n.genre === "critere" ? `${n.variable} ` : `${SYMBOLES[n.symbole]?.texte ?? ""} `;
      const suite = FEUILLES.has(cible.genre) ? ` → ${cible.racine ?? cible.texte}` : "";
      return `${prefixe}${b[i].libelle}${suite}`;
    }
    const cible = b.length === 1 ? arbre.noeuds[b[0].vers] : null;
    const suite = cible && FEUILLES.has(cible.genre) ? ` → ${cible.racine ?? cible.texte}` : "";
    return `${resume(n)}${suite}`;
  }

  /** Une étape de chemin en texte : « Âge <18 ans : oui ». */
  function texteEtape(n, e) {
    const b = n.branches ?? [];
    const prefixe = n.genre === "critere" ? `${n.variable} ` : "";
    if (e.role === "oui") return `${prefixe}${b[e.i]?.libelle ?? ""}`.trim();
    if (e.role === "non") return `${prefixe}${b.length === 1 ? b[0].libelle : resume(n)} : non`.trim();
    return intituleCourt(n);
  }

  // ---- Premier affichage ----

  // Rendu vrai quand la vue s'est placée d'elle-même sur une étape (lien
  // profond) : le routeur ne la ramène alors pas en haut de page.
  const [cmdDemandee, noeudDemande, casDemande] = chemin;
  return afficherCmd(cmdDemandee ?? ORIENTATION, {
    noeud: noeudDemande,
    cas: casDemande != null && /^\d+$/.test(casDemande) ? Number(casDemande) : null,
    historique: Boolean(cmdDemandee),
  });
}

/** Les codes d'une liste, sans doublon : une même liste apparaît sous
 *  plusieurs CMD dans les listes publiées, avec le même contenu. */
async function codesDeListe(nature, code) {
  const { lignes } = await chargerJeu(
    "groupage",
    nature,
    nature === "actes" ? "listes d'actes de la fonction groupage" : "listes de diagnostics de la fonction groupage"
  );
  const vus = new Set();
  const resultat = [];
  for (const l of lignes) {
    if (l.Liste !== code || vus.has(l.Code)) continue;
    vus.add(l.Code);
    resultat.push({ Code: l.Code, "Libellé code": l["Libellé code"] });
  }
  return resultat;
}

/** Une racine de GHM ou un code de GHM, entier ou en partie. */
const RE_REQUETE_GHM = /^\d{2}[ckmz]\d{0,2}[a-z0-9]?$/;

/** « D-0103 », « d0103 », « A 180 » → le code de liste canonique, ou null. */
function codeDeListe(requete) {
  const m = requete.trim().match(/^([ad])\s*-?\s*(\d{3,4})$/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

/** « G40.9 » ou « g409 » → diagnostics ; « AAFA001 » → actes. */
function natureDeCode(requete) {
  const r = requete.trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{4}\d{3}/.test(r)) return "actes";
  if (/^[A-Z]\d{2}(\.?\d*)?[+]?\d*$/.test(r)) return "diagnostics";
  return null;
}

function cleDeCode(code) {
  return String(code).toUpperCase().replace(/[\s.]/g, "");
}

// ==== Légende ====

function legende() {
  const ligne = (picto, texte) => el("li", {}, picto, el("span", {}, texte));
  const cercle = (symbole) => pictogramme({ genre: "test", symbole });
  return el(
    "details",
    { class: "legende-arbre" },
    el("summary", {}, "Légende des symboles"),
    el(
      "div",
      { class: "legende-grille" },
      el(
        "div",
        {},
        el("p", { class: "legende-titre" }, "Tests sur les données médicales du RSS"),
        el(
          "ul",
          {},
          ...["DP", "DR", "DAS", "D", "D2", "Dtous", "A", "A2", "Atous", "AG", "DRbarre", "DRDP"].map((s) =>
            ligne(cercle(s), SYMBOLES[s].titre)
          )
        )
      ),
      el(
        "div",
        {},
        el("p", { class: "legende-titre" }, "Tests sur les autres données"),
        el(
          "ul",
          {},
          ligne(
            pictogramme({ genre: "critere", variable: "DS" }),
            "Donnée non médicale : âge, durée de séjour (DS), destination, mode d'entrée (ME) ou de sortie (MS), poids, groupe de nouveau-nés (GNN)…"
          ),
          ligne(
            pictogramme({ genre: "critere", variable: "Inversion DP/DR" }),
            "Y a-t-il eu inversion du DP et du DR ? L'inversion est interne à la fonction groupage et ne modifie en rien les règles de recueil."
          ),
          ligne(
            pictogramme({ genre: "sans_relation" }),
            "Actes sans relation avec le DP : si tous les actes classants opératoires sont des actes mineurs reclassant dans un GHM médical, ils sont ignorés (code retour 80) ; sinon un acte classant opératoire éventuel est ignoré (code retour 222)."
          ),
          ligne(pictogramme({ genre: "gnn" }), "Détermination du groupe du nouveau-né.")
        ),
        el("p", { class: "legende-titre" }, "Groupes"),
        el(
          "ul",
          {},
          ligne(
            el("span", { class: "ghm" }, el("span", { class: "ghm-racine" }, "01M24"), el("span", { class: "ghm-cases" }, el("span", {}, "T"), el("span", {}, "1"))),
            "Racine de GHM. En haut : J ambulatoire, T très courte durée. En bas : 1 niveaux de sévérité 1 à 4, Z non segmenté, E avec décès, A à D complications spécifiques."
          ),
          ligne(el("span", { class: "ghm age" }, el("span", { class: "ghm-racine" }, "bleu")), COULEURS.age + "."),
          ligne(
            el("span", { class: "ghm age_gestationnel" }, el("span", { class: "ghm-racine" }, "vert")),
            COULEURS.age_gestationnel + "."
          ),
          ligne(el("span", { class: "ghm erreur" }, el("span", { class: "ghm-racine" }, "90Z02Z")), "Groupe comportant au moins une erreur, ou inclassable.")
        )
      )
    )
  );
}
