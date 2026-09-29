// Dessin d'un arbre de décision de fonction groupage, commun aux deux
// algorithmes : MCO (themes/arbre.js, les arbres du volume 3 du Manuel des
// GHM relus par scripts/build_arbre.py) et SMR (themes/smr/arbre.js, ceux
// du volume 1 du Manuel des GME, construits depuis la classification).
//
// Un arbre se lit comme dans le manuel : chaque test s'enchaîne sous le
// précédent quand sa condition n'est pas satisfaite (« non », la colonne
// qui descend), et ouvre en retrait ce qui suit quand elle l'est (« oui »,
// le trait qui part à droite). Un trait qui en rejoint un autre devient un
// renvoi cliquable vers l'étape rejointe, dessinée une seule fois.
//
// Le graphe a la forme de arbre.json (MCO) : des nœuds indexés par
// identifiant, `{ genre, cmd, page, branches: [{ libelle, listes, vers,
// rejoint }], sinon, suite }`, où `cmd` nomme la catégorie du sélecteur
// (CMD, CM, GN…) où le nœud est dessiné. Un test (genre « test », un
// `symbole`) et un critère (« critere », une `variable`) se dessinent ici ;
// les autres étapes et les feuilles, par le profil du champ (cf.
// dessinerArbre).

import * as recherche from "./recherche.js";
import { el, champMotsClefs, nombre } from "./interface.js";

// Un code de liste dans un libellé, avec ses parenthèses s'il en a : la
// puce cliquable qui le remplace tient lieu de parenthèses.
const RE_LISTE = /\(\s*([AD]-\d{3,4})\s*\)|\b([AD]-\d{3,4})\b/g;
// Au-delà, la liste de résultats demande d'affiner la recherche plutôt que
// de dérouler des centaines de lignes.
const RESULTATS_MAX = 40;

// ==== Lecture de l'arbre ====

/** Index construits une fois par graphe : parents de chaque nœud (pour
 *  remonter le chemin jusqu'à la racine) et texte de recherche. */
function preparer(P) {
  const arbre = P.arbre;
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
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    n._id = id;
    n._recherche = recherche.normaliser(texteDeRecherche(P, n));
  }
  arbre._pret = true;
  return arbre;
}

function texteDeRecherche(P, n) {
  const codes = P.codesNoeud(n);
  if (P.feuilles.has(n.genre)) {
    const texte = P.texteFeuille(n);
    return [texte, ...codes.filter((c) => c !== texte)].join(" ");
  }
  // Pour un test, le seul code de son symbole (« A », « DP ») : sa légende
  // fixe (« L'un au moins des actes du RSS ») ferait remonter tous les
  // tests du même symbole à chaque mot courant.
  const morceaux = [n.genre === "test" ? P.symboles[n.symbole].texte : intituleCourt(P, n), ...codes];
  for (const b of n.branches ?? []) {
    morceaux.push(b.libelle);
    for (const code of b.listes) morceaux.push(code, P.arbre.listes[code]?.libelle ?? "");
  }
  return morceaux.join(" ");
}

/** Texte ou fonction du nœud : les étapes propres à un champ décrivent
 *  leurs textes par l'un ou l'autre. */
function special(P, n, cle) {
  const valeur = P.special?.[n.genre]?.[cle];
  return typeof valeur === "function" ? valeur(n) : valeur;
}

/** Ce que teste un nœud, en quelques mots, sans ses listes. */
function intituleCourt(P, n) {
  switch (n.genre) {
    case "test":
      return `${P.symboles[n.symbole].texte} — ${P.symboles[n.symbole].titre}`;
    case "critere":
      return n.variable;
    default:
      return special(P, n, "court") ?? "";
  }
}

/** Un nœud en une ligne, pour un renvoi ou un résultat de recherche. */
function resume(P, n) {
  const b = n.branches ?? [];
  const prefixe =
    n.genre === "test" ? P.symboles[n.symbole].texte : n.genre === "critere" ? n.variable : "";
  if (n.genre === "test" || n.genre === "critere") {
    if (b.length === 1) return `${prefixe} ${b[0].libelle}`.trim();
    return `${prefixe} — ${b.length} cas`;
  }
  if (P.feuilles.has(n.genre)) return P.texteFeuille(n);
  return intituleCourt(P, n);
}

/** Les entrées du sélecteur ; des catégories consécutives de même
 *  `groupe` se rangent dans un <optgroup>. */
