// Fiche code — tout ce que la fonction groupage fait d'un code CIM-10 ou
// CCAM, sur une seule page : en diagnostic principal (CMD où il oriente le
// séjour, listes, étapes de l'arbre qui le testent, racines de GHM possibles
// et leurs tarifs, codes frontières), en diagnostic associé (niveau de CMA,
// DP et racines qui l'excluent), ou comme acte (listes, étapes, racines et
// leurs tarifs, actes frontières).
//
// Tout est calculé dans le navigateur à partir des référentiels déjà
// publiés : arbre.json, listes de la fonction groupage, diagnostics
// d'entrée des CMD (volume 2), liste des CMA et leurs exclusions, tarifs des
// GHS.

import { chargerJeu, chargerJson } from "../donnees.js";
import { el, fraicheur, nombre } from "../interface.js";
import {
  RE_CCAM,
  SUGGESTIONS_MAX,
  chercher,
  codeCcam,
  decompte,
  donneesFicheActe,
  donneesFicheDiagnostic,
  exclusionParDp,
  ghmDeRacineDansArbre,
  graphie,
  jeuxOuChercher,
  libellesRacines,
  titreElement,
} from "../groupage_mco.js";
import { chargerTarifs, ghmDeRacine, nombreGhs, noteTarifs, tableTarifs } from "../tarifs.js";

// ==== Données ====

const jeux = {
  diagnostics: () => chargerJeu("groupage", "diagnostics", "listes de diagnostics de la fonction groupage"),
  actes: () => chargerJeu("groupage", "actes", "listes d'actes de la fonction groupage"),
  cma: () => chargerJeu("groupage", "cma", "liste des CMA de la fonction groupage"),
  entrees: () => chargerJeu("groupage", "entrees", "diagnostics d'entrée des CMD (volume 2)"),
  racines: () => chargerJeu("groupage", "racines", "libellés des racines de GHM"),
};

// Libellés des racines de GHM (racine → libellé), chargés à l'ouverture de
// la page et passés aux fonctions qui les affichent : ils permettent au
// codeur de vérifier d'un coup d'œil la cohérence du classement.
const libelleRacine = (libelles, r) => libelles.get(r) ?? "";

/** « 06M10 Ulcères gastroduodénaux compliqués » pour une liste de racines
 *  séparées par des virgules. */
const racinesEnClair = (libelles, racines) =>
  racines
    .split(", ")
    .filter(Boolean)
    .map((r) => (libelleRacine(libelles, r) ? `${r} ${libelleRacine(libelles, r)}` : r))
    .join(" ; ");

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const [arbre, racines] = await Promise.all([chargerJson("groupage", "arbre"), jeux.racines().catch(() => null)]);
  const libelles = libellesRacines(racines?.lignes ?? []);
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
    // Les jeux se chargent un à un, jusqu'à ce que les suggestions suffisent.
    const trouves = new Map();
    for (const nom of jeuxOuChercher(q)) {
      if (trouves.size >= SUGGESTIONS_MAX) break;
      const jeu = await jeux[nom]();
      if (monJeton !== jeton) return;
      chercher(q, nom, jeu, trouves);
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

  let ouverture = 0;
  async function ouvrir(code, { historique = true } = {}) {
    const monOuverture = ++ouverture;
    zoneSuggestions.innerHTML = "";
    saisie.value = code;
    if (historique && zoneFiche.isConnected && location.hash !== `#/mco/fiche/${code}`) {
      history.replaceState(null, "", `#/mco/fiche/${code}`);
    }
    zoneFiche.innerHTML = "";
    zoneFiche.append(el("p", { class: "compteur", role: "status" }, "Chargement…"));
    let contenu;
    try {
      contenu = RE_CCAM.test(code) ? await ficheActe(arbre, code, libelles) : await ficheDiagnostic(arbre, code, libelles);
    } catch (erreur) {
      console.error(erreur);
      contenu = [el("p", { class: "message-erreur" }, `Fiche indisponible pour le moment : ${erreur?.message ?? erreur}`)];
    }
    // Une autre fiche a été demandée entre-temps : c'est elle qui s'affiche.
    if (monOuverture !== ouverture) return;
    zoneFiche.innerHTML = "";
    zoneFiche.append(...contenu.filter(Boolean));
    zoneFiche.querySelector("h2")?.focus?.();
  }

  const [demande] = chemin;
  if (demande) await ouvrir(graphie(demande), { historique: false });
  else saisie.focus();
}

// ==== Fiche d'un diagnostic ====

