// Fiche code — tout ce que la fonction groupage fait d'un code CIM-10 ou
// CCAM, sur une seule page : en diagnostic principal (CMD où il oriente le
// séjour, listes, étapes de l'arbre qui le testent, racines de GHM possibles
// et leurs tarifs, codes frontières), en diagnostic associé (niveau de CMA,
// DP et racines qui l'excluent), ou comme acte (listes, étapes, racines et
// leurs tarifs, actes frontières).
//
// Tout est calculé dans le navigateur à partir des référentiels déjà
// publiés : arbre.json, listes de la fonction groupage, diagnostics
// d'entrée de la CMD 14 (volume 2), liste des CMA et leurs exclusions,
// tarifs des GHS.

import { chargerJeu, chargerJson } from "../donnees.js";
import { normaliser } from "../recherche.js";
import { el, fraicheur, nombre } from "../interface.js";
import { racinesAtteintes, sorties, calculer as frontieresDp } from "./frontieres.js";
import { calculer as frontieresActes } from "./actes_frontieres.js";
import { couvre } from "./cma.js";
import { codesGhm } from "./arbre.js";
import { chargerTarifs, ghmDeRacine, nombreGhs, noteTarifs, tableTarifs } from "../tarifs.js";

const SUGGESTIONS_MAX = 12;
const RE_CCAM = /^[A-Z]{4}\d{3}/;
const RE_RACINE = /^\d{2}[CKMZ]\d{2}$/;
// Liste de diagnostics d'une CMD : « D-0307 » est une liste de la CMD 03. En
// DP, un code de l'une d'elles oriente le séjour vers cette CMD.
const RE_LISTE_CMD = /^D-(\d{2})\d{2}$/;

// Type de racine, 3e caractère de son code.
const TYPES_RACINE = { C: "chirurgicale", K: "interventionnelle", M: "médicale", Z: "indifférenciée" };

const SYMBOLES = {
  DP: "DP",
  DR: "DR",
  DAS: "DAS",
  D: "un diagnostic",
  D2: "deux diagnostics",
  Dtous: "tous les diagnostics",
  DRbarre: "DP ou DAS (sauf DR)",
  A: "un acte",
  A2: "deux actes",
  Atous: "tous les actes",
};

// ==== Données ====

const jeux = {
  diagnostics: () => chargerJeu("groupage", "diagnostics", "listes de diagnostics de la fonction groupage"),
  actes: () => chargerJeu("groupage", "actes", "listes d'actes de la fonction groupage"),
  cma: () => chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage"),
  entrees: () => chargerJeu("groupage", "entrees", "diagnostics d'entrée des CMD (volume 2)"),
  racines: () => chargerJeu("groupage", "racines", "libellés des racines de GHM"),
};

// Libellé de chaque racine de GHM, chargé à l'ouverture de la page : il
// permet au codeur de vérifier d'un coup d'œil la cohérence du classement.
let libellesRacines = new Map();
const libelleRacine = (r) => libellesRacines.get(r) ?? "";

/** « 06M10 Ulcères gastroduodénaux compliqués » pour une liste de racines
 *  séparées par des virgules. */
const racinesEnClair = (racines) =>
  racines
    .split(", ")
    .filter(Boolean)
    .map((r) => (libelleRacine(r) ? `${r} ${libelleRacine(r)}` : r))
    .join(" ; ");

/** « g409 », « G40.9 » → « G40.9 » ; « aafa001 » → « AAFA001 ». */
function graphie(saisie) {
  const c = saisie.trim().toUpperCase().replace(/\s+/g, "");
  if (RE_CCAM.test(c)) return c;
  const sansPoint = c.replace(/\./g, "");
  return sansPoint.length <= 3 ? sansPoint : `${sansPoint.slice(0, 3)}.${sansPoint.slice(3)}`;
}

/** Code d'acte des listes (« AAFA001-00/0 ») ramené à son code CCAM. */
const codeCcam = (code) => code.split("-")[0];

