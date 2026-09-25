// Algorithme de la fonction groupage SMR — le volume 1 du Manuel des GME, de
// la catégorie majeure (CM) au groupe médico-économique (GME). Présenté en
// tableaux plutôt qu'en arbre dessiné : l'ATIH livre les tests d'entrée en
// GN, les types de réadaptation et leurs seuils, les règles de lourdeur en
// tables (GN_liste_tests, GR_infos, GL_infos), que build_smr.py reprend
// telles quelles dans classification.json.
//
// Les règles qui relient ces tables ne sont pas retranscrites ici depuis le
// manuel : chaque étape affichée suit, dans le même ordre, la fonction de
// smr.js qui l'applique (orienterCm, orienterGn, grouperReadaptation,
// grouperLourdeur, grouperSeverite), pour que la page dise exactement ce que
// calcule le thème « Calcul du GME ». Une règle qui change dans smr.js
// se reporte donc ici.
//
// Adresses : #/smr/arbre (vue d'ensemble et orientation en CM),
// #/smr/arbre/<CM> (tests d'entrée en GN de la CM), #/smr/arbre/<GN> (le GN
// ouvert dans sa CM) et, depuis la recherche, #/smr/arbre/<GR|GL|GME> (le GN
// ouvert sur ce groupe). L'adresse suit la sélection sans entrée
// d'historique, comme l'algorithme MCO.

import * as recherche from "../recherche.js";
import { el, fraicheur, champMotsClefs, nombre } from "../interface.js";
import { chargerActesSpe, chargerClassification, chargerTarifsSmr, libelleGroupe, TYPES_READAPTATION } from "../smr.js";
import { groupeLibelle, lienCode, lienTarifs, noteTarifsSmr, sourceFg, tableTarifsGme } from "../smr_interface.js";

// Au-delà, la liste de résultats demande d'affiner la recherche plutôt que
// de dérouler des centaines de groupes (« 01 » en ramène plus de 400).
const RESULTATS_MAX = 40;
// CM 90 « Erreurs et recueils inclassables » : aucune liste n'y oriente,
// aucun test d'entrée en GN ; elle n'a rien à montrer dans le sélecteur.
const CM_ERREURS = "90";
const NIVEAUX = ["CM", "GN", "GR", "GL", "GME"];
// Types de réadaptation dans l'ordre où grouperReadaptation les teste :
// pédiatrique d'abord, puis du plus au moins spécialisé ou intense.
const TYPES_HC = ["P", "S", "T", "U"];
const TYPES_HTP = ["H", "I", "J", "K", "L"];
// Code de groupe saisi, entier ou en partie : « 01 », « 0147 », « 0147S »,
// « 0147SC », « 0147SC2 ». Comparé au début des codes, jamais aux libellés.
const RE_CODE_GROUPE = /^\d{2}(?:\d{2}(?:[A-Z](?:[A-Z]\d?)?)?)?$/;
// GR, GL ou GME dans l'adresse : le GN s'ouvre, placé sur ce groupe.
const RE_GROUPE_ADRESSE = /^\d{4}[A-Z](?:[A-Z]\d?)?$/;
const ANCRE = "smr-arbre-";

const POSITIONS = {
  MMP: "manifestation morbide principale",
  AE: "affection étiologique",
  DAS: "diagnostic associé significatif",
};

// Conditions du seul test écrit en toutes lettres (GN 0871, fractures
// multiples), telles que les donne GN_liste_tests.xlsx ; build_smr.py les
// réduit à ces deux mots-clefs, qu'applique evaluerNoeud (smr.js).
const CONDITIONS = {
  mmpPrioritaire: "Si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant.",
  quatreCaracteresDifferents:
    "Les 4 premiers caractères du code classant en DAS doivent être différents des 4 premiers caractères du code classant en MMP ou AE.",
};

// Score que teste chaque type d'HC (3.4.1.1) : les autres se décident sur
// l'âge (P) ou à défaut (U).
const SCORES_HC = { S: "spécialisé", T: "global" };

// ==== Index ====

/** Index construits une fois par chargement de la classification, gardés
 *  sur elle (partagée par les thèmes SMR, d'où le préfixe) : rangs de
 *  chaque GN dans les tests de sa CM, groupes fils de chaque groupe, texte
 *  de recherche des CM, GN, GR, GL et GME. */
function preparer(k) {
  if (k._arbre) return k._arbre;
  const rangs = new Map();
  for (const t of k.tests) {
    if (!rangs.has(t.gn)) rangs.set(t.gn, []);
    rangs.get(t.gn).push(t.ordre);
  }
  for (const liste of rangs.values()) liste.sort((a, b) => a - b);
  // Chaque groupe prolonge d'un caractère son parent (GR = GN + type, GL =
  // GR + lourdeur, GME = GL + sévérité), ce que build_smr.py vérifie.
  const fils = new Map();
  for (const niveau of ["GR", "GL", "GME"]) {
    for (const code of Object.keys(k.groupes[niveau]).sort()) {
      const parent = code.slice(0, -1);
      if (!fils.has(parent)) fils.set(parent, []);
      fils.get(parent).push(code);
    }
  }
  const entrees = [];
  for (const niveau of NIVEAUX) {
    for (const code of Object.keys(k.groupes[niveau]).sort()) {
      if (niveau === "CM" && code === CM_ERREURS) continue;
      const [court, long] = k.groupes[niveau][code];
      entrees.push({ niveau, code, long, _recherche: recherche.normaliser(`${code} ${court} ${long}`) });
    }
  }
  const cms = Object.keys(k.groupes.CM)
    .filter((c) => c !== CM_ERREURS)
    .sort();
  // GN dont aucun GL d'HC n'a de niveau de sévérité 2 (le 2303, soins
  // palliatifs, en 2026) : lu dans les groupes plutôt qu'écrit en dur.
  const sansSeverite2 = new Set(
    Object.keys(k.groupes.GL)
      .filter((gl) => TYPES_HC.includes(gl[4]) && !k.groupes.GME[gl + "2"])
      .map((gl) => gl.slice(0, 4))
  );
  k._arbre = { rangs, fils, entrees, cms, sansSeverite2 };
  return k._arbre;
}

/** Nombre d'actes de chaque liste d'actes spécialisés, compté une fois par
 *  jeu chargé. */
function actesParListe(jeu) {
  if (!jeu._arbreCompte) {
    const codes = new Map();
    for (const l of jeu.lignes) {
      if (!codes.has(l.Liste)) codes.set(l.Liste, new Set());
      codes.get(l.Liste).add(l.Code);
    }
    jeu._arbreCompte = new Map([...codes].map(([liste, s]) => [liste, s.size]));
  }
  return jeu._arbreCompte;
}

