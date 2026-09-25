// Calcul du GME — groupage pas à pas d'un séjour d'hospitalisation complète
// (HC, une suite de RHS) ou d'un RHS d'hospitalisation à temps partiel
// (HTP), de la morbidité et des actes jusqu'au GME et à ses tarifs.
//
// Aucune règle de groupage n'est écrite ici : contrôles des diagnostics,
// orientation en CM et en GN, GN du séjour, pondération des actes, scores de
// réadaptation, GR, GL et sévérité sont ceux de smr.js (grouper, ponderer,
// calculerScores…), qui cite pour chacun le paragraphe du volume 1 du Manuel
// des GME qu'il applique. Le thème lit la saisie, appelle ces fonctions et
// montre ce qu'elles rendent, étape par étape. Les seules vérifications
// propres au thème sont celles d'un formulaire : champ vide, nombre
// illisible, dépendance hors des bornes que donne le manuel (1.2.3.6-7).
//
// Les scores spécialisés dépendent du GN (un acte n'est spécialisé que pour
// certains GN, 3.2) : le séjour est d'abord groupé sans scores, pour son GN,
// puis les scores sont calculés pour ce GN, puis le séjour est groupé à
// nouveau avec eux. Le GN ne dépend pas des scores : les deux passages le
// trouvent identique.
//
// Adresses : #/smr/calcul (saisie vide), #/smr/calcul/<exemple> (les trois
// exemples chiffrés du manuel : avc, paralysie, genou) et
// #/smr/calcul/saisie/<saisie> (la saisie en cours, encodée). L'adresse suit
// la saisie sans entrée d'historique (replaceState) : un lien copié rouvre le
// même cas, et « Signaler un problème », qui emporte l'adresse de la page,
// transmet le cas saisi tel quel.

import { el, fraicheur, nombre } from "../interface.js";
import { normaliser } from "../recherche.js";
import {
  chargerSmr,
  chargerTarifsSmr,
  calculerScores,
  cle,
  estSpecialise,
  graphie,
  grouper,
  libelleGroupe,
  lignePonderation,
  nomenclature,
  orienteDansCm,
  ponderer,
  positionAutorisee,
  transcoderCsar,
  TYPES_READAPTATION,
} from "../smr.js";
import { groupeLibelle, lienArbre, lienCode, lienFiche, lienTarifs, noteTarifsSmr, sourceFg, tableTarifsGme } from "../smr_interface.js";

// Même délai que les champs de recherche du site (interface.js) : regrouper
// entre deux touches d'une même saisie ne sert à rien.
const DELAI_FRAPPE = 120;
const SUGGESTIONS_MAX = 8;
// Bornes d'une saisie relue dans l'adresse : une adresse fabriquée ne doit
// pas faire construire des milliers de lignes de formulaire.
const RHS_MAX = 60;
const ACTES_MAX = 200;
const LONGUEUR_CHAMP_MAX = 400;
// Au-delà, les tests négatifs d'un parcours en GN se replient : la CM 01 en
// compte jusqu'à 25 avant son dernier GN.
const NEGATIFS_DEPLIES_MAX = 4;
// Le GN du séjour se décide sur les 10 premiers RHS (2.2.2) ; affiché pour
// expliquer le décompte, calculé par gnDuSejour.
const RHS_DECOMPTES = 10;
const VERSION_SAISIE = 1;
const ADRESSE = "#/smr/calcul";

const POSITIONS_LONGUES = {
  MMP: "manifestation morbide principale",
  AE: "affection étiologique",
  DAS: "diagnostic associé significatif",
};

// Conditions du seul test écrit en toutes lettres (GN 0871), telles que les
// donne GN_liste_tests.xlsx ; evaluerNoeud (smr.js) les applique.
const CONDITIONS = {
  mmpPrioritaire: "Si la MMP et l'AE sont classantes, seul le code en MMP est retenu comme classant.",
  quatreCaracteresDifferents:
    "Les 4 premiers caractères du code classant en DAS doivent différer de ceux du code classant en MMP ou AE.",
};

// Colonne « Modalité » du transcodage CSAR (CSAR_infos.xlsx, lisez-moi).
const MODALITES = { 0: "individuel", 1: "collectif", 2: "individuel ou collectif" };

// ==== Exemples du manuel ====

// Les trois cas chiffrés du volume 1, suivis d'une section à l'autre (2.3,
// 3.6, 4.4, 5.3 et 6.2), avec le GME que le manuel leur donne : le thème
// vérifie en les affichant qu'il le retrouve.
const EXEMPLES = {
  avc: {
    libelle: "AVC avec hémiplégie",
    precision: "patient X, HC, 61 ans",
    attendu: "0147SC1",
    etat: {
      hospitalisation: "HC",
      age: "61",
      cog: "6",
      phy: "13",
      rhs: [{ mmp: "G81.1", ae: "I63.4" }],
      mode: "scores",
      scores: { speSejour: "10620", speJour: "106", globSejour: "14400", globJour: "144" },
    },
  },
  paralysie: {
    libelle: "Paralysie cérébrale",
    precision: "enfant de 8 ans, HC",
    attendu: "0118PB1",
    etat: { hospitalisation: "HC", age: "8", cog: "6", phy: "10", rhs: [{ mmp: "G80.0" }], mode: "scores" },
  },
  genou: {
    libelle: "Lésion ligamentaire du genou",
    precision: "HTP, 39 ans",
    attendu: "0839JA0",
    etat: {
      hospitalisation: "HTP",
      age: "39",
      rhs: [{ mmp: "Z96.7", ae: "S83.5" }],
      mode: "scores",
      scores: { globJour: "123" },
    },
  },
};

// ==== Saisie ====

const rhsVide = () => ({ mmp: "", ae: "", das: "", ccam: "" });
const acteVide = (intervenant = "") => ({ code: "", intervenant, nombre: "1", lieu: "", temps: "", collectif: false });

function etatVide() {
  return {
    hospitalisation: "HC",
    age: "",
    cog: "",
    phy: "",
    postChirurgical: false,
    rhs: [rhsVide()],
    mode: "actes",
    scores: { speSejour: "", speJour: "", globSejour: "", globJour: "" },
    actes: [acteVide()],
    jours: { semaine: "", weekend: "", presence: "" },
  };
}

/** Une saisie partielle (exemple) complétée des valeurs vides. */
function completer(partiel) {
  const vide = etatVide();
  return {
    ...vide,
    ...partiel,
    rhs: (partiel.rhs ?? vide.rhs).map((r) => ({ ...rhsVide(), ...r })),
    scores: { ...vide.scores, ...partiel.scores },
    actes: (partiel.actes ?? vide.actes).map((a) => ({ ...acteVide(), ...a })),
    jours: { ...vide.jours, ...partiel.jours },
  };
}

// ---- Saisie ↔ adresse ----

// Tableaux plutôt qu'objets nommés : l'adresse reste courte (quelques
// centaines de caractères pour un séjour ordinaire). Le numéro de version
// en tête permet de relire une adresse d'une version antérieure du format.
function compacter(e) {
  return [
    VERSION_SAISIE,
    e.hospitalisation === "HTP" ? 1 : 0,
    e.age,
    e.cog,
    e.phy,
    e.postChirurgical ? 1 : 0,
    e.rhs.map((r) => [r.mmp, r.ae, r.das, r.ccam]),
    e.mode === "scores" ? 1 : 0,
    [e.scores.speSejour, e.scores.speJour, e.scores.globSejour, e.scores.globJour],
    e.actes.map((a) => [a.code, a.intervenant, a.nombre, a.lieu, a.temps, a.collectif ? 1 : 0]),
    [e.jours.semaine, e.jours.weekend, e.jours.presence],
  ];
}

/** L'inverse de compacter, sur une donnée qui vient d'une adresse : chaque
 *  valeur est ramenée à du texte borné, chaque liste à sa taille maximale. */
function decompacter(t) {
  if (!Array.isArray(t) || t[0] !== VERSION_SAISIE) throw new Error("version de saisie inconnue");
  const s = (v) => String(v ?? "").slice(0, LONGUEUR_CHAMP_MAX);
  const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const [, htp, age, cog, phy, chir, rhs, scores, [speSejour, speJour, globSejour, globJour] = [], actes, [semaine, weekend, presence] = []] = t;
  const lesRhs = liste(rhs, RHS_MAX).map((r) => {
    const [mmp, ae, das, ccam] = liste(r, 4);
    return { mmp: s(mmp), ae: s(ae), das: s(das), ccam: s(ccam) };
  });
  const lesActes = liste(actes, ACTES_MAX).map((a) => {
    const [code, intervenant, n, lieu, temps, collectif] = liste(a, 6);
    return { code: s(code), intervenant: s(intervenant), nombre: s(n), lieu: s(lieu), temps: s(temps), collectif: collectif === 1 };
  });
  return {
    hospitalisation: htp === 1 ? "HTP" : "HC",
    age: s(age),
    cog: s(cog),
    phy: s(phy),
    postChirurgical: chir === 1,
    rhs: lesRhs.length ? lesRhs : [rhsVide()],
    mode: scores === 1 ? "scores" : "actes",
    scores: { speSejour: s(speSejour), speJour: s(speJour), globSejour: s(globSejour), globJour: s(globJour) },
    actes: lesActes.length ? lesActes : [acteVide()],
    jours: { semaine: s(semaine), weekend: s(weekend), presence: s(presence) },
  };
}

