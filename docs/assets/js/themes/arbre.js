// Algorithme de la fonction groupage MCO — les arbres de décision du volume
// 3 du Manuel des GHM, CMD par CMD, relus dans le PDF de l'ATIH par
// scripts/build_arbre.py.
//
// Le dessin (colonnes, étapes, renvois, panneaux, recherche) est celui de
// arbre_vue.js, commun avec l'algorithme SMR ; ce thème y apporte ce qui
// est propre au MCO : symboles du volume 3, orientation vers les CM et CMD,
// cases de GHM, exclusions des CMA dans les listes, tarifs des GHS.

import { chargerJson, chargerJeu } from "../donnees.js";
import { el, fraicheur } from "../interface.js";
import { dessinerArbre } from "../arbre_vue.js";
import { codesGhm, couvre, couvreRacine, racinesAtteintes } from "../groupage_mco.js";
import { chargerTarifs, noteTarifs, parGhm, tableTarifs } from "../tarifs.js";

const ORIENTATION = "orientation";

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

function titreCmd(c) {
  const prefixe = ["15", "27"].includes(c.cmd) ? "CM" : "CMD";
  return `${prefixe} ${c.cmd}`;
}

function pages(c) {
  const [premiere, derniere] = [c.pages[0], c.pages[c.pages.length - 1]];
  return premiere === derniere ? `page ${premiere}` : `pages ${premiere} à ${derniere}`;
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
  // Les tarifs ne servent qu'à l'ouverture d'une case de GHM : l'arbre
  // s'affiche sans les attendre. Libellés et tarifs sont des compléments,
  // leur absence n'empêche pas de lire l'arbre.
  const promesseTarifs = chargerTarifs().catch(() => null);
  const [arbre, racines] = await Promise.all([
    chargerJson("groupage", "arbre"),
    chargerJeu("groupage", "racines", "libellés des racines de GHM").catch(() => null),
  ]);
  const cmds = new Map(arbre.cmd.map((c) => [c.cmd, c]));
  // Libellé de chaque racine, pour l'infobulle des cases de GHM et le titre
  // du chemin qui y mène.
  const libelles = new Map((racines?.lignes ?? []).map((l) => [l.ListeRacineGHM, l["Libellé liste"]]));

  // Le drapeau prend la date des tarifs quand ils arrivent.
  const jeuArbre = { libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime };
  let drapeau = fraicheur([jeuArbre]);
  promesseTarifs.then((tarifs) => {
    if (!tarifs || !drapeau.isConnected) return;
    const complet = fraicheur([jeuArbre, { libelle: tarifs.libelle, millesime: tarifs.millesime }]);
    drapeau.replaceWith(complet);
    drapeau = complet;
  });

  function vueOrientation({ afficher, marqueEntree, flecheVers }) {
    const ol = el("ol", { class: "colonne" });
    arbre.orientation.forEach((etape, i) => {
      const cible = etape.cmd ? cmds.get(etape.cmd) : null;
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
            { type: "button", class: "renvoi-cmd", onclick: () => afficher(cible.cmd) },
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
                  { type: "button", class: "renvoi-cmd", title: c.titre, onclick: () => afficher(c.cmd) },
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

  /** Une case de GHM, un groupe d'erreur ou un renvoi vers d'autres CMD.
   *  `depuis` dit par quel trait on y arrive, pour en donner le chemin. */
  function feuille(n, depuis, { basculerChemin }) {
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
        : `${libelles.get(n.racine) ? `${n.racine} ${libelles.get(n.racine)}\n` : ""}${codes.join(", ")}${n.couleur ? ` — ${COULEURS[n.couleur]}` : ""}`;
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

  function titreChemin(n) {
    const titre = [el("strong", {}, n.racine)];
    if (libelles.get(n.racine)) titre.push(` ${libelles.get(n.racine)}`);
    if (n.genre === "ghm") {
      titre.push(` — GHM ${codesGhm(n).join(", ")}`);
      if (n.couleur) titre.push(` ; ${COULEURS[n.couleur]}`);
    } else {
      titre.push(" — groupe comportant au moins une erreur ou inclassable");
    }
    return titre;
  }

  /** Les GHS des GHM de la case — de la case seulement : une racine coupée
   *  en plusieurs cases (25M02 en A, B, C…) n'y montre que les siens.
   *  Rempli dès que les tarifs sont là. */
  function blocTarifs(n) {
    if (n.genre !== "ghm") return [];
    const codes = codesGhm(n);
    const zone = el("div", {}, el("p", { class: "compteur" }, "Chargement des tarifs…"));
    promesseTarifs.then((tarifs) => {
      zone.innerHTML = "";
      if (!tarifs) {
        zone.append(el("p", { class: "message-avertissement" }, "Tarifs des GHS indisponibles pour le moment."));
        return;
      }
      // Le lien vers le thème ne mènerait nulle part pour une racine que
      // l'arrêté ne tarife pas (14Z08, 15Z10, 23Z03).
      const tarifee = codes.some((g) => parGhm(tarifs).has(g));
      zone.append(
        el("p", { class: "compteur" }, "Tarifs des GHS :"),
        tableTarifs(tarifs, codes),
        noteTarifs(tarifee ? `#/mco/tarifs/${n.racine}` : null)
      );
    });
    return [zone];
  }

  /** Le test d'où la liste est ouverte, et ce qu'il en découle pour les
   *  exclusions de CMA : les racines que sa branche peut atteindre, et, si
   *  c'est un test sur le DP, les DP possibles (les codes de la liste). */
  function contexteDeListe(n, b) {
    if (!arbre._memoRacines) arbre._memoRacines = new Map();
    const racines = [...racinesAtteintes(arbre, b.vers, arbre._memoRacines)].filter((r) => /^\d{2}[CKMZ]\d{2}$/.test(r));
    return { racines, dp: n.genre === "test" && n.symbole === "DP" };
  }

  return dessinerArbre(
    conteneur,
    {
      champ: "mco",
      arbre,
      parDefaut: ORIENTATION,
      categories: [
        { id: ORIENTATION, option: "Orientation vers les CM et CMD", vue: vueOrientation },
        ...arbre.cmd.map((c) => ({
          id: c.cmd,
          option: `${titreCmd(c)} — ${c.titre}`,
          etiquette: titreCmd(c),
          titre: `${titreCmd(c)} — ${c.titre}`,
          sousTitre: `Volume 3, ${pages(c)}.`,
          racines: [{ depart: c.racine }],
        })),
      ],
      entete: [
        el("h1", {}, "Algorithme de la fonction groupage"),
        drapeau,
        el(
          "p",
          {},
          "Les arbres de décision de la classification en GHM, tels que les dessine le volume 3 du ",
          el("strong", {}, arbre.version ?? "Manuel des GHM"),
          " (ATIH), transcrits page à page. Chaque test s'enchaîne sous le précédent quand sa condition n'est pas satisfaite, et ouvre en retrait ce qui suit quand elle l'est. Un clic sur un code de liste en montre les codes ; un clic sur une case de GHM donne le chemin qui y mène et les tarifs de ses GHS."
        ),
        legende(),
      ],
      selecteur: {
        id: "arbre_cmd",
        libelle: "Catégorie majeure :",
        aide: "Dans l'ordre du manuel : l'orientation d'abord, puis les CM et CMD que la fonction groupage teste avant les autres.",
      },
      recherche: { id: "arbre_recherche", exemple: "ex. : 01M24, D-0103, G40.9, épilepsie" },
      titrePage: "Page du volume 3 du Manuel des GHM",
      symboles: SYMBOLES,
      variables: VARIABLES,
      special: {
        sans_relation: {
          court: "Actes sans relation avec le diagnostic principal",
          intitule: () => [
            "Actes sans relation avec le diagnostic principal",
            el("span", { class: "etape-precision" }, " — tests spéciaux, volume 3 page 8"),
          ],
        },
        gnn: {
          court: "Détermination du groupe du nouveau-né",
          intitule: () => ["Détermination du groupe du nouveau-né (GNN)"],
        },
        inversion: {
          court: "Inversion DP/DR",
          intitule: () => ["Inversion du DP et du DR, s'il y a lieu"],
        },
      },
      pictogramme,
      feuilles: new Set(["ghm", "erreur", "renvoi"]),
      feuille,
      texteFeuille: (n) => n.racine ?? n.texte,
      codesNoeud: (n) => (n.genre === "ghm" ? codesGhm(n) : n.genre === "erreur" ? [n.racine] : []),
      nomFeuille: ["GHM", "GHM"],
      titreChemin,
      origineChemin: (n) => `Chemin depuis la racine de la ${titreCmd(cmds.get(n.cmd))} :`,
      complementChemin: blocTarifs,
      codesDeListe,
      contexteDeListe,
      listeAbsente: (code) =>
        code === "A-001"
          ? "A-001 désigne l'ensemble des actes classants opératoires : elle ne figure pas parmi les listes publiées de la fonction groupage."
          : undefined,
      titreCma:
        "Niveau de CMA en diagnostic associé, et ses exclusions à cette étape : par les racines que la branche peut atteindre et, pour un test sur le DP, par les DP de la liste",
      groupeDeRequete: (compact) => (RE_REQUETE_GHM.test(compact) ? compact : null),
      natureDeCode,
      listesDuCode,
    },
    chemin
  );
}

/** Les listes de la fonction groupage qui contiennent les codes commençant
 *  par la requête (un code CIM-10 ou CCAM, entier ou en partie). */
async function listesDuCode(requete, nature) {
  const { lignes } = await chargerJeu(
    "groupage",
    nature,
    nature === "actes" ? "listes d'actes de la fonction groupage" : "listes de diagnostics de la fonction groupage"
  );
  const cle = cleDeCode(requete);
  const parCode = new Map();
  for (const l of lignes) {
    if (!cleDeCode(l.Code).startsWith(cle)) continue;
    if (!parCode.has(l.Code)) parCode.set(l.Code, { libelle: l["Libellé code"], listes: new Set() });
    parCode.get(l.Code).listes.add(l.Liste);
  }
  return parCode;
}

/** Les codes d'une liste, sans doublon : une même liste apparaît sous
 *  plusieurs CMD dans les listes publiées, avec le même contenu. */
async function codesDeListe(code, nature, contexte) {
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
  if (nature !== "diagnostics") return resultat;
  // Le niveau de CMA de chaque diagnostic et ses exclusions à cette étape
  // (volume 1, annexes 4 et 5), chargés à la première liste ouverte.
  let exclusions;
  try {
    exclusions = await chargerJson("groupage", "cma_exclusions");
  } catch (erreur) {
    console.error(erreur);
    return resultat;
  }
  if (!exclusions.parCode) exclusions.parCode = new Map(exclusions.cma.map((c) => [c[0], c]));
  const dps = contexte?.dp ? resultat.map((r) => r.Code) : [];
  const racines = contexte?.racines ?? [];
  for (const r of resultat) r._cma = statutCma(exclusions, r.Code, dps, racines);
  return resultat;
}

/** Niveau d'une CMA et ce qu'en retiennent les exclusions : `exclue` si
 *  toutes les racines atteignables, ou tous les DP possibles, l'excluent ;
 *  `partielle` si certains seulement ; `retenue` sinon. */
function statutCma(exclusions, code, dps, racines) {
  const fiche = exclusions.parCode.get(code);
  if (!fiche) return null;
  const [, niveau, listeDp, listeRacine] = fiche;
  const parRacine =
    listeRacine == null ? [] : racines.filter((r) => exclusions.racines[listeRacine].some((e) => couvreRacine(e, r)));
  const parDp = listeDp == null ? [] : dps.filter((d) => exclusions.dp[listeDp].some((e) => couvre(e, d)));
  const toutes = (parRacine.length && parRacine.length === racines.length) || (parDp.length && parDp.length === dps.length);
  const statut = toutes ? "exclue" : parRacine.length || parDp.length ? "partielle" : "retenue";
  const details = [`CMA de niveau ${niveau}`];
  if (parRacine.length) details.push(`exclue dans ${parRacine.length === racines.length ? "toutes les racines atteignables" : parRacine.join(", ")}`);
  if (parDp.length) details.push(`exclue avec ${parDp.length === dps.length ? "tous les" : `${parDp.length} des ${dps.length}`} DP de cette liste`);
  if (statut === "retenue") details.push(racines.length || dps.length ? "retenue à cette étape" : "exclusions non évaluées ici");
  return { niveau, statut, detail: details.join(" ; ") };
}

/** Une racine de GHM ou un code de GHM, entier ou en partie. */
const RE_REQUETE_GHM = /^\d{2}[ckmz]\d{0,2}[a-z0-9]?$/;

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