function indexer(arbre) {
  if (arbre._fiche) return arbre._fiche;
  const parListe = new Map(); // liste → [{ id, n, i }]
  for (const [id, n] of Object.entries(arbre.noeuds)) {
    (n.branches ?? []).forEach((b, i) => {
      for (const l of b.listes) {
        if (!parListe.has(l)) parListe.set(l, []);
        parListe.get(l).push({ id, n, i });
      }
    });
  }
  // Parcours par toutes les sorties de chaque nœud, commun aux fiches ;
  // celui d'un DP est propre à la fiche de son code (parcoursEnDp).
  arbre._fiche = { parListe, parcours: { suivre: sorties, memo: new Map() } };
  return arbre._fiche;
}

/** Le parcours d'un séjour dont le code est le DP. Un test sur le DP ne
 *  suit que le premier cas qui contient le code, ou son « sinon » ; un test
 *  sur l'un des diagnostics du RSS (D, ou DP et DAS sauf DR) que le code
 *  satisfait ne va pas au-delà de son cas ; l'inversion du DP et du DR n'a
 *  pas eu lieu, puisque le code est resté le DP. Les autres tests (actes,
 *  autres diagnostics, âge, durée de séjour…) restent ouverts. */
function parcoursEnDp(listes) {
  const contient = (b) => b.listes.some((l) => listes.includes(l));
  const suivre = (n) => {
    const branches = n.branches ?? [];
    if (n.genre === "test" && n.symbole === "DP") {
      const b = branches.find(contient);
      return [b ? b.vers : n.sinon?.vers].filter(Boolean);
    }
    if (n.genre === "test" && (n.symbole === "D" || n.symbole === "DRbarre")) {
      const i = branches.findIndex(contient);
      if (i >= 0) return branches.slice(0, i + 1).map((b) => b.vers);
    }
    if (n.genre === "critere" && n.variable === "Inversion DP/DR") return [n.sinon.vers];
    return sorties(n);
  };
  return { suivre, memo: new Map() };
}

function racinesDe(arbre, vers, parcours = indexer(arbre).parcours) {
  return [...racinesAtteintes(arbre, vers, parcours.memo, parcours.suivre)].filter((r) => RE_RACINE.test(r)).sort();
}

/** Les racines que peuvent atteindre les étapes, sans doublon. */
function racinesDesEtapes(arbre, etapes, parcours) {
  return [...new Set(etapes.flatMap((e) => racinesDe(arbre, e.n.branches[e.i].vers, parcours)))].sort();
}

/** Les GHM d'une racine d'après les cases de l'arbre, y compris ceux que
 *  l'arrêté ne tarife pas (09Z02A) : ils doivent figurer, sans tarif, dans
 *  le tableau de leur racine plutôt que d'en disparaître. */