// ==== Petits composants ====

const code = (texte) => el("span", { class: "code" }, texte);
const note = (...enfants) => el("p", { class: "note" }, ...enfants);
const entete = (texte, titre) => el("th", { scope: "col", title: titre }, texte);
const fleche = () => el("span", { class: "fleche", "aria-hidden": "true" }, "→");

/** Tableau à la manière des autres thèmes SMR : en-têtes, puis un ou
 *  plusieurs <tbody>. */
function table(entetes, corps, classe = "") {
  return el(
    "div",
    { class: `codes-liste ${classe}`.trim() },
    el("table", {}, el("thead", {}, el("tr", {}, ...entetes)), ...corps)
  );
}

/** « 4 », « 4 et 9 », « 4, 7 et 9 ». */
function enumeration(elements) {
  if (elements.length < 2) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements.at(-1)}`;
}

/** « 0_3 » → « 0 à 3 ans », « 86_plus » → « 86 ans et plus ». */
function libelleClasseAge(classe) {
  const [min, max] = classe.split("_");
  return max === "plus" ? `${min} ans et plus` : `${min} à ${max} ans`;
}

/** Une tranche d'âge d'une règle combinée : « de 18 à 70 ans »,
 *  « jusqu'à 80 ans », « à partir de 71 ans ». */
function libelleTranche([min, max]) {
  if (max == null) return `à partir de ${min} ans`;
  if (min === 0) return `jusqu'à ${max} ans`;
  return `de ${min} à ${max} ans`;
}

/** Les positions d'un test : « MMP ou AE », chaque sigle développé en
 *  infobulle. */
function positions(test) {
  return test.positions.flatMap((p, i) => {
    const sigle = el("abbr", { title: POSITIONS[p] }, p);
    return i ? [" ou ", sigle] : [sigle];
  });
}

/** « – » d'une case sans objet, dit en toutes lettres aux lecteurs
 *  d'écran. */
function sansObjet(texte) {
  return [el("span", { "aria-hidden": "true" }, "–"), el("span", { class: "visuellement-cache" }, texte)];
}

/** Libellé de la liste d'un test : celui que porte le test dans
 *  GN_liste_tests (« MMP ou AE D-0103 - États… »), à défaut celui de la
 *  liste dans CIM_infos_SMR. */
function libelleListe(k, test) {
  const lu = test.texte.replace(/^.*?D-\d{4}\s*-?\s*/, "").trim();
  return lu || k.listes[test.liste] || "";
}

/** « réadaptation très intense » → « très intense » : dans la colonne
 *  « Type » d'un tableau de GR, le mot se répète sans rien dire, et
 *  élargit la colonne sur téléphone. */
function sansMotReadaptation(type) {
  return type.replace(/^réadaptation /, "");
}

// ==== Règles du type de réadaptation (grouperReadaptation, smr.js) ====

/** Condition d'un test sur un couple de seuils [séjour, jour] (testSeuils,
 *  smr.js) : positive quand les deux scores atteignent leur seuil ; un
 *  seuil absent de GR_infos ne s'oppose pas au test. */
function conditionSeuils(score, [sejour, jour]) {
  const parties = [];
  if (sejour != null) parties.push(`≥ ${nombre(sejour)} par séjour`);
  if (jour != null) parties.push(`≥ ${nombre(jour)} par jour`);
  const absent = sejour == null ? "par séjour" : jour == null ? "par jour" : null;
  return `Score ${score} ${parties.join(" et ")}${absent ? ` — pas de seuil ${absent} dans GR_infos, qui ne s'y oppose donc pas` : ""}`;
}

/** Les tests du type de réadaptation en HC, dans l'ordre et avec les
 *  branches de grouperReadaptation : { si, type, precision }. */
function etapesHc(e) {
  const etapes = [];
  if (e.hc.includes("P")) {
    etapes.push({ si: "Moins de 18 ans", type: "P" });
  } else {
    const type = e.hc.includes("S") ? "S" : e.hc.includes("T") ? "T" : "U";
    etapes.push({ si: "Moins de 18 ans, le GN n'ayant pas de type pédiatrique", type, precision: "sans test sur les scores (3.4.1.2)" });
  }
  const adultes = e.hc.replace("P", "");
  if (adultes.length === 1) {
    etapes.push({
      si: "18 ans et plus",
      type: adultes,
      precision: "GN non subdivisé sur la réadaptation : type unique, sans test sur les scores (3.4.1.2)",
    });
    return etapes;
  }
  if (adultes.includes("S")) etapes.push({ si: conditionSeuils("spécialisé", e.spe), type: "S" });
  if (adultes.includes("T")) etapes.push({ si: conditionSeuils("global", e.glob), type: "T" });
  etapes.push({ si: "Aucun des tests sur les scores n'est positif", type: "U" });
  return etapes;
}

/** Les tests du type de réadaptation en HTP, dans l'ordre de
 *  grouperReadaptation. */