async function ficheDiagnostic(arbre, code, libelles) {
  const [diagnostics, cma, entrees, exclusions, tarifs] = await Promise.all([
    jeux.diagnostics(),
    jeux.cma(),
    jeux.entrees(),
    chargerJson("groupage", "cma_exclusions"),
    chargerTarifs().catch(() => null),
  ]);
  const fiche = donneesFicheDiagnostic(arbre, code, {
    diagnostics: diagnostics.lignes,
    cma: cma.lignes,
    entrees: entrees.lignes,
    exclusions,
  });
  if (!fiche) {
    return [
      el(
        "p",
        { class: "message-info" },
        `${code} ne figure ni dans les listes de la fonction groupage, ni parmi les CMA, ni parmi les diagnostics d'entrée des CMD.`
      ),
    ];
  }
  return [
    el("h2", { tabindex: "-1" }, `${code} — ${fiche.libelle}`),
    resume(fiche),
    el("h3", {}, "En diagnostic principal"),
    fiche.cmds.length
      ? null
      : el(
          "p",
          { class: "message-info" },
          `${code} n'est un diagnostic d'entrée d'aucune CMD (volume 2 du Manuel des GHM) : en DP, il n'oriente le séjour vers aucune CMD.`
        ),
    fiche.enDp.length ? tableEtapes(libelles, fiche.enDp) : null,
    fiche.enDp.length
      ? el(
          "p",
          { class: "fiche-note" },
          "Racines possibles : celles que le séjour peut atteindre depuis l'étape avec ce DP, selon ses actes, ses autres diagnostics, l'âge ou la durée de séjour."
        )
      : null,
    fiche.frontiere.length ? blocFrontiere(libelles, code, fiche) : null,
    ...blocTarifs(arbre, libelles, tarifs, fiche.racines),
    el("h3", {}, "En diagnostic associé : CMA"),
    blocCma(libelles, exclusions, code, fiche.cma),
    fiche.autres.length ? el("h3", {}, "Autres tests de l'arbre sur ce diagnostic") : null,
    fiche.autres.length ? tableEtapes(libelles, fiche.autres) : null,
    el("h3", {}, "Listes de la fonction groupage"),
    fiche.listes.length ? listeDesListes(fiche.listes) : el("p", { class: "compteur" }, "Aucune."),
  ];
}

/** Trois pastilles pour lire la fiche d'un coup d'œil. */
function resume({ cmds, enDp, frontiere, cma }) {
  const etapes = `testé à ${enDp.length} étape${enDp.length > 1 ? "s" : ""}`;
  const dp = cmds.length
    ? `DP : CMD ${cmds.join(" ou ")}, ${etapes}`
    : enDp.length
      ? `DP : ${etapes}`
      : "DP : pas de test spécifique";
  const pastilles = [
    el("span", { class: "pastille" }, dp),
    frontiere.length ? el("span", { class: "pastille attention" }, "Code frontière en DP") : null,
    el("span", { class: cma ? "pastille cma" : "pastille" }, cma ? `CMA de niveau ${cma.niveau}` : "Pas une CMA"),
  ];
  return el("p", { class: "fiche-resume" }, ...pastilles);
}

function lienArbre(e) {
  const cas = e.cas != null ? `/${e.cas}` : "";
  return el("a", { href: `#/mco/arbre/${e.cmd}/${e.id}${cas}` }, `CMD ${e.cmd} · p. ${e.page}`);
}

// Au-delà, les racines d'une étape se replient : depuis la CMD du DP, elles
// sont souvent plusieurs dizaines.
const RACINES_EN_CELLULE_MAX = 6;

function celluleRacines(libelles, racines) {
  if (!racines.length) return ["—"];
  const lignes = racines.map((r) =>
    el("span", { class: "racine-libellee" }, el("strong", { class: "code" }, r), libelleRacine(libelles, r) ? ` ${libelleRacine(libelles, r)}` : "")
  );
  if (racines.length <= RACINES_EN_CELLULE_MAX) return lignes;
  return [el("details", {}, el("summary", {}, decompte(racines)), ...lignes)];
}

/** Le tableau des étapes, d'après leurs lignes (lignesEtapes). */
function tableEtapes(libelles, etapes) {
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
        ...etapes.map((e) =>
          el(
            "tr",
            {},
            el("td", { class: "code" }, lienArbre(e)),
            el("td", {}, e.test),
            e.nonAtteinte
              ? el(
                  "td",
                  { class: "racines non-atteinte" },
                  "Non atteinte avec ce DP : un test précédent classe le séjour ailleurs, ou l'étape suit une inversion du DP et du DR."
                )
              : el("td", { class: "racines" }, ...celluleRacines(libelles, e.racines))
          )
        )
      )
    )
  );
}

// Au-delà, les racines restent repliées : la fiche d'un diagnostic testé à
// plusieurs étapes en compte vite une dizaine.
const RACINES_DEPLIEES_MAX = 3;

