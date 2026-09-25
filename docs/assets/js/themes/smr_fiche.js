// Fiche code SMR — ce que la fonction groupage SMR fait d'un code, sur une
// seule page :
// - un diagnostic CIM-10 : CM d'orientation, positions permises, deuxième
//   intention, listes d'entrée en GN et tests de l'arbre qui les emploient,
//   caractère de CMA et liste d'exclusion, avec vérificateur ;
// - un acte CSARR ou CCAM : type, statut, validité, pondération (par
//   intervenant le cas échéant), modulateurs de lieu, listes d'actes
//   spécialisés, CMA CCAM, erreurs 162 et 163, actes CSAR transcodés vers
//   lui ;
// - un acte CSAR : modalités, modulateurs, transcodage en CSARR par
//   intervenant et modalité, écarts de pondération, caractère spécialisé.
//
// Tout vient des jeux de scripts/build_smr.py, chargés et indexés par
// smr.js ; les règles citées (2.2.1, 3.3.1.3, 5.2.3…) sont celles du volume
// 1 du Manuel des GME. La page partage son chemin avec la fiche code MCO
// (`cheminCommun`) : « I634 », « i63.4 » ou « alq247 » y ouvrent la même
// fiche, et l'adresse est réécrite dans la graphie du site.

import { el, fraicheur, nombre } from "../interface.js";
import { normaliser } from "../recherche.js";
import {
  chargerSmr,
  cle,
  graphie,
  RE_CIM,
  RE_CSAR,
  RE_CSARR,
  POSITIONS,
  controlerDiagnostics,
  estExclue,
  estSpecialise,
  libelleGroupe,
  orienteDansCm,
  positionAutorisee,
} from "../smr.js";
import { groupeLibelle, lienArbre, lienFiche, sourceFg } from "../smr_interface.js";

const SUGGESTIONS_MAX = 12;
// Au-delà, les intervenants d'une ligne de tableau se replient : une ligne
// « tous les autres » en compte souvent une trentaine.
const INTERVENANTS_DEPLIES_MAX = 6;
// Même délai que les champs de recherche du site (interface.js) : filtrer
// 45 000 codes entre deux touches d'une même saisie ne sert à rien.
const DELAI_FRAPPE = 120;

// Lisez-moi de ACTES_ponderations.xlsx (colonnes « Type » et « Statut »).
const TYPES_ACTE = {
  D: "acte dédié",
  "D/ND": "acte dédié ou non dédié",
  C: "acte collectif",
  A: "appareillage avec étapes",
  PP: "pluriprofessionnel",
  CCAM: "acte CCAM de réadaptation",
};
const STATUTS_ACTE = {
  pond_u: "pondération unique pour tous les intervenants",
  "diff inter": "pondération différenciée selon les intervenants",
  "pond 0": "pondération à 0 pour certains couples acte/intervenant, les autres couples ayant la même pondération",
  "pond 0 / diff inter":
    "pondération à 0 pour certains couples acte/intervenant, les autres couples ayant des pondérations différenciées",
  CCAM: "acte CCAM",
};

// Lisez-moi de CIM_infos_SMR.xlsx (colonne « Profil ») : un caractère par
// position — MMP, AE, DAS —, O pour oui, N pour non.
const PROFILS = {
  NNN: "code non utilisable ; il s'agit en particulier de codes pères, dont l'extension est obligatoire",
  NNO: "code autorisé seulement en DAS",
  NOO: "code autorisé seulement en AE et en DAS ; il s'agit en particulier de codes séquelles",
  ONO: "code autorisé seulement en MMP et en DAS ; il s'agit en particulier de codes symptômes",
  OOO: "code autorisé aux trois positions",
};
const POSITIONS_LONGUES = {
  MMP: "Manifestation morbide principale (MMP)",
  AE: "Affection étiologique (AE)",
  DAS: "Diagnostic associé significatif (DAS)",
};

// Conditions du seul test écrit en toutes lettres (GN 0871, fractures
// multiples), telles que les donne GN_liste_tests.xlsx ; build_smr.py les
// réduit à ces deux mots-clefs.
const CONDITIONS = {
  mmpPrioritaire: "Si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant.",
  quatreCaracteresDifferents:
    "Les 4 premiers caractères du code classant en DAS doivent être différents des 4 premiers caractères du code classant en MMP ou AE.",
};

// Colonne « acte_coll » de CSAR_infos.xlsx (lisez-moi).
const MODALITES = { 0: "individuel", 1: "collectif", 2: "individuel ou collectif" };

// Tableau 4 du volume 1 (3.3.1.4) : le modulateur de lieu CSARR que devient
// chaque modulateur CSAR au transcodage.
const LIEUX_TRANSCODES = { L1: "HW ou LJ", L2: "XH", L3: "L3" };
const LIEUX_CSARR = ["HW", "LJ", "XH", "L3"];

// ==== Petits composants ====

const lien = (href, ...enfants) => el("a", { href }, ...enfants);
// `contenu` : un texte, ou les morceaux que rend coupable().
const code = (...contenu) => el("span", { class: "code" }, ...contenu);
const note = (...enfants) => el("p", { class: "fiche-note" }, ...enfants);
// Césures des en-têtes (trait d'union conditionnel) : en capitales
// espacées, « PONDÉRATION » ou « INTERVENANTS » sont les mots les plus
// larges d'un tableau et le faisaient déborder d'un téléphone ; coupés au
// besoin seulement, ils restent entiers sur grand écran.
const CESURES = {
  Accepté: "Accep\u00adté",
  arrivée: "arri\u00advée",
  entrée: "en\u00adtrée",
  Intervenant: "Inter\u00advenant",
  Intervenants: "Inter\u00advenants",
  Majoration: "Majo\u00adration",
  Modalité: "Moda\u00adlité",
  Modulateur: "Modu\u00adlateur",
  Pondération: "Pondé\u00adration",
  Position: "Posi\u00adtion",
  Propriété: "Pro\u00adpriété",
  spécialisé: "spécia\u00adlisé",
  transcodé: "trans\u00adcodé",
};
const entete = (texte, titre) =>
  el("th", { scope: "col", title: titre }, texte.replace(/\p{L}+/gu, (mot) => CESURES[mot] ?? mot));
// Libellé sous son code, dans la même cellule : un tableau de quatre
// colonnes au plus tient dans un téléphone sans défiler, et l'étiquette
// d'écart, en dernière colonne, reste en vue.
const sousLibelle = (texte) =>
  texte && texte.length ? el("span", { class: "racine-libellee" }, ...(Array.isArray(texte) ? texte : [texte])) : null;

/** Nom technique d'une liste d'actes spécialisés (« 0106_09_15_30_45 »,
 *  « 1_aff_cereb_et_autres ») coupable après chaque « _ » : d'un seul
 *  tenant, il élargirait sa colonne de moitié sur un téléphone. */
function coupable(texte) {
  return String(texte ?? "")
    .split("_")
    .flatMap((morceau, i) => (i ? ["_", el("wbr"), morceau] : [morceau]));
}

/** Tableau à la manière de la fiche MCO : en-têtes, puis un ou plusieurs
 *  <tbody> (un par groupe de lignes). Affiché en entier ; `defilant`, il
 *  défile dans son cadre (tableau d'une trentaine d'intervenants). */
function table(entetes, ...corps) {
  return el(
    "div",
    { class: "codes-liste" },
    el("table", {}, el("thead", {}, el("tr", {}, ...entetes)), ...corps)
  );
}
function tableDefilante(entetes, ...corps) {
  const cadre = table(entetes, ...corps);
  cadre.classList.add("defilant");
  return cadre;
}

/** Tableau de définitions : une ligne par propriété, son nom en en-tête de
 *  ligne. */