function ghmDeRacineDansArbre(arbre, racine) {
  if (!arbre._ghmParRacine) {
    const index = new Map();
    for (const n of Object.values(arbre.noeuds)) {
      if (n.genre !== "ghm") continue;
      if (!index.has(n.racine)) index.set(n.racine, new Set());
      for (const g of codesGhm(n)) index.get(n.racine).add(g);
    }
    arbre._ghmParRacine = index;
  }
  return [...(arbre._ghmParRacine.get(racine) ?? [])].sort();
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const [arbre, racines] = await Promise.all([chargerJson("groupage", "arbre"), jeux.racines().catch(() => null)]);
  if (racines) libellesRacines = new Map(racines.lignes.map((l) => [l.ListeRacineGHM, l["Libellé liste"]]));
  conteneur.innerHTML = "";

  const saisie = el("input", {
    type: "search",
    id: "fiche_code",
    placeholder: "ex. : I61.0, G40.9, AAFA001, épilepsie",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => suggerer(saisie.value),
    onkeydown: (e) => {
      if (e.key === "Enter") {
        const premier = zoneSuggestions.querySelector("button");
        if (premier) premier.click();
        else if (saisie.value.trim()) ouvrir(graphie(saisie.value));
      }
    },
  });
  const zoneSuggestions = el("div", { class: "fiche-suggestions" });
  const zoneFiche = el("div", { class: "fiche" });

  conteneur.append(
    el("h1", {}, "Fiche code"),
    fraicheur([{ libelle: "arbre de décision de la fonction groupage", millesime: arbre.millesime }]),
    el(
      "p",
      {},
      "Tout ce que la fonction groupage fait d'un code : en diagnostic principal, en diagnostic associé (CMA), ou comme acte CCAM. Saisir un code ou quelques mots de son libellé."
    ),
    el(
      "div",
      { class: "barre-outils" },
      el(
        "div",
        { class: "champ" },
        el("label", { for: "fiche_code" }, "Code CIM-10 ou CCAM :"),
        el("div", { class: "champ-recherche" }, el("span", { class: "icone loupe", "aria-hidden": "true" }), saisie),
        zoneSuggestions
      )
    ),
    zoneFiche,
    el(
      "p",
      { class: "pied-page" },
      "Vues d'ensemble : ",
      el("a", { class: "lien-texte", href: "#/mco/frontieres" }, "codes frontières en DP"),
      " · ",
      el("a", { class: "lien-texte", href: "#/mco/actes-frontieres" }, "actes frontières"),
      " · ",
      el("a", { class: "lien-texte", href: "#/mco/cma" }, "liste des CMA"),
      "."
    )
  );

  // ---- Suggestions ----

  let jeton = 0;
  async function suggerer(valeur) {
    const monJeton = ++jeton;
    const q = valeur.trim();
    zoneSuggestions.innerHTML = "";
    if (q.length < 2) return;
    const code = graphie(q);
    const ccam = /^[a-z]{4}\d/i.test(q.replace(/\s+/g, ""));
    const aChercher = ccam
      ? ["actes"]
      : /^[a-z]\d/i.test(q)
        ? ["diagnostics", "cma", "entrees"]
        : ["diagnostics", "cma", "entrees", "actes"];
    const trouves = new Map();
    const mots = normaliser(q).split(/\s+/).filter(Boolean);
    for (const nom of aChercher) {
      const { lignes } = await jeux[nom]();
      if (monJeton !== jeton) return;
      for (const l of lignes) {
        const c = nom === "actes" ? codeCcam(l.Code) : l.Code;
        if (trouves.has(c)) continue;
        const libelle = l["Libellé code"] ?? l["Libellé"];
        const parCode = c.replace(/\./g, "").startsWith(code.replace(/\./g, ""));
        const parTexte = !parCode && mots.length && mots.every((m) => normaliser(libelle).includes(m));
        if (parCode || (parTexte && q.length >= 3)) trouves.set(c, libelle);
        if (trouves.size >= SUGGESTIONS_MAX) break;
      }
    }
    if (monJeton !== jeton) return;
    zoneSuggestions.innerHTML = "";
    if (!trouves.size) {
      zoneSuggestions.append(el("p", { class: "champ-aide" }, "Aucun code des référentiels de groupage ne correspond."));
      return;
    }
    zoneSuggestions.append(
      el(
        "ul",
        { class: "liste-suggestions" },
        ...[...trouves].map(([c, libelle]) =>
          el("li", {}, el("button", { type: "button", onclick: () => ouvrir(c) }, el("strong", {}, c), ` ${libelle}`))
        )
      )
    );
  }

  // ---- Fiche ----

  async function ouvrir(code, { historique = true } = {}) {
    zoneSuggestions.innerHTML = "";
    saisie.value = code;
    if (historique && location.hash !== `#/mco/fiche/${code}`) history.replaceState(null, "", `#/mco/fiche/${code}`);
    zoneFiche.innerHTML = "";
    zoneFiche.append(el("p", { class: "compteur", role: "status" }, "Chargement…"));
    const contenu = RE_CCAM.test(code) ? await ficheActe(arbre, code) : await ficheDiagnostic(arbre, code);
    zoneFiche.innerHTML = "";
    zoneFiche.append(...contenu.filter(Boolean));
    zoneFiche.querySelector("h2")?.focus?.();
  }

  const [demande] = chemin;
  if (demande) await ouvrir(graphie(demande), { historique: false });
  else saisie.focus();
}

