// Algorithme de la fonction groupage SMR — les arbres de décision du volume
// 1 du Manuel des GME, dessinés comme ceux du volume 3 du Manuel des GHM :
// le dessin est celui de arbre_vue.js, commun avec l'algorithme MCO.
//
// Le manuel décrit l'orientation en CM (2.2.1, figure 4), les tests
// d'entrée en GN de chaque CM (2.2.2, annexe 7.2), puis, dans chaque GN, le
// type de réadaptation (3.4, figures 6 et 7, annexes 7.3 et 7.4), le niveau
// de lourdeur (4.2, figure 8, annexe 7.5) et le niveau de sévérité (5.2.3,
// figure 9). Les règles qui en font des nœuds sont dans smr_arbre.js, sans
// DOM, avec le profil que lit arbre_graphe.js (légendes, feuilles, codes,
// adresses, chemins) ; ce module les dessine.
//
// Adresses : #/smr/arbre/orientation, #/smr/arbre/<CM> et
// #/smr/arbre/<GN>, suivies d'un nœud le cas échéant ; #/smr/arbre/<GR, GL
// ou GME> ouvre l'arbre du GN sur ce groupe (liens des autres thèmes).

import { el, fraicheur, nombre } from "../../interface.js";
import { dessinerArbre } from "../../arbre_vue.js";
import { chargerClassification, chargerDiagnostics, chargerTarifsSmr, libelleGroupe, TYPES_READAPTATION } from "../../smr.js";
import {
  CM_ERREURS,
  codesDeListe,
  CONDITIONS,
  construire,
  enumeration,
  listesDuCode,
  ORIENTATION,
  origineChemin,
  PAGE_ORIENTATION,
  particularitesGn,
  profilArbre,
  rangsDuGn,
  resoudre,
  SPECIAL,
  SYMBOLES,
  VARIABLES,
} from "../../smr_arbre.js";
import { lienCode, lienErreurs, lienGroupage, lienTarifs, noteTarifsSmr, sourceFg, tableTarifsGme } from "../../smr_interface.js";

// ==== Textes ====

/** « page 52 », « pages 50 à 52 ». */
function pages(numeros) {
  const [premiere, derniere] = [Math.min(...numeros), Math.max(...numeros)];
  return premiere === derniere ? `page ${premiere}` : `pages ${premiere} à ${derniere}`;
}

// ==== Pictogrammes ====

function pictogramme(n) {
  if (n.genre === "test") {
    const s = SYMBOLES[n.symbole];
    return el(
      "span",
      {
        class: ["picto", "cercle", s.variante].filter(Boolean).join(" "),
        role: "img",
        "aria-label": `${s.texte} : ${s.titre}`,
        title: s.titre,
      },
      el("span", { "aria-hidden": "true" }, ...(s.lignes ? [s.lignes[0], el("br"), s.lignes[1]] : [s.texte]))
    );
  }
  if (n.genre === "critere") {
    return el("span", {
      class: "picto losange",
      role: "img",
      "aria-label": "Test sur une variable du séjour",
      title: `Test sur une variable du séjour : ${VARIABLES[n.variable] ?? n.variable}`,
    });
  }
  if (n.genre === "gr") {
    return el(
      "span",
      {
        class: "picto boite",
        role: "img",
        "aria-label": "Groupe de réadaptation",
        title: "Groupe de réadaptation (GR) : la suite de l'arbre en détermine le niveau de lourdeur",
      },
      el("span", { "aria-hidden": "true" }, "GR")
    );
  }
  return null;
}

// ==== Légende ====