function definitions(lignes) {
  return table(
    [entete("Propriété"), entete("Valeur")],
    el("tbody", {}, ...lignes.map(([nom, valeur]) => el("tr", {}, el("th", { scope: "row" }, nom), el("td", {}, valeur))))
  );
}

function lienGn(k, gn) {
  return lien(lienArbre(gn), groupeLibelle(k, gn));
}

function libelleIntervenant(k, iv) {
  return k.intervenants[iv] ?? `intervenant ${iv}`;
}

/** Étiquette « écart » : visible d'un coup d'œil dans un tableau d'une
 *  trentaine de lignes, lue avec ses deux valeurs par un lecteur d'écran. */
function etiquetteEcart(csarr, fichierCsar) {
  return el(
    "span",
    {
      class: "etiquette-ecart",
      title: `Pondération du fichier CSAR : ${fichierCsar} ; du CSARR transcodé : ${csarr}`,
    },
    "écart"
  );
}

/** Les intervenants d'une ligne de tableau : « Tous les intervenants » s'ils
 *  y sont tous, leur liste s'ils sont peu nombreux, repliée sinon. */
function celluleIntervenants(k, codes, total, { autres = false } = {}) {
  if (codes.length === total && total > 1) return [`Tous les intervenants (${nombre(total)})`];
  const noms = codes.map((iv) =>
    el("span", { class: "racine-libellee" }, el("strong", { class: "code" }, iv), ` ${libelleIntervenant(k, iv)}`)
  );
  if (codes.length <= INTERVENANTS_DEPLIES_MAX) return noms;
  return [
    el(
      "details",
      {},
      el("summary", {}, autres ? `Les ${nombre(codes.length)} autres intervenants` : `${nombre(codes.length)} intervenants`),
      ...noms
    ),
  ];
}

/** Lignes de transcodage regroupées par transcodage identique — même
 *  modalité, même CSARR, mêmes pondérations — pour qu'un acte CSAR à 32
 *  intervenants tienne en quelques lignes. Groupes par modalité, le plus
 *  nombreux d'abord. */
function regrouperTranscodage(lignes) {
  const groupes = new Map();
  for (const l of lignes) {
    const clef = [l["Modalité"], l["Code CSARR"], l["Pondération CSARR"], l["Pondération CSAR"], l["Équivalent"]].join("|");
    if (!groupes.has(clef)) {
      groupes.set(clef, {
        csar: l["Code CSAR"],
        libelleCsar: l["Libellé CSAR"],
        modalite: l["Modalité"],
        csarr: l["Code CSARR"],
        libelleCsarr: l["Libellé CSARR"],
        ponderation: l["Pondération CSARR"],
        fichierCsar: l["Pondération CSAR"],
        equivalent: l["Équivalent"],
        intervenants: [],
      });
    }
    groupes.get(clef).intervenants.push(l.Intervenant);
  }
  // Nombre d'intervenants transcodés pour chaque acte et modalité : le
  // dénominateur de « tous les intervenants ».
  const totaux = new Map();
  for (const l of lignes) {
    const clef = `${l["Code CSAR"]}|${l["Modalité"]}`;
    if (!totaux.has(clef)) totaux.set(clef, new Set());
    totaux.get(clef).add(l.Intervenant);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, ecart: g.ponderation !== g.fichierCsar, total: totaux.get(`${g.csar}|${g.modalite}`).size }))
    .sort((a, b) => (a.csar === b.csar ? 0 : a.csar < b.csar ? -1 : 1) || a.modalite - b.modalite || b.intervenants.length - a.intervenants.length);
}

// ==== Index ====

/** Clef de comparaison d'une saisie à un code : capitales, sans point,
 *  espace ni « + » — « alq247 » trouve ALQ+247, « i634 » trouve I63.4. */
const clefSaisie = (texte) => String(texte ?? "").toUpperCase().replace(/[\s.+]/g, "");

function entree(code, nature, libelle) {
  return { code, nature, libelle, clef: clefSaisie(code), texte: normaliser(libelle) };
}

/** Les entrées de suggestion, construites une fois par jeu chargé et
 *  gardées sur l'objet du jeu : jamais recalculées à la frappe. Les actes
 *  CCAM CMA qui ne sont pas des actes de réadaptation (EBLA003…) rejoignent
 *  les actes : ils ont eux aussi leur fiche. */
function listesSuggestion(smr) {
  const { diagnostics, actes, csar, classification: k } = smr;
  if (!diagnostics._ficheSuggestions) {
    diagnostics._ficheSuggestions = diagnostics.lignes.map((l) => entree(l.Code, "CIM-10", l["Libellé"]));
  }
  if (!actes._ficheSuggestions) {
    const entrees = [...actes._parCode].map(([c, lignes]) => entree(c, lignes[0].Nomenclature, lignes[0]["Libellé"]));
    for (const [c, libelle] of k._cmaCcam) if (!actes._parCode.has(c)) entrees.push(entree(c, "CCAM", libelle));
    // ACTES_ponderations.xlsx est rangé par hiérarchie : trié par code, un
    // début de code propose d'abord le code exact.
    actes._ficheSuggestions = entrees.sort((a, b) => (a.code < b.code ? -1 : 1));
  }
  if (!csar._ficheSuggestions) {
    csar._ficheSuggestions = [...csar._parCode].map(([c, lignes]) => entree(c, "CSAR", lignes[0]["Libellé CSAR"]));
  }
  return [diagnostics._ficheSuggestions, actes._ficheSuggestions, csar._ficheSuggestions];
}

/** Suggestions : par début de code d'abord, puis par mots du libellé. Une
 *  saisie qui a la forme d'un début de code (« i63 », « 01E », « alq+2 »,
 *  « ahqp ») ne se cherche pas dans les libellés, où elle ne trouverait que
 *  du bruit. */
function chercher(smr, saisie) {
  const q = saisie.trim();
  if (q.length < 2) return [];
  const clef = clefSaisie(q);
  const compacte = q.replace(/\s+/g, "");
  const commeCode = /^([a-z]\d|\d{2}|[a-z]{3}\+|[a-z]{4}\d)/i.test(compacte);
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  const parTexte = !commeCode && q.length >= 3;
  const parCode = [];
  const parMots = [];
  for (const entrees of listesSuggestion(smr)) {
    for (const e of entrees) {
      if (clef && e.clef.startsWith(clef)) {
        parCode.push(e);
        if (parCode.length >= SUGGESTIONS_MAX) return parCode;
      } else if (parTexte && parMots.length < SUGGESTIONS_MAX && mots.every((m) => e.texte.includes(m))) {
        parMots.push(e);
      }
    }
  }
  return [...parCode, ...parMots].slice(0, SUGGESTIONS_MAX);
}

/** Tests d'entrée en GN qui emploient chaque liste D-xxxx : liste →
 *  [{ noeud, test, rang }], `rang` 0 ou 1 (premier ou second test du nœud). */
function testsParListe(k) {
  if (!k._ficheTestsParListe) {
    const index = new Map();
    for (const noeud of k.tests) {
      noeud.tests.forEach((test, rang) => {
        if (!index.has(test.liste)) index.set(test.liste, []);
        index.get(test.liste).push({ noeud, test, rang });
      });
    }
    k._ficheTestsParListe = index;
  }
  return k._ficheTestsParListe;
}

/** Nombre de codes d'une liste d'exclusion : les plages sont des bornes de
 *  clefs dans l'ordre de CIM_infos_SMR trié (build_smr.py), on compte les
 *  clefs comprises entre elles. Rang et tailles gardés en cache. */