// ==== Fiche d'un diagnostic ====

async function ficheDiagnostic(arbre, code) {
  const [diagnostics, cma, entrees, exclusions, tarifs] = await Promise.all([
    jeux.diagnostics(),
    jeux.cma(),
    jeux.entrees(),
    chargerJson("groupage", "cma_exclusions"),
    chargerTarifs().catch(() => null),
  ]);
  const lignes = diagnostics.lignes.filter((l) => l.Code === code);
  const entreesDuCode = entrees.lignes.filter((l) => l.Code === code);
  const libelle =
    lignes[0]?.["Libellé code"] ?? cma.lignes.find((l) => l.Code === code)?.["Libellé"] ?? entreesDuCode[0]?.["Libellé"];
  if (!libelle) {
    return [el("p", { class: "message-info" }, `${code} ne figure ni dans les listes de la fonction groupage, ni parmi les CMA.`)];
  }
  const listes = [...new Set(lignes.map((l) => l.Liste))].sort();
  const { parListe } = indexer(arbre);
  const etapes = listes.flatMap((l) => (parListe.get(l) ?? []).map((e) => ({ ...e, liste: l })));
  const surLeDp = (e) => e.n.genre === "test" && e.n.symbole === "DP";
  const cmds = [...cmdsDuDp(listes, entreesDuCode)].map(([cmd, origine]) => etapeCmd(arbre, cmd, origine)).filter(Boolean);
  const parcours = parcoursEnDp(listes);
  const enDp = [...cmds, ...marquerAtteintes(arbre, etapes.filter(surLeDp), cmds, parcours)];
  const autres = etapes.filter((e) => !surLeDp(e));
  const cmdsDuVolume2 = [...new Set(entrees.lignes.map((l) => l.CMD))].join(", ");

  if (!arbre._frontieresDp) arbre._frontieresDp = frontieresDp(arbre, diagnostics.lignes);
  const frontiere = arbre._frontieresDp.filter((f) => f.Code === code);
  const voisins = frontiere.length
    ? arbre._frontieresDp.filter(
        (f) => f._categorie === code.slice(0, 3) && frontiere.some((x) => x.CMD === f.CMD) && f.Code !== code
      )
    : [];

  return [
    el("h2", { tabindex: "-1" }, `${code} — ${libelle}`),
    resume(cmds, enDp, frontiere, exclusions, code),
    el("h3", {}, "En diagnostic principal"),
    cmds.length
      ? null
      : el(
          "p",
          { class: "message-info" },
          `${code} ne figure ni dans une liste de diagnostics propre à une CMD, numérotée d'après elle (D-0307 pour la CMD 03), ni parmi les diagnostics d'entrée relevés dans le volume 2 du manuel (CMD ${cmdsDuVolume2}) : la CMD où il oriente le séjour en DP n'est pas calculée ici.`
        ),
    enDp.length ? tableEtapes(arbre, enDp, parcours) : null,
    enDp.length
      ? el(
          "p",
          { class: "fiche-note" },
          "Racines possibles : celles que le séjour peut atteindre depuis l'étape avec ce DP, selon ses actes, ses autres diagnostics, l'âge ou la durée de séjour."
        )
      : null,
    frontiere.length ? blocFrontiere(code, frontiere, voisins) : null,
    ...blocTarifs(arbre, tarifs, racinesDesEtapes(arbre, enDp.filter((e) => !e.nonAtteinte), parcours)),
    el("h3", {}, "En diagnostic associé : CMA"),
    blocCma(exclusions, code),
    autres.length ? el("h3", {}, "Autres tests de l'arbre sur ce diagnostic") : null,
    autres.length ? tableEtapes(arbre, autres) : null,
    el("h3", {}, "Listes de la fonction groupage"),
    listes.length
      ? el(
          "ul",
          { class: "fiche-listes" },
          ...listes.map((l) => el("li", {}, el("strong", { class: "code" }, l), ` ${arbre.listes[l]?.libelle ?? lignes.find((x) => x.Liste === l)?.["Libellé liste"] ?? ""}`))
        )
      : el("p", { class: "compteur" }, "Aucune."),
  ];
}