function optionsDuSelecteur(categories) {
  const options = [];
  let groupe = null;
  for (const c of categories) {
    const option = el("option", { value: c.id }, c.option);
    if (!c.groupe) {
      options.push(option);
      groupe = null;
      continue;
    }
    if (groupe?.label !== c.groupe) {
      groupe = el("optgroup", { label: c.groupe });
      options.push(groupe);
    }
    groupe.append(option);
  }
  return options;
}

/** « D-0103 », « d0103 », « A 180 » → le code de liste canonique, ou null. */
function codeDeListe(requete) {
  const m = requete.trim().match(/^([ad])\s*-?\s*(\d{3,4})$/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

// ==== Vue ====

/**
 * Dessine l'algorithme dans `conteneur`, placé selon l'adresse (`chemin`) ;
 * rend vrai quand la vue s'est placée d'elle-même sur une étape (lien
 * profond), et que le routeur ne doit pas la ramener en haut de page.
 *
 * Le profil apporte ce qui est propre au champ :
 * - `champ` (« mco », « smr ») : préfixe des adresses #/<champ>/arbre/… ;
 * - `arbre` : `{ noeuds, listes }` ; chaque liste citée par une branche,
 *   `{ libelle, nature, codes }` (nature « actes » ou « diagnostics »,
 *   nombre de codes) ;
 * - `categories` : les entrées du sélecteur, dans l'ordre : `{ id, option,
 *   groupe?, etiquette, titre, sousTitre (ou sousTitre(outils)), racines:
 *   [{ depart, titre?, note? }], notes?(outils), vue?(outils) }` — `vue`
 *   dessine à sa façon
 *   une catégorie qui n'est pas un arbre ; `parDefaut`, celle d'une
 *   adresse sans catégorie ; `resoudre?(chemin)` → `{ cmd, noeud, cas }` ;
 * - `entete` : ce qui précède la barre d'outils (titre, drapeau, légende) ;
 *   `selecteur` `{ id, libelle, aide }` ; `recherche` `{ id, libelle?,
 *   exemple }` ; `titrePage`, infobulle du numéro de page des étapes ;
 * - `symboles` et `variables` : légende des tests et des critères ;
 *   `special` : `{ genre: { intitule(n, outils), court } }`, les autres
 *   étapes ; `pictogramme(n)` ; `note?(n)` : précision sous une étape ;
 * - `feuilles` : les genres des feuilles ; `feuille(n, depuis, outils)`,
 *   ce qui les dessine ; `texteFeuille(n)`, leur code ou leur texte ;
 *   `codesNoeud(n)`, les codes de groupe qu'un nœud porte, pour la
 *   recherche ; `nomFeuille` [singulier, pluriel] ; `titreChemin(n)`,
 *   `origineChemin(n)` et `complementChemin?(n, outils)` : le panneau
 *   d'une feuille ;
 * - `codesDeListe(code, nature, contexte)` → promesse des lignes `{ Code,
 *   « Libellé code », _cma? }` ; `contexteDeListe?(n, branche)` ;
 *   `listeAbsente?(code)` ; `titreCma` ;
 * - `groupeDeRequete(compact)` : la requête lue comme un code de groupe, ou
 *   null ; `natureDeCode?(requete)` : « actes », « diagnostics » ou null ;
 *   `listesDuCode(requete, nature)` → promesse d'une Map code → `{ libelle,
 *   listes }` des codes qui commencent par la requête.
 */
export function dessinerArbre(conteneur, profil, chemin = []) {
  const P = profil;
  const arbre = preparer(P);
  const categories = new Map(P.categories.map((c, i) => [c.id, { ...c, ordre: i }]));
  // Ce que le profil peut appeler en retour : ses vues et ses feuilles
  // naviguent, reprennent les marques de l'arbre (« non », flèche), ouvrent
  // un chemin.
  const outils = { afficher, marqueEntree, flecheVers, basculerChemin };

  conteneur.innerHTML = "";
  const etat = { cmd: null, requete: "" };

  const selecteur = el(
    "select",
    { id: P.selecteur.id, onchange: (e) => afficher(e.target.value) },
    ...optionsDuSelecteur(P.categories)
  );
  const blocCmd = el(
    "div",
    { class: "champ" },
    el("label", { for: P.selecteur.id }, P.selecteur.libelle),
    selecteur,
    el("p", { class: "champ-aide" }, P.selecteur.aide)
  );
  const champ = champMotsClefs({
    id: P.recherche.id,
    libelle: P.recherche.libelle,
    exemple: P.recherche.exemple,
    onInput: (valeur) => chercher(valeur),
  });

  const zoneRecherche = el("div", { class: "resultats-arbre" });
  const zoneArbre = el("div", { class: "zone-arbre" });

  conteneur.append(...P.entete, el("div", { class: "barre-outils" }, blocCmd, champ), zoneRecherche, zoneArbre);

  // ---- Navigation entre catégories ----

  function afficher(cmd, { noeud, cas = null, historique = true } = {}) {
    if (!categories.has(cmd)) cmd = P.parDefaut;
    etat.cmd = cmd;
    selecteur.value = cmd;
    zoneArbre.innerHTML = "";
    zoneArbre.append(vueCategorie(categories.get(cmd)));
    // L'adresse suit la catégorie affichée, sans ajouter d'entrée
    // d'historique ni déclencher le routeur (replaceState ne lève pas
    // `hashchange`).
    if (historique && zoneArbre.isConnected) {
      const cible = `#/${P.champ}/arbre/${cmd}${noeud ? `/${noeud}` : ""}${noeud && cas != null ? `/${cas}` : ""}`;
      if (location.hash !== cible) history.replaceState(null, "", cible);
    }
    return noeud ? montrer(noeud, cas) : false;
  }

  function vueCategorie(c) {
    if (c.vue) return c.vue(outils);
    const outilsArbre = el(
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
    // Une catégorie à plusieurs racines (l'HC et l'HTP d'un GN) les
    // dessine l'une sous l'autre, chacune sous son intertitre.
    const racines =
      c.racines.length === 1 && !c.racines[0].titre
        ? [colonne(c.racines[0].depart, null)]
        : c.racines.flatMap((r) => [
            el("h3", { class: "arbre-racine" }, r.titre),
            r.note ? el("p", { class: "sous-titre" }, ...[r.note].flat()) : null,
            colonne(r.depart, null),
          ]);
    return el(
      "section",
      { class: "arbre", "aria-labelledby": "arbre-titre" },
      el("h2", { id: "arbre-titre" }, c.titre),
      el("p", { class: "sous-titre" }, ...[typeof c.sousTitre === "function" ? c.sousTitre(outils) : c.sousTitre].flat()),
      outilsArbre,
      ...racines,
      ...(c.notes?.(outils) ?? [])
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
      if (P.feuilles.has(n.genre)) {
        ol.append(el("li", { class: "fin" }, marqueEntree(arrivee), P.feuille(n, lien.depuis, outils)));
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
   *  d'une étape sans condition, ou la seule issue d'un test qui n'a pas
   *  de cas « non » (la racine « DP de la CMD »). */
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
      P.pictogramme(n),
      el("span", { class: "etape-intitule" }, ...intitule(n)),
      n.page != null ? el("span", { class: "etape-page", title: P.titrePage }, `p. ${n.page}`) : null
    );
    li.append(tete);
    const note = P.note?.(n);
    if (note) li.append(el("p", { class: "etape-note" }, ...note));
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
        if (unCas) return libelleAvecListes(b[0].libelle || P.symboles[n.symbole].titre);
        return [el("strong", {}, P.symboles[n.symbole].texte), ` — ${P.symboles[n.symbole].titre}`];
      case "critere": {
        const variable = el(
          "strong",
          { title: P.variables[n.variable] ?? n.variable },
          n.variable
        );
        return unCas ? [variable, " ", ...libelleAvecListes(b[0].libelle)] : [variable];
      }
      default:
        return P.special?.[n.genre]?.intitule(n, outils) ?? [];
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
    } else if (P.feuilles.has(cible.genre)) {
      condition.append(flecheVers(), P.feuille(cible, depuis, outils));
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
      el("span", {}, resume(P, n)),
      n.page != null ? el("span", { class: "etape-page" }, `p. ${n.page}`) : null
    );
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
    // Un code de liste cliqué dans le chemin d'une feuille ouvre sa liste
    // dans ce panneau-là, qui l'emporte en se refermant.
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

  /** Le test d'où la liste est ouverte, et ce que le profil en tire (MCO :
   *  les exclusions de CMA à cette étape). */
  function contexteDeListe(bouton, code) {
    const n = arbre.noeuds[bouton.closest("[data-noeud]")?.dataset.noeud];
    const b = n?.branches?.find((x) => x.listes.includes(code));
    if (!b || !P.contexteDeListe) return null;
    return P.contexteDeListe(n, b);
  }

  function basculerListe(bouton, code) {
    const contexte = contexteDeListe(bouton, code);
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
            P.listeAbsente?.(code) ?? "Cette liste ne figure pas parmi les listes publiées de la fonction groupage."
          )
        );
        return panneau;
      }
      P.codesDeListe(code, nature, contexte)
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
    // Colonne CMA quand le profil en donne une (MCO : liste de diagnostics).
    const avecCma = lignes.length > 0 && "_cma" in lignes[0];
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
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", { scope: "col" }, "Code"),
              el("th", { scope: "col" }, "Libellé"),
              avecCma ? el("th", { scope: "col", title: P.titreCma }, "CMA") : null
            )
          ),
          el(
            "tbody",
            {},
            ...lignes.map((l) =>
              el(
                "tr",
                {},
                el("td", { class: "code" }, el("a", { href: `#/${P.champ}/fiche/${l.Code.split("-")[0]}`, title: "Fiche du code" }, l.Code)),
                el("td", {}, l["Libellé code"]),
                avecCma
                  ? el(
                      "td",
                      { class: `code cma-${l._cma?.statut ?? "aucune"}`, title: l._cma?.detail ?? "Pas une CMA" },
                      l._cma ? `${l._cma.niveau}${l._cma.statut === "exclue" ? " · exclue" : l._cma.statut === "partielle" ? " · en partie" : ""}` : "—"
                    )
                  : null
              )
            )
          )
        )
      )
    );
  }

  function basculerChemin(bouton, n, depuis) {
    basculerPanneau(bouton, (fermer) => {
      const etapes = cheminVers(depuis);
      const ol = el("ol", { class: "chemin" });
      for (const e of etapes) {
        const noeud = arbre.noeuds[e.de];
        ol.append(
          el(
            "li",
            { "data-noeud": e.de },
            P.pictogramme(noeud),
            el("span", { class: "chemin-libelle" }, ...libelleEtape(noeud, e)),
            el("span", { class: `issue ${e.role === "non" ? "non" : "oui"}` }, issue(e))
          )
        );
      }
      return el(
        "div",
        { class: "panneau panneau-chemin" },
        entetePanneau(P.titreChemin(n), fermer),
        el("p", { class: "compteur" }, P.origineChemin(n)),
        ol,
        ...(P.complementChemin?.(n, outils) ?? [])
      );
    });
  }

  /** Les étapes qui mènent au trait `depuis`, de la racine de la catégorie
   *  vers la feuille. On remonte par le trait qui porte chaque étape
   *  (jamais par un renvoi « rejoint »), si bien que le chemin est celui du
   *  dessin. */
  function cheminVers(depuis) {
    // Une feuille en tête de colonne (un GN du SMR que rien ne subdivise en
    // HTP) : aucun test n'y mène.
    if (!depuis) return [];
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
      return [...prefixe, ...libelleAvecListes(b[e.i].libelle || P.symboles[n.symbole]?.titre || "")];
    }
    if (e.role === "non" && b.length === 1) {
      const prefixe = n.genre === "critere" ? [el("strong", {}, n.variable), " "] : [];
      return [...prefixe, ...libelleAvecListes(b[0].libelle || P.symboles[n.symbole]?.titre || "")];
    }
    if (e.role === "non") {
      return [`${resume(P, n)} : aucun des cas (${b.map((x) => x.listes.join(", ") || x.libelle).join(" ; ")})`];
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

    // Un code de la nomenclature : on cherche aussi les listes qui le
    // contiennent, ce qui demande les listes complètes (chargées à la
    // première demande).
    const nature = P.natureDeCode?.(requete);
    if (!nature) return;
    blocCodes.append(el("p", { class: "compteur", role: "status" }, "Recherche du code dans les listes…"));
    try {
      const parCode = await P.listesDuCode(requete, nature);
      if (monJeton !== jeton) return;
      blocCodes.innerHTML = "";
      if (!parCode.size) {
        // « a180 » est la liste A-180 comme le code A18.0 : l'absence de
        // code ne s'annonce que si rien d'autre n'a répondu.
        if (!trouves.length) {
          blocCodes.append(
            el(
              "p",
              { class: "message-info", role: "status" },
              `Aucune étape ni aucun ${P.nomFeuille[0]}, et aucune liste de la fonction groupage ne contient de code commençant par « ${requete} ».`
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
    // Un code de groupe, entier ou en partie (« 01M », « 01M24 »,
    // « 0147SC ») : comparé aux codes que porte chaque nœud, si bien que
    // « 25M02C » ne rend que la case C.
    const groupe = P.groupeDeRequete(compact);
    // Un code de liste, avec ou sans tiret : comparé code pour code, faute
    // de quoi « D-030 » ramènerait aussi D-0301 à D-0309.
    const liste = codeDeListe(requete);
    const filtre = recherche.filtre(requete);
    const entrees = [];
    for (const n of Object.values(arbre.noeuds)) {
      const codes = P.codesNoeud(n);
      if (groupe) {
        if (codes.some((c) => recherche.normaliser(c).startsWith(groupe))) entrees.push({ n, i: null });
        continue;
      }
      if (P.feuilles.has(n.genre)) {
        // Une feuille qui porte un code ne répond qu'à son code.
        if (!codes.length && !liste && filtre({ _recherche: n._recherche })) entrees.push({ n, i: null });
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
      if (!P.natureDeCode?.(etat.requete)) {
        bloc.append(
          el("p", { class: "message-info", role: "status" }, `Aucune étape ni aucun ${P.nomFeuille[0]} pour cette recherche.`)
        );
      }
      return;
    }
    entrees.sort(
      (a, b) =>
        categories.get(a.n.cmd).ordre - categories.get(b.n.cmd).ordre ||
        (a.n.page ?? 0) - (b.n.page ?? 0) ||
        (a.i ?? -1) - (b.i ?? -1)
    );
    const affiches = entrees.slice(0, RESULTATS_MAX);
    bloc.append(
      el(
        "p",
        { class: "compteur", role: "status" },
        el("strong", {}, nombre(entrees.length)),
        ` étape${entrees.length > 1 ? "s" : ""} ou ${P.nomFeuille[entrees.length > 1 ? 1 : 0]}`,
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
              { type: "button", onclick: () => afficher(n.cmd, { noeud: n._id, cas: i }) },
              el("span", { class: "resultat-cmd" }, categories.get(n.cmd).etiquette),
              n.page != null ? el("span", { class: "etape-page" }, `p. ${n.page}`) : null,
              P.feuilles.has(n.genre) ? null : P.pictogramme(n),
              el("span", { class: "resultat-libelle" }, resumeResultat(n, i))
            )
          )
        )
      )
    );
  }

  function resumeResultat(n, i) {
    const codes = P.codesNoeud(n);
    if (P.feuilles.has(n.genre) && codes.length) {
      // Les deux dernières conditions du chemin situent la case mieux que
      // son seul code : « Épilepsie (D-0103) · Âge <18 ans ».
      const parent = (arbre._parents.get(n._id) ?? [])[0];
      const contexte = parent
        ? cheminVers(parent)
            .slice(-2)
            .map((e) => texteEtape(arbre.noeuds[e.de], e))
            .join(" · ")
        : "";
      const texte = P.texteFeuille(n);
      const autres = codes.filter((c) => c !== texte);
      return `${texte}${autres.length ? ` (${autres.join(", ")})` : ""}${contexte ? ` — ${contexte}` : ""}`;
    }
    const b = n.branches ?? [];
    if (i != null) {
      const cible = arbre.noeuds[b[i].vers];
      const prefixe = n.genre === "critere" ? `${n.variable} ` : `${P.symboles[n.symbole]?.texte ?? ""} `;
      const suite = P.feuilles.has(cible.genre) ? ` → ${P.texteFeuille(cible)}` : "";
      return `${prefixe}${b[i].libelle}${suite}`;
    }
    const cible = b.length === 1 ? arbre.noeuds[b[0].vers] : null;
    const suite = cible && P.feuilles.has(cible.genre) ? ` → ${P.texteFeuille(cible)}` : "";
    return `${resume(P, n)}${suite}`;
  }

  /** Une étape de chemin en texte : « Âge <18 ans : oui ». */
  function texteEtape(n, e) {
    const b = n.branches ?? [];
    const prefixe = n.genre === "critere" ? `${n.variable} ` : "";
    if (e.role === "oui") return `${prefixe}${b[e.i]?.libelle ?? ""}`.trim();
    if (e.role === "non") return `${prefixe}${b.length === 1 ? b[0].libelle : resume(P, n)} : non`.trim();
    return intituleCourt(P, n);
  }

  // ---- Premier affichage ----

  const demande = P.resoudre ? P.resoudre(chemin) : lireChemin(chemin);
  return afficher(demande.cmd ?? P.parDefaut, {
    noeud: demande.noeud,
    cas: demande.cas,
    historique: Boolean(demande.cmd),
  });
}

/** L'adresse `<catégorie>/<nœud>/<cas>`, telle quelle. */
function lireChemin([cmd, noeud, cas]) {
  return { cmd, noeud, cas: cas != null && /^\d+$/.test(cas) ? Number(cas) : null };
}