function tailleListeExclusion(smr, index) {
  const D = smr.diagnostics;
  if (!D._ficheRang) {
    // Tri par unités de code, comme le `sorted` de Python : les clefs ne
    // portent que des capitales, des chiffres et « + ».
    const cles = [...D._parCle.keys()].sort();
    D._ficheRang = new Map(cles.map((c, i) => [c, i]));
  }
  const X = smr.exclusions;
  if (!X._ficheTailles) X._ficheTailles = new Map();
  if (!X._ficheTailles.has(index)) {
    let n = 0;
    for (const [a, b] of X.listes[index]) {
      const ra = D._ficheRang.get(a);
      const rb = D._ficheRang.get(b);
      if (ra != null && rb != null) n += rb - ra + 1;
    }
    X._ficheTailles.set(index, n);
  }
  return X._ficheTailles.get(index);
}

/** Transcodage CSAR à rebours : code CSARR → lignes de csar.json. */
function csarVers(smr, csarr) {
  const jeu = smr.csar;
  if (!jeu._ficheParCsarr) {
    jeu._ficheParCsarr = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._ficheParCsarr.has(l["Code CSARR"])) jeu._ficheParCsarr.set(l["Code CSARR"], []);
      jeu._ficheParCsarr.get(l["Code CSARR"]).push(l);
    }
  }
  return jeu._ficheParCsarr.get(csarr) ?? [];
}

/** Les GN pour lesquels un acte CSARR ou CCAM est spécialisé, par liste
 *  d'actes spécialisés : [{ liste, gns }]. La liste des GN vient de
 *  smr.estSpecialise, le test même de la fonction groupage. */
function specialisation(smr, csarr) {
  const k = smr.classification;
  const listes = [...(smr.actesSpe._parCode.get(csarr) ?? [])].sort();
  const gns = Object.keys(k.groupes.GN).filter((gn) => estSpecialise(smr, csarr, gn));
  return listes.map((liste) => ({ liste, gns: gns.filter((gn) => k._listeSpeParGn.get(gn) === liste) }));
}

// ==== Résolution d'un code saisi ====

/** La saisie (champ ou lien profond) rapportée à une fiche : { nature,
 *  code, affiche, connu, … }. `affiche` est la graphie de l'adresse et du
 *  titre (« I63.4 », « ALQ+247 »). */
function trouver(smr, saisie) {
  const k = smr.classification;
  const brut = String(saisie ?? "").trim().toUpperCase().replace(/\s+/g, "");
  // CSARR saisi sans son « + » (« ALQ247 ») : aucune autre nomenclature
  // n'a cette forme.
  const csarr = /^[A-Z]{3}\d{3}$/.test(brut) ? `${brut.slice(0, 3)}+${brut.slice(3)}` : brut;
  if (RE_CSARR.test(csarr)) {
    const lignes = smr.actes._parCode.get(csarr);
    return { nature: "CSARR", code: csarr, affiche: csarr, connu: !!lignes, lignes };
  }
  if (RE_CSAR.test(brut)) {
    const lignes = smr.csar._parCode.get(brut);
    return { nature: "CSAR", code: brut, affiche: brut, connu: !!lignes, lignes };
  }
  // Code CCAM suivi de sa phase ou de son activité (« EBLA0030 »,
  // « AHQP002-10 ») : ni les pondérations ni les CMA n'en tiennent compte.
  if (/^[A-Z]{4}\d{3}/.test(brut)) {
    const c = brut.slice(0, 7);
    const lignes = smr.actes._parCode.get(c);
    const cma = k._cmaCcam.get(c);
    return { nature: "CCAM", code: c, affiche: c, connu: !!lignes || cma != null, lignes, cma };
  }
  if (brut && RE_CIM.test(cle(brut))) {
    const diag = smr.diagnostics._parCle.get(cle(brut));
    return { nature: "CIM-10", code: cle(brut), affiche: graphie(brut), connu: !!diag, diag };
  }
  return { nature: null, code: brut, affiche: brut, connu: false };
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const smr = await chargerSmr();
  const k = smr.classification;
  conteneur.innerHTML = "";

  let minuteur = null;
  const saisie = el("input", {
    type: "search",
    id: "fiche_smr_code",
    placeholder: "ex. : I63.4, G81.1, ALQ+247, 01E08, hémiplégie",
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": "fiche_smr_aide",
    "aria-controls": "fiche_smr_suggestions",
    oninput: () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => suggerer(saisie.value), DELAI_FRAPPE);
    },
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // La frappe n'est peut-être pas encore retombée : on cherche tout de
        // suite plutôt que d'ouvrir une suggestion périmée.
        clearTimeout(minuteur);
        const [premier] = chercher(smr, saisie.value);
        if (premier) ouvrir(premier.code);
        else if (saisie.value.trim()) ouvrir(saisie.value);
      } else if (e.key === "ArrowDown") {
        const bouton = zoneSuggestions.querySelector("button");
        if (bouton) {
          e.preventDefault();
          bouton.focus();
        }
      } else if (e.key === "Escape") {
        if (!zoneSuggestions.childElementCount && !saisie.value) return;
        e.stopPropagation(); // sinon la touche referme aussi le tiroir
        if (zoneSuggestions.childElementCount) viderSuggestions();
        else saisie.value = "";
      }
    },
  });
  const zoneSuggestions = el("div", { class: "fiche-suggestions", id: "fiche_smr_suggestions" });
  const statut = el("p", { class: "visuellement-cache", role: "status" });
  const zoneFiche = el("div", { class: "fiche fiche-smr" });

  conteneur.append(
    el("h1", {}, "Fiche code"),
    sourceFg(),
    fraicheur([
      { libelle: smr.diagnostics.libelle, millesime: smr.diagnostics.millesime },
      { libelle: smr.actes.libelle, millesime: smr.actes.millesime },
      { libelle: smr.actesSpe.libelle, millesime: smr.actesSpe.millesime },
      { libelle: smr.csar.libelle, millesime: smr.csar.millesime },
      { libelle: "listes d'exclusion des CMA", millesime: smr.exclusions.millesime },
      ...Object.entries(k.millesimes).map(([fichier, millesime]) => ({ libelle: fichier, millesime })),
    ]),
    el(
      "p",
      {},
      "Tout ce que la fonction groupage SMR fait d'un code : diagnostic CIM-10 (CM, positions permises, listes d'entrée en GN, CMA), acte CSARR ou CCAM (pondération, modulateurs, caractère spécialisé) ou acte CSAR (transcodage en CSARR). Saisir un code ou quelques mots de son libellé."
    ),
    el(
      "div",
      { class: "barre-outils" },
      el(
        "div",
        { class: "champ" },
        el("label", { for: "fiche_smr_code" }, "Code CIM-10, CSARR, CCAM ou CSAR :"),
        el("div", { class: "champ-recherche" }, el("span", { class: "icone loupe", "aria-hidden": "true" }), saisie),
        el(
          "p",
          { class: "champ-aide", id: "fiche_smr_aide" },
          "Entrée ouvre la première suggestion ; flèche bas pour les parcourir."
        ),
        zoneSuggestions,
        statut
      )
    ),
    zoneFiche,
    el(
      "p",
      { class: "pied-page" },
      "Vues d'ensemble : ",
      el("a", { class: "lien-texte", href: "#/smr/groupage" }, "listes de la fonction groupage"),
      " · ",
      el("a", { class: "lien-texte", href: "#/smr/arbre" }, "algorithme de la fonction groupage"),
      " · ",
      el("a", { class: "lien-texte", href: "#/smr/cma" }, "CMA et exclusions"),
      " · ",
      el("a", { class: "lien-texte", href: "#/smr/ponderations" }, "pondérations des actes"),
      " · ",
      el("a", { class: "lien-texte", href: "#/smr/csar" }, "transcodage CSAR ↔ CSARR"),
      "."
    )
  );

  // ---- Suggestions ----

  function viderSuggestions() {
    clearTimeout(minuteur);
    zoneSuggestions.innerHTML = "";
    statut.textContent = "";
  }

  function suggerer(valeur) {
    zoneSuggestions.innerHTML = "";
    if (valeur.trim().length < 2) {
      statut.textContent = "";
      return;
    }
    const trouves = chercher(smr, valeur);
    if (!trouves.length) {
      zoneSuggestions.append(el("p", { class: "champ-aide" }, "Aucun code de la fonction groupage SMR ne correspond."));
      statut.textContent = "Aucune suggestion.";
      return;
    }
    const boutons = trouves.map((t) =>
      el(
        "button",
        { type: "button", onclick: () => ouvrir(t.code), onkeydown: (e) => naviguer(e) },
        el("strong", {}, t.code),
        ` ${t.libelle}`,
        t.nature === "CIM-10" ? null : ` (acte ${t.nature})`
      )
    );
    zoneSuggestions.append(el("ul", { class: "liste-suggestions" }, ...boutons.map((b) => el("li", {}, b))));
    statut.textContent = `${nombre(trouves.length)} suggestion${trouves.length > 1 ? "s" : ""}.`;
  }

  /** Flèches haut et bas d'une suggestion à l'autre, Échap revient au
   *  champ. */
  function naviguer(e) {
    const boutons = [...zoneSuggestions.querySelectorAll("button")];
    const i = boutons.indexOf(e.target);
    if (e.key === "ArrowDown" && i < boutons.length - 1) {
      e.preventDefault();
      boutons[i + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i > 0 ? boutons[i - 1] : saisie).focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      viderSuggestions();
      saisie.focus();
    }
  }

  // ---- Fiche ----

  function ouvrir(demande, { lienProfond = false } = {}) {
    viderSuggestions();
    const trouve = trouver(smr, demande);
    saisie.value = trouve.affiche;
    // L'adresse dit la fiche ouverte, dans la graphie du site, sans entrée
    // d'historique (replaceState ne lève pas `hashchange`) : comme la fiche
    // MCO, la page se partage et se recharge telle quelle.
    const cible = lienFiche(trouve.affiche);
    if (trouve.affiche && location.hash !== cible) history.replaceState(null, "", cible);
    zoneFiche.innerHTML = "";
    zoneFiche.append(...fiche(smr, trouve).filter(Boolean));
    zoneFiche.querySelector("h2")?.focus({ preventScroll: lienProfond });
  }

  const [demande] = chemin;
  if (demande) ouvrir(demande, { lienProfond: true });
  else saisie.focus();
}