/** Les CMD où le code oriente le séjour en DP, et ce qui l'y range : sa
 *  liste de diagnostics de CMD (« D-0307 » : CMD 03) ou, à défaut, les
 *  diagnostics d'entrée que donne le volume 2 du manuel (CMD 14, dont les
 *  listes D-14xx n'en contiennent qu'une partie). Un code des appareils
 *  génitaux est dans deux listes de CMD, 12 et 13, selon le sexe. */
function cmdsDuDp(listes, entrees) {
  const cmds = new Map();
  for (const l of listes) {
    const m = RE_LISTE_CMD.exec(l);
    if (m && !cmds.has(m[1])) cmds.set(m[1], l);
  }
  for (const e of entrees) if (!cmds.has(e.CMD)) cmds.set(e.CMD, "diagnostic d'entrée du volume 2");
  return cmds;
}

/** L'étape qui oriente le séjour en DP vers la CMD : la racine de son arbre
 *  (« DP : CMD 03 »), avec ce qui y range le code. */
function etapeCmd(arbre, cmd, origine) {
  const c = arbre.cmd.find((x) => x.cmd === cmd);
  return c ? { id: c.racine, n: arbre.noeuds[c.racine], i: 0, libelle: `CMD ${c.cmd} ${c.titre} (${origine})` } : null;
}

/** Marque `nonAtteinte` les étapes sur le DP dont le séjour ne prend pas le
 *  cas avec ce DP. L'orientation (séances, transplantation, traumatismes
 *  multiples, VIH, nouveau-nés) précède la CMD du DP ; hors d'elle, une
 *  étape n'est atteinte que depuis cette CMD. Sans CMD connue, rien n'est
 *  marqué. */
function marquerAtteintes(arbre, etapes, cmds, parcours) {
  if (!cmds.length) return etapes;
  const orientation = new Set(arbre.orientation.map((o) => o.cmd));
  const atteints = new Set();
  const pile = cmds.map((e) => e.n.branches[e.i].vers);
  while (pile.length) {
    const id = pile.pop();
    if (atteints.has(id)) continue;
    atteints.add(id);
    pile.push(...parcours.suivre(arbre.noeuds[id]));
  }
  const prise = (e) => atteints.has(e.id) && parcours.suivre(e.n).includes(e.n.branches[e.i].vers);
  return etapes.map((e) => (orientation.has(e.n.cmd) || prise(e) ? e : { ...e, nonAtteinte: true }));
}

/** Trois pastilles pour lire la fiche d'un coup d'œil. */
function resume(cmds, enDp, frontiere, exclusions, code) {
  const fiche = exclusions.cma.find((c) => c[0] === code);
  const etapes = `testé à ${enDp.length} étape${enDp.length > 1 ? "s" : ""}`;
  const dp = cmds.length
    ? `DP : CMD ${cmds.map((e) => e.n.cmd).join(" ou ")}, ${etapes}`
    : enDp.length
      ? `DP : ${etapes}`
      : "DP : pas de test spécifique";
  const pastilles = [
    el("span", { class: "pastille" }, dp),
    frontiere.length ? el("span", { class: "pastille attention" }, "Code frontière en DP") : null,
    el("span", { class: fiche ? "pastille cma" : "pastille" }, fiche ? `CMA de niveau ${fiche[1]}` : "Pas une CMA"),
  ];
  return el("p", { class: "fiche-resume" }, ...pastilles);
}

