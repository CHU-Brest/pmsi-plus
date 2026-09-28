// Fiche code — tout ce que la fonction groupage fait d'un code CIM-10 ou
// CCAM, sur une seule page : en diagnostic principal (listes, étapes de
// l'arbre qui le testent, racines de GHM possibles et leurs tarifs, codes
// frontières), en diagnostic associé (niveau de CMA, DP et racines qui
// l'excluent), ou comme acte (listes, étapes, racines et leurs tarifs, actes
// frontières).
//
// Tout est calculé dans le navigateur à partir des référentiels déjà
// publiés : arbre.json, listes de la fonction groupage, liste des CMA et
// leurs exclusions, tarifs des GHS.

import { chargerJeu, chargerJson } from "../donnees.js";
import { normaliser } from "../recherche.js";
import { el, fraicheur, nombre } from "../interface.js";
import { racinesAtteintes, calculer as frontieresDp } from "./frontieres.js";
import { calculer as frontieresActes } from "./actes_frontieres.js";
import { couvre } from "./cma.js";
import { codesGhm } from "./arbre.js";
import { chargerTarifs, ghmDeRacine, nombreGhs, noteTarifs, tableTarifs } from "../tarifs.js";

const SUGGESTIONS_MAX = 12;
const RE_CCAM = /^[A-Z]{4}\d{3}/;
const RE_RACINE = /^\d{2}[CKMZ]\d{2}$/;

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
  arbre._fiche = { parListe, memo: new Map() };
  return arbre._fiche;
}

function racinesDe(arbre, vers) {
  return [...racinesAtteintes(arbre, vers, indexer(arbre).memo)].filter((r) => RE_RACINE.test(r)).sort();
}

/** Les racines que peuvent atteindre les étapes, sans doublon. */
function racinesDesEtapes(arbre, etapes) {
  return [...new Set(etapes.flatMap((e) => racinesDe(arbre, e.n.branches[e.i].vers)))].sort();
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
    const aChercher = ccam ? ["actes"] : /^[a-z]\d/i.test(q) ? ["diagnostics", "cma"] : ["diagnostics", "cma", "actes"];
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
  const [diagnostics, cma, exclusions, tarifs] = await Promise.all([
    jeux.diagnostics(),
    jeux.cma(),
    chargerJson("groupage", "cma_exclusions"),
    chargerTarifs().catch(() => null),
  ]);
  const lignes = diagnostics.lignes.filter((l) => l.Code === code);
  const libelle = lignes[0]?.["Libellé code"] ?? cma.lignes.find((l) => l.Code === code)?.["Libellé"];
  if (!libelle) {
    return [el("p", { class: "message-info" }, `${code} ne figure ni dans les listes de la fonction groupage, ni parmi les CMA.`)];
  }
  const listes = [...new Set(lignes.map((l) => l.Liste))].sort();
  const { parListe } = indexer(arbre);
  const etapes = listes.flatMap((l) => (parListe.get(l) ?? []).map((e) => ({ ...e, liste: l })));
  const enDp = etapes.filter((e) => e.n.genre === "test" && e.n.symbole === "DP");
  const autres = etapes.filter((e) => !(e.n.genre === "test" && e.n.symbole === "DP"));

  if (!arbre._frontieresDp) arbre._frontieresDp = frontieresDp(arbre, diagnostics.lignes);
  const frontiere = arbre._frontieresDp.filter((f) => f.Code === code);
  const voisins = frontiere.length
    ? arbre._frontieresDp.filter(
        (f) => f._categorie === code.slice(0, 3) && frontiere.some((x) => x.CMD === f.CMD) && f.Code !== code
      )
    : [];

  return [
    el("h2", { tabindex: "-1" }, `${code} — ${libelle}`),
    resume(enDp, frontiere, exclusions, code),
    el("h3", {}, "En diagnostic principal"),
    enDp.length
      ? tableEtapes(arbre, enDp)
      : el("p", { class: "message-info" }, "Aucune étape de l'arbre ne teste ce code en DP : la CMD que détermine ce DP le classe par ses autres tests."),
    frontiere.length ? blocFrontiere(code, frontiere, voisins) : null,
    ...blocTarifs(arbre, tarifs, racinesDesEtapes(arbre, enDp)),
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

/** Trois pastilles pour lire la fiche d'un coup d'œil. */
function resume(enDp, frontiere, exclusions, code) {
  const fiche = exclusions.cma.find((c) => c[0] === code);
  const pastilles = [
    el("span", { class: "pastille" }, enDp.length ? `DP : testé à ${enDp.length} étape${enDp.length > 1 ? "s" : ""}` : "DP : pas de test spécifique"),
    frontiere.length ? el("span", { class: "pastille attention" }, "Code frontière en DP") : null,
    el("span", { class: fiche ? "pastille cma" : "pastille" }, fiche ? `CMA de niveau ${fiche[1]}` : "Pas une CMA"),
  ];
  return el("p", { class: "fiche-resume" }, ...pastilles);
}

function lienArbre(e) {
  const cas = e.n.branches.length > 1 ? `/${e.i}` : "";
  return el("a", { href: `#/mco/arbre/${e.n.cmd}/${e.id}${cas}` }, `CMD ${e.n.cmd} · p. ${e.n.page}`);
}

function celluleRacines(racines) {
  if (!racines.length) return ["—"];
  return racines.map((r) =>
    el("span", { class: "racine-libellee" }, el("strong", { class: "code" }, r), libelleRacine(r) ? ` ${libelleRacine(r)}` : "")
  );
}

function tableEtapes(arbre, etapes) {
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
            el("td", {}, `${symbole} : ${b.libelle}`),
            el("td", { class: "racines" }, ...celluleRacines(racinesDe(arbre, b.vers)))
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