function fiche(smr, trouve) {
  if (!trouve.connu) return ficheInconnue(trouve);
  if (trouve.nature === "CIM-10") return ficheDiagnostic(smr, trouve);
  if (trouve.nature === "CSAR") return ficheCsar(smr, trouve);
  return ficheActe(smr, trouve);
}

function ficheInconnue({ nature, affiche }) {
  const message = {
    "CIM-10": `${affiche} ne figure pas parmi les codes CIM-10 de la fonction groupage SMR (CIM_infos_SMR).`,
    CSARR: `${affiche} ne figure pas parmi les actes CSARR pondérés (ACTES_ponderations) : la fonction groupage lève l'erreur 82.`,
    CCAM: `${affiche} n'est ni un acte CCAM de réadaptation pondéré (ACTES_ponderations), ni un acte CCAM CMA.`,
    CSAR: `${affiche} ne figure pas dans le transcodage CSAR (CSAR_infos) : la fonction groupage lève l'erreur 91.`,
  }[nature];
  return [
    el("h2", { tabindex: "-1" }, "Code inconnu"),
    el(
      "p",
      { class: "message-info" },
      message ??
        `« ${affiche} » n'a la forme d'aucun code : CIM-10 (I63.4), CSARR (ALQ+247), CCAM (AHQP002) ou CSAR (01E08).`
    ),
  ];
}

// ==== Fiche d'un diagnostic ====

function ficheDiagnostic(smr, { diag, affiche }) {
  const k = smr.classification;
  const nnn = diag.Profil === "NNN";
  const permises = POSITIONS.filter((p) => positionAutorisee(diag, p));
  return [
    el("h2", { tabindex: "-1" }, `${affiche} — ${diag["Libellé"]}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, orienteDansCm(diag) ? `CM ${diag.CM}` : "CM 90 : aucune CM"),
      diag["Deuxième intention"] ? el("span", { class: "pastille attention" }, "Oriente en deuxième intention") : null,
      el(
        "span",
        { class: nnn ? "pastille attention" : "pastille" },
        nnn ? "Code non utilisable" : `Permis en ${permises.join(", ")}`
      ),
      el("span", { class: diag.CMA ? "pastille cma" : "pastille" }, diag.CMA ? "CMA" : "Pas une CMA"),
      el(
        "span",
        { class: "pastille" },
        diag.Listes.length
          ? `${diag.Listes.length} liste${diag.Listes.length > 1 ? "s" : ""} d'entrée en GN`
          : "Aucune liste d'entrée en GN"
      )
    ),
    el("h3", {}, "Catégorie majeure"),
    ...blocCm(k, diag),
    el("h3", {}, "Positions permises"),
    ...blocPositions(smr, diag),
    el("h3", {}, "Listes d'entrée en GN et tests qui les emploient"),
    ...blocListes(k, diag),
    el("h3", {}, "Niveau de sévérité : CMA"),
    ...blocCma(smr, diag, affiche),
  ];
}

// Ce que le code fait de l'orientation en CM, selon les positions que son
// profil permet : seules la MMP et l'AE orientent en CM (2.2.1), un code
// permis seulement en DAS n'y joue aucun rôle.
const RAPPEL_AE = "quand l'AE est testée : MMP qui n'appartient à aucune liste d'entrée dans une CM, ou qui oriente en deuxième intention";

function blocCm(k, diag) {
  const mmp = positionAutorisee(diag, "MMP");
  const ae = positionAutorisee(diag, "AE");
  if (!orienteDansCm(diag)) {
    return [
      el("p", {}, el("strong", {}, "CM 90 : n'oriente dans aucune CM."), ` ${libelleGroupe(k, "90")}.`),
      el(
        "p",
        {},
        "Ce code n'appartient à aucune liste d'entrée dans une CM.",
        mmp
          ? " Codé en MMP, il laisse l'AE orienter le RHS ; si l'AE n'appartient pas non plus à une liste d'entrée dans une CM, le RHS est orienté vers la CM 90, non groupable ou sans objet (erreur 300)."
          : ae
            ? " Codé en AE, il n'oriente pas le RHS : si la MMP n'oriente pas non plus, le RHS est orienté vers la CM 90, non groupable ou sans objet (erreur 300)."
            : ""
      ),
      note("Volume 1, 2.2.1."),
    ];
  }
  const cm = el("p", {}, "Oriente dans la ", el("strong", {}, `CM ${diag.CM}`), ` — ${libelleGroupe(k, diag.CM)}.`);
  if (!mmp && !ae) {
    return [
      cm,
      el("p", {}, "Son profil ne le permet qu'en DAS : il ne sert donc pas à orienter le RHS en CM, que seules la MMP et l'AE déterminent."),
      note("Volume 1, 2.2.1."),
    ];
  }
  if (!diag["Deuxième intention"]) {
    return [
      cm,
      el(
        "p",
        {},
        mmp ? "Codé en MMP, il oriente le RHS dans cette CM." : "Son profil ne permet pas de le coder en MMP.",
        ae ? ` Codé en AE, il l'y oriente ${RAPPEL_AE}.` : " Son profil ne permet pas de le coder en AE."
      ),
      note("Volume 1, 2.2.1."),
    ];
  }
  return [
    cm,
    el(
      "div",
      { class: "message-info" },
      el("strong", {}, "Oriente en deuxième intention. "),
      `Codé en MMP, il ne classe le RHS dans la CM ${diag.CM} que si l'AE n'appartient à aucune liste d'entrée dans une CM : sinon, c'est la CM de l'AE qui est retenue. Ces codes correspondent généralement à des symptômes, non spécifiques d'un système fonctionnel (une dyspnée R06.0 en MMP avec une insuffisance cardiaque I50.9 en AE oriente dans la CM 05).`,
      ae
        ? " La notion n'existe que pour la MMP : codé en AE, ce code oriente dans sa CM comme tout autre."
        : " Son profil ne permet pas de le coder en AE."
    ),
    note("Volume 1, 2.2.1."),
  ];
}