function lienArbre(e) {
  const cas = e.n.branches.length > 1 ? `/${e.i}` : "";
  return el("a", { href: `#/mco/arbre/${e.n.cmd}/${e.id}${cas}` }, `CMD ${e.n.cmd} · p. ${e.n.page}`);
}

// Au-delà, les racines d'une étape se replient : depuis la CMD du DP, elles
// sont souvent plusieurs dizaines.
const RACINES_EN_CELLULE_MAX = 6;

function celluleRacines(racines) {
  if (!racines.length) return ["—"];
  const lignes = racines.map((r) =>
    el("span", { class: "racine-libellee" }, el("strong", { class: "code" }, r), libelleRacine(r) ? ` ${libelleRacine(r)}` : "")
  );
  if (racines.length <= RACINES_EN_CELLULE_MAX) return lignes;
  return [el("details", {}, el("summary", {}, decompte(racines)), ...lignes)];
}

/** « 27 racines : 22 chirurgicales, 3 interventionnelles, 2 médicales ». */
function decompte(racines) {
  const parType = Object.entries(TYPES_RACINE).flatMap(([type, nom]) => {
    const n = racines.filter((r) => r[2] === type).length;
    return n ? [`${n} ${nom}${n > 1 ? "s" : ""}`] : [];
  });
  return `${racines.length} racines : ${parType.join(", ")}`;
}

function tableEtapes(arbre, etapes, parcours) {
  return el(
    "div",
    { class: "codes-liste" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el("tr", {}, el("th", { scope: "col" }, "Étape"), el("th", { scope: "col" }, "Test"), el("th", { scope: "col" }, "Racines possibles"))
      ),
      el(
        "tbody",
        {},
        ...etapes.map((e) => {
          const b = e.n.branches[e.i];
          const symbole = e.n.genre === "test" ? SYMBOLES[e.n.symbole] ?? e.n.symbole : e.n.variable;
          return el(
            "tr",
            {},
            el("td", { class: "code" }, lienArbre(e)),
            el("td", {}, `${symbole} : ${e.libelle ?? b.libelle}`),
            e.nonAtteinte
              ? el(
                  "td",
                  { class: "racines non-atteinte" },
                  "Non atteinte avec ce DP : un test précédent classe le séjour ailleurs, ou l'étape suit une inversion du DP et du DR."
                )
              : el("td", { class: "racines" }, ...celluleRacines(racinesDe(arbre, b.vers, parcours)))
          );
        })
      )
    )
  );
}

// Au-delà, les racines restent repliées : la fiche d'un diagnostic testé à
// plusieurs étapes en compte vite une dizaine.
const RACINES_DEPLIEES_MAX = 3;

/** Les GHS de chaque racine possible, une racine par encadré à déplier. */
function blocTarifs(arbre, tarifs, racines) {
  if (!racines.length) return [];
  const titre = el("h3", {}, "Tarifs des racines possibles");
  if (!tarifs) return [titre, el("p", { class: "message-avertissement" }, "Tarifs des GHS indisponibles pour le moment.")];
  const deplier = racines.length <= RACINES_DEPLIEES_MAX;
  return [
    titre,
    fraicheur([{ libelle: tarifs.libelle, millesime: tarifs.millesime }]),
    noteTarifs("#/mco/tarifs"),
    ...racines.map((r) => {
      const dansArbre = ghmDeRacineDansArbre(arbre, r);
      const ghms = dansArbre.length ? dansArbre : ghmDeRacine(tarifs, r);
      const n = nombreGhs(tarifs, ghms);
      return el(
        "details",
        { class: "tarifs-racine", open: deplier ? "" : undefined },
        el(
          "summary",
          {},
          el("strong", { class: "code" }, r),
          libelleRacine(r) ? ` ${libelleRacine(r)}` : "",
          el("span", { class: "compte" }, n ? ` · ${n} GHS` : " · pas de tarif")
        ),
        n
          ? tableTarifs(tarifs, ghms)
          : el("p", { class: "message-info" }, "L'arrêté tarifaire ne donne aucun GHS pour cette racine.")
      );
    }),
  ];
}