/** Les GHS de chaque racine possible, une racine par encadré à déplier. */
function blocTarifs(arbre, libelles, tarifs, racines) {
  if (!racines.length) return [];
  const titre = el("h3", {}, "Tarifs des racines possibles");
  if (!tarifs) return [titre, el("p", { class: "message-avertissement" }, "Tarifs des GHS indisponibles pour le moment.")];
  const deplier = racines.length <= RACINES_DEPLIEES_MAX;
  return [
    titre,
    fraicheur([{ libelle: tarifs.libelle, millesime: tarifs.millesime }]),
    noteTarifs("#/mco/tarifs"),
    ...racines.map((r) => {
      const ghms = ghmDeRacineDansArbre(arbre, r, ghmDeRacine(tarifs, r));
      const n = nombreGhs(tarifs, ghms);
      return el(
        "details",
        { class: "tarifs-racine", open: deplier ? "" : undefined },
        el(
          "summary",
          {},
          el("strong", { class: "code" }, r),
          libelleRacine(libelles, r) ? ` ${libelleRacine(libelles, r)}` : "",
          el("span", { class: "compte" }, n ? ` · ${n} GHS` : " · pas de tarif")
        ),
        n
          ? tableTarifs(tarifs, ghms)
          : el("p", { class: "message-info" }, "L'arrêté tarifaire ne donne aucun GHS pour cette racine.")
      );
    }),
  ];
}

function blocFrontiere(libelles, code, { voisins, voisinsEnPlus }) {
  return el(
    "div",
    { class: "message-avertissement fiche-frontiere" },
    el("strong", {}, "Code frontière : "),
    `dans la catégorie ${code.slice(0, 3)}, des codes voisins en DP mènent à d'autres racines.`,
    el(
      "ul",
      {},
      ...voisins.map((v) =>
        el("li", {}, el("a", { href: `#/mco/fiche/${v.Code}` }, v.Code), ` ${v["Libellé code"]} → ${racinesEnClair(libelles, v.Racines)}`)
      ),
      voisinsEnPlus ? el("li", {}, `… et ${voisinsEnPlus} autres (voir les codes frontières en DP).`) : null
    )
  );
}

function blocCma(libelles, exclusions, code, cma) {
  if (!cma) return el("p", { class: "message-info" }, `${code} n'est pas une CMA : en DAS, il ne modifie pas le niveau de sévérité.`);
  const { niveau, listeDp, listeRacine, elementsDp, elementsRacines } = cma;
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
      const element = exclusionParDp(exclusions, code, dp);
      verdict.classList.add(element ? "message-avertissement" : "message-succes");
      verdict.append(element ? `Exclue avec le DP ${dp} (élément « ${element} » de la liste ${listeDp}).` : `Retenue avec le DP ${dp}.`);
    },
  });
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
          el("span", { class: "puce-exclusion", title: libelleRacine(libelles, e) || undefined }, libelleRacine(libelles, e) ? `${e} ${libelleRacine(libelles, e)}` : e.replace(/_/g, " "))
        )) : null,
    el(
      "p",
      { class: "sous-titre" },
      "Listes d'exclusion du volume 1 du Manuel des GHM (annexes 4 et 5). Les conditions de durée de séjour attachées aux niveaux ne sont pas reprises."
    )
  );
}

// ==== Fiche d'un acte ====

async function ficheActe(arbre, code, libelles) {
  const [actes, tarifs] = await Promise.all([jeux.actes(), chargerTarifs().catch(() => null)]);
  const fiche = donneesFicheActe(arbre, code, actes.lignes);
  if (!fiche) {
    return [el("p", { class: "message-info" }, `${code} ne figure dans aucune liste d'actes de la fonction groupage : ce n'est pas un acte classant.`)];
  }
  const { etapes, voisins } = fiche;
  return [
    el("h2", { tabindex: "-1" }, `${code} — ${fiche.libelle}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, `Acte classant : testé à ${etapes.length} étape${etapes.length > 1 ? "s" : ""}`),
      fiche.frontiere.length ? el("span", { class: "pastille attention" }, fiche.typeChange ? "Acte frontière (le type de GHM change)" : "Acte frontière") : null
    ),
    el("h3", {}, "Étapes de l'arbre qui testent cet acte"),
    etapes.length ? tableEtapes(libelles, etapes) : el("p", { class: "compteur" }, "Aucune."),
    voisins.length
      ? el(
          "div",
          { class: "message-avertissement fiche-frontiere" },
          el("strong", {}, "Acte frontière : "),
          "des actes voisins (mêmes 4 lettres) mènent à d'autres racines.",
          el(
            "ul",
            {},
            ...voisins.map((v) =>
              el("li", {}, el("a", { href: `#/mco/fiche/${codeCcam(v.Code)}` }, codeCcam(v.Code)), ` ${v["Libellé code"]} → ${racinesEnClair(libelles, v.Racines)} (CMD ${v.CMD})`)
            )
          )
        )
      : null,
    ...blocTarifs(arbre, libelles, tarifs, fiche.racines),
    el("h3", {}, "Listes de la fonction groupage"),
    listeDesListes(fiche.listes),
  ];
}

/** Les listes du code, chacune avec son libellé. */
function listeDesListes(listes) {
  return el("ul", { class: "fiche-listes" }, ...listes.map(({ liste, libelle }) => el("li", {}, el("strong", { class: "code" }, liste), ` ${libelle}`)));
}