function blocPositions(smr, diag) {
  const k = smr.classification;
  // Les erreurs que lèverait le code à chaque position : celles du contrôle
  // des diagnostics de smr.js, plutôt qu'une table recopiée ici. Le même
  // code aux trois positions ajoute l'erreur 69 (AE = MMP), écartée.
  const erreurs = controlerDiagnostics(smr, { mmp: diag.Code, ae: diag.Code, das: [diag.Code] }).filter((e) => e.code !== 69);
  const lignes = POSITIONS.map((p) => {
    const oui = positionAutorisee(diag, p);
    const erreur = erreurs.find((e) => e.position === p);
    const bloquante = erreur && k._erreurs.get(erreur.code)?.bloquant !== false;
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, p, sousLibelle(POSITIONS_LONGUES[p])),
      el("td", { class: oui ? undefined : "non-attendu" }, oui ? "oui" : "non"),
      el(
        "td",
        {},
        erreur ? [`Erreur ${erreur.code}${bloquante ? " (bloquante)" : ""} : `, erreur.libelle].join("") : "—"
      )
    );
  });
  const blocs = [
    table([entete("Position"), entete("Permise"), entete("Codé à cette position")], el("tbody", {}, ...lignes)),
    note(`Profil ${diag.Profil} de CIM_infos_SMR (MMP, AE, DAS) : ${PROFILS[diag.Profil] ?? "profil inconnu"}.`),
  ];
  if (diag.Profil === "NNN") {
    // Les codes plus précis sont ceux qui prolongent la clef du code père.
    const clef = cle(diag.Code);
    const enfants = smr.diagnostics.lignes.filter((l) => {
      const c = cle(l.Code);
      return c !== clef && c.startsWith(clef) && l.Profil !== "NNN";
    });
    blocs.push(
      el(
        "div",
        { class: "message-avertissement fiche-frontiere" },
        el("strong", {}, "Code non utilisable : "),
        "il faut coder l'un des codes plus précis qu'il regroupe.",
        enfants.length
          ? el(
              "ul",
              {},
              ...enfants.slice(0, 30).map((l) => el("li", {}, lien(lienFiche(l.Code), l.Code), ` ${l["Libellé"]}`)),
              enfants.length > 30 ? el("li", {}, `… et ${nombre(enfants.length - 30)} autres.`) : null
            )
          : null
      )
    );
  }
  return blocs;
}

function blocListes(k, diag) {
  if (!diag.Listes.length) return [el("p", { class: "message-info" }, "Ce code n'appartient à aucune liste d'entrée en GN.")];
  const index = testsParListe(k);
  let horsCm = false;
  const corps = diag.Listes.map((liste) => {
    const usages = index.get(liste) ?? [];
    const enTete = el(
      "th",
      { scope: "rowgroup", rowspan: String(Math.max(1, usages.length)) },
      `D-${liste}`,
      sousLibelle(k.listes[liste])
    );
    if (!usages.length) {
      return el(
        "tbody",
        {},
        el("tr", {}, enTete, el("td", { colspan: "2", class: "non-attendu" }, "Aucun test d'entrée en GN n'emploie cette liste."))
      );
    }
    return el(
      "tbody",
      {},
      ...usages.map(({ noeud, test, rang }, i) => {
        const nbTests = k._testsParCm.get(noeud.cm)?.length ?? 0;
        // Les tests sont propres à chaque CM (2.2.2) : un test d'une autre
        // CM que celle du code ne le lit que dans un RHS classé dans cette
        // CM par un autre code. Un test en DAS, lui, lit tous les DAS.
        const autreCm = noeud.cm !== diag.CM && !test.positions.includes("DAS");
        if (autreCm) horsCm = true;
        const autre = noeud.tests[1 - rang];
        // Une cellule pour tout le nœud, une ligne par élément : où il se
        // trouve dans l'arbre, à quelle position le code y est lu, le second
        // test éventuel et les conditions du GN 0871.
        return el(
          "tr",
          {},
          i === 0 ? enTete : null,
          el(
            "td",
            {},
            el("strong", {}, `CM ${noeud.cm}, test ${noeud.ordre} sur ${nbTests}`),
            autreCm ? sousLibelle(`autre CM que celle du code (${diag.CM})`) : null,
            sousLibelle(
              `Code lu en ${test.positions.join(" ou ")}${noeud.tests.length > 1 ? ` (${rang === 0 ? "premier" : "second"} test du nœud)` : ""}`
            ),
            autre ? sousLibelle(`et ${autre.texte}`) : null,
            ...(noeud.conditions ?? []).map((c) => sousLibelle(CONDITIONS[c] ?? c))
          ),
          el("td", {}, lienGn(k, noeud.gn))
        );
      })
    );
  });
  return [
    table([entete("Liste"), entete("Test d'entrée en GN"), entete("GN d'arrivée")], ...corps),
    note(
      "Dans sa CM, le RHS passe les tests dans l'ordre de leur rang : le premier nœud dont le test — ou les deux tests — est positif donne le GN. ",
      horsCm ? "Un test d'une autre CM que celle du code ne le lit que dans un RHS orienté dans cette CM par un autre code. " : "",
      "Volume 1, 2.2.2 et annexe 7.2."
    ),
  ];
}

function blocCma(smr, diag, affiche) {
  if (!diag.CMA) {
    return [el("p", {}, `${affiche} n'est pas une CMA : il n'est pas marqueur de sévérité.`)];
  }
  const index = smr.exclusions.cma[graphie(diag.Code)];
  const blocs = [
    el(
      "p",
      {},
      el("strong", {}, "CMA. "),
      "Codée en MMP ou en DAS, elle est marqueur de sévérité et classe un séjour d'hospitalisation complète en niveau 2, sauf si elle est exclue par un des codes ayant orienté un RHS du séjour dans le GN retenu, ou si le groupe n'a pas de niveau 2 (GN 2303, soins palliatifs). En hospitalisation à temps partiel, le niveau de sévérité est toujours 0."
    ),
    note("Volume 1, 5.1 et 5.2."),
  ];
  if (index == null) {
    blocs.push(el("p", { class: "message-info" }, "Aucune liste d'exclusion : aucun code orientant ne l'exclut."));
  } else {
    const n = tailleListeExclusion(smr, index);
    blocs.push(
      el("p", { class: "fiche-sous-titre" }, `Liste d'exclusion : ${nombre(n)} code${n > 1 ? "s" : ""} l'excluent quand ils orientent le RHS dans le GN du séjour.`),
      verificateur(smr, diag, affiche)
    );
  }
  blocs.push(
    el("p", {}, el("a", { class: "lien-texte", href: `#/smr/cma/${encodeURIComponent(affiche)}` }, "Voir la CMA et sa liste d'exclusion complète"))
  );
  return blocs;
}

/** « Exclue par ce code orientant ? » : smr.estExclue, le test même de la
 *  fonction groupage, sur un code saisi. Un code inconnu est signalé avant :
 *  entre deux bornes de plage, il passerait pour exclu. */