function blocFrontiere(code, frontiere, voisins) {
  const racinesDuCode = new Set(frontiere.flatMap((f) => f.Racines.split(", ")));
  const ailleurs = voisins.filter((v) => v.Racines.split(", ").some((r) => !racinesDuCode.has(r)));
  return el(
    "div",
    { class: "message-avertissement fiche-frontiere" },
    el("strong", {}, "Code frontière : "),
    `dans la catégorie ${code.slice(0, 3)}, des codes voisins en DP mènent à d'autres racines.`,
    el(
      "ul",
      {},
      ...ailleurs.slice(0, 15).map((v) =>
        el("li", {}, el("a", { href: `#/mco/fiche/${v.Code}` }, v.Code), ` ${v["Libellé code"]} → ${racinesEnClair(v.Racines)}`)
      ),
      ailleurs.length > 15 ? el("li", {}, `… et ${ailleurs.length - 15} autres (voir les codes frontières en DP).`) : null
    )
  );
}

function blocCma(exclusions, code) {
  const fiche = exclusions.cma.find((c) => c[0] === code);
  if (!fiche) return el("p", { class: "message-info" }, `${code} n'est pas une CMA : en DAS, il ne modifie pas le niveau de sévérité.`);
  const [, niveau, listeDp, listeRacine] = fiche;
  const verdict = el("p", { class: "fiche-verdict", role: "status" });
  const champ = el("input", {
    type: "text",
    id: "fiche_dp",
    placeholder: "ex. : N18.5",
    autocomplete: "off",
    oninput: () => {
      const dp = champ.value.trim() ? graphie(champ.value) : "";
      verdict.innerHTML = "";
      verdict.className = "fiche-verdict";
      if (!dp) return;
      const element = listeDp != null ? exclusions.dp[listeDp].find((e) => couvre(e, dp)) : null;
      verdict.classList.add(element ? "message-avertissement" : "message-succes");
      verdict.append(element ? `Exclue avec le DP ${dp} (élément « ${element} » de la liste ${listeDp}).` : `Retenue avec le DP ${dp}.`);
    },
  });
  const elementsDp = listeDp != null ? exclusions.dp[listeDp] : [];
  const elementsRacines = listeRacine != null ? exclusions.racines[listeRacine] : [];
  return el(
    "div",
    {},
    el("p", {}, el("strong", {}, `CMA de niveau ${niveau}`), " : codée en DAS, elle peut porter le séjour au niveau de sévérité ", String(niveau), ", sauf exclusion."),
    el(
      "div",
      { class: "champ fiche-dp" },
      el("label", { for: "fiche_dp" }, "Cette CMA compte-t-elle avec le DP :"),
      champ,
      verdict
    ),
    el(
      "p",
      { class: "fiche-sous-titre" },
      listeDp != null ? `DP qui l'excluent (liste ${listeDp}, ${nombre(elementsDp.length)} élément${elementsDp.length > 1 ? "s" : ""}) :` : "Aucun DP ne l'exclut."
    ),
    elementsDp.length ? el("p", { class: "puces-exclusion" }, ...elementsDp.map((e) => el("span", { class: "puce-exclusion", title: titreElement(e) }, e))) : null,
    el(
      "p",
      { class: "fiche-sous-titre" },
      listeRacine != null ? `Racines de GHM où elle est exclue (liste ${listeRacine}) :` : "Aucune racine de GHM ne l'exclut."
    ),
    elementsRacines.length ? el("p", { class: "puces-exclusion" }, ...elementsRacines.map((e) =>
          el("span", { class: "puce-exclusion", title: libelleRacine(e) || undefined }, libelleRacine(e) ? `${e} ${libelleRacine(e)}` : e.replace(/_/g, " "))
        )) : null,
    el(
      "p",
      { class: "sous-titre" },
      "Listes d'exclusion du volume 1 du Manuel des GHM (annexes 4 et 5). Les conditions de durée de séjour attachées aux niveaux ne sont pas reprises."
    )
  );
}