function etapesHtp(e) {
  const etapes = [];
  if (e.htp.includes("H")) {
    etapes.push({ si: "Moins de 18 ans", type: "H" });
  } else {
    etapes.push({
      si: "Moins de 18 ans, le GN n'ayant pas de type pédiatrique",
      type: e.htp.includes("I") ? "I" : "L",
      precision: "sans test sur le score (3.4.2.2)",
    });
  }
  if (e.htp.includes("I")) {
    const [bas, haut] = e.htpSeuils;
    etapes.push({ si: `Score global par jour ≥ ${nombre(haut)} (seuil très intense)`, type: "I" });
    etapes.push({ si: `Score global par jour ≥ ${nombre(bas)} (seuil intense)`, type: "J" });
    etapes.push({ si: `Score global par jour < ${nombre(bas)}`, type: "K" });
  } else {
    etapes.push({ si: "18 ans et plus", type: "L", precision: "GN non subdivisé en intensités (3.4.2.2)" });
  }
  return etapes;
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  // Tarifs et listes d'actes spécialisés ne servent qu'au panneau d'un GN :
  // la page s'affiche sans les attendre, et leur absence ne coûte que leur
  // bloc. diagnostics.json (4 Mo) n'est pas chargé : rien ici n'en dépend.
  const promesseTarifs = chargerTarifsSmr().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const promesseActesSpe = chargerActesSpe().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const k = await chargerClassification();
  const index = preparer(k);

  conteneur.innerHTML = "";
  const etat = { cm: null, gn: null };

  // Le drapeau porte les fichiers de l'ATIH dont la page affiche les
  // tables ; il prend la date des tarifs quand ils arrivent.
  const jeux = [
    ["TOTAL_listes_groupes.xlsx", "libellés des groupes"],
    ["GN_liste_tests.xlsx", "tests d'entrée dans les GN"],
    ["GR_infos.xlsx", "types de réadaptation et seuils"],
    ["GL_infos.xlsx", "règles de lourdeur"],
    ["ACTES_listes_SPE.xlsx", "listes d'actes spécialisés"],
  ]
    .map(([fichier, libelle]) => ({ libelle, millesime: k.millesimes?.[fichier] }))
    .filter((j) => j.millesime);
  let drapeau = fraicheur(jeux);
  promesseTarifs.then((tarifs) => {
    if (!tarifs || !drapeau?.isConnected) return;
    const complet = fraicheur([...jeux, { libelle: tarifs.libelle, millesime: tarifs.millesime }]);
    drapeau.replaceWith(complet);
    drapeau = complet;
  });

  const selecteur = el(
    "select",
    { id: "smr_arbre_cm", onchange: (e) => afficherCm(e.target.value || null) },
    el("option", { value: "" }, "Vue d'ensemble et orientation en CM"),
    ...index.cms.map((cm) => el("option", { value: cm }, `CM ${cm} — ${libelleGroupe(k, cm)}`))
  );
  const blocCm = el(
    "div",
    { class: "champ" },
    el("label", { for: "smr_arbre_cm" }, "Catégorie majeure :"),
    selecteur,
    el("p", { class: "champ-aide" }, "Une CM donne ses tests d'entrée en GN, dans l'ordre où la fonction groupage les fait.")
  );
  const champ = champMotsClefs({
    id: "smr_arbre_recherche",
    libelle: "Rechercher un groupe :",
    exemple: "ex. : 0147, 0147SC2, hémiplégie",
    onInput: (valeur) => chercher(valeur),
  });

  const zoneRecherche = el("div", { class: "resultats-arbre" });
  const zoneVue = el("div", { class: "smr-arbre" });
  // Annonce, pour les lecteurs d'écran, de ce que le sélecteur ou un clic
  // vient d'afficher plus bas, sans leur faire relire toute la zone.
  const annonce = el("p", { class: "visuellement-cache", role: "status" });

  conteneur.append(
    el("h1", {}, "Algorithme de la fonction groupage"),
    sourceFg(),
    drapeau,
    el(
      "p",
      {},
      "Le groupage d'un séjour SMR tel que le décrit le volume 1 du Manuel des GME : orientation en catégorie majeure (CM), " +
        "tests d'entrée dans les groupes nosologiques (GN), type de réadaptation, niveau de lourdeur, niveau de sévérité. " +
        "Les tables sont celles des fichiers de l'ATIH ; les règles qui les relient, celles qu'applique le ",
      el("a", { class: "lien-texte", href: "#/smr/calcul" }, "calcul du GME"),
      ". Une CM donne ses tests d'entrée en GN ; un GN, ses types de réadaptation et leurs seuils, ses règles de lourdeur, " +
        "ses GME et leurs tarifs."
    ),
    el("div", { class: "barre-outils" }, blocCm, champ),
    zoneRecherche,
    zoneVue,
    annonce
  );

  // ---- Adresse ----

  /** L'adresse suit la vue, sans entrée d'historique ni passage par le
   *  routeur (replaceState ne lève pas `hashchange`) ; jamais une fois la
   *  page quittée, qu'une frappe retardée ou un chargement tardif ne
   *  réécrive pas l'adresse d'un autre thème. */
  function majAdresse(segment) {
    const cible = segment ? `#/smr/arbre/${segment}` : "#/smr/arbre";
    if (!zoneVue.isConnected || !location.hash.startsWith("#/smr/arbre")) return;
    if (location.hash !== cible) history.replaceState(null, "", cible);
  }

  function defiler(noeud, bloc, douceur) {
    const reduit = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    noeud.scrollIntoView({ block: bloc, behavior: douceur && !reduit ? "smooth" : "instant" });
  }

  // ---- Navigation ----

  /** Affiche la vue d'ensemble (cm nul) ou les tests d'une CM, et, s'il y a
   *  lieu, ouvre un GN. Rend vrai quand la vue s'est placée d'elle-même. */
  function afficherCm(cm, { gn = null, cible = null, historique = true, douceur = true } = {}) {
    if (cm && (!index.cms.includes(cm) || !k._testsParCm.has(cm))) cm = null;
    etat.cm = cm;
    etat.gn = null;
    selecteur.value = cm ?? "";
    zoneVue.replaceChildren(cm ? vueCm(cm) : vueEnsemble());
    if (gn) return ouvrirGn(gn, { cible, historique, douceur });
    if (historique) majAdresse(cm);
    annonce.textContent = cm
      ? `CM ${cm} affichée : ${nombre(k._testsParCm.get(cm).length)} tests d'entrée en GN.`
      : "Vue d'ensemble affichée.";
    return false;
  }

  /** Ouvre le panneau d'un GN sous les tests de sa CM (affichée d'abord si
   *  besoin), placé sur `cible` (GR, GL ou GME) s'il y en a une. */
  function ouvrirGn(gn, { cible = null, historique = true, douceur = true } = {}) {
    const cm = gn.slice(0, 2);
    if (etat.cm !== cm) return afficherCm(cm, { gn, cible, historique, douceur });
    etat.gn = gn;
    const zoneGn = zoneVue.querySelector(".zone-gn");
    const panneau = vueGn(gn);
    zoneGn.replaceChildren(panneau);
    marquerGn(gn);
    if (historique) majAdresse(cible ?? gn);
    annonce.textContent = `GN ${gn} ouvert : ${libelleGroupe(k, gn)}.`;
    const titre = panneau.querySelector("h2");
    const ancre = cible ? panneau.querySelector(`#${ANCRE}${cible}`) : null;
    if (ancre) {
      defiler(ancre, "center", douceur);
      ancre.classList.remove("surbrillance");
      void ancre.offsetWidth; // relance l'animation d'un groupe montré deux fois
      ancre.classList.add("surbrillance");
    } else {
      defiler(panneau, "start", douceur);
    }
    titre.focus({ preventScroll: true });
    return true;
  }

  function fermerGn() {
    const gn = etat.gn;
    etat.gn = null;
    zoneVue.querySelector(".zone-gn")?.replaceChildren();
    marquerGn(null);
    majAdresse(etat.cm);
    annonce.textContent = "GN refermé.";
    // Le focus revient au GN qui avait ouvert le panneau.
    zoneVue.querySelector(`button[data-gn="${gn}"]`)?.focus();
  }

  /** Les lignes du GN ouvert se distinguent dans le tableau des tests : un
   *  GN peut y être à plusieurs rangs. */
  function marquerGn(gn) {
    for (const bouton of zoneVue.querySelectorAll("button[data-gn]")) {
      const actif = bouton.dataset.gn === gn;
      bouton.closest("tr").classList.toggle("actif", actif);
      if (actif) bouton.setAttribute("aria-current", "true");
      else bouton.removeAttribute("aria-current");
    }
  }

  // ---- Vue d'ensemble (1.2.1, 1.2.2, 2.2.1) ----

  function vueEnsemble() {
    const n = (niveau) => nombre(Object.keys(k.groupes[niveau]).length);
    const sans2 = [...index.sansSeverite2].sort();
    // Deux colonnes seulement, le groupe et l'exemple sous le niveau, les
    // informations mobilisées sous la description : le tableau tient sur
    // un téléphone sans comprimer ses textes.
    const niveaux = [
      ["Catégorie majeure et groupe nosologique", "CM, puis GN = CM + 2 chiffres", "01, 0147", "Le système fonctionnel (CM), puis la pathologie ou la déficience principale (GN)", "MMP, AE et, plus rarement, un DAS"],
      ["Type de réadaptation", "GR = GN + type", "0147S", "La prise en charge de réadaptation dont a bénéficié le patient", "actes CSARR, codés ou transcodés du CSAR, actes CCAM de réadaptation, âge"],
      ["Niveau de lourdeur", "GL = GR + A, B ou C", "0147SC", "L'augmentation de la charge économique due aux caractéristiques du patient, hors diagnostics et actes CCAM", "âge, dépendances physique et cognitive, statut post-chirurgical"],
      ["Niveau de sévérité", "GME = GL + 1 ou 2 en HC, 0 en HTP", "0147SC2", "L'augmentation de la charge économique liée aux diagnostics et aux actes CCAM", "CMA : diagnostics en MMP ou en DAS, actes CCAM"],
    ];
    const tableNiveaux = table(
      [entete("Niveau"), entete("Ce qu'il décrit")],
      [
        el(
          "tbody",
          {},
          ...niveaux.map(([niveau, groupe, exemple, decrit, infos]) =>
            el(
              "tr",
              {},
              el("th", { scope: "row" }, niveau, el("span", { class: "sous-ligne" }, `${groupe} ; ex. `, code(exemple))),
              el("td", {}, decrit, el("span", { class: "sous-ligne" }, `Informations mobilisées : ${infos}.`))
            )
          )
        ),
      ],
      "ensemble"
    );

    const phases = [
      [
        "CM et GN",
        "Chaque RHS du séjour est groupé en CM puis en GN. Le séjour prend le GN le plus fréquent de ses 10 premiers RHS (de tous s'il en compte moins) ; en cas d'égalité, le premier dans l'ordre chronologique (2.2.2).",
        "Chaque RHS est groupé en CM puis en GN, sans égard aux autres RHS de la suite (2.2.2).",
      ],
      [
        "Type de réadaptation",
        "Pédiatrique (P), spécialisée importante (S), globale importante (T) ou autre (U), selon l'âge et les scores de réadaptation spécialisée et globale, par séjour et par jour (3.4.1).",
        "Pédiatrique (H), très intense (I), intense (J), modérée (K) ou indifférenciée (L), selon l'âge et le score global par jour de la semaine (3.4.2).",
      ],
      [
        "Niveau de lourdeur",
        "A, B ou C : le plus lourd des niveaux que donnent l'âge, les dépendances physique et cognitive et le statut post-chirurgical (4.2.1).",
        "A, par convention.",
      ],
      [
        "Niveau de sévérité",
        `2 si au moins un marqueur de sévérité est retenu et que le niveau 2 existe${sans2.length ? ` (il n'existe pas pour le GN ${enumeration(sans2)})` : ""}, 1 sinon (5.2.3).`,
        "0, par convention.",
      ],
    ];
    const tablePhases = table(
      [entete("Étape"), entete("HC : le séjour", "Hospitalisation complète"), entete("HTP : chaque RHS", "Hospitalisation à temps partiel")],
      [el("tbody", {}, ...phases.map(([etape, hc, htp]) => el("tr", {}, el("th", { scope: "row" }, etape), el("td", {}, hc), el("td", {}, htp))))],
      "ensemble"
    );

    // Les étapes d'orientation suivent orienterCm (smr.js) branche à branche.
    const oui = () => el("span", { class: "issue oui" }, "oui");
    const non = () => el("span", { class: "issue non" }, "non");
    const etapes = [
      [
        el("strong", {}, "La MMP est-elle un code orientant en deuxième intention ?"),
        " ",
        oui(),
        " l'AE est testée d'abord : si elle oriente dans une CM, le RHS va dans cette CM ; sinon, retour à la MMP (étape 2). ",
        non(),
        " étape 2.",
      ],
      [el("strong", {}, "La MMP oriente-t-elle dans une CM ?"), " ", oui(), " le RHS va dans la CM de la MMP. ", non(), " étape 3."],
      [el("strong", {}, "L'AE oriente-t-elle dans une CM ?"), " ", oui(), " le RHS va dans la CM de l'AE. ", non(), " étape 4."],
      [
        el("strong", {}, "Ni la MMP ni l'AE n'orientent dans une CM :"),
        ` le RHS va dans la CM ${CM_ERREURS} « ${libelleGroupe(k, CM_ERREURS)} » (erreur 300 « ${k._erreurs.get(300)?.libelle ?? "Aucune CM trouvée"} »).`,
      ],
    ];
    const orientation = el(
      "ol",
      { class: "chemin" },
      ...etapes.map((contenu) => el("li", {}, el("span", { class: "chemin-libelle" }, ...contenu)))
    );

    const grille = el(
      "div",
      { class: "grille-cmd" },
      ...index.cms.map((cm) =>
        el(
          "button",
          { type: "button", class: "renvoi-cmd", title: libelleGroupe(k, cm), "aria-label": `CM ${cm}, ${libelleGroupe(k, cm)}`, onclick: () => afficherCm(cm) },
          `CM ${cm}`
        )
      )
    );

    return el(
      "section",
      { "aria-labelledby": "smr-arbre-ensemble" },
      el("h2", { id: "smr-arbre-ensemble" }, "Vue d'ensemble"),
      el("p", { class: "sous-titre" }, "Volume 1, 1.2.1 et 1.2.2."),
      el(
        "p",
        {},
        `La classification a quatre niveaux ; chacun classe dans un groupe dont le code prolonge d'un caractère celui du niveau au-dessus. Elle compte ${n("GN")} GN, ${n("GR")} GR, ${n("GL")} GL et ${n("GME")} GME.`
      ),
      tableNiveaux,
      el("h3", {}, "Hospitalisation complète et à temps partiel"),
      tablePhases,
      el("h2", {}, "Orientation en catégorie majeure"),
      el("p", { class: "sous-titre" }, "Volume 1, 2.2.1 et figure 4. Les tests sont faits dans cet ordre, sur chaque RHS."),
      orientation,
      note(
        `Un code oriente dans une CM quand il appartient à une liste d'entrée dans une CM : CIM_infos_SMR lui en donne une, autre que la ${CM_ERREURS}. ` +
          "La liste des codes orientant en deuxième intention, des symptômes pour la plupart, est dans le même fichier ; " +
          "la deuxième intention n'existe que pour la MMP. Exemple du manuel : dyspnée (",
        lienCode("R06.0"),
        ") en MMP, code orientant en deuxième intention, et insuffisance cardiaque (",
        lienCode("I50.9"),
        ") en AE : le RHS va dans la CM 05."
      ),
      el("h2", {}, "Tests d'entrée en GN"),
      el("p", { class: "sous-titre" }, "Volume 1, 2.2.2 et annexe 7.2."),
      el(
        "p",
        {},
        "Dans la CM, chaque nœud de l'arbre porte un ou deux tests : chacun cherche un code d'une liste aux positions qu'il nomme " +
          "(MMP ou AE, plus rarement DAS). Le premier nœud dont tous les tests sont positifs donne le GN ; si aucun ne l'est, " +
          "le RHS n'est pas groupé. Choisir une CM :"
      ),
      grille
    );
  }

  // ---- Tests d'entrée en GN d'une CM (orienterGn, smr.js) ----

  function vueCm(cm) {
    const noeuds = k._testsParCm.get(cm);
    // Même recherche de l'erreur que orienterGn : celle qui nomme la CM.
    const erreur = k.erreurs.find(([, libelle]) => libelle.endsWith(`dans la CM ${cm}`));
    const lignes = noeuds.map((noeud) => {
      const autres = index.rangs.get(noeud.gn).filter((r) => r !== noeud.ordre);
      const conditions = (noeud.conditions ?? []).map((c) => CONDITIONS[c]).filter(Boolean);
      return el(
        "tr",
        {},
        el("th", { scope: "row", class: "rang" }, String(noeud.ordre)),
        celluleTests(noeud.tests, conditions),
        el(
          "td",
          {},
          el(
            "button",
            { type: "button", class: "bouton-gn", "data-gn": noeud.gn, onclick: () => ouvrirGn(noeud.gn) },
            code(noeud.gn),
            " ",
            libelleGroupe(k, noeud.gn)
          ),
          autres.length
            ? el("span", { class: "rangs-autres" }, `Aussi au${autres.length > 1 ? "x rangs" : " rang"} ${enumeration(autres.map(String))}.`)
            : null
        )
      );
    });
    return el(
      "section",
      { "aria-labelledby": "smr-arbre-cm" },
      el("h2", { id: "smr-arbre-cm" }, `CM ${cm} — ${libelleGroupe(k, cm)}`),
      el(
        "p",
        { class: "sous-titre" },
        `Volume 1, 2.2.2 et annexe 7.2 : ${nombre(noeuds.length)} nœud${noeuds.length > 1 ? "s" : ""}, testé${noeuds.length > 1 ? "s" : ""} dans l'ordre ; le premier dont tous les tests sont positifs oriente le RHS dans son GN.`
      ),
      table(
        [
          entete("Rang", "Ordre du nœud dans la CM (Ordre_intra_CM)"),
          entete("Tests", "Un nœud à deux tests n'est positif que si les deux le sont"),
          entete("GN d'arrivée"),
        ],
        [el("tbody", {}, ...lignes)],
        "tests-gn"
      ),
      note(
        "Un test est positif quand l'un des codes aux positions qu'il nomme appartient à sa liste ; chaque liste mène à ses codes. " +
          "Un GN peut revenir à plusieurs rangs, avec d'autres listes. ",
        erreur
          ? `Aucun nœud positif : le RHS n'est pas groupé, erreur ${erreur[0]} « ${erreur[1]} ».`
          : `Aucun code erreur de FG_erreurs ne nomme la CM ${cm}.`,
        " Un GN cliqué s'ouvre sous le tableau."
      ),
      el("div", { class: "zone-gn" })
    );
  }

  /** Les tests d'un nœud dans une seule case, numérotés quand il y en a
   *  deux (le test 2 est rare : une colonne à lui resterait vide presque
   *  partout, et pousserait le GN d'arrivée hors de l'écran d'un
   *  téléphone). Chaque test : positions, liste (lien vers ses codes) et
   *  libellé ; le nœud du GN 0871 porte en plus ses conditions. */
  function celluleTests(tests, conditions) {
    const td = el("td", {});
    tests.forEach((test, i) => {
      td.append(
        el(
          "span",
          { class: "test" },
          tests.length > 1 ? el("span", { class: "numero-test" }, i ? "et test 2 : " : "Test 1 : ") : null,
          ...positions(test),
          " ",
          el("a", { class: "code", href: `#/smr/groupage/D-${test.liste}`, title: `Codes de la liste D-${test.liste}` }, `D-${test.liste}`),
          el("span", { class: "test-liste" }, libelleListe(k, test))
        )
      );
    });
    if (conditions.length) {
      td.append(
        el("span", { class: "test-conditions-titre" }, "Conditions supplémentaires :"),
        el("ul", { class: "test-conditions" }, ...conditions.map((c) => el("li", {}, c)))
      );
    }
    return td;
  }

  // ---- Panneau d'un GN ----

  function vueGn(gn) {
    const e = k.gr[gn];
    const rangs = index.rangs.get(gn) ?? [];
    const hc = TYPES_HC.filter((t) => e.hc.includes(t)).map((t) => gn + t);
    const htp = TYPES_HTP.filter((t) => e.htp.includes(t)).map((t) => gn + t);
    const gmes = [...hc, ...htp].flatMap((gr) => (index.fils.get(gr) ?? []).flatMap((gl) => index.fils.get(gl) ?? []));
    return el(
      "section",
      { class: "smr-gn", id: "smr-gn", "aria-labelledby": "smr-gn-titre" },
      el(
        "div",
        { class: "smr-gn-entete" },
        el("h2", { id: "smr-gn-titre", tabindex: "-1" }, "GN ", groupeLibelle(k, gn)),
        el("button", { type: "button", class: "bouton-icone", onclick: fermerGn, "aria-label": `Fermer le GN ${gn}` }, "Fermer")
      ),
      el(
        "p",
        { class: "sous-titre" },
        `CM ${gn.slice(0, 2)} — test${rangs.length > 1 ? "s" : ""} d'entrée au${rangs.length > 1 ? "x" : ""} rang${rangs.length > 1 ? "s" : ""} ${enumeration(rangs.map(String))}. ` +
          `${hc.length} GR d'hospitalisation complète, ${htp.length} d'hospitalisation à temps partiel, ${gmes.length} GME.`
      ),
      el("h3", {}, "Type de réadaptation — hospitalisation complète"),
      ...blocHc(gn, e, hc),
      el("h3", {}, "Type de réadaptation — hospitalisation à temps partiel"),
      ...blocHtp(gn, e, htp),
      el("h3", {}, "Niveau de lourdeur"),
      ...blocLourdeur(hc),
      el("h3", {}, "Niveau de sévérité et GME"),
      ...blocGme(gn, hc, htp),
      el("h3", {}, "Tarifs des GME"),
      blocTarifs(gn, gmes)
    );
  }

  /** Une étape du type de réadaptation : condition, puis le GR auquel elle
   *  mène. */
  function listeEtapes(gn, etapes) {
    return el(
      "ol",
      { class: "chemin" },
      ...etapes.map(({ si, type, precision }) =>
        el(
          "li",
          {},
          el("span", { class: "chemin-libelle" }, si, precision ? el("span", { class: "precision" }, ` — ${precision}`) : null),
          el("span", { class: "etape-gr" }, fleche(), " ", code(gn + type), ` ${TYPES_READAPTATION[type]}`)
        )
      )
    );
  }

  function blocHc(gn, e, grs) {
    const adultes = e.hc.replace("P", "");
    const teste = (t) => adultes.length > 1 && t in SCORES_HC;
    const seuils = (t) => (t === "S" ? e.spe : e.glob);
    const seuil = (t, i) => (!teste(t) ? "–" : seuils(t)[i] == null ? "aucun" : `≥ ${nombre(seuils(t)[i])}`);
    // Le score testé suit le type dans sa case plutôt que d'avoir sa
    // colonne : sur téléphone, les seuils restent ainsi dans le cadre.
    const lignes = grs.map((gr) => {
      const t = gr[4];
      return el(
        "tr",
        { id: ANCRE + gr },
        el("th", { scope: "row", title: libelleGroupe(k, gr) }, gr),
        el(
          "td",
          {},
          sansMotReadaptation(TYPES_READAPTATION[t]),
          t === "P" ? " (moins de 18 ans)" : "",
          teste(t) ? el("span", { class: "sous-ligne" }, `score ${SCORES_HC[t]}`) : null
        ),
        el("td", { class: "nombre" }, seuil(t, 0)),
        el("td", { class: "nombre" }, seuil(t, 1))
      );
    });
    const blocs = [
      table(
        [
          entete("GR"),
          entete("Type", "Type de réadaptation"),
          el("th", { scope: "col", class: "nombre" }, "Seuil par séjour"),
          el("th", { scope: "col", class: "nombre" }, "Seuil par jour"),
        ],
        [el("tbody", {}, ...lignes)]
      ),
    ];
    if (adultes.length > 1) {
      blocs.push(
        note(
          "Score spécialisé : somme des pondérations des actes de la liste d'actes spécialisés du GN réalisés pendant le séjour ; " +
            "score global : de tous les actes CSARR, codés ou transcodés, et CCAM de réadaptation. Par jour : divisé par le nombre " +
            "de jours de présence du lundi au vendredi, à défaut de week-end (3.3.2.1). Le test est positif quand le score par séjour " +
            "ET le score par jour atteignent leur seuil (tableau 5)."
        )
      );
    }
    blocs.push(
      el("p", { class: "etapes-titre" }, "Tests, dans l'ordre (3.4.1) : le premier satisfait donne le GR."),
      listeEtapes(gn, etapesHc(e)),
      blocListeSpe(gn, e)
    );
    return blocs;
  }

  /** La liste d'actes spécialisés du GN (ACTES_listes_SPE), ou pourquoi il
   *  n'en a pas, lu dans les types de GR_infos. */
  function blocListeSpe(gn, e) {
    const liste = k.gnListeSpe[gn]?.liste;
    const adultes = e.hc.replace("P", "");
    if (!liste) {
      const raison = !e.hc.includes("S")
        ? "le GN n'a pas de type « réadaptation spécialisée importante »."
        : adultes.length === 1
          ? "le GN n'est pas subdivisé sur la réadaptation ; son unique type, hors pédiatrique, est la réadaptation spécialisée importante (3.4.1.2)."
          : "aucun acte n'y est spécialisé.";
      return note("Pas de liste d'actes spécialisés : ", raison);
    }
    const fiche = k.listesSpe[liste];
    const voisins = (fiche?.gn ?? []).filter((g) => g !== gn);
    const compte = el("span", {});
    promesseActesSpe.then((jeu) => {
      const n = jeu ? actesParListe(jeu).get(liste) : null;
      if (n) compte.textContent = `, ${nombre(n)} acte${n > 1 ? "s" : ""}`;
    });
    return note(
      "Liste d'actes spécialisés du GN : ",
      el("a", { class: "code", href: `#/smr/groupage/${encodeURIComponent(liste)}`, title: "Actes de la liste" }, liste),
      fiche?.libelle ? ` (« ${fiche.libelle} »)` : "",
      compte,
      voisins.length ? ` ; commune aux GN ${enumeration(voisins)}` : "",
      ". Seuls ses actes entrent dans le score spécialisé (3.3.2.1) ; un acte CSAR y entre par l'acte CSARR que lui donne le transcodage (3.2.3)."
    );
  }

  function blocHtp(gn, e, grs) {
    const [bas, haut] = e.htpSeuils;
    const seuil = { I: `≥ ${nombre(haut ?? 0)}`, J: `≥ ${nombre(bas ?? 0)} et < ${nombre(haut ?? 0)}`, K: `< ${nombre(bas ?? 0)}` };
    const lignes = grs.map((gr) => {
      const t = gr[4];
      return el(
        "tr",
        { id: ANCRE + gr },
        el("th", { scope: "row", title: libelleGroupe(k, gr) }, gr),
        el("td", {}, sansMotReadaptation(TYPES_READAPTATION[t]), t === "H" ? " (moins de 18 ans)" : ""),
        el("td", { class: "nombre" }, seuil[t] ?? "–")
      );
    });
    return [
      table(
        [entete("GR"), entete("Type", "Type de réadaptation"), el("th", { scope: "col", class: "nombre" }, "Score global par jour")],
        [el("tbody", {}, ...lignes)]
      ),
      e.htp.includes("I")
        ? note(
            "Score global par jour : somme des pondérations de tous les actes CSARR, codés ou transcodés, et CCAM de la semaine, " +
              "divisée par le nombre de jours de présence dans la semaine (3.3.2.2). Chaque RHS est groupé indépendamment des autres."
          )
        : null,
      el("p", { class: "etapes-titre" }, "Tests, dans l'ordre (3.4.2) : le premier satisfait donne le GR."),
      listeEtapes(gn, etapesHtp(e)),
    ].filter(Boolean);
  }

  // ---- Lourdeur (grouperLourdeur, smr.js) ----

  function blocLourdeur(grs) {
    // Les classes que lit grouperLourdeur : classe d'âge de GL_infos,
    // dépendance cognitive [2-6] [7-8], physique [4-8] [9-12] [13-16],
    // statut post-chirurgical sans ou avec.
    const variables = [
      { nom: "Âge", cle: "age", classes: k.classesAge.map(libelleClasseAge) },
      { nom: "Dépendance cognitive", cle: "cog", classes: ["2 à 6", "7 à 8"] },
      { nom: "Dépendance physique", cle: "phy", classes: ["4 à 8", "9 à 12", "13 à 16"] },
      { nom: "Statut post-chirurgical", cle: "chir", classes: ["non", "oui"] },
    ];
    const regles = grs.map((gr) => k.gl[gr]);
    const niveaux = el(
      "tbody",
      {},
      el(
        "tr",
        {},
        el("th", { scope: "row", colspan: "2" }, "Niveaux possibles"),
        ...grs.map((gr) =>
          el("td", { class: "niveau" }, (index.fils.get(gr) ?? []).map((gl) => gl[5]).join(", "))
        )
      )
    );
    const corps = variables.map(({ nom, cle, classes }) =>
      el(
        "tbody",
        {},
        ...classes.map((classe, i) =>
          el(
            "tr",
            {},
            i === 0 ? el("th", { scope: "rowgroup", rowspan: String(classes.length) }, nom) : null,
            el("th", { scope: "row" }, classe),
            ...regles.map((r) => celluleNiveau(r[cle][i]))
          )
        )
      )
    );
    const blocs = [
      table(
        [entete("Variable"), entete("Valeur"), ...grs.map((gr) => el("th", { scope: "col", class: "niveau", title: libelleGroupe(k, gr) }, gr))],
        [niveaux, ...corps],
        "lourdeur"
      ),
      note(
        "Pour chaque GR d'hospitalisation complète, chaque valeur de chaque variable donne un niveau ; le niveau de lourdeur du " +
          "séjour est le plus lourd des quatre (C, puis B, puis A), et le GL est le GR suivi de ce niveau (4.2.1). Âge : celui du " +
          "premier RHS ; dépendances physique et cognitive : le maximum des RHS du séjour ; statut post-chirurgical : intervention " +
          "datant de 90 jours au plus (1.2.3). Les classes d'âge de moins de 18 ans portent les règles pédiatriques du manuel (4.2.1, 4.2.2.2). " +
          "En hospitalisation à temps partiel, le niveau est A par convention."
      ),
    ];
    if (regles.some((r) => r.age.includes(null))) {
      blocs.push(
        note(
          "« – » : sans objet. Le type de réadaptation se décide avant la lourdeur : un moins de 18 ans va dans le GR pédiatrique " +
            "quand le GN en a un, et un patient de 18 ans et plus n'y entre pas."
        )
      );
    }
    // Règles combinées (4.2.2.1) : le niveau de la dépendance physique
    // dépend aussi de l'âge, que niveauVariable (smr.js) lit par tranches.
    grs.forEach((gr, j) => {
      const phy = regles[j].phy;
      const combinees = phy.map((v, i) => [v, variables[2].classes[i]]).filter(([v]) => Array.isArray(v));
      if (!combinees.length) return;
      blocs.push(
        note(
          el("strong", {}, `Règle combinée âge × dépendance physique, GR ${gr} (4.2.2.1) : `),
          combinees
            .map(([tranches, classe]) => `une dépendance physique de ${classe} donne ${tranches.map(([min, max, niveau]) => `${niveau} ${libelleTranche([min, max])}`).join(", ")}`)
            .join(" ; "),
          "."
        )
      );
    });
    return blocs;
  }

  function celluleNiveau(valeur) {
    if (valeur == null) return el("td", { class: "niveau sans-objet", title: "Sans objet" }, ...sansObjet("sans objet"));
    if (Array.isArray(valeur)) {
      return el(
        "td",
        { class: "niveau combinee", title: "Règle combinée âge × dépendance physique (4.2.2.1)" },
        valeur.map(([min, max, niveau]) => `${niveau} ${libelleTranche([min, max])}`).join(" ; ")
      );
    }
    return el("td", { class: "niveau" }, valeur);
  }

  // ---- Sévérité et GME (grouperSeverite, smr.js) ----

  function blocGme(gn, hc, htp) {
    const corps = [...hc, ...htp].flatMap((gr) =>
      (index.fils.get(gr) ?? []).map((gl) => {
        const gmes = index.fils.get(gl) ?? [];
        return el(
          "tbody",
          {},
          ...gmes.map((gme, i) =>
            el(
              "tr",
              { id: ANCRE + gme },
              i === 0 ? el("th", { scope: "rowgroup", rowspan: String(gmes.length), id: ANCRE + gl, title: libelleGroupe(k, gl) }, gl) : null,
              el("td", { class: "niveau" }, gme.at(-1)),
              el("td", {}, groupeLibelle(k, gme))
            )
          )
        );
      })
    );
    return [
      note(
        "Hospitalisation complète : sévérité 2 quand au moins un marqueur de sévérité est retenu — un code CIM-10 CMA en MMP ou en " +
          "DAS d'un RHS, qu'aucun des codes ayant orienté un RHS du séjour dans ce GN n'exclut, ou un acte CCAM CMA — et que le " +
          "niveau 2 existe ; 1 sinon (5.2.3). ",
        index.sansSeverite2.has(gn)
          ? el("strong", {}, `Le GN ${gn} n'a pas de niveau de sévérité 2 : tout séjour d'HC y est en sévérité 1. `)
          : null,
        "Hospitalisation à temps partiel : lourdeur A et sévérité 0, par convention (4.1, 5.1)."
      ),
      table([entete("GL"), el("th", { scope: "col", class: "niveau" }, "Sévérité"), entete("GME")], corps, "gme"),
    ];
  }

  /** Les GMT des GME du GN, rempli dès que les tarifs sont là. */
  function blocTarifs(gn, gmes) {
    const zone = el("div", {}, el("p", { class: "compteur" }, "Chargement des tarifs…"));
    promesseTarifs.then((tarifs) => {
      zone.replaceChildren(
        ...(tarifs
          ? [tableTarifsGme(tarifs, gmes), noteTarifsSmr(lienTarifs(gn))]
          : [el("p", { class: "message-avertissement" }, "Tarifs des GME indisponibles pour le moment.")])
      );
    });
    return zone;
  }

  // ---- Recherche ----

  function chercher(valeur) {
    zoneRecherche.innerHTML = "";
    const requete = valeur.trim();
    if (!requete) return;
    const compact = requete.toUpperCase().replace(/\s+/g, "");
    // Un numéro de liste (« D-0112 », « d0112 ») : les nœuds dont un test
    // l'emploie, comparés liste pour liste.
    const liste = compact.match(/^D-?(\d{4})$/)?.[1];
    if (liste) {
      afficherResultats(noeudsDeListe(liste), `D-${liste}`);
      return;
    }
    // Un code se compare au début des codes : « 0147 » ne ramène pas les
    // GME dont le libellé porterait ces chiffres.
    const trouves = RE_CODE_GROUPE.test(compact)
      ? index.entrees.filter((e) => e.code.startsWith(compact))
      : index.entrees.filter(recherche.filtre(requete));
    afficherResultats(trouves, null);
    // Un code CIM-10 ou un acte n'est pas un groupe : la fiche code dit dans
    // quelle CM et quelles listes il entre, sans charger ici les 43 000
    // codes de la fonction groupage.
    if (!trouves.length && /^[A-Z]\d{2}[0-9.+]*$|^[A-Z]{3}\+?\d{3}$|^[A-Z]{4}\d{3}$|^\d{2}[A-Z]\d{2}$/.test(compact)) {
      zoneRecherche.append(
        el(
          "p",
          { class: "message-info" },
          "Ce n'est pas un code de groupe. La fiche code dit dans quelle CM et dans quelles listes entre un code, et quels tests d'entrée en GN les emploient : ",
          lienCode(compact),
          "."
        )
      );
    }
  }

  /** Les nœuds dont un test emploie la liste D-`liste`, en entrées de GN
   *  qui disent où : « CM 01, rang 6, test 2 ». */
  function noeudsDeListe(liste) {
    return k.tests.flatMap((noeud) =>
      noeud.tests
        .map((t, i) => [t, i])
        .filter(([t]) => t.liste === liste)
        .map(([, i]) => ({
          niveau: "GN",
          code: noeud.gn,
          long: `${libelleGroupe(k, noeud.gn)} — CM ${noeud.cm}, rang ${noeud.ordre}${noeud.tests.length > 1 ? `, test ${i + 1}` : ""}`,
        }))
    );
  }

  /** Compteur et liste des groupes trouvés ; `liste` : le numéro de liste
   *  cherché, le cas échéant. */
  function afficherResultats(trouves, liste) {
    if (!trouves.length) {
      zoneRecherche.append(
        el(
          "p",
          { class: "message-info", role: "status" },
          ...(liste
            ? [`Aucun test d'entrée en GN n'emploie la liste ${liste}. `, el("a", { class: "lien-texte", href: `#/smr/groupage/${liste}` }, "Voir la liste"), "."]
            : ["Aucune CM, aucun GN, GR, GL ni GME pour cette recherche."])
        )
      );
      return;
    }
    const parNiveau = NIVEAUX.map((n) => [n, trouves.filter((e) => e.niveau === n).length]).filter(([, c]) => c);
    const affiches = trouves.slice(0, RESULTATS_MAX);
    zoneRecherche.append(
      el(
        "p",
        { class: "compteur", role: "status" },
        el("strong", {}, nombre(trouves.length)),
        liste
          ? ` test${trouves.length > 1 ? "s" : ""} d'entrée en GN emploi${trouves.length > 1 ? "ent" : "e"} la liste ${liste}`
          : ` groupe${trouves.length > 1 ? "s" : ""} (${parNiveau.map(([n, c]) => `${nombre(c)} ${n}`).join(", ")})`,
        trouves.length > affiches.length ? ` — les ${RESULTATS_MAX} premiers ; précisez la recherche pour les autres` : ""
      ),
      el(
        "ol",
        { class: "liste-resultats" },
        ...affiches.map((e) =>
          el(
            "li",
            {},
            el(
              "button",
              { type: "button", onclick: () => allerA(e) },
              el("span", { class: "resultat-cmd" }, e.code),
              el("span", { class: "resultat-niveau" }, e.niveau),
              el("span", { class: "resultat-libelle" }, e.long)
            )
          )
        )
      )
    );
  }

  function allerA({ niveau, code: c }) {
    if (niveau === "CM") {
      afficherCm(c);
      defiler(zoneVue, "start", true);
      zoneVue.querySelector("h2")?.setAttribute("tabindex", "-1");
      zoneVue.querySelector("h2")?.focus({ preventScroll: true });
      return;
    }
    const gn = c.slice(0, 4);
    ouvrirGn(gn, { cible: niveau === "GN" ? null : c });
  }

  // ---- Premier affichage ----

  // Rendu vrai quand la vue s'est placée d'elle-même sur un GN (lien
  // profond) : le routeur ne la ramène alors pas en haut de page. Une
  // adresse illisible retombe sur la vue d'ensemble, adresse corrigée.
  const demande = String(chemin[0] ?? "").toUpperCase();
  if (/^\d{2}$/.test(demande) && index.cms.includes(demande)) return afficherCm(demande);
  if (/^\d{4}$/.test(demande) && k.gr[demande]) return afficherCm(demande.slice(0, 2), { gn: demande, douceur: false });
  if (RE_GROUPE_ADRESSE.test(demande) && k.groupes[{ 5: "GR", 6: "GL", 7: "GME" }[demande.length]]?.[demande]) {
    return afficherCm(demande.slice(0, 2), { gn: demande.slice(0, 4), cible: demande, douceur: false });
  }
  return afficherCm(null, { historique: chemin.length > 0 });
}