function verificateur(smr, diag, affiche) {
  const verdict = el("p", { class: "fiche-verdict", role: "status" });
  const champ = el("input", {
    type: "text",
    id: "fiche_smr_orientant",
    placeholder: "ex. : I63.4",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => {
      const saisie = champ.value.trim();
      verdict.innerHTML = "";
      verdict.className = "fiche-verdict";
      if (!saisie) return;
      const orientant = smr.diagnostics._parCle.get(cle(saisie));
      if (!orientant) {
        verdict.classList.add("message-info");
        verdict.append(`${saisie.toUpperCase()} n'est pas un code CIM-10 de la fonction groupage SMR.`);
        return;
      }
      const exclue = estExclue(smr, diag.Code, orientant.Code);
      verdict.classList.add(exclue ? "message-avertissement" : "message-succes");
      verdict.append(
        exclue
          ? `Exclue : si ${orientant.Code} a orienté un RHS du séjour dans le GN retenu, ${affiche} n'est pas marqueur de sévérité.`
          : `Retenue : ${orientant.Code} n'exclut pas ${affiche}.`
      );
    },
  });
  return el(
    "div",
    { class: "champ fiche-dp" },
    el("label", { for: "fiche_smr_orientant" }, "Exclue par ce code orientant (MMP, AE ou DAS classant) ?"),
    champ,
    verdict
  );
}

// ==== Fiche d'un acte CSARR ou CCAM ====

function ficheActe(smr, trouve) {
  const k = smr.classification;
  const { code: c, lignes, nature } = trouve;
  const ligne = lignes?.[0];
  const libelle = ligne?.["Libellé"] ?? trouve.cma ?? "";
  const cma = k._cmaCcam.has(c);
  const spe = ligne ? specialisation(smr, c) : [];
  const nbGn = new Set(spe.flatMap((s) => s.gns)).size;
  const venus = nature === "CSARR" ? csarVers(smr, c) : [];
  const ecarts = venus.some((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]);
  return [
    el("h2", { tabindex: "-1" }, `${c} — ${libelle}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, `Acte ${nature}`),
      ligne && ligne.Type !== "CCAM" ? el("span", { class: "pastille" }, `Type ${ligne.Type}`) : null,
      ligne && !ligne.Valide ? el("span", { class: "pastille attention" }, "Plus valide") : null,
      ligne ? el("span", { class: "pastille" }, nbGn ? `Spécialisé pour ${nbGn} GN` : "Non spécialisé") : null,
      nature === "CCAM" ? el("span", { class: cma ? "pastille cma" : "pastille" }, cma ? "CMA" : "Pas une CMA") : null,
      ecarts ? el("span", { class: "pastille attention" }, "Écart de pondération d'un acte CSAR transcodé") : null
    ),
    ...(ligne
      ? [
          el("h3", {}, "Caractéristiques"),
          definitions([
            ["Nomenclature", ligne.Nomenclature],
            ["Type", `${ligne.Type} — ${TYPES_ACTE[ligne.Type] ?? "type inconnu"}`],
            ["Statut", `${ligne.Statut} — ${STATUTS_ACTE[ligne.Statut] ?? "statut inconnu"}`],
            ["Hiérarchie", ligne["Hiérarchie"].toLowerCase() === "suppr" ? "acte supprimé du catalogue" : ligne["Hiérarchie"]],
            [
              "Validité",
              ligne.Valide
                ? `en cours de validité, depuis ${ligne["Début"] ?? "—"}`
                : `plus valide : utilisé de ${ligne["Début"] ?? "—"} à ${ligne.Fin ?? "—"}`,
            ],
          ]),
          el("h3", {}, "Pondération"),
          ...blocPonderation(k, c, lignes),
          el("h3", {}, "Modulateurs de lieu"),
          ...blocModulateurs(k, ligne),
          el("h3", {}, "Actes spécialisés"),
          ...blocSpecialise(k, spe),
        ]
      : [
          el("h3", {}, "Pondération"),
          el(
            "p",
            { class: "message-info" },
            "Pas un acte de réadaptation : absent de ACTES_ponderations, il ne compte dans aucun score de réadaptation."
          ),
        ]),
    ...(nature === "CCAM"
      ? [
          el("h3", {}, "Niveau de sévérité : CMA"),
          cma
            ? el(
                "p",
                {},
                el("strong", {}, "Acte CCAM CMA. "),
                "Il est marqueur de sévérité et classe un séjour d'hospitalisation complète en niveau 2 si le groupe en a un (pas le GN 2303). Les listes d'exclusion ne portent que sur les codes CIM-10 : aucun code ne l'exclut."
              )
            : el("p", {}, `${c} n'est pas une CMA : il n'est pas marqueur de sévérité.`),
          cma ? note("Volume 1, 5.2 ; liste de CMA_CCAM.") : null,
          cma
            ? el("p", {}, el("a", { class: "lien-texte", href: `#/smr/cma/${encodeURIComponent(c)}` }, "Voir dans la liste des CMA"))
            : null,
        ]
      : []),
    ...(nature === "CSARR" ? [el("h3", {}, "Actes CSAR transcodés en cet acte"), ...blocCsarVers(k, venus)] : []),
  ];
}

function blocPonderation(k, c, lignes) {
  const blocs = [];
  if (lignes.length === 1) {
    const l = lignes[0];
    blocs.push(
      el(
        "p",
        {},
        "Pondération unique : ",
        el("strong", {}, String(l["Pondération"])),
        l.Nomenclature === "CCAM" ? " (acte CCAM : une seule pondération, quel que soit l'intervenant)." : ", quel que soit l'intervenant."
      )
    );
  } else {
    const triees = [...lignes].sort((a, b) => (a.Intervenant < b.Intervenant ? -1 : 1));
    blocs.push(
      el("p", {}, resumePonderations(k, triees)),
      tableDefilante(
        [entete("Intervenant"), entete("Libellé"), entete("Pondération")],
        el(
          "tbody",
          {},
          ...triees.map((l) =>
            el(
              "tr",
              {},
              el("td", { class: "code" }, l.Intervenant),
              el("td", {}, libelleIntervenant(k, l.Intervenant)),
              el(
                "td",
                { class: l["Pondération"] === 0 ? "non-attendu" : "nombre" },
                l["Pondération"] === 0 ? "0 — non attendu" : String(l["Pondération"])
              )
            )
          )
        )
      )
    );
    if (triees.some((l) => l["Pondération"] === 0)) {
      blocs.push(
        note(
          "Pondération 0 : intervenant non attendu pour cet acte ; les modulateurs de temps et de lieu n'ont alors pas d'effet. Volume 1, 3.3.1.2 à 3.3.1.4."
        )
      );
    }
  }
  // Erreurs non bloquantes de FG_erreurs dont la liste d'actes cite celui-ci.
  for (const numero of ["162", "163"]) {
    if (!(k.actesErreurs[numero] ?? []).some(([a]) => a === c)) continue;
    const erreur = k._erreurs.get(Number(numero));
    blocs.push(
      el(
        "p",
        { class: "message-avertissement" },
        el("strong", {}, `Erreur ${numero}${erreur?.bloquant === false ? " (non bloquante)" : ""} : `),
        `« ${erreur?.libelle ?? ""} ». L'acte figure dans la liste des actes concernés (FG_erreurs).`
      )
    );
  }
  return blocs;
}

/** « Pondération 35 pour 29 intervenants ; 130 pour neuropsychologue (33),
 *  psychotechnicien (72) ; 85 pour orthophoniste (24). » */