function titreElement(e) {
  if (e.includes("-")) {
    const [a, b] = e.split("-");
    return `Tous les codes de ${a} à ${b.replace("*", "")}${b.endsWith("*") ? " (sauf l'extension 0)" : ", extensions comprises"}`;
  }
  return e.endsWith("*") ? `${e.slice(0, -1)} et ses extensions, sauf l'extension 0` : `${e} et toutes ses extensions`;
}

// ==== Fiche d'un acte ====

async function ficheActe(arbre, code) {
  const [actes, tarifs] = await Promise.all([jeux.actes(), chargerTarifs().catch(() => null)]);
  const lignes = actes.lignes.filter((l) => codeCcam(l.Code) === code);
  if (!lignes.length) {
    return [el("p", { class: "message-info" }, `${code} ne figure dans aucune liste d'actes de la fonction groupage : ce n'est pas un acte classant.`)];
  }
  const libelle = lignes[0]["Libellé code"];
  const listes = [...new Set(lignes.map((l) => l.Liste))].sort();
  const { parListe } = indexer(arbre);
  const etapes = listes.flatMap((l) => (parListe.get(l) ?? []).map((e) => ({ ...e, liste: l })));
  if (!arbre._frontieresActes) arbre._frontieresActes = frontieresActes(arbre, actes.lignes);
  const moi = arbre._frontieresActes.filter((f) => codeCcam(f.Code) === code);
  const voisins = arbre._frontieresActes.filter(
    (f) => moi.some((m) => m.CMD === f.CMD && m._famille === f._famille && m.Racines !== f.Racines) && codeCcam(f.Code) !== code
  );
  return [
    el("h2", { tabindex: "-1" }, `${code} — ${libelle}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, `Acte classant : testé à ${etapes.length} étape${etapes.length > 1 ? "s" : ""}`),
      moi.length ? el("span", { class: "pastille attention" }, moi.some((m) => m._typeChange) ? "Acte frontière (le type de GHM change)" : "Acte frontière") : null
    ),
    el("h3", {}, "Étapes de l'arbre qui testent cet acte"),
    etapes.length ? tableEtapes(arbre, etapes) : el("p", { class: "compteur" }, "Aucune."),
    voisins.length
      ? el(
          "div",
          { class: "message-avertissement fiche-frontiere" },
          el("strong", {}, "Acte frontière : "),
          "des actes voisins (mêmes 4 lettres) mènent à d'autres racines.",
          el(
            "ul",
            {},
            ...voisins.slice(0, 15).map((v) =>
              el("li", {}, el("a", { href: `#/mco/fiche/${codeCcam(v.Code)}` }, codeCcam(v.Code)), ` ${v["Libellé code"]} → ${racinesEnClair(v.Racines)} (CMD ${v.CMD})`)
            )
          )
        )
      : null,
    ...blocTarifs(arbre, tarifs, racinesDesEtapes(arbre, etapes)),
    el("h3", {}, "Listes de la fonction groupage"),
    el(
      "ul",
      { class: "fiche-listes" },
      ...listes.map((l) => el("li", {}, el("strong", { class: "code" }, l), ` ${arbre.listes[l]?.libelle ?? lignes.find((x) => x.Liste === l)?.["Libellé liste"] ?? ""}`))
    ),
  ];
}