function versBase64url(texte) {
  let binaire = "";
  for (const octet of new TextEncoder().encode(texte)) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function depuisBase64url(code) {
  const b = code.replace(/-/g, "+").replace(/_/g, "/");
  const binaire = atob(b + "===".slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(binaire, (c) => c.charCodeAt(0)));
}

const encoder = (e) => versBase64url(JSON.stringify(compacter(e)));
const estVide = (e) => JSON.stringify(compacter(e)) === JSON.stringify(compacter(etatVide()));

/** { etat, exemple, erreur } d'après ce qui suit le slug dans l'adresse. */
function lireChemin(chemin) {
  const [premier, second] = chemin;
  if (!premier) return { etat: etatVide(), exemple: null, erreur: null };
  if (EXEMPLES[premier]) return { etat: completer(EXEMPLES[premier].etat), exemple: premier, erreur: null };
  if (premier === "saisie" && second) {
    try {
      return { etat: decompacter(JSON.parse(depuisBase64url(second))), exemple: null, erreur: null };
    } catch {
      return { etat: etatVide(), exemple: null, erreur: "La saisie portée par l'adresse est illisible : le formulaire repart à vide." };
    }
  }
  return { etat: etatVide(), exemple: null, erreur: `« ${premier} » ne désigne ni un exemple du manuel ni une saisie : le formulaire repart à vide.` };
}

// ---- Lecture des champs ----

/** Codes d'un champ à plusieurs valeurs (DAS, actes CCAM) : séparés par des
 *  espaces, des virgules ou des points-virgules. */
const decouper = (texte) => String(texte ?? "").split(/[\s,;]+/).filter(Boolean);

/** « alq247 », « ALQ+247 » → « ALQ+247 » ; les autres codes d'actes en
 *  capitales, sans espace. Le « + » du CSARR s'oublie à la saisie ; sans
 *  lui, nomenclature() ne reconnaîtrait pas l'acte. */
function codeActe(saisie) {
  const c = String(saisie ?? "").toUpperCase().replace(/\s/g, "");
  return /^[A-Z]{3}\d{3}$/.test(c) ? `${c.slice(0, 3)}+${c.slice(3)}` : c;
}

/** Entier positif saisi : null si le champ est vide, NaN s'il est illisible. */
function lireEntier(v) {
  const t = String(v ?? "").replace(/\s/g, "");
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** Score saisi : espaces de milliers et virgule décimale admis. */
function lireScore(v) {
  const t = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

const arrondi = (n) => (n == null || Number.isNaN(n) ? "–" : nombre(Math.round(n * 10) / 10));

// ==== Index (gardés sur les jeux, partagés entre deux visites) ====

/** Codes CIM-10 triés par clef, avec leur libellé normalisé : suggestions
 *  par début de code (recherche dichotomique) ou par mots du libellé. */
function indexDiagnostics(jeu) {
  if (!jeu._calculIndex) {
    jeu._calculIndex = jeu.lignes
      .map((l) => ({ cle: cle(l.Code), code: l.Code, libelle: l["Libellé"], texte: normaliser(l["Libellé"]) }))
      .sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }
  return jeu._calculIndex;
}

/** Actes pondérés (CSARR, CCAM) et actes CSAR, triés par code. */
function indexActes(smr) {
  const jeu = smr.actes;
  if (!jeu._calculIndex) {
    const entrees = [...jeu._parCode].map(([code, lignes]) => ({
      cle: code,
      code,
      libelle: lignes[0]["Libellé"],
      texte: normaliser(lignes[0]["Libellé"]),
    }));
    for (const [code, lignes] of smr.csar._parCode) {
      entrees.push({ cle: code, code, libelle: lignes[0]["Libellé CSAR"], texte: normaliser(lignes[0]["Libellé CSAR"]) });
    }
    jeu._calculIndex = entrees.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  }
  return jeu._calculIndex;
}

/** Actes CCAM CMA (CMA_CCAM.xlsx), triés par code. */
function indexCmaCcam(k) {
  if (!k._calculCmaCcam) {
    k._calculCmaCcam = k.cmaCcam
      .map(([code, libelle]) => ({ cle: code, code, libelle, texte: normaliser(libelle) }))
      .sort((a, b) => (a.cle < b.cle ? -1 : 1));
  }
  return k._calculCmaCcam;
}

/** Les couples acte CSAR / intervenant / modalité dont la pondération dans
 *  le fichier CSAR de l'ATIH diffère de celle du CSARR transcodé. */
function ecartsCsar(csar) {
  if (!csar._calculEcarts) {
    csar._calculEcarts = csar.lignes
      .filter((l) => l["Pondération CSAR"] !== l["Pondération CSARR"])
      .sort((a, b) => (a["Code CSAR"] + a.Intervenant < b["Code CSAR"] + b.Intervenant ? -1 : 1));
  }
  return csar._calculEcarts;
}

/** Au plus SUGGESTIONS_MAX entrées de `index` dont le code commence par
 *  `saisie` (clef `clef`) ; à défaut, dont le libellé contient tous les
 *  mots de la saisie. Rien quand la saisie est déjà un code complet. */
function suggerer(index, saisie, clef) {
  const q = saisie.trim();
  if (q.length < 2) return [];
  const c = clef(q);
  let bas = 0;
  let haut = index.length;
  while (bas < haut) {
    const milieu = (bas + haut) >> 1;
    if (index[milieu].cle < c) bas = milieu + 1;
    else haut = milieu;
  }
  if (index[bas]?.cle === c && !index[bas + 1]?.cle.startsWith(c)) return [];
  const trouves = [];
  for (let i = bas; i < index.length && trouves.length < SUGGESTIONS_MAX && index[i].cle.startsWith(c); i++) trouves.push(index[i]);
  if (trouves.length || q.length < 3) return trouves;
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  for (const e of index) {
    if (mots.every((m) => e.texte.includes(m))) trouves.push(e);
    if (trouves.length >= SUGGESTIONS_MAX) break;
  }
  return trouves;
}

// ==== Petits composants ====

const code = (texte) => el("span", { class: "code" }, texte);
const note = (...enfants) => el("p", { class: "calcul-note" }, ...enfants);

function libelleErreur(k, n) {
  return k._erreurs.get(n)?.libelle ?? "erreur inconnue de FG_erreurs";
}

/** « Erreur 65 — Manifestation morbide principale non acceptée ». */
function texteErreur(k, n) {
  return [el("strong", {}, `Erreur ${n}`), ` — ${libelleErreur(k, n)}`];
}

/** Champ texte étiqueté ; `aide` sous le champ, lue avec lui. */
function champTexte({ id, libelle, valeur, exemple, aide, numerique = false, onInput, classe = "" }) {
  const input = el("input", {
    type: "text",
    id,
    value: valeur || undefined,
    placeholder: exemple,
    autocomplete: "off",
    spellcheck: "false",
    inputmode: numerique ? "numeric" : undefined,
    "aria-describedby": aide ? `${id}_aide` : undefined,
    oninput: (e) => onInput(e.target.value),
  });
  const bloc = el(
    "div",
    { class: `champ ${classe}`.trim() },
    el("label", { for: id }, libelle),
    input,
    aide ? el("p", { class: "champ-aide", id: `${id}_aide` }, aide) : null
  );
  return { bloc, input };
}

/** Suggestions sous un champ de code : liste de boutons, au clavier par les
 *  flèches ; Entrée prend la première, Échap la referme. `multiple` : le
 *  champ porte plusieurs codes, la suggestion remplace le dernier. */
function aideSaisie(input, conteneur, { chercher, multiple = false }) {
  const zone = el("div", { class: "calcul-suggestions" });
  conteneur.append(zone);
  let minuteur = null;

  const jeton = () => {
    if (!multiple) return { debut: 0, texte: input.value };
    const reste = input.value.match(/[^\s,;]*$/)[0];
    return { debut: input.value.length - reste.length, texte: reste };
  };
  const fermer = () => {
    zone.innerHTML = "";
  };
  const boutons = () => [...zone.querySelectorAll("button")];

  function proposer() {
    fermer();
    const trouves = chercher(jeton().texte);
    if (!trouves.length) return;
    zone.append(
      el(
        "ul",
        { class: "liste-suggestions", "aria-label": "Suggestions" },
        ...trouves.map((t) => el("li", {}, el("button", { type: "button", onclick: () => choisir(t.code) }, el("strong", {}, t.code), ` ${t.libelle}`)))
      )
    );
  }

  function choisir(valeur) {
    const { debut } = jeton();
    input.value = multiple ? `${input.value.slice(0, debut)}${valeur} ` : valeur;
    fermer();
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    clearTimeout(minuteur);
  }

  input.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(proposer, DELAI_FRAPPE);
  });
  input.addEventListener("keydown", (e) => {
    const liste = boutons();
    if (!liste.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      liste[0].focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      liste[0].click();
    } else if (e.key === "Escape") {
      e.stopPropagation(); // sinon la touche referme aussi le tiroir
      fermer();
    }
  });
  zone.addEventListener("keydown", (e) => {
    const liste = boutons();
    const i = liste.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (j < 0) input.focus();
      else liste[Math.min(j, liste.length - 1)].focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      fermer();
      input.focus();
    }
  });
  // La liste se referme quand le focus quitte le champ et ses suggestions.
  conteneur.addEventListener("focusout", (e) => {
    if (!conteneur.contains(e.relatedTarget)) fermer();
  });
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const promesseTarifs = chargerTarifsSmr().catch((erreur) => {
    console.error(erreur);
    return null;
  });
  const smr = await chargerSmr();
  const k = smr.classification;
  const D = smr.diagnostics._parCle;
  let tarifs = null;

  const lu = lireChemin(chemin);
  let etat = lu.etat;
  let exemple = lu.exemple;

  conteneur.innerHTML = "";

  // ---- Drapeau : tous les fichiers de l'ATIH que le groupage lit ----

  const jeux = [
    { libelle: smr.diagnostics.libelle, millesime: smr.diagnostics.millesime },
    { libelle: "listes d'exclusion des CMA", millesime: smr.exclusions.millesime },
    { libelle: smr.actes.libelle, millesime: smr.actes.millesime },
    { libelle: smr.actesSpe.libelle, millesime: smr.actesSpe.millesime },
    { libelle: smr.csar.libelle, millesime: smr.csar.millesime },
    ...[
      ["TOTAL_listes_groupes.xlsx", "libellés des groupes"],
      ["GN_liste_tests.xlsx", "tests d'entrée dans les GN"],
      ["GR_infos.xlsx", "types de réadaptation et seuils"],
      ["GL_infos.xlsx", "règles de lourdeur"],
      ["CMA_CCAM.xlsx", "actes CCAM CMA"],
      ["FG_erreurs.TXT", "erreurs de la fonction groupage"],
    ].map(([fichier, libelle]) => ({ libelle, millesime: k.millesimes?.[fichier] })),
  ].filter((j) => j.millesime);
  let drapeau = fraicheur(jeux);

  // ---- Exemples ----

  const boutonsExemples = Object.entries(EXEMPLES).map(([id, ex]) =>
    el(
      "button",
      { type: "button", class: "bouton-icone", "data-exemple": id, onclick: () => charger(completer(ex.etat), id) },
      ex.libelle,
      el("span", { class: "calcul-exemple-precision" }, ` — ${ex.precision}`)
    )
  );
  const effacer = el(
    "button",
    { type: "button", class: "bouton-icone calcul-effacer", onclick: () => charger(etatVide(), null) },
    "Effacer la saisie"
  );

  // ---- Formulaire ----

  const zoneSejour = el("div", {});
  const zoneRhs = el("div", { class: "calcul-rhs-liste" });
  const zoneReadaptation = el("div", {});
  const formulaire = el(
    "form",
    { class: "calcul-formulaire calcul-smr", novalidate: "", onsubmit: (e) => e.preventDefault() },
    el("section", { class: "calcul-carte", "aria-labelledby": "calcul_sejour_titre" }, el("h2", { id: "calcul_sejour_titre" }, "Séjour"), zoneSejour),
    el(
      "section",
      { class: "calcul-carte", "aria-labelledby": "calcul_morbidite_titre" },
      el("h2", { id: "calcul_morbidite_titre" }, "Morbidité"),
      zoneRhs
    ),
    el(
      "section",
      { class: "calcul-carte", "aria-labelledby": "calcul_readaptation_titre" },
      el("h2", { id: "calcul_readaptation_titre" }, "Réadaptation"),
      zoneReadaptation
    )
  );

  // ---- Résultat ----

  const annonce = el("p", { class: "visuellement-cache", role: "status", "aria-live": "polite" });
  const zoneFil = el("div", { class: "calcul-fil-zone" });
  const zoneEtapes = el("div", { class: "calcul-etapes" });

  // append() natif écrirait « null » là où el() ignore un enfant absent.
  const morceaux = [
    el("h1", {}, "Calcul du GME"),
    sourceFg(),
    drapeau,
    el(
      "p",
      {},
      "Groupe pas à pas un séjour d'hospitalisation complète (HC) ou un RHS d'hospitalisation à temps partiel (HTP) : contrôles des diagnostics et des actes, catégorie majeure, groupe nosologique, type de réadaptation, niveaux de lourdeur et de sévérité, puis le GME et ses tarifs. Les scores de réadaptation se saisissent, ou se calculent à partir des actes. Les règles appliquées sont celles décrites dans l'",
      el("a", { class: "lien-texte", href: lienArbre(null) }, "algorithme de la fonction groupage"),
      "."
    ),
    el(
      "p",
      { class: "message-info calcul-avertissement" },
      el("strong", {}, "Outil d'aide, pas un groupeur. "),
      "Le calcul suit la version provisoire de la fonction groupage SMR 2026 et ne remplace pas le groupeur officiel de l'ATIH. Seuls les diagnostics et les actes sont contrôlés : le format du RHS (dates, numéros, champs obligatoires) ne l'est pas."
    ),
    lu.erreur ? el("p", { class: "message-avertissement" }, lu.erreur) : null,
    el(
      "div",
      { class: "calcul-exemples", role: "group", "aria-labelledby": "calcul_exemples_titre" },
      el("span", { class: "calcul-exemples-titre", id: "calcul_exemples_titre" }, "Exemples du manuel :"),
      ...boutonsExemples,
      effacer
    ),
    formulaire,
    el(
      "section",
      { class: "calcul-resultat calcul-smr", "aria-labelledby": "calcul_resultat_titre" },
      el("h2", { id: "calcul_resultat_titre" }, "Groupage"),
      zoneFil,
      zoneEtapes,
      annonce
    ),
  ];
  conteneur.append(...morceaux.filter(Boolean));

  promesseTarifs.then((t) => {
    if (!t || !conteneur.contains(zoneEtapes)) return;
    tarifs = t;
    const complet = fraicheur([...jeux, { libelle: t.libelle, millesime: t.millesime }]);
    drapeau.replaceWith(complet);
    drapeau = complet;
    calculer();
  });

  // ---- Mise à jour ----

  let minuteur = null;
  /** Toute modification de la saisie passe par là : l'exemple chargé cesse
   *  de l'être, le calcul et l'adresse suivent après la frappe. */
  function modifie(immediat = false) {
    exemple = null;
    clearTimeout(minuteur);
    if (immediat) calculer();
    else minuteur = setTimeout(calculer, DELAI_FRAPPE);
  }

  function charger(nouvel, id) {
    etat = nouvel;
    exemple = id;
    clearTimeout(minuteur);
    rendreSejour();
    rendreRhs();
    rendreReadaptation();
    calculer();
  }

  function mettreAdresse() {
    // Un calcul en attente peut tomber après un changement de page : il ne
    // doit pas réécrire l'adresse de la page suivante.
    if (!location.hash.startsWith(ADRESSE)) return;
    const cible = exemple ? `${ADRESSE}/${exemple}` : estVide(etat) ? ADRESSE : `${ADRESSE}/saisie/${encoder(etat)}`;
    if (location.hash !== cible) history.replaceState(null, "", cible);
  }

  // ==== Séjour ====

  let blocLourdeur = null;
  let noteHtp = null;
  let aideAge = null;

  function rendreSejour() {
    zoneSejour.innerHTML = "";
    const radio = (valeur, libelle, precision) =>
      el(
        "label",
        { class: "toggle" },
        el("input", {
          type: "radio",
          name: "calcul_hospitalisation",
          value: valeur,
          checked: etat.hospitalisation === valeur ? "" : undefined,
          onchange: () => {
            etat.hospitalisation = valeur;
            basculerHospitalisation();
            modifie(true);
          },
        }),
        el("span", {}, el("strong", {}, libelle), ` ${precision}`)
      );
    const age = champTexte({
      id: "calcul_age",
      libelle: "Âge (années)",
      valeur: etat.age,
      exemple: "ex. : 61",
      numerique: true,
      aide: "",
      classe: "champ-court",
      onInput: (v) => {
        etat.age = v;
        modifie();
      },
    });
    aideAge = el("p", { class: "champ-aide", id: "calcul_age_aide" });
    age.bloc.append(aideAge);
    age.input.setAttribute("aria-describedby", "calcul_age_aide");

    const phy = champTexte({
      id: "calcul_phy",
      libelle: "Dépendance physique (4 à 16)",
      valeur: etat.phy,
      exemple: "ex. : 13",
      numerique: true,
      aide: "Somme des quatre items ; maximum des RHS du séjour (1.2.3.6).",
      classe: "champ-court",
      onInput: (v) => {
        etat.phy = v;
        modifie();
      },
    });
    const cog = champTexte({
      id: "calcul_cog",
      libelle: "Dépendance cognitive (2 à 8)",
      valeur: etat.cog,
      exemple: "ex. : 6",
      numerique: true,
      aide: "Somme des deux items ; maximum des RHS du séjour (1.2.3.7).",
      classe: "champ-court",
      onInput: (v) => {
        etat.cog = v;
        modifie();
      },
    });
    const chir = el(
      "div",
      { class: "champ champ-court" },
      el("span", { class: "champ-toggle", id: "calcul_chir_titre" }, "Statut post-chirurgical"),
      el(
        "label",
        { class: "toggle" },
        el("input", {
          type: "checkbox",
          id: "calcul_chir",
          checked: etat.postChirurgical ? "" : undefined,
          "aria-describedby": "calcul_chir_aide",
          onchange: (e) => {
            etat.postChirurgical = e.target.checked;
            modifie(true);
          },
        }),
        "Intervention il y a 90 jours ou moins"
      ),
      el("p", { class: "champ-aide", id: "calcul_chir_aide" }, "D'après la date d'intervention du premier RHS (1.2.3.8).")
    );
    blocLourdeur = el("div", { class: "calcul-champs" }, phy.bloc, cog.bloc, chir);
    noteHtp = note(
      "En HTP, le niveau de lourdeur vaut A par convention (4.2.1) : dépendances et statut post-chirurgical n'interviennent pas, et le niveau de sévérité vaut 0 (5.1)."
    );
    zoneSejour.append(
      el(
        "fieldset",
        { class: "calcul-choix" },
        el("legend", {}, "Type d'hospitalisation"),
        radio("HC", "Hospitalisation complète (HC)", "— un séjour, un ou plusieurs RHS"),
        radio("HTP", "Hospitalisation à temps partiel (HTP)", "— un RHS")
      ),
      el("div", { class: "calcul-champs" }, age.bloc),
      blocLourdeur,
      noteHtp
    );
    basculerHospitalisation(false);
  }

  /** HC ↔ HTP : ce qui ne sert qu'à l'un se masque, sans rien effacer — un
   *  retour à l'autre type retrouve la saisie. */
  function basculerHospitalisation(rendreLeReste = true) {
    const hc = etat.hospitalisation === "HC";
    blocLourdeur.hidden = !hc;
    noteHtp.hidden = hc;
    aideAge.textContent = hc
      ? "Au premier RHS du séjour (1.2.3.5) : il décide du type pédiatrique (moins de 18 ans) et de la lourdeur."
      : "Au RHS (1.2.3.5) : il décide du type pédiatrique (moins de 18 ans).";
    if (rendreLeReste) {
      rendreRhs();
      rendreReadaptation();
    }
  }

  // ==== Morbidité (RHS) ====

  function rendreRhs(focus = null) {
    zoneRhs.innerHTML = "";
    const hc = etat.hospitalisation === "HC";
    const visibles = hc ? etat.rhs : etat.rhs.slice(0, 1);
    zoneRhs.append(
      note(
        hc
          ? "Chaque RHS est groupé en CM puis en GN ; le séjour prend le GN le plus fréquent de ses 10 premiers RHS (2.2.2). Les CMA sont cherchées dans tous les RHS (5.2.3). Codes avec ou sans point ; plusieurs DAS ou actes séparés par un espace."
          : "Le RHS est groupé seul (2.2.2). Codes avec ou sans point ; plusieurs DAS ou actes séparés par un espace."
      )
    );
    visibles.forEach((r, i) => zoneRhs.append(carteRhs(r, i, hc)));
    if (!hc && etat.rhs.length > 1) {
      zoneRhs.append(
        note(`En HTP, seul le premier RHS est groupé ; les ${etat.rhs.length - 1} autres restent saisis pour un retour en HC.`)
      );
    }
    if (hc) {
      zoneRhs.append(
        el(
          "p",
          { class: "calcul-boutons" },
          el(
            "button",
            {
              type: "button",
              class: "bouton-icone",
              disabled: etat.rhs.length >= RHS_MAX ? "" : undefined,
              onclick: () => {
                etat.rhs.push(rhsVide());
                rendreRhs(etat.rhs.length - 1);
                modifie(true);
              },
            },
            "Ajouter un RHS"
          )
        )
      );
    }
    if (focus != null) document.getElementById(`calcul_rhs${focus}_mmp`)?.focus();
  }

  function carteRhs(r, i, hc) {
    const n = i + 1;
    const prefixe = `calcul_rhs${i}`;
    const champCode = (quoi, libelle, exemple, lecture, { multiple = false, index }) => {
      const c = champTexte({
        id: `${prefixe}_${quoi}`,
        libelle,
        valeur: r[quoi],
        exemple,
        classe: "calcul-champ-code",
        onInput: (v) => {
          r[quoi] = v;
          majLecture();
          modifie();
        },
      });
      const zoneLecture = el("div", { class: "calcul-lecture-zone", id: `${prefixe}_${quoi}_lecture`, "aria-live": "polite" });
      c.input.setAttribute("aria-describedby", zoneLecture.id);
      const majLecture = () => {
        zoneLecture.innerHTML = "";
        const liste = lecture(r[quoi]);
        if (liste) zoneLecture.append(liste);
      };
      aideSaisie(c.input, c.bloc, { chercher: (t) => suggerer(index(), t, quoi === "ccam" ? codeActe : cle), multiple });
      c.bloc.append(zoneLecture);
      majLecture();
      return c.bloc;
    };
    const diag = () => indexDiagnostics(smr.diagnostics);
    const entete = el(
      "div",
      { class: "calcul-rhs-entete" },
      el("h3", { id: `${prefixe}_titre` }, hc ? `RHS ${n}` : "RHS"),
      hc
        ? el(
            "span",
            { class: "calcul-rhs-actions" },
            el(
              "button",
              {
                type: "button",
                class: "bouton-icone",
                "aria-label": `Dupliquer le RHS ${n}`,
                disabled: etat.rhs.length >= RHS_MAX ? "" : undefined,
                onclick: () => {
                  etat.rhs.splice(i + 1, 0, { ...r });
                  rendreRhs(i + 1);
                  modifie(true);
                },
              },
              "Dupliquer"
            ),
            etat.rhs.length > 1
              ? el(
                  "button",
                  {
                    type: "button",
                    class: "bouton-icone",
                    "aria-label": `Retirer le RHS ${n}`,
                    onclick: () => {
                      etat.rhs.splice(i, 1);
                      rendreRhs(Math.max(0, i - 1));
                      modifie(true);
                    },
                  },
                  "Retirer"
                )
              : null
          )
        : null
    );
    return el(
      "fieldset",
      { class: "calcul-rhs", "aria-labelledby": `${prefixe}_titre` },
      entete,
      el(
        "div",
        { class: "calcul-champs" },
        champCode("mmp", "Manifestation morbide principale (MMP)", "ex. : G81.1", (v) => lectureDiagnostics(v, "MMP"), { index: diag }),
        champCode("ae", "Affection étiologique (AE)", "ex. : I63.4", (v) => lectureDiagnostics(v, "AE"), { index: diag })
      ),
      el(
        "div",
        { class: "calcul-champs" },
        champCode("das", "Diagnostics associés (DAS)", "ex. : E11.9 N18.3", (v) => lectureDiagnostics(v, "DAS"), { multiple: true, index: diag }),
        champCode("ccam", "Actes CCAM (pour les CMA)", "ex. : EBLA003", lectureCcam, { multiple: true, index: () => indexCmaCcam(k) })
      )
    );
  }

  /** Ce que les listes de l'ATIH disent de chaque code saisi à cette
   *  position : libellé, position permise, CM, deuxième intention, CMA. */
  function lectureDiagnostics(valeur, position) {
    const codes = position === "DAS" ? decouper(valeur) : [valeur.trim()].filter(Boolean);
    if (!codes.length) return null;
    return el(
      "ul",
      { class: "calcul-lecture" },
      ...codes.map((saisi) => {
        const d = D.get(cle(saisi));
        if (!d) return el("li", { class: "inconnu" }, code(graphie(saisi)), " absent de la CIM-10 de la fonction groupage SMR");
        const marques = [];
        if (!positionAutorisee(d, position)) marques.push(el("span", { class: "calcul-marque attention" }, `non accepté en ${position}`));
        if (position !== "DAS") marques.push(el("span", { class: "calcul-marque" }, orienteDansCm(d) ? `CM ${d.CM}` : "n'oriente dans aucune CM"));
        if (position === "MMP" && d["Deuxième intention"]) marques.push(el("span", { class: "calcul-marque" }, "oriente en deuxième intention"));
        if (d.CMA && position !== "AE") marques.push(el("span", { class: "calcul-marque cma" }, "CMA"));
        return el("li", {}, lienCode(d.Code), ` ${d["Libellé"]} `, ...marques);
      })
    );
  }

  function lectureCcam(valeur) {
    const codes = decouper(valeur).map(codeActe);
    if (!codes.length) return null;
    return el(
      "ul",
      { class: "calcul-lecture" },
      ...codes.map((c) => {
        const acte = c.slice(0, 7);
        if (!/^[A-Z]{4}\d{3}$/.test(acte)) return el("li", { class: "inconnu" }, code(c), " : code CCAM attendu (4 lettres, 3 chiffres)");
        const libelle = k._cmaCcam.get(acte);
        if (libelle) return el("li", {}, code(acte), ` ${libelle} `, el("span", { class: "calcul-marque cma" }, "CMA"));
        return el("li", {}, code(acte), " n'est pas une CMA CCAM : sans effet sur la sévérité");
      })
    );
  }

  // ==== Réadaptation ====

  let zoneScores = null;
  let zoneActes = null;
  let corpsActes = null;
  let zoneScoresCalcules = null;
  let lignesActes = []; // { tbody, maj(pondere, gn) } par acte, dans l'ordre de etat.actes

  function rendreReadaptation() {
    zoneReadaptation.innerHTML = "";
    const hc = etat.hospitalisation === "HC";
    const radio = (valeur, libelle) =>
      el(
        "label",
        { class: "toggle" },
        el("input", {
          type: "radio",
          name: "calcul_mode",
          value: valeur,
          checked: etat.mode === valeur ? "" : undefined,
          onchange: () => {
            etat.mode = valeur;
            zoneActes.hidden = valeur !== "actes";
            zoneScores.hidden = valeur !== "scores";
            modifie(true);
          },
        }),
        libelle
      );

    // -- Scores saisis --
    const score = (quoi, libelle, exemple) =>
      champTexte({
        id: `calcul_score_${quoi}`,
        libelle,
        valeur: etat.scores[quoi],
        exemple,
        numerique: true,
        classe: "champ-court",
        onInput: (v) => {
          etat.scores[quoi] = v;
          modifie();
        },
      }).bloc;
    zoneScores = el(
      "div",
      { class: "calcul-scores", hidden: etat.mode !== "scores" ? "" : undefined },
      hc
        ? el(
            "div",
            { class: "calcul-champs" },
            score("speSejour", "Score spécialisé par séjour", "ex. : 10620"),
            score("speJour", "Score spécialisé par jour", "ex. : 106"),
            score("globSejour", "Score global par séjour", "ex. : 14400"),
            score("globJour", "Score global par jour", "ex. : 144")
          )
        : el("div", { class: "calcul-champs" }, score("globJour", "Score global par jour", "ex. : 123")),
      note(
        hc
          ? "Scores du séjour (3.3.2.1) : le score spécialisé ne compte que les actes spécialisés pour le GN du séjour. Un score non saisi compte pour 0."
          : "Score de la semaine divisé par les jours de présence (3.3.2.2). Non saisi, il compte pour 0."
      )
    );

    // -- Actes --
    zoneScoresCalcules = el("div", { class: "calcul-scores-calcules", "aria-live": "polite" });
    const entete = (texte, classe) => el("th", { scope: "col", class: classe }, texte);
    const table = el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          entete("Acte"),
          entete("Intervenant"),
          entete("Nombre", "nombre"),
          entete("Lieu"),
          entete("Temps"),
          entete("Collectif"),
          entete("Pondération", "nombre"),
          el("th", { scope: "col" }, el("span", { class: "visuellement-cache" }, "Retirer"))
        )
      )
    );
    const jour = (quoi, libelle, aide) =>
      champTexte({
        id: `calcul_jours_${quoi}`,
        libelle,
        valeur: etat.jours[quoi],
        exemple: "ex. : 10",
        numerique: true,
        aide,
        classe: "champ-court",
        onInput: (v) => {
          etat.jours[quoi] = v;
          modifie();
        },
      }).bloc;
    zoneActes = el(
      "div",
      { class: "calcul-actes-zone", hidden: etat.mode !== "actes" ? "" : undefined },
      note(
        "Actes CSARR, CCAM de réadaptation ou CSAR, réalisés pendant le ",
        hc ? "séjour" : "semaine du RHS",
        ". Le lieu ne propose que les modulateurs qui majorent la pondération (3.3.1.4) ; le temps et la modalité collective ne concernent que le CSAR (3.1.1, 3.3.1.3)."
      ),
      el("div", { class: "codes-liste calcul-actes" }, table),
      el(
        "p",
        { class: "calcul-boutons" },
        el(
          "button",
          {
            type: "button",
            class: "bouton-icone",
            onclick: () => {
              if (etat.actes.length >= ACTES_MAX) return;
              const dernier = etat.actes[etat.actes.length - 1];
              etat.actes.push(acteVide(dernier?.intervenant ?? ""));
              ajouterLigneActe(etat.actes.length - 1, true);
              modifie(true);
            },
          },
          "Ajouter un acte"
        )
      ),
      hc
        ? el(
            "div",
            { class: "calcul-champs" },
            jour("semaine", "Jours de présence du lundi au vendredi", "Sur tout le séjour : dénominateur des scores par jour (3.3.2.1)."),
            jour("weekend", "Jours de présence le week-end", "Dénominateur à défaut de tout jour de semaine (3.3.2.1).")
          )
        : el("div", { class: "calcul-champs" }, jour("presence", "Jours de présence dans la semaine", "Dénominateur du score par jour (3.3.2.2).")),
      zoneScoresCalcules,
      blocEcarts()
    );
    // Un <tbody> par acte : sa ligne de saisie et celle du détail.
    corpsActes = table;
    lignesActes = [];
    etat.actes.forEach((_, i) => ajouterLigneActe(i, false));

    zoneReadaptation.append(
      el(
        "fieldset",
        { class: "calcul-choix" },
        el("legend", {}, "Scores de réadaptation"),
        radio("actes", "Calculer à partir des actes"),
        radio("scores", "Saisir les scores")
      ),
      zoneActes,
      zoneScores
    );
  }

  /** Les couples acte CSAR / intervenant dont le fichier CSAR de l'ATIH et le
   *  CSARR transcodé ne donnent pas la même pondération : le groupage retient
   *  la seconde (3.3.1.3). Chacun s'essaie d'un clic. */
  function blocEcarts() {
    const ecarts = ecartsCsar(smr.csar);
    if (!ecarts.length) return null;
    const couples = ecarts.length > 1 ? `${ecarts.length} couples` : "un couple";
    return el(
      "details",
      { class: "calcul-ecarts" },
      el("summary", {}, `Écarts de pondération CSAR : ${couples} acte / intervenant`),
      note(
        "Pour ces couples, la pondération que donne le fichier CSAR de l'ATIH (ACTES_ponderations_CSAR_transcodage) diffère de celle du CSARR transcodé ; la fonction groupage retient celle du CSARR transcodé, ou celle du modulateur de temps si elle est plus élevée (volume 1, 3.3.1.3). Un acte saisi dans l'un de ces couples porte l'étiquette « écart ». Les intervenants 80 et 81, transposés en infirmier (3.3.1.2), héritent des écarts de l'intervenant 21."
      ),
      el(
        "div",
        { class: "codes-liste calcul-table" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", { scope: "col" }, "Acte CSAR"),
              el("th", { scope: "col" }, "Intervenant"),
              el("th", { scope: "col" }, "CSARR transcodé"),
              el("th", { scope: "col", class: "nombre" }, "Fichier CSAR"),
              el("th", { scope: "col", class: "nombre" }, "Retenue"),
              el("th", { scope: "col" }, el("span", { class: "visuellement-cache" }, "Essayer"))
            )
          ),
          el(
            "tbody",
            {},
            ...ecarts.map((l) =>
              el(
                "tr",
                {},
                el("td", {}, lienCode(l["Code CSAR"]), el("span", { class: "calcul-sous-libelle" }, `${l["Libellé CSAR"]} (${MODALITES[l["Modalité"]] ?? l["Modalité"]})`)),
                el("td", {}, code(l.Intervenant), ` ${k.intervenants[l.Intervenant] ?? ""}`),
                el("td", {}, lienCode(l["Code CSARR"])),
                el("td", { class: "nombre" }, String(l["Pondération CSAR"])),
                el("td", { class: "nombre" }, String(l["Pondération CSARR"])),
                el(
                  "td",
                  {},
                  el(
                    "button",
                    {
                      type: "button",
                      class: "bouton-icone",
                      "aria-label": `Essayer ${l["Code CSAR"]} avec l'intervenant ${l.Intervenant}`,
                      onclick: () => essayer(l),
                    },
                    "Essayer"
                  )
                )
              )
            )
          )
        )
      )
    );
  }

  /** Ajoute un couple en écart à la liste d'actes (à la place d'une ligne
   *  vide s'il y en a une) et passe au calcul par les actes. */
  function essayer(l) {
    const acte = { ...acteVide(l.Intervenant), code: l["Code CSAR"], collectif: l["Modalité"] === "1" };
    const vide = etat.actes.findIndex((a) => !a.code.trim());
    if (vide >= 0) etat.actes[vide] = acte;
    else if (etat.actes.length < ACTES_MAX) etat.actes.push(acte);
    etat.mode = "actes";
    rendreReadaptation();
    modifie(true);
    const i = vide >= 0 ? vide : etat.actes.length - 1;
    document.getElementById(`calcul_acte${i}_code`)?.focus();
  }

  // ---- Une ligne d'acte ----

  // Modulateurs de lieu CSARR qui majorent la pondération (table
  // « modulateurs » de ACTES_ponderations) ; ceux du CSAR (L1, L2, L3)
  // viennent de CSAR_infos.
  const lieuxCsarr = k.modulateurs.filter(([, , individuel, collectif]) => individuel || collectif);

  function ajouterLigneActe(i, focus) {
    const a = etat.actes[i];
    const prefixe = `calcul_acte${i}`;
    const n = i + 1;
    const cellule = (libelle, ...enfants) => el("td", { "data-libelle": libelle }, ...enfants);
    const celluleNombre = (libelle, ...enfants) => el("td", { "data-libelle": libelle, class: "nombre" }, ...enfants);

    const saisieCode = el("input", {
      type: "text",
      id: `${prefixe}_code`,
      value: a.code || undefined,
      placeholder: "ex. : ALQ+247",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": `Code de l'acte ${n}`,
      oninput: (e) => {
        a.code = e.target.value;
        adapter();
        modifie();
      },
    });
    const celluleCode = cellule("Acte", saisieCode);
    celluleCode.classList.add("calcul-acte-code");
    aideSaisie(saisieCode, celluleCode, { chercher: (t) => suggerer(indexActes(smr), t, codeActe) });

    const intervenants = Object.entries(k.intervenants);
    const propresCsar = new Set(Object.keys(k.csar.transposition));
    const option = ([c, libelle]) => el("option", { value: c, selected: a.intervenant === c ? "" : undefined }, `${c} ${libelle}`);
    const choixIntervenant = el(
      "select",
      {
        id: `${prefixe}_intervenant`,
        "aria-label": `Intervenant de l'acte ${n}`,
        onchange: (e) => {
          a.intervenant = e.target.value;
          adapter();
          modifie(true);
        },
      },
      el("option", { value: "" }, "(à choisir)"),
      el("optgroup", { label: "Intervenants" }, ...intervenants.filter(([c]) => !propresCsar.has(c)).map(option)),
      el("optgroup", { label: "Intervenants CSAR, transposés en 21" }, ...intervenants.filter(([c]) => propresCsar.has(c)).map(option))
    );

    const saisieNombre = el("input", {
      type: "text",
      id: `${prefixe}_nombre`,
      value: a.nombre || undefined,
      inputmode: "numeric",
      autocomplete: "off",
      "aria-label": `Nombre de réalisations de l'acte ${n}`,
      oninput: (e) => {
        a.nombre = e.target.value;
        modifie();
      },
    });
    const choixLieu = el("select", {
      id: `${prefixe}_lieu`,
      "aria-label": `Modulateur de lieu de l'acte ${n}`,
      onchange: (e) => {
        a.lieu = e.target.value;
        modifie(true);
      },
    });
    const choixTemps = el(
      "select",
      {
        id: `${prefixe}_temps`,
        "aria-label": `Modulateur de temps de l'acte ${n}`,
        onchange: (e) => {
          a.temps = e.target.value;
          modifie(true);
        },
      },
      el("option", { value: "" }, "—"),
      ...k.csar.temps.map(([c, libelle, poids]) => el("option", { value: c, selected: a.temps === c ? "" : undefined }, `${c} ${libelle} : ${poids}`))
    );
    const caseCollectif = el("input", {
      type: "checkbox",
      id: `${prefixe}_collectif`,
      checked: a.collectif ? "" : undefined,
      "aria-label": `Modalité collective de l'acte ${n}`,
      onchange: (e) => {
        a.collectif = e.target.checked;
        adapter();
        modifie(true);
      },
    });
    const sortiePonderation = el("output", { class: "calcul-ponderation", for: `${prefixe}_code` }, "–");
    // L'étiquette « écart » se pose sous la pondération : visible d'un coup
    // d'œil dans la colonne, expliquée dans la ligne de détail.
    const etiquette = el("span", { class: "etiquette-ecart", hidden: "" }, "écart");
    const celluleSortie = celluleNombre("Pondération", sortiePonderation, etiquette);
    const detail = el("td", { class: "calcul-acte-detail", colspan: "8" });
    const retirer = el(
      "button",
      {
        type: "button",
        class: "bouton-icone calcul-retirer",
        "aria-label": `Retirer l'acte ${n}`,
        title: "Retirer l'acte",
        onclick: () => {
          etat.actes.splice(i, 1);
          if (!etat.actes.length) etat.actes.push(acteVide());
          rendreReadaptation();
          modifie(true);
          const suivant = document.getElementById(`calcul_acte${Math.min(i, etat.actes.length - 1)}_code`);
          suivant?.focus();
        },
      },
      el("span", { class: "icone", "aria-hidden": "true" })
    );

    const tbody = el(
      "tbody",
      { class: "calcul-acte" },
      el(
        "tr",
        { class: "calcul-acte-saisie" },
        celluleCode,
        cellule("Intervenant", choixIntervenant),
        celluleNombre("Nombre", saisieNombre),
        cellule("Lieu", choixLieu),
        cellule("Temps", choixTemps),
        cellule("Collectif", caseCollectif),
        celluleSortie,
        el("td", { class: "calcul-acte-retirer" }, retirer)
      ),
      el("tr", { class: "calcul-acte-suite" }, detail)
    );
    corpsActes.append(tbody);

    /** Les commandes que la nomenclature de l'acte admet : lieu CSARR ou
     *  CSAR selon le code, temps et modalité collective en CSAR seulement,
     *  intervenant sans objet en CCAM. Une valeur que l'acte n'accepte pas
     *  est retirée de la saisie : le calcul l'ignorerait sans le dire. */
    let signature = null;
    function adapter() {
      const c = codeActe(a.code);
      const nature = nomenclature(c);
      let lieux = [];
      let tempsAccepte = false;
      let collectifAccepte = false;
      let collectifImpose = false;
      if (nature === "CSARR") {
        const ligne = lignePonderation(smr, c, a.intervenant) ?? smr.actes._parCode.get(c)?.[0];
        lieux = lieuxCsarr.map(([m, libelle]) => [m, libelle, !!ligne?.[m]]);
        collectifImpose = ligne?.Type === "C";
      } else if (nature === "CSAR") {
        const [tps, l1, l2, l3] = k.csar.modulables[c] ?? [false, false, false, false];
        const acceptes = { L1: l1, L2: l2, L3: l3 };
        lieux = k.csar.lieu.map(([m, libelle]) => [m, libelle, !!acceptes[m]]);
        tempsAccepte = tps;
        collectifAccepte = (smr.csar._parCode.get(c) ?? []).some((l) => l["Modalité"] !== "0");
      }
      const empreinte = JSON.stringify([c, nature, lieux, a.intervenant]);
      if (empreinte !== signature) {
        signature = empreinte;
        choixLieu.innerHTML = "";
        choixLieu.append(
          el("option", { value: "" }, "—"),
          ...lieux.map(([m, libelle, ok]) =>
            el("option", { value: m, disabled: ok ? undefined : "" }, `${m} ${libelle}${ok ? "" : " (non accepté par l'acte)"}`)
          )
        );
        if (!lieux.some(([m, , ok]) => ok && m === a.lieu)) a.lieu = "";
        choixLieu.value = a.lieu;
      }
      choixLieu.disabled = !lieux.length;
      choixTemps.disabled = !tempsAccepte;
      if (!tempsAccepte && a.temps) {
        a.temps = "";
        choixTemps.value = "";
      }
      choixIntervenant.disabled = nature === "CCAM";
      caseCollectif.disabled = !collectifAccepte;
      if (nature === "CSAR" && !collectifAccepte && a.collectif) a.collectif = false;
      caseCollectif.checked = nature === "CSAR" ? a.collectif : collectifImpose;
      caseCollectif.title = collectifImpose ? "Acte CSARR collectif par nature (type C)" : "";
    }
    adapter();

    /** Sortie de l'acte, après calcul : pondération, détail de ponderer(),
     *  erreur, caractère spécialisé pour le GN du séjour, écart CSAR. */
    function maj(p, gn) {
      detail.innerHTML = "";
      tbody.classList.toggle("ecart", !!p?.ecart);
      etiquette.hidden = !p?.ecart;
      if (p?.ecart) etiquette.title = `Pondération du fichier CSAR : ${p.ecart.fichier} ; du CSARR transcodé, retenue : ${p.ecart.retenue}`;
      tbody.classList.toggle("en-erreur", !!(p && (p.erreur || p.manque)));
      if (!p) {
        sortiePonderation.textContent = "–";
        return;
      }
      const morceaux = [];
      if (p.libelle) morceaux.push(el("span", { class: "calcul-acte-libelle" }, code(p.code), ` ${p.libelle}`));
      if (p.manque) {
        sortiePonderation.textContent = "–";
        morceaux.push(el("span", { class: "calcul-acte-erreur" }, p.manque));
      } else if (p.erreur) {
        sortiePonderation.textContent = "–";
        morceaux.push(
          el(
            "span",
            { class: "calcul-acte-erreur" },
            ...texteErreur(k, p.erreur),
            k._erreurs.get(p.erreur)?.bloquant === false ? " (non bloquante)" : " (bloquante)",
            " : l'acte n'est pas compté dans les scores."
          )
        );
      } else {
        sortiePonderation.textContent = p.nombre > 1 ? `${nombre(p.nombre)} × ${nombre(p.unitaire)} = ${nombre(p.ponderation)}` : nombre(p.ponderation);
        morceaux.push(el("span", {}, p.detail.join(" ")));
        if (gn) {
          morceaux.push(
            estSpecialise(smr, p.csarr, gn)
              ? el("span", { class: "calcul-marque cma" }, `spécialisé pour le GN ${gn}`)
              : el("span", { class: "calcul-marque" }, `non spécialisé pour le GN ${gn}`)
          );
        }
      }
      if (p.ecart) {
        const e = p.ecart;
        morceaux.push(
          el(
            "span",
            { class: "calcul-ecart" },
            el(
              "span",
              { class: "etiquette-ecart", title: `Pondération du fichier CSAR : ${e.fichier} ; du CSARR transcodé : ${e.retenue}` },
              "écart"
            ),
            ` Le fichier CSAR de l'ATIH donne ${e.fichier} à ${p.code} pour l'intervenant ${e.intervenant}${e.modalite ? `, ${e.modalite}` : ""} ; la fonction groupage retient la pondération du CSARR transcodé ${e.csarr}, ${e.retenue}${e.retenue === 0 ? " (intervenant non attendu)" : ""} (3.3.1.3).`
          )
        );
      }
      detail.append(...morceaux);
    }

    lignesActes[i] = { maj };
    if (focus) saisieCode.focus();
  }

  // ==== Calcul ====

  /** La pondération de chaque acte saisi, ou ce qui manque pour la
   *  calculer ; `ecart` quand le couple CSAR / intervenant est l'un de
   *  ceux où le fichier CSAR et le CSARR transcodé divergent. */
  function pondererActes() {
    return etat.actes.map((a) => {
      const c = codeActe(a.code);
      if (!c) return null;
      const nature = nomenclature(c);
      const libelle =
        nature === "CSAR" ? smr.csar._parCode.get(c)?.[0]["Libellé CSAR"] : nature ? smr.actes._parCode.get(c)?.[0]["Libellé"] : null;
      // Un acte différencié selon l'intervenant, ou un acte CSAR, attend
      // son intervenant : sans lui, ponderer() rendrait l'erreur 85 ou 185,
      // juste pour la fonction groupage mais obscure pour une saisie en
      // cours.
      const lignes = smr.actes._parCode.get(c);
      const attendIntervenant =
        (nature === "CSAR" && smr.csar._parCode.has(c)) || (nature === "CSARR" && lignes && !lignes.some((l) => l.Intervenant === "00"));
      if (attendIntervenant && !a.intervenant) {
        return { code: c, libelle, manque: "Intervenant à choisir : la pondération de cet acte en dépend.", erreur: null, ponderation: 0 };
      }
      const n = lireEntier(a.nombre);
      if (n != null && !(n >= 1)) {
        return { code: c, libelle, manque: "Nombre de réalisations : entier supérieur à 0 attendu.", erreur: null, ponderation: 0 };
      }
      const p = ponderer(smr, { code: c, intervenant: a.intervenant, nombre: n ?? 1, lieu: a.lieu, temps: a.temps, collectif: a.collectif });
      let ecart = null;
      if (nature === "CSAR" && !p.erreur) {
        const t = transcoderCsar(smr, c, a.intervenant, a.collectif);
        if (t.ligne && t.ligne["Pondération CSAR"] !== t.ligne["Pondération CSARR"]) {
          ecart = {
            fichier: t.ligne["Pondération CSAR"],
            retenue: t.ligne["Pondération CSARR"],
            csarr: t.csarr,
            intervenant: t.intervenantTranscode,
            modalite: t.ligne["Modalité"] === "2" ? null : MODALITES[t.ligne["Modalité"]],
          };
        }
      }
      return { ...p, code: c, libelle, ecart };
    });
  }

  /** Ce que la saisie doit fournir avant chaque étape : l'âge pour le type
   *  de réadaptation, les dépendances pour la lourdeur (HC). */
  function verifierSaisie() {
    const hc = etat.hospitalisation === "HC";
    const manques = { gr: [], gl: [], notes: [] };
    const age = lireEntier(etat.age);
    if (age == null) manques.gr.push("Âge : à saisir.");
    else if (Number.isNaN(age) || age > 150) manques.gr.push("Âge : nombre entier d'années attendu.");
    if (etat.mode === "scores") {
      const libelles = { speSejour: "spécialisé par séjour", speJour: "spécialisé par jour", globSejour: "global par séjour", globJour: "global par jour" };
      for (const quoi of hc ? Object.keys(libelles) : ["globJour"]) {
        if (Number.isNaN(lireScore(etat.scores[quoi]))) manques.gr.push(`Score ${libelles[quoi]} : nombre attendu.`);
      }
    } else {
      for (const quoi of hc ? ["semaine", "weekend"] : ["presence"]) {
        if (Number.isNaN(lireEntier(etat.jours[quoi]))) manques.gr.push("Jours de présence : nombre entier attendu.");
      }
      if (!hc && lireEntier(etat.jours.presence) > 7) manques.gr.push("Jours de présence : une semaine en compte au plus 7.");
    }
    if (hc) {
      const borne = (valeur, libelle, min, max, paragraphe) => {
        const n = lireEntier(valeur);
        if (n == null) manques.gl.push(`${libelle} : à saisir (${min} à ${max}).`);
        else if (Number.isNaN(n) || n < min || n > max) manques.gl.push(`${libelle} : de ${min} à ${max} (${paragraphe}).`);
      };
      borne(etat.phy, "Dépendance physique", 4, 16, "1.2.3.6");
      borne(etat.cog, "Dépendance cognitive", 2, 8, "1.2.3.7");
    }
    return manques;
  }

  function sejourSaisi() {
    const hc = etat.hospitalisation === "HC";
    const rhs = (hc ? etat.rhs : etat.rhs.slice(0, 1)).map((r) => ({
      mmp: r.mmp.trim(),
      ae: r.ae.trim(),
      das: decouper(r.das),
      actesCcam: decouper(r.ccam).map(codeActe),
    }));
    return {
      hospitalisation: etat.hospitalisation,
      age: lireEntier(etat.age),
      cog: lireEntier(etat.cog),
      phy: lireEntier(etat.phy),
      postChirurgical: etat.postChirurgical,
      rhs,
    };
  }

  function scoresSaisis() {
    const s = etat.scores;
    if (etat.hospitalisation === "HTP") return { globJour: lireScore(s.globJour) };
    return { speSejour: lireScore(s.speSejour), speJour: lireScore(s.speJour), globSejour: lireScore(s.globSejour), globJour: lireScore(s.globJour) };
  }

  function calculer() {
    if (!zoneEtapes.isConnected) return;
    mettreAdresse();
    const hc = etat.hospitalisation === "HC";
    const sejour = sejourSaisi();
    const ponderes = etat.mode === "actes" ? pondererActes() : [];
    const valides = ponderes.filter((p) => p && !p.manque);
    const vide = sejour.rhs.every((r) => !r.mmp && !r.ae && !r.das.length && !r.actesCcam.length);

    // Les actes CCAM de réadaptation sont aussi des actes du RHS : la
    // sévérité les voit comme ceux saisis avec la morbidité (aucun n'est
    // aujourd'hui CMA, mais la liste peut changer).
    const ccamReadaptation = valides.filter((p) => p.nature === "CCAM" && !p.erreur).map((p) => p.code);
    if (sejour.rhs.length) sejour.rhs[0].actesCcam.push(...ccamReadaptation);

    let resultat = null;
    let scores = null;
    let erreurCalcul = null;
    if (!vide) {
      try {
        // Premier passage pour le GN, que les scores spécialisés attendent.
        const premier = grouper(smr, { ...sejour, scores: null });
        if (etat.mode === "actes") {
          const jours = hc ? { semaine: lireEntier(etat.jours.semaine), weekend: lireEntier(etat.jours.weekend) } : { presence: lireEntier(etat.jours.presence) };
          scores = calculerScores(smr, valides, premier.gn ?? null, etat.hospitalisation, jours);
        } else {
          scores = scoresSaisis();
        }
        resultat = premier.gn ? grouper(smr, { ...sejour, scores }) : premier;
      } catch (erreur) {
        console.error(erreur);
        erreurCalcul = erreur;
      }
    } else if (etat.mode === "actes") {
      const jours = hc ? { semaine: lireEntier(etat.jours.semaine), weekend: lireEntier(etat.jours.weekend) } : { presence: lireEntier(etat.jours.presence) };
      scores = calculerScores(smr, valides, null, etat.hospitalisation, jours);
    }

    const gn = resultat?.gn ?? null;
    ponderes.forEach((p, i) => lignesActes[i]?.maj(p, gn));
    afficherScoresCalcules(ponderes, scores, gn);
    afficherResultat({ vide, sejour, resultat, scores, ponderes, erreurCalcul });
  }

  function afficherScoresCalcules(ponderes, scores, gn) {
    if (!zoneScoresCalcules) return;
    zoneScoresCalcules.innerHTML = "";
    const comptes = ponderes.filter((p) => p && !p.manque && !p.erreur);
    if (!comptes.length || !scores) return;
    const hc = etat.hospitalisation === "HC";
    const ecarts = ponderes.filter((p) => p?.ecart).length;
    const jours = scores.jours ? `${nombre(scores.jours)} jour${scores.jours > 1 ? "s" : ""}` : "aucun jour de présence saisi";
    zoneScoresCalcules.append(
      el(
        "p",
        { class: "calcul-scores-ligne" },
        el("strong", {}, "Scores calculés : "),
        hc
          ? [
              `global ${arrondi(scores.globSejour)} par séjour, ${arrondi(scores.globJour)} par jour`,
              gn ? ` ; spécialisé pour le GN ${gn} ${arrondi(scores.speSejour)} par séjour, ${arrondi(scores.speJour)} par jour` : " ; spécialisé : en attente du GN du séjour",
              ` (${jours}).`,
            ].join("")
          : `global ${arrondi(scores.globSejour ?? scores.globSemaine)} sur la semaine, ${arrondi(scores.globJour)} par jour (${jours}).`,
        ecarts ? " " : null,
        ecarts ? el("span", { class: "calcul-marque attention" }, ecarts > 1 ? `${ecarts} actes en écart CSAR` : "1 acte en écart CSAR") : null
      )
    );
  }

  // ==== Affichage du résultat ====

  function afficherResultat({ vide, sejour, resultat, scores, ponderes, erreurCalcul }) {
    zoneFil.innerHTML = "";
    zoneEtapes.innerHTML = "";
    if (vide) {
      zoneFil.append(el("p", { class: "message-info" }, "Saisir la morbidité d'un RHS, ou choisir un exemple du manuel : le groupage s'affiche ici, étape par étape."));
      annonce.textContent = "";
      return;
    }
    if (erreurCalcul) {
      zoneFil.append(
        el("div", { class: "message-erreur" }, el("strong", {}, "Le calcul a échoué. "), String(erreurCalcul?.message ?? erreurCalcul))
      );
      annonce.textContent = "Le calcul a échoué.";
      return;
    }
    const hc = etat.hospitalisation === "HC";
    const manques = verifierSaisie();
    const peutGr = !manques.gr.length;
    const peutGl = peutGr && !manques.gl.length;
    const r = resultat;

    // Jusqu'où le groupage va : il s'arrête à la première erreur, et le
    // thème à la première étape dont la saisie manque.
    const gn = r.gn ?? null;
    const gr = gn && peutGr ? r.gr : null;
    const gl = gr && peutGl ? r.gl : null;
    const gme = gl && !gl.erreur && r.gme && !r.erreur ? r.gme : null;

    zoneEtapes.append(
      panneauControles(sejour, r, ponderes, manques, { peutGr, peutGl }),
      panneauCm(sejour, r),
      panneauGn(sejour, r),
      gn ? panneauGr(gn, gr, scores, peutGr) : null,
      gr ? panneauGl(gr, gl, peutGl) : null,
      gl && !gl.erreur ? panneauSeverite(r, gl, gme) : null,
      panneauGme(r, gme, { peutGr, peutGl })
    );
    zoneFil.append(fil(r, { gn, gr, gl, gme }));
    annonce.textContent = gme
      ? `GME ${gme.gme} : ${libelleGroupe(k, gme.gme)}`
      : r.erreur
        ? `Pas de GME : erreur ${r.erreur}, ${libelleErreur(k, r.erreur)}`
        : "Saisie incomplète : pas de GME.";
  }

  /** Le groupage en une ligne, de la CM au GME. */
  function fil(r, { gn, gr, gl, gme }) {
    const cms = [...new Set(r.rhs.map((x) => x.cm?.cm).filter(Boolean))];
    const pas = [
      ["CM", r.gn ? r.rhs.find((x) => x.gn?.gn === r.gn)?.cm?.cm : cms[0]],
      ["GN", gn],
      ["GR", gr?.gr],
      ["GL", gl && !gl.erreur ? gl.gl : null],
      ["GME", gme?.gme],
    ];
    return el(
      "ol",
      { class: "calcul-fil", "aria-label": "Groupes trouvés" },
      ...pas.map(([niveau, valeur]) =>
        el("li", { class: valeur ? undefined : "absent" }, el("span", { class: "calcul-fil-niveau" }, niveau), valeur ? code(valeur) : el("span", {}, "–"))
      )
    );
  }

  /** Un panneau d'étape ; `contenu` peut imbriquer des tableaux de nœuds,
   *  qu'el() n'aplatit pas. */
  function panneau(titre, ...contenu) {
    return el("section", { class: "calcul-etape" }, el("h3", {}, titre), ...contenu.flat(Infinity).filter(Boolean));
  }

  // ---- Contrôles ----

  function panneauControles(sejour, r, ponderes, manques, { peutGr, peutGl }) {
    const hc = etat.hospitalisation === "HC";
    const items = [];
    r.rhs.forEach((x, i) => {
      for (const e of x.erreurs) {
        items.push(
          el(
            "li",
            {},
            hc ? `RHS ${i + 1} · ` : "",
            ...texteErreur(k, e.code),
            ...(e.diag ? [" (", code(e.diag), ` en ${e.position})`] : [` (${e.position})`])
          )
        );
      }
    });
    ponderes.forEach((p, i) => {
      if (!p || !(p.erreur || p.manque)) return;
      items.push(
        el(
          "li",
          {},
          `Acte ${i + 1} · `,
          code(p.code),
          " : ",
          ...(p.manque ? [p.manque] : [...texteErreur(k, p.erreur), k._erreurs.get(p.erreur)?.bloquant === false ? " (non bloquante)" : " (bloquante)", " ; non compté dans les scores."])
        )
      );
    });
    // Erreur du groupage lui-même (aucune CM, aucun GN, pas de GL) quand
    // aucun contrôle de diagnostic ne l'explique déjà.
    const dejaDites = new Set(r.rhs.flatMap((x) => x.erreurs.map((e) => e.code)));
    if (r.erreur && !dejaDites.has(r.erreur) && (r.erreur !== 402 || peutGl)) items.push(el("li", {}, ...texteErreur(k, r.erreur)));
    const saisie = [...manques.gr, ...(peutGr ? manques.gl : [])];
    const contenu = [];
    if (items.length) contenu.push(el("ul", { class: "calcul-liste erreurs" }, ...items));
    if (saisie.length) {
      contenu.push(
        el("p", { class: "calcul-sous-titre" }, "Saisie incomplète :"),
        el("ul", { class: "calcul-liste" }, ...saisie.map((m) => el("li", {}, m)))
      );
    }
    if (!items.length && !saisie.length) {
      contenu.push(el("p", { class: "message-succes" }, hc ? "Aucune erreur sur les diagnostics ni sur les actes du séjour." : "Aucune erreur sur les diagnostics ni sur les actes du RHS."));
    }
    contenu.push(note("Contrôles de FG_erreurs sur les diagnostics (code connu, position permise, AE différente de la MMP) et sur les actes (code connu, intervenant accepté, modalité collective). Le format du RHS n'est pas contrôlé."));
    return panneau("Contrôles", contenu);
  }

  // ---- CM et GN ----

  /** RHS de même morbidité regroupés : un séjour de dix semaines identiques
   *  ne répète pas dix fois son orientation. */
  function groupesRhs(sejour, r) {
    const groupes = new Map();
    sejour.rhs.forEach((x, i) => {
      const clef = JSON.stringify([cle(x.mmp), cle(x.ae), x.das.map(cle)]);
      if (!groupes.has(clef)) groupes.set(clef, { indices: [], rhs: x, res: r.rhs[i] });
      groupes.get(clef).indices.push(i + 1);
    });
    return [...groupes.values()];
  }

  const nommerRhs = (indices) =>
    etat.hospitalisation === "HTP" ? "RHS" : indices.length > 1 ? `RHS ${indices.join(", ")}` : `RHS ${indices[0]}`;

  function panneauCm(sejour, r) {
    const blocs = groupesRhs(sejour, r).map(({ indices, res }) => {
      if (!res.cm) return el("div", { class: "calcul-bloc" }, el("p", { class: "calcul-sous-titre" }, `${nommerRhs(indices)} : non orienté`), note("Erreur bloquante sur les diagnostics : le RHS n'est pas groupé."));
      return el(
        "div",
        { class: "calcul-bloc" },
        el("p", { class: "calcul-sous-titre" }, `${nommerRhs(indices)} : `, groupeLibelle(k, res.cm.cm)),
        el("ol", { class: "chemin" }, ...res.cm.etapes.map((e) => el("li", {}, el("span", { class: "chemin-libelle" }, e))))
      );
    });
    return panneau("Catégorie majeure", blocs, note("La MMP est testée d'abord, l'AE ensuite ; une MMP qui oriente en deuxième intention laisse l'AE décider (2.2.1)."));
  }

  function panneauGn(sejour, r) {
    const blocs = groupesRhs(sejour, r).map(({ indices, rhs, res }) => {
      if (!res.gn) return null;
      const g = res.gn;
      const negatifs = g.parcours.filter((p) => !p.positif);
      const positif = g.parcours.find((p) => p.positif);
      const ligne = (p) =>
        el(
          "li",
          { class: p.positif ? "positif" : "negatif" },
          el(
            "span",
            { class: "chemin-libelle" },
            el("span", { class: "calcul-rang" }, `Rang ${p.noeud.ordre} · `),
            el("a", { href: lienArbre(p.noeud.gn) }, code(p.noeud.gn)),
            ` ${libelleGroupe(k, p.noeud.gn)}`,
            el("span", { class: "calcul-test" }, p.noeud.tests.map((t) => t.texte).join(" ET ")),
            ...(p.noeud.conditions ?? []).map((c) => el("span", { class: "calcul-test" }, CONDITIONS[c] ?? c))
          ),
          el("span", { class: p.positif ? "issue oui" : "issue non" }, p.positif ? "positif" : "négatif")
        );
      const liste = [];
      if (negatifs.length > NEGATIFS_DEPLIES_MAX) {
        liste.push(
          el(
            "details",
            { class: "calcul-negatifs" },
            el("summary", {}, `${nombre(negatifs.length)} tests négatifs avant ${positif ? "le premier positif" : "la fin de la CM"}`),
            el("ol", { class: "chemin" }, ...negatifs.map(ligne))
          )
        );
        if (positif) liste.push(el("ol", { class: "chemin", start: String(negatifs.length + 1) }, ligne(positif)));
      } else {
        liste.push(el("ol", { class: "chemin" }, ...g.parcours.map(ligne)));
      }
      const orientants = g.orientants.length
        ? el(
            "p",
            { class: "calcul-orientants" },
            "Codes orientants : ",
            ...g.orientants.flatMap((o, j) => [j ? ", " : "", lienCode(graphie(o.code)), ` (${o.position})`]),
            "."
          )
        : null;
      return el(
        "div",
        { class: "calcul-bloc" },
        el("p", { class: "calcul-sous-titre" }, `${nommerRhs(indices)} : `, g.gn ? groupeLibelle(k, g.gn) : el("span", {}, `aucun GN dans la CM ${res.cm.cm}`)),
        ...liste,
        orientants,
        !g.gn && g.erreur ? note(...texteErreur(k, g.erreur)) : null
      );
    });
    const contenu = [blocs];
    if (etat.hospitalisation === "HC" && sejour.rhs.length > 1) contenu.push(decompteGn(r));
    if (r.gn) contenu.push(el("p", { class: "calcul-conclusion" }, "GN du séjour : ", el("a", { href: lienArbre(r.gn) }, groupeLibelle(k, r.gn))));
    contenu.push(note("Les tests de la CM se font dans l'ordre de GN_liste_tests, jusqu'au premier positif ; un nœud à deux tests demande les deux (2.2.2)."));
    return panneau("Groupe nosologique", contenu);
  }

  /** Le décompte des GN des 10 premiers RHS, qui explique le GN que
   *  gnDuSejour retient (le plus fréquent, le premier en cas d'égalité). */
  function decompteGn(r) {
    const premiers = r.rhs.slice(0, RHS_DECOMPTES).map((x) => x.gn?.gn ?? null);
    const compte = new Map();
    for (const g of premiers.filter(Boolean)) compte.set(g, (compte.get(g) ?? 0) + 1);
    const morceaux = [...compte].map(([g, n], j) => [j ? " ; " : "", code(g), ` : ${n} RHS`]).flat();
    return el(
      "p",
      { class: "calcul-orientants" },
      `GN des ${premiers.length < r.rhs.length ? `${RHS_DECOMPTES} premiers` : `${premiers.length}`} RHS — `,
      ...(morceaux.length ? morceaux : ["aucun"]),
      ". Le séjour prend le plus fréquent ; à égalité, le premier dans l'ordre des RHS (2.2.2)."
    );
  }

  // ---- GR ----

  function panneauGr(gn, gr, scores, peutGr) {
    const hc = etat.hospitalisation === "HC";
    const e = k.gr[gn];
    const types = (hc ? e.hc : e.htp).split("").map((t) => `${t} (${TYPES_READAPTATION[t]})`).join(", ");
    const ligneScore = (libelle, sejourVal, seuilSejour, jourVal, seuilJour) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, libelle),
        el("td", { class: "nombre" }, arrondi(sejourVal)),
        el("td", { class: "nombre" }, seuilSejour == null ? "–" : nombre(seuilSejour)),
        el("td", { class: "nombre" }, arrondi(jourVal)),
        el("td", { class: "nombre" }, seuilJour == null ? "–" : nombre(seuilJour))
      );
    const tableScores = hc
      ? el(
          "div",
          { class: "codes-liste calcul-table" },
          el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", { scope: "col" }, "Score"),
                el("th", { scope: "col", class: "nombre" }, "Par séjour"),
                el("th", { scope: "col", class: "nombre" }, "Seuil"),
                el("th", { scope: "col", class: "nombre" }, "Par jour"),
                el("th", { scope: "col", class: "nombre" }, "Seuil")
              )
            ),
            el(
              "tbody",
              {},
              ligneScore("Spécialisé", scores?.speSejour, e.spe[0], scores?.speJour, e.spe[1]),
              ligneScore("Global", scores?.globSejour, e.glob[0], scores?.globJour, e.glob[1])
            )
          )
        )
      : el(
          "div",
          { class: "codes-liste calcul-table" },
          el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", { scope: "col" }, "Score"),
                el("th", { scope: "col", class: "nombre" }, "Par jour"),
                el("th", { scope: "col", class: "nombre" }, "Seuil intense"),
                el("th", { scope: "col", class: "nombre" }, "Seuil très intense")
              )
            ),
            el(
              "tbody",
              {},
              el(
                "tr",
                {},
                el("th", { scope: "row" }, "Global"),
                el("td", { class: "nombre" }, arrondi(scores?.globJour)),
                el("td", { class: "nombre" }, e.htpSeuils[0] == null ? "–" : nombre(e.htpSeuils[0])),
                el("td", { class: "nombre" }, e.htpSeuils[1] == null ? "–" : nombre(e.htpSeuils[1]))
              )
            )
          )
        );
    const contenu = [el("p", {}, `Types de réadaptation du GN ${gn} en ${hc ? "HC" : "HTP"} : ${types}.`), tableScores];
    if (!peutGr) {
      contenu.push(el("p", { class: "message-avertissement" }, "Saisie incomplète (voir les contrôles) : le groupe de réadaptation n'est pas calculé."));
    } else {
      contenu.push(
        el("ol", { class: "chemin" }, ...gr.etapes.map((t) => el("li", {}, el("span", { class: "chemin-libelle" }, t)))),
        el("p", { class: "calcul-conclusion" }, "GR : ", groupeLibelle(k, gr.gr))
      );
    }
    contenu.push(
      note(
        hc
          ? "Pédiatrique d'abord (moins de 18 ans), puis spécialisé, puis global : un test sur les scores est positif quand le score par jour ET le score par séjour atteignent leurs seuils (3.4.1)."
          : "Pédiatrique d'abord (moins de 18 ans), puis selon le score global par jour et les seuils du GN (3.4.2)."
      )
    );
    return panneau("Type de réadaptation", contenu);
  }

  // ---- GL ----

  function panneauGl(gr, gl, peutGl) {
    const hc = etat.hospitalisation === "HC";
    const contenu = [];
    if (!hc) {
      contenu.push(el("p", {}, "En HTP, le niveau de lourdeur vaut A par convention (4.2.1)."));
    } else if (!peutGl) {
      contenu.push(el("p", { class: "message-avertissement" }, "Saisie incomplète (voir les contrôles) : le groupe de lourdeur n'est pas calculé."));
      return panneau("Niveau de lourdeur", contenu);
    } else {
      contenu.push(
        el(
          "div",
          { class: "codes-liste calcul-table" },
          el(
            "table",
            {},
            el(
              "thead",
              {},
              el("tr", {}, el("th", { scope: "col" }, "Variable"), el("th", { scope: "col" }, "Valeur"), el("th", { scope: "col", class: "niveau" }, "Niveau"))
            ),
            el(
              "tbody",
              {},
              ...gl.detail.map((d) =>
                el(
                  "tr",
                  {},
                  el("th", { scope: "row" }, d.variable),
                  el("td", {}, String(d.valeur)),
                  el("td", { class: "niveau" }, d.niveau ?? "–")
                )
              )
            )
          )
        )
      );
    }
    if (gl.erreur) contenu.push(el("p", { class: "message-erreur" }, ...texteErreur(k, gl.erreur)));
    else {
      if (hc) contenu.push(el("p", {}, `Niveau retenu : ${gl.niveau}, le plus lourd des quatre variables (A < B < C).`));
      contenu.push(el("p", { class: "calcul-conclusion" }, "GL : ", groupeLibelle(k, gl.gl)));
    }
    if (hc) contenu.push(note(`Niveau de chaque variable pour le GR ${gr.gr} d'après GL_infos (4.2) ; certaines règles combinent l'âge et la dépendance physique (4.2.2.1).`));
    return panneau("Niveau de lourdeur", contenu);
  }

  // ---- Sévérité ----

  function panneauSeverite(r, gl, gme) {
    const hc = etat.hospitalisation === "HC";
    const contenu = [];
    if (!hc) {
      contenu.push(el("p", {}, "En HTP, le niveau de sévérité vaut 0 par convention (5.1)."));
    } else if (r.gme) {
      const s = r.gme;
      contenu.push(
        el(
          "p",
          {},
          "Codes ayant orienté un RHS dans le GN du séjour : ",
          ...(r.orientants ?? []).flatMap((o, j) => [j ? ", " : "", lienCode(graphie(o))]),
          ". Ils excluent les CMA de leur liste d'exclusion (5.2.3)."
        )
      );
      if (s.marqueurs.length) {
        contenu.push(
          el(
            "div",
            { class: "codes-liste calcul-table" },
            el(
              "table",
              {},
              el(
                "thead",
                {},
                el("tr", {}, el("th", { scope: "col" }, "CMA"), el("th", { scope: "col" }, "Position"), el("th", { scope: "col" }, "Marqueur de sévérité"))
              ),
              el(
                "tbody",
                {},
                ...s.marqueurs.map((m) =>
                  el(
                    "tr",
                    { class: m.retenu ? "retenu" : "exclu" },
                    el(
                      "td",
                      {},
                      lienCode(m.code),
                      el("span", { class: "calcul-sous-libelle" }, m.nature === "CCAM" ? k._cmaCcam.get(m.code) ?? "" : D.get(cle(m.code))?.["Libellé"] ?? "")
                    ),
                    el("td", {}, m.nature === "CCAM" ? "acte CCAM" : m.position),
                    el(
                      "td",
                      {},
                      ...(m.retenu ? ["retenu"] : ["exclu par ", ...m.excluePar.flatMap((c, j) => [j ? ", " : "", code(c)])])
                    )
                  )
                )
              )
            )
          )
        );
      } else {
        contenu.push(el("p", {}, "Aucune CMA parmi les MMP, les DAS et les actes CCAM du séjour."));
      }
      const retenus = s.marqueurs.some((m) => m.retenu);
      contenu.push(
        el(
          "p",
          {},
          s.niveau === 2
            ? "Au moins un marqueur retenu : niveau de sévérité 2."
            : retenus && !s.niveau2
              ? `Un marqueur est retenu, mais le GL ${gl.gl} n'a pas de niveau 2 : niveau de sévérité 1.`
              : "Aucun marqueur retenu : niveau de sévérité 1."
        )
      );
    }
    if (gme) contenu.push(el("p", { class: "calcul-conclusion" }, "GME : ", groupeLibelle(k, gme.gme)));
    if (hc) contenu.push(note("Une CMA compte en MMP ou en DAS, dans n'importe quel RHS du séjour ; le GN 2303 (soins palliatifs) n'a pas de niveau 2 (5.2)."));
    return panneau("Niveau de sévérité", contenu);
  }

  // ---- GME ----

  function panneauGme(r, gme, { peutGr, peutGl }) {
    const bloc = el("section", { class: "calcul-gme", "aria-labelledby": "calcul_gme_titre" });
    bloc.append(el("h3", { id: "calcul_gme_titre" }, "GME"));
    if (!gme) {
      const raison = r.erreur && (r.erreur !== 402 || peutGl)
        ? [...texteErreur(k, r.erreur), "."]
        : !peutGr || !peutGl
          ? ["Saisie incomplète : compléter les champs signalés dans les contrôles."]
          : ["Le groupage s'est arrêté avant le GME."];
      bloc.append(el("p", { class: "calcul-gme-absent" }, "Pas de GME. ", ...raison));
      return bloc;
    }
    const attendu = exemple ? EXEMPLES[exemple] : null;
    bloc.append(
      el("p", { class: "calcul-gme-code" }, gme.gme),
      el("p", { class: "calcul-gme-libelle" }, libelleGroupe(k, gme.gme)),
      attendu
        ? el(
            "p",
            { class: attendu.attendu === gme.gme ? "message-succes" : "message-erreur" },
            attendu.attendu === gme.gme
              ? `Exemple du manuel (${attendu.libelle.toLowerCase()}, ${attendu.precision}) : le manuel donne aussi ${attendu.attendu}.`
              : `Exemple du manuel : le manuel donne ${attendu.attendu}, le calcul ${gme.gme}.`
          )
        : null,
      el(
        "p",
        { class: "calcul-liens" },
        el("a", { class: "lien-texte", href: lienArbre(r.gn) }, `Le GN ${r.gn} dans l'algorithme`),
        " · ",
        el("a", { class: "lien-texte", href: lienTarifs(gme.gme) }, "Tarifs du GME")
      )
    );
    if (tarifs) {
      bloc.append(
        el("h4", {}, "Tarifs"),
        fraicheur([{ libelle: tarifs.libelle, millesime: tarifs.millesime }]),
        tableTarifsGme(tarifs, [gme.gme]),
        noteTarifsSmr(lienTarifs(gme.gme))
      );
    } else {
      bloc.append(note("Tarifs des GMT en cours de chargement, ou indisponibles."));
    }
    return bloc;
  }

  // ---- Premier rendu ----

  rendreSejour();
  rendreRhs();
  rendreReadaptation();
  calculer();
}