function resumePonderations(k, lignes) {
  const parValeur = new Map();
  for (const l of lignes) {
    if (!parValeur.has(l["Pondération"])) parValeur.set(l["Pondération"], []);
    parValeur.get(l["Pondération"]).push(l.Intervenant);
  }
  const morceaux = [...parValeur]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([valeur, ivs]) => {
      const qui =
        ivs.length > 4
          ? `${nombre(ivs.length)} intervenants`
          : ivs.map((iv) => `${libelleIntervenant(k, iv).toLowerCase()} (${iv})`).join(", ");
      return `${valeur}${valeur === 0 ? " (non attendu)" : ""} pour ${qui}`;
    });
  return `Pondération différenciée selon l'intervenant : ${morceaux.join(" ; ")}.`;
}

function blocModulateurs(k, ligne) {
  const collectif = ligne.Type === "C";
  const lignes = LIEUX_CSARR.map((m) => {
    const [, libelle, individuel, coll] = k.modulateurs.find(([c]) => c === m) ?? [m, "", 0, null];
    const accepte = !!ligne[m];
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, m, sousLibelle(libelle)),
      el("td", { class: accepte ? undefined : "non-attendu" }, accepte ? "oui" : "non"),
      el(
        "td",
        {},
        `+${individuel} en individuel`,
        sousLibelle(coll == null ? "sans objet en collectif" : `+${coll} en collectif`)
      )
    );
  });
  return [
    table([entete("Modulateur"), entete("Accepté"), entete("Majoration")], el("tbody", {}, ...lignes)),
    note(
      LIEUX_CSARR.some((m) => ligne[m])
        ? `Majoration ajoutée à la pondération ${collectif ? "d'un acte collectif (type C) : celle « en collectif »" : "d'un acte individuel : celle « en individuel »"}, sans effet pour un intervenant non attendu. `
        : "L'acte n'accepte aucun modulateur de lieu qui majore sa pondération. ",
      "Seuls les modulateurs qui majorent la pondération sont notés dans ACTES_ponderations. Volume 1, 3.3.1.4."
    ),
  ];
}

function blocSpecialise(k, spe) {
  if (!spe.length) {
    return [
      el(
        "p",
        {},
        "Acte non spécialisé : sa pondération compte dans le score de réadaptation globale, pas dans le score de réadaptation spécialisée."
      ),
      note("Volume 1, 3.2 et 3.3.2."),
    ];
  }
  return [
    el(
      "p",
      {},
      "Acte spécialisé, marqueur de la réadaptation des déficiences liées à la pathologie qui motive le séjour : dans les GN ci-dessous, sa pondération compte dans le score de réadaptation spécialisée, en plus du score global."
    ),
    table(
      [entete("Liste"), entete("CM"), entete("GN couverts")],
      el(
        "tbody",
        {},
        ...spe.map(({ liste, gns }) =>
          el(
            "tr",
            {},
            el("td", {}, code(...coupable(liste)), sousLibelle(coupable(k.listesSpe[liste]?.libelle))),
            el("td", { class: "code" }, k.listesSpe[liste]?.cm ?? ""),
            el("td", {}, ...gns.map((gn) => el("span", { class: "racine-libellee" }, lienGn(k, gn))))
          )
        )
      )
    ),
    note("Listes de ACTES_listes_SPE. Volume 1, 3.2 et 3.3.2."),
  ];
}

function blocCsarVers(k, venus) {
  if (!venus.length) return [el("p", {}, "Aucun acte CSAR n'est transcodé en cet acte.")];
  const groupes = regrouperTranscodage(venus);
  // La modalité n'a sa colonne que si elle varie d'une ligne à l'autre.
  const modalite = new Set(groupes.map((g) => g.modalite)).size > 1;
  return [
    table(
      [entete("Acte CSAR"), modalite ? entete("Modalité") : null, entete("Intervenants"), entete("Pondération")].filter(Boolean),
      el(
        "tbody",
        {},
        ...groupes.map((g) =>
          el(
            "tr",
            { class: g.ecart ? "ecart" : undefined },
            el("td", {}, el("strong", { class: "code" }, lien(lienFiche(g.csar), g.csar)), sousLibelle(g.libelleCsar)),
            modalite ? el("td", {}, MODALITES[g.modalite] ?? g.modalite) : null,
            el("td", {}, ...celluleIntervenants(k, g.intervenants, g.total)),
            celluleEcart(g)
          )
        )
      )
    ),
    modalite ? null : note(`Modalité : ${MODALITES[groupes[0].modalite] ?? groupes[0].modalite}.`),
    groupes.some((g) => g.ecart)
      ? note("Écart : la pondération du fichier CSAR de l'ATIH diffère de celle de cet acte ; la fonction groupage retient celle de cet acte (volume 1, 3.3.1.3). Le détail est sur la fiche de l'acte CSAR.")
      : null,
  ];
}

/** Pondération du CSARR transcodé, et, en cas d'écart, l'étiquette et la
 *  valeur du fichier CSAR. */
function celluleEcart(g) {
  if (!g.ecart) return el("td", { class: "nombre" }, String(g.ponderation));
  return el(
    "td",
    {},
    String(g.ponderation),
    etiquetteEcart(g.ponderation, g.fichierCsar),
    el("span", { class: "ecart-detail" }, `fichier CSAR : ${g.fichierCsar}`)
  );
}

// ==== Fiche d'un acte CSAR ====