function legende() {
  const ligne = (picto, texte) => el("li", {}, picto, el("span", {}, texte));
  const cercle = (symbole) => pictogramme({ genre: "test", symbole });
  const groupe = (racine, cases, classe = "ghm") =>
    el(
      "span",
      { class: classe },
      el("span", { class: "ghm-racine" }, racine),
      cases ? el("span", { class: "ghm-cases" }, el("span", {}, cases[0]), el("span", {}, cases[1])) : null
    );
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
        el("p", { class: "legende-titre" }, "Tests d'entrée en GN, sur les diagnostics du RHS"),
        el(
          "ul",
          {},
          ...["MMP", "AE", "MMPAE", "DAS"].map((s) => ligne(cercle(s), `${SYMBOLES[s].titre} appartient à la liste nommée.`))
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
            pictogramme({ genre: "critere", variable: "Âge" }),
            "Variable du séjour ou du RHS : âge, scores de réadaptation, caractéristiques du patient qui font le niveau de lourdeur (âge, dépendances physique et cognitive, statut post-chirurgical)."
          ),
          ligne(pictogramme({ genre: "gr" }), "Groupe de réadaptation (GR) retenu ; la suite de l'arbre en détermine le niveau de lourdeur.")
        ),
        el("p", { class: "legende-titre" }, "Groupes"),
        el(
          "ul",
          {},
          ligne(groupe("0147"), "Groupe nosologique (GN) : un clic donne le chemin qui y mène et ouvre son arbre."),
          ligne(
            groupe("0147SC", ["2", "1"]),
            "Groupe de lourdeur (GL). En bas, le niveau de sévérité 1 (0 en HTP) ; en haut, le niveau 2 quand il existe. Le GME est le GL suivi de son niveau de sévérité."
          ),
          ligne(groupe("Erreur 301", null, "ghm erreur"), "RHS non groupé : code erreur de la fonction groupage.")
        )
      )
    )
  );
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  // Les tarifs ne servent qu'à l'ouverture d'une case de GL : l'arbre
  // s'affiche sans les attendre, et leur absence ne coûte que leur bloc.
  // diagnostics.json (4 Mo) n'est chargé qu'à la première liste ouverte ou
  // au premier code cherché.
  const promesseTarifs = chargerTarifsSmr().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const k = await chargerClassification();
  const { cms, gnsParCm, departs } = construire(k);

  // Le drapeau porte les fichiers de l'ATIH d'où viennent les arbres ; il
  // prend la date des tarifs quand ils arrivent.
  const jeux = [
    ["TOTAL_listes_groupes.xlsx", "libellés des groupes"],
    ["GN_liste_tests.xlsx", "tests d'entrée dans les GN"],
    ["GR_infos.xlsx", "types de réadaptation et seuils"],
    ["GL_infos.xlsx", "règles de lourdeur"],
  ]
    .map(([fichier, libelle]) => ({ libelle, millesime: k.millesimes?.[fichier] }))
    .filter((j) => j.millesime);
  let drapeau = fraicheur(jeux);
  promesseTarifs.then((tarifs) => {
    if (!tarifs || !drapeau.isConnected) return;
    const complet = fraicheur([...jeux, { libelle: tarifs.libelle, millesime: tarifs.millesime }]);
    drapeau.replaceWith(complet);
    drapeau = complet;
  });

  const note = (...enfants) => el("p", { class: "note" }, ...enfants);

  // ---- Feuilles ----

  function titreFeuille(n) {
    if (n.genre === "erreur") return `${n.etiquette} : ${n.titre}`;
    return `${n.code} ${libelleGroupe(k, n.code)}${n.genre === "gl" ? `\n${n.gmes.join(", ")}` : ""}`;
  }

  /** Un GN (tests d'une CM), un GL et ses niveaux de sévérité (arbre d'un
   *  GN), un code erreur, ou les CM où mène l'orientation. */
  function feuille(n, depuis, { afficher, basculerChemin }) {
    if (n.genre === "renvoi") {
      return el("span", { class: "renvoi", "data-feuille": n._id, tabindex: "-1" }, n.texte);
    }
    if (n.genre === "grille") {
      return el(
        "span",
        { class: "grille-cmd", "data-feuille": n._id, tabindex: "-1", role: "group", "aria-label": n.texte },
        ...cms.map((cm) =>
          el(
            "button",
            { type: "button", class: "renvoi-cmd", title: libelleGroupe(k, cm), onclick: () => afficher(cm) },
            `CM ${cm}`
          )
        )
      );
    }
    const bouton = el(
      "button",
      {
        type: "button",
        class: n.genre === "erreur" ? "ghm erreur" : "ghm",
        title: titreFeuille(n),
        "aria-expanded": "false",
        "data-feuille": n._id,
        onclick: () => basculerChemin(bouton, n, depuis),
      },
      el("span", { class: "ghm-racine" }, n.etiquette ?? n.code)
    );
    if (n.genre === "gl") {
      // En bas, la sévérité 1 (0 en HTP) ; en haut, la 2 quand elle existe.
      const niveaux = new Set(n.gmes.map((g) => g.at(-1)));
      bouton.append(
        el(
          "span",
          { class: "ghm-cases", "aria-hidden": "true" },
          el("span", {}, niveaux.has("2") ? "2" : ""),
          el("span", {}, niveaux.has("1") ? "1" : niveaux.has("0") ? "0" : "")
        ),
        el("span", { class: "visuellement-cache" }, ` : GME ${n.gmes.join(", ")}`)
      );
    }
    return bouton;
  }

  function titreChemin(n) {
    if (n.genre === "erreur") return [el("strong", {}, n.etiquette), ` — ${n.titre}`];
    const titre = [el("strong", {}, n.code), ` ${libelleGroupe(k, n.code)}`];
    if (n.genre === "gl") titre.push(` — GME ${n.gmes.join(", ")}`);
    return titre;
  }

  function complementChemin(n, { afficher }) {
    if (n.genre === "gn") {
      return [
        el(
          "p",
          { class: "compteur" },
          el(
            "button",
            { type: "button", class: "renvoi-cmd", onclick: () => afficher(n.code) },
            `Arbre du GN ${n.code} : type de réadaptation, lourdeur et sévérité`
          )
        ),
      ];
    }
    if (n.genre === "erreur") {
      return n.erreur == null
        ? []
        : [
            el(
              "p",
              { class: "compteur" },
              el("a", { class: "lien-texte", href: lienErreurs(n.erreur) }, `L'erreur ${n.erreur} dans les erreurs de la fonction groupage`)
            ),
          ];
    }
    if (n.genre !== "gl") return [];
    // Les GMT des GME de la case, remplis dès que les tarifs sont là.
    const zone = el("div", {}, el("p", { class: "compteur" }, "Chargement des tarifs…"));
    promesseTarifs.then((tarifs) => {
      zone.replaceChildren(
        ...(tarifs
          ? [el("p", { class: "compteur" }, "Tarifs des GME :"), tableTarifsGme(tarifs, n.gmes), noteTarifsSmr(lienTarifs(n.cmd))]
          : [el("p", { class: "message-avertissement" }, "Tarifs des GME indisponibles pour le moment.")])
      );
    });
    return [zone];
  }

  // ---- Catégories ----

  const noteOrientation = () =>
    note(
      `Un code oriente dans une CM quand il appartient à une liste d'entrée dans une CM : CIM_infos_SMR lui en donne une, autre que la ${CM_ERREURS}. ` +
        "La liste des codes orientant en deuxième intention, des symptômes pour la plupart, est dans le même fichier ; " +
        "la deuxième intention n'existe que pour la MMP. Exemple du manuel : dyspnée (",
      lienCode("R06.0"),
      ") en MMP, code orientant en deuxième intention, et insuffisance cardiaque (",
      lienCode("I50.9"),
      ") en AE : le RHS va dans la CM 05."
    );

  const noteCm = () =>
    note(
      "Un test est positif quand l'un des codes aux positions qu'il nomme appartient à sa liste ; un nœud à deux tests ne l'est que si " +
        "les deux le sont. Un GN peut revenir à plusieurs rangs, avec d'autres listes ou d'autres positions. En HC, le séjour prend ensuite " +
        "le GN le plus fréquent de ses 10 premiers RHS (de tous s'il en compte moins), le premier dans l'ordre chronologique en cas " +
        "d'égalité ; en HTP, chaque RHS garde le sien (2.2.2)."
    );

  function sousTitreGn(gn, { afficher }) {
    const cm = gn.slice(0, 2);
    const rangs = rangsDuGn(k, gn);
    const pluriel = rangs.length > 1;
    return [
      `Test${pluriel ? "s" : ""} d'entrée au${pluriel ? "x" : ""} rang${pluriel ? "s" : ""} ${enumeration(rangs)} de la `,
      el("button", { type: "button", class: "renvoi-cmd", onclick: () => afficher(cm) }, `CM ${cm}`),
      `. Volume 1 : type de réadaptation, 3.4 et annexes 7.3 (page ${k.pages.grHc[gn]}) et 7.4 (page ${k.pages.grHtp[gn]}) ; ` +
        "lourdeur, 4.2 et annexe 7.5 ; sévérité, 5.2.3.",
    ];
  }

  function notesGn(gn) {
    const { adultes, seuilManquant, combinees, sansSeverite2: sans2, intensite } = particularitesGn(k, gn);
    const notes = [];
    if (adultes.length > 1) {
      const scores = [];
      if (adultes.includes("S")) {
        scores.push("score spécialisé : somme des pondérations des actes de la liste d'actes spécialisés du GN réalisés pendant le séjour");
      }
      if (adultes.includes("T")) {
        scores.push("score global : de tous les actes CSARR, codés ou transcodés du CSAR, et CCAM de réadaptation");
      }
      notes.push(
        note(
          `Scores de réadaptation en HC — ${scores.join(" ; ")}. Par jour : divisé par le nombre de jours de présence du lundi au ` +
            "vendredi, à défaut de week-end (3.3.2.1). Un test est positif quand le score par séjour et le score par jour atteignent " +
            `leur seuil (tableau 5)${seuilManquant ? " ; un seuil absent de GR_infos ne s'y oppose pas" : ""}.`
        )
      );
    }
    notes.push(
      note(
        "Lourdeur, en HC : le niveau du séjour est le plus lourd de ceux que donnent ses caractéristiques (4.2.1), d'où les tests du " +
          "niveau C, puis du niveau B. Âge au premier RHS ; dépendances physique et cognitive : le maximum des RHS du séjour ; statut " +
          "post-chirurgical : intervention datée dans le premier RHS, de 90 jours au plus — plus ancienne ou absente, le séjour n'est " +
          "pas post-chirurgical (1.2.3.5 à 1.2.3.8). Les niveaux de chaque caractéristique sont ceux de GL_infos (annexe 7.5) ; les " +
          `classes d'âge de moins de 18 ans y portent les règles pédiatriques (4.2.2.2).${
            combinees.length ? ` Règle combinant l'âge et la dépendance physique (4.2.2.1) : GR ${enumeration(combinees)}.` : ""
          }`
      )
    );
    notes.push(
      note(
        "Sévérité, en HC : le GME est le GL suivi du niveau 2 quand au moins un marqueur de sévérité est retenu — un code CIM-10 CMA " +
          "en MMP ou en DAS d'un RHS, qu'aucun des codes ayant orienté un RHS du séjour dans ce GN n'exclut, ou un acte CCAM CMA — et " +
          "que le niveau 2 existe ; du niveau 1 sinon (5.2.3). ",
        sans2 ? el("strong", {}, `Le GN ${gn} n'a pas de niveau de sévérité 2 : tout séjour d'HC y est en sévérité 1. `) : null,
        "En HTP, lourdeur A et sévérité 0, par convention (4.1, 5.1)."
      )
    );
    if (intensite) {
      notes.push(
        note(
          "Score global par jour, en HTP : somme des pondérations de tous les actes CSARR, codés ou transcodés, et CCAM de la semaine, " +
            "divisée par le nombre de jours de présence dans la semaine (3.3.2.2)."
        )
      );
    }
    return notes;
  }

  const categories = [
    {
      id: ORIENTATION,
      option: "Orientation en CM",
      etiquette: "Orientation",
      titre: "Orientation en catégorie majeure",
      sousTitre: `Volume 1, 2.2.1 et figure 4, page ${PAGE_ORIENTATION}. Les tests sont faits dans cet ordre, sur chaque RHS.`,
      racines: [{ depart: "o-mmp-2e" }],
      notes: () => [noteOrientation()],
    },
  ];
  for (const cm of cms) {
    const groupe = `CM ${cm} — ${libelleGroupe(k, cm)}`;
    const tests = k._testsParCm.get(cm);
    categories.push({
      id: cm,
      groupe,
      option: `CM ${cm} — tests d'entrée en GN`,
      etiquette: `CM ${cm}`,
      titre: groupe,
      sousTitre:
        `Volume 1, 2.2.2 et annexe 7.2, ${pages(tests.map((t) => k.pages.noeuds[`${cm}-${t.ordre}`]))}. ` +
        `${nombre(tests.length)} nœud${tests.length > 1 ? "s" : ""}, testé${tests.length > 1 ? "s" : ""} dans l'ordre sur chaque RHS ; le premier dont tous les tests sont positifs donne le GN.`,
      racines: [{ depart: `${cm}-${tests[0].ordre}` }],
      notes: () => [noteCm()],
    });
    for (const gn of gnsParCm.get(cm)) {
      categories.push({
        id: gn,
        groupe,
        option: `GN ${gn} — ${libelleGroupe(k, gn)}`,
        etiquette: `GN ${gn}`,
        titre: `GN ${gn} — ${libelleGroupe(k, gn)}`,
        sousTitre: (outils) => sousTitreGn(gn, outils),
        racines: [
          {
            titre: "Hospitalisation complète",
            note: "Le séjour, dans le GN le plus fréquent de ses 10 premiers RHS (2.2.2). Type de réadaptation : figure 6 ; lourdeur : figure 8 ; sévérité : figure 9.",
            depart: departs.get(gn).hc,
          },
          {
            titre: "Hospitalisation à temps partiel",
            note: "Chaque RHS, groupé sans égard aux autres RHS de la suite (2.2.2). Type de réadaptation : figure 7 ; lourdeur A et sévérité 0, par convention.",
            depart: departs.get(gn).htp,
          },
        ],
        notes: () => notesGn(gn),
      });
    }
  }
  return dessinerArbre(
    conteneur,
    {
      // Arbre, légendes, feuilles, codes et lecture d'une requête : le
      // profil sans DOM de smr_arbre.js.
      ...profilArbre(k),
      champ: "smr",
      parDefaut: ORIENTATION,
      categories,
      resoudre: (adresse) => resoudre(k, adresse),
      entete: [
        el("h1", {}, "Algorithme de la fonction groupage"),
        sourceFg(),
        drapeau,
        el(
          "p",
          {},
          "Les arbres de décision de la classification en GME, tels que les décrit le volume 1 du ",
          el("strong", {}, "Manuel des GME 2026"),
          " (ATIH, version provisoire) : orientation en CM, tests d'entrée en GN de chaque CM, puis, pour chaque GN, type de réadaptation, niveau de lourdeur et niveau de sévérité. Chaque test s'enchaîne sous le précédent quand sa condition n'est pas satisfaite, et ouvre en retrait ce qui suit quand elle l'est. Un clic sur un code de liste en montre les codes ; un clic sur un GN donne le chemin qui y mène et ouvre son arbre ; un clic sur une case de GL donne le chemin qui y mène et les tarifs de ses GME."
        ),
        legende(),
      ],
      selecteur: {
        id: "smr_arbre_cm",
        libelle: "Catégorie majeure ou GN :",
        aide: "Dans l'ordre du manuel : l'orientation d'abord, puis chaque CM et ses GN.",
      },
      recherche: { id: "smr_arbre_recherche", exemple: "ex. : 0147SC, D-0112, I63.4, hémiplégies" },
      titrePage: "Page du volume 1 du Manuel des GME",
      special: {
        gr: {
          ...SPECIAL.gr,
          intitule: (n) => [
            el("strong", {}, n.code),
            ` ${TYPES_READAPTATION[n.code[4]]}`,
            n.unique ? el("span", { class: "etape-precision" }, " — GN non subdivisé sur la réadaptation (3.4.1.2)") : null,
          ],
        },
      },
      note: (n) => {
        if (n.ecart) {
          return [
            `Écart entre les sources de l'ATIH : l'annexe 7.2 du manuel (page ${n.page}) écrit ce nœud « ${n.ecart.annexe} », ` +
              `GN_liste_tests.xlsx, que suit l'arbre, « ${n.ecart.fichier} ».`,
          ];
        }
        if (n.conditions?.length) {
          return [`Conditions supplémentaires : ${n.conditions.map((c) => CONDITIONS[c]).filter(Boolean).join(" ; ")}.`];
        }
        if (n.listeSpe) {
          const fiche = k.listesSpe?.[n.listeSpe];
          return [
            "Actes de la liste d'actes spécialisés du GN : ",
            el("a", { class: "code", href: lienGroupage(n.listeSpe), title: "Actes de la liste" }, n.listeSpe),
            fiche?.libelle ? ` (« ${fiche.libelle} »)` : "",
            ".",
          ];
        }
        return null;
      },
      pictogramme,
      feuille,
      nomFeuille: ["groupe", "groupes"],
      titreChemin,
      origineChemin: (n) => origineChemin(k, n),
      complementChemin,
      codesDeListe: async (code) => codesDeListe(await chargerDiagnostics(), code),
      listesDuCode: async (requete) => listesDuCode(await chargerDiagnostics(), requete),
    },
    chemin
  );
}