function ficheCsar(smr, { code: c, lignes }) {
  const k = smr.classification;
  const modalites = new Set(lignes.map((l) => l["Modalité"]));
  const [temps, l1, l2, l3] = k.csar.modulables[c] ?? [false, false, false, false];
  const groupes = regrouperTranscodage(lignes);
  const ecarts = groupes.filter((g) => g.ecart);
  const equivalents = lignes.filter((l) => l["Équivalent"]).length;
  const csarrs = [...new Set(lignes.map((l) => l["Code CSARR"]))].sort();
  // Les CSARR transcodés d'un même acte CSAR ont souvent les mêmes listes
  // (ALQ+137 et ALQ+247 pour 01E08) : une ligne pour eux tous.
  const spe = [];
  for (const csarr of csarrs) {
    const listes = specialisation(smr, csarr);
    const signature = JSON.stringify(listes);
    const meme = spe.find((x) => x.signature === signature);
    if (meme) meme.csarrs.push(csarr);
    else spe.push({ csarrs: [csarr], listes, signature });
  }
  const nbGn = new Set(spe.flatMap((s) => s.listes.flatMap((x) => x.gns))).size;
  // La modalité n'a sa colonne que si l'acte en a plusieurs : sinon, la
  // section « Modalités » la dit, et la colonne ne ferait que la répéter.
  const avecModalite = new Set(groupes.map((g) => g.modalite)).size > 1;

  // Le plus nombreux des groupes d'une modalité est « les autres » quand
  // d'autres groupes existent pour la même modalité.
  const plusNombreux = new Map();
  for (const g of groupes) if (!plusNombreux.has(g.modalite)) plusNombreux.set(g.modalite, g);
  const parModalite = (m) => groupes.filter((g) => g.modalite === m).length;

  return [
    el("h2", { tabindex: "-1" }, `${c} — ${lignes[0]["Libellé CSAR"]}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, "Acte CSAR"),
      el("span", { class: "pastille" }, texteModalites(modalites, true)),
      equivalents ? el("span", { class: "pastille attention" }, "Sans correspondance CSARR") : null,
      ecarts.length ? el("span", { class: "pastille attention" }, texteEcarts(ecarts)) : null,
      el("span", { class: "pastille" }, nbGn ? `Spécialisé pour ${nbGn} GN` : "Non spécialisé")
    ),
    el("h3", {}, "Modalités"),
    el("p", {}, texteModalites(modalites, false)),
    note("Colonne « acte_coll » de CSAR_infos. Volume 1, 3.1.1."),
    el("h3", {}, "Modulateurs acceptés"),
    blocModulateursCsar(k, { temps, L1: l1, L2: l2, L3: l3 }),
    note(
      "Sans effet pour un intervenant non attendu (pondération 0 du CSARR transcodé). Drapeaux de ACTES_ponderations_CSAR_transcodage. Volume 1, 3.3.1.3 et 3.3.1.4."
    ),
    el("h3", {}, "Transcodage en CSARR"),
    equivalents
      ? el(
          "p",
          { class: "message-info" },
          el("strong", {}, "Acte sans correspondance CSARR, équivalent en pondération. "),
          "Le CSARR indiqué n'est pas une traduction de l'acte mais un acte de pondération équivalente, fourni pour faciliter le transcodage (commentaire de CSAR_infos)."
        )
      : null,
    table(
      [
        avecModalite ? entete("Modalité") : null,
        entete("Intervenants"),
        entete("CSARR", "Acte CSARR transcodé"),
        entete("Pondération", "Pondération du CSARR transcodé pour ces intervenants"),
      ].filter(Boolean),
      el(
        "tbody",
        {},
        ...groupes.map((g) =>
          el(
            "tr",
            { class: g.ecart ? "ecart" : undefined },
            avecModalite ? el("td", {}, MODALITES[g.modalite] ?? g.modalite) : null,
            el(
              "td",
              {},
              ...celluleIntervenants(k, g.intervenants, g.total, {
                autres: plusNombreux.get(g.modalite) === g && parModalite(g.modalite) > 1,
              })
            ),
            el(
              "td",
              {},
              el("strong", { class: "code" }, lien(lienFiche(g.csarr), g.csarr)),
              sousLibelle(g.libelleCsarr),
              g.equivalent && equivalents < lignes.length ? sousLibelle("équivalent en pondération") : null
            ),
            celluleEcart(g)
          )
        )
      )
    ),
    ecarts.length ? blocEcarts(k, ecarts, temps) : null,
    Object.keys(k.csar.transposition).length
      ? note(
          `Intervenants ${Object.keys(k.csar.transposition).join(" et ")} du CSAR : transposés en ${[...new Set(Object.values(k.csar.transposition))].map((iv) => `${iv} (${libelleIntervenant(k, iv).toLowerCase()})`).join(", ")} avant le transcodage. Volume 1, 3.3.1.2.`
        )
      : null,
    el("p", {}, el("a", { class: "lien-texte", href: `#/smr/csar/${encodeURIComponent(c)}` }, "Voir dans le transcodage CSAR ↔ CSARR")),
    el("h3", {}, "Caractère spécialisé"),
    el(
      "p",
      {},
      "Le caractère spécialisé d'un acte CSAR et les GN associés sont ceux de l'acte CSARR retenu par le transcodage."
    ),
    table(
      [entete("CSARR transcodé"), entete("Liste"), entete("GN pour lesquels il est spécialisé")],
      ...spe.map(({ csarrs: codes, listes }) =>
        el(
          "tbody",
          {},
          ...(listes.length ? listes : [null]).map((x, i) =>
            el(
              "tr",
              {},
              i === 0
                ? el(
                    "th",
                    { scope: "rowgroup", rowspan: String(Math.max(1, listes.length)) },
                    ...codes.map((csarr) => el("span", { class: "racine-libellee" }, lien(lienFiche(csarr), csarr)))
                  )
                : null,
              x
                ? el("td", {}, code(...coupable(x.liste)), sousLibelle(coupable(k.listesSpe[x.liste]?.libelle)))
                : el("td", { class: "non-attendu" }, "—"),
              x
                ? el("td", {}, ...x.gns.map((gn) => el("span", { class: "racine-libellee" }, lienGn(k, gn))))
                : el("td", { class: "non-attendu" }, "Non spécialisé : ne compte que dans le score global.")
            )
          )
        )
      )
    ),
    note("Volume 1, 3.2.1 et 3.2.3."),
  ];
}

/** « Écart de pondération : 4 intervenants » — pour la pastille. */
function texteEcarts(ecarts) {
  const n = ecarts.reduce((somme, g) => somme + g.intervenants.length, 0);
  return `Écart de pondération : ${nombre(n)} intervenant${n > 1 ? "s" : ""}`;
}

/** « Individuel seulement », « Individuel ou collectif, transcodés
 *  séparément »… — `court` pour la pastille. */
function texteModalites(modalites, court) {
  if (modalites.has("2")) {
    return court
      ? "Individuel ou collectif"
      : "Codable en individuel ou en collectif, avec le même transcodage dans les deux cas.";
  }
  if (modalites.has("0") && modalites.has("1")) {
    return court
      ? "Individuel ou collectif"
      : "Codable en individuel ou en collectif : chaque modalité a son propre CSARR transcodé.";
  }
  if (modalites.has("1")) return court ? "Collectif seulement" : "Codable en collectif seulement.";
  return court
    ? "Individuel seulement"
    : "Codable en individuel seulement : codé en collectif, il lève l'erreur 179 (modalité collective non acceptée pour l'acte CSAR).";
}

function blocModulateursCsar(k, acceptes) {
  const temps = k.csar.temps.map(([m, , p]) => `${m} ${p}`).join(" · ");
  const lignes = [
    el(
      "tr",
      {},
      el("th", { scope: "row" }, "Temps", sousLibelle("Durée de la séance, de T0 à T4")),
      el("td", { class: acceptes.temps ? undefined : "non-attendu" }, acceptes.temps ? "oui" : "non"),
      el("td", {}, `Pondération ${temps} ; la plus élevée de celle-ci et de celle du CSARR transcodé est retenue.`)
    ),
    ...k.csar.lieu.map(([m, libelle, individuel, collectif]) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, m, sousLibelle(libelle)),
        el("td", { class: acceptes[m] ? undefined : "non-attendu" }, acceptes[m] ? "oui" : "non"),
        el(
          "td",
          {},
          `+${individuel} (individuel)`,
          collectif == null ? ", sans objet en collectif" : `, +${collectif} (collectif)`,
          LIEUX_TRANSCODES[m] ? ` ; transcodé en ${LIEUX_TRANSCODES[m]}.` : "."
        )
      )
    ),
  ];
  return table([entete("Modulateur"), entete("Accepté"), entete("Effet")], el("tbody", {}, ...lignes));
}

/** Les écarts entre la pondération du fichier CSAR de l'ATIH et celle du
 *  CSARR transcodé : la fonction groupage ne lit que la seconde (3.3.1.3).
 *  Signalés un par un, avec les deux valeurs. */
function blocEcarts(k, ecarts, tempsAccepte) {
  return el(
    "div",
    { class: "message-avertissement fiche-frontiere" },
    el("strong", {}, "Écart de pondération. "),
    "Pour ces intervenants, la pondération que donne le fichier CSAR de l'ATIH (ACTES_ponderations_CSAR_transcodage) diffère de celle du CSARR transcodé. La fonction groupage retient celle du CSARR transcodé",
    tempsAccepte
      ? " — ou celle du modulateur de temps si elle est plus élevée, sauf pour un intervenant non attendu (pondération 0), pour qui le modulateur est sans effet"
      : "",
    " (volume 1, 3.3.1.3).",
    el(
      "ul",
      {},
      ...ecarts.map((g) =>
        el(
          "li",
          {},
          g.intervenants.map((iv) => `${libelleIntervenant(k, iv)} (${iv})`).join(", "),
          `, ${MODALITES[g.modalite] ?? g.modalite} : `,
          lien(lienFiche(g.csarr), g.csarr),
          ` ${g.ponderation}${g.ponderation === 0 ? " (non attendu)" : ""}, retenue ; fichier CSAR ${g.fichierCsar}.`
        )
      )
    )
  );
}
