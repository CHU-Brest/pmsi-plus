// Composants d'interface partagés par les thèmes : squelette de chargement,
// drapeau de fraîcheur, champ de recherche, tableau de résultats. Un seul
// rendu de tableau, un seul rendu de drapeau, pour que deux thèmes ne
// puissent pas afficher la même chose de deux façons.

import { normaliser } from "./recherche.js";

const AIDE_MOTS_CLEFS =
  "Recherche insensible à la casse et aux accents. Plusieurs mots clefs " +
  "séparés par un espace sont cumulatifs.";

const FORMAT_NOMBRE = new Intl.NumberFormat("fr-FR");

export function nombre(n) {
  return FORMAT_NOMBRE.format(n);
}

function el(tag, attrs = {}, ...enfants) {
  const noeud = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attrs)) {
    if (valeur == null) continue;
    if (cle === "class") noeud.className = valeur;
    else if (cle === "html") noeud.innerHTML = valeur;
    else if (cle.startsWith("on")) noeud.addEventListener(cle.slice(2), valeur);
    else noeud.setAttribute(cle, valeur);
  }
  for (const enfant of enfants) {
    if (enfant == null) continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(enfant));
  }
  return noeud;
}
export { el };

/** Silhouette animée affichée pendant le chargement d'un thème : la page
 *  garde sa forme au lieu de sauter d'un « Chargement… » d'une ligne au
 *  tableau complet. */
export function squelette() {
  return el(
    "div",
    { class: "squelette", "aria-hidden": "true" },
    el("span", {}),
    el("span", {}),
    el("span", {})
  );
}

// ==== Fraîcheur des données ====

function jour(iso) {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

/** L'âge d'une donnée en clair : « il y a 5 mois ». */
function depuis(iso, aujourdhui) {
  const millesime = new Date(iso + "T00:00:00");
  const jours = Math.round((aujourdhui - millesime) / 86_400_000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";

  let mois =
    (aujourdhui.getFullYear() - millesime.getFullYear()) * 12 +
    (aujourdhui.getMonth() - millesime.getMonth());
  if (aujourdhui.getDate() < millesime.getDate()) mois -= 1;

  if (mois < 1) return `il y a ${jours} jours`;
  if (mois < 24) return `il y a ${mois} mois`;
  return `il y a ${Math.floor(mois / 12)} ans`;
}

/** Pastille du drapeau : verte, orange puis rouge selon l'âge — un coup
 *  d'œil suffit à voir qu'un référentiel n'a pas été rafraîchi depuis un an
 *  sans avoir à lire la date. */
function teinte(iso, aujourdhui) {
  const jours = (aujourdhui - new Date(iso + "T00:00:00")) / 86_400_000;
  if (jours > 365) return "froid";
  if (jours > 180) return "tiede";
  return "";
}

/** Un seul drapeau, portant le millésime le plus ancien des jeux passés.
 *  `jeux` : [{ libelle, millesime }] — `millesime` au format ISO `AAAA-MM-JJ`. */
export function fraicheur(jeux) {
  if (!jeux.length) return null;

  const dates = jeux.map((j) => j.millesime);
  const plusAncien = dates.reduce((a, b) => (a < b ? a : b));
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);

  const libelle = `Données du ${jour(plusAncien)} — ${depuis(plusAncien, aujourdhui)}`;
  const detailNecessaire = new Set(dates).size > 1;
  const infobulle = detailNecessaire
    ? "Le drapeau porte le millésime le plus ancien de la page.\n" +
      jeux.map((j) => `${j.libelle} : ${jour(j.millesime)}`).join("\n")
    : null;

  const classes = ["drapeau", teinte(plusAncien, aujourdhui)].filter(Boolean);
  return el(
    "span",
    { class: classes.join(" "), title: infobulle ?? undefined },
    libelle
  );
}

// ==== Champ de recherche ====

// Filtrer à chaque frappe sur un référentiel de plusieurs milliers de
// lignes reste rapide, mais reconstruire le tableau entre deux touches
// d'une même saisie ne sert à rien : on laisse retomber la frappe.
const DELAI_FRAPPE = 120;

// « / » ramène au premier champ de recherche de la page, sauf si l'on est
// déjà en train de saisir quelque part. L'écouteur est posé une seule fois
// pour tout le site : un thème rendu deux fois ne doit pas en empiler deux.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const cible = e.target;
  if (cible instanceof HTMLInputElement || cible instanceof HTMLTextAreaElement) return;
  const champ = document.querySelector("#contenu input[type='search']");
  if (!champ) return;
  e.preventDefault();
  champ.focus();
});

/** Champ de recherche : loupe, bouton d'effacement, raccourci clavier « / »
 *  pour y revenir sans la souris. */
export function champMotsClefs({ id, exemple, onInput }) {
  const label = el("label", {}, "Mot(s) clef(s) :");
  label.htmlFor = id;

  let minuteur = null;
  const input = el("input", {
    type: "search",
    id,
    placeholder: exemple,
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e) => {
      const valeur = e.target.value;
      effacer.hidden = valeur === "";
      raccourci.hidden = valeur !== "";
      clearTimeout(minuteur);
      minuteur = setTimeout(() => onInput(valeur), DELAI_FRAPPE);
    },
    onkeydown: (e) => {
      if (e.key !== "Escape" || input.value === "") return;
      e.stopPropagation(); // sinon la touche referme aussi le tiroir
      viderChamp();
    },
  });

  function viderChamp() {
    input.value = "";
    effacer.hidden = true;
    raccourci.hidden = false;
    clearTimeout(minuteur);
    onInput("");
    input.focus();
  }

  const effacer = el(
    "button",
    {
      type: "button",
      class: "effacer",
      hidden: "",
      "aria-label": "Effacer la recherche",
      onclick: viderChamp,
    },
    "✕"
  );
  const raccourci = el("span", { class: "raccourci", "aria-hidden": "true" }, "/");

  return el(
    "div",
    { class: "champ" },
    label,
    el(
      "div",
      { class: "champ-recherche" },
      el("span", { class: "loupe", "aria-hidden": "true" }),
      input,
      raccourci,
      effacer
    ),
    el("p", { class: "champ-aide" }, AIDE_MOTS_CLEFS)
  );
}

// ==== Tableau et compteur ====

function colonnesVisibles(lignes) {
  if (!lignes.length) return [];
  return Object.keys(lignes[0]).filter((c) => !c.startsWith("_"));
}

// Colonnes de codes (CIM-10, CCAM) : en chasse fixe, les codes s'alignent
// et se comparent d'un coup d'œil d'une ligne à l'autre.
const COLONNES_CODES = /^code|code$/;

function celluleValeur(v, colonne) {
  if (typeof v === "boolean") {
    return el(
      "td",
      { class: v ? "oui" : "non", "aria-label": v ? "oui" : "non" },
      v ? "✓" : ""
    );
  }
  // Une seule ligne par cellule (tronquée avec « … » en CSS) : un libellé
  // long ne doit pas rendre sa ligne plus haute que les autres, sans quoi
  // la hauteur du tableau varie encore d'une page ou d'une recherche à
  // l'autre. Le texte complet reste lisible via l'infobulle au survol.
  const texte = v ?? "";
  const classe = COLONNES_CODES.test(normaliser(colonne)) ? "code" : undefined;
  return el("td", { class: classe, title: texte || undefined }, texte);
}

// Les référentiels les plus gros (actes, médicaments) dépassent 20 000
// lignes : sans pagination, une recherche large — y compris la page vide,
// au premier chargement — reconstruisait des dizaines de milliers de <tr>
// à chaque frappe. On pagine donc : quel que soit le nombre de résultats,
// au plus `taillePage` lignes sont dans le DOM à la fois.
const TAILLES_PAGE = [10, 25, 50];
const TAILLE_PAGE_DEFAUT = 10;

// Largeur naturelle d'une colonne : assez pour son en-tête ET son contenu
// moyen sur une seule ligne chacun, sans repli sur plusieurs lignes ni
// troncature du nom de colonne — un nom de colonne coupé n'importe où
// (EMPOISONNEMENT_NON_DETERMINEE, Ffm - Membre Supérieur/Inférieur...)
// est illisible. Si la somme des largeurs naturelles dépasse la largeur
// disponible, `.zone-tableau` (overflow-x: auto) fait défiler le tableau
// plutôt que de comprimer les colonnes ; si elle tient dedans (petits
// référentiels : germes, contextes, acronymes), on étire au prorata pour
// ne pas laisser d'espace vide à droite.
const LARGEUR_MIN = 56;
const LARGEUR_MAX_TEXTE = 700;
const CARACTERE_PX = 7.5;
const PADDING_CELLULE = 28;

// Colonne « vedette » : le libellé ou le nom est le texte qui identifie la
// ligne pour l'utilisateur, contrairement aux colonnes voisines (code,
// justification, catégorie...) qui peuvent être aussi longues en moyenne
// sans être ce qu'on a besoin de lire en entier. On l'élargit donc d'office
// plutôt que de se fier à la seule longueur moyenne du contenu — avec son
// propre plafond, plus haut que LARGEUR_MAX_TEXTE : sur les actes CCAM par
// exemple, la longueur moyenne du libellé (~90 caractères) atteint déjà
// LARGEUR_MAX_TEXTE à elle seule, donc un simple facteur multiplicatif n'a
// aucun effet visible tant que le plafond général reste le même.
const COLONNES_VEDETTES = /^(nom|libelle)/;
const FACTEUR_COLONNE_VEDETTE = 1.6;
const LARGEUR_MAX_TEXTE_VEDETTE = 1100;

function estColonneVedette(nom) {
  return COLONNES_VEDETTES.test(normaliser(nom));
}

function largeurTexte(nbCaracteres) {
  return nbCaracteres * CARACTERE_PX + PADDING_CELLULE;
}

function largeursColonnes(colonnes, colonnesCases, lignes, largeurDisponible) {
  const naturelles = new Map();
  for (const c of colonnes) {
    const largeurEntete = largeurTexte(c.length);
    let largeurContenu;
    if (colonnesCases.has(c)) {
      largeurContenu = LARGEUR_MIN;
    } else {
      let somme = 0;
      for (const ligne of lignes) somme += String(ligne[c] ?? "").length;
      largeurContenu = largeurTexte(lignes.length ? somme / lignes.length : 0);
    }
    const vedette = estColonneVedette(c);
    let largeur = Math.max(largeurEntete, largeurContenu);
    if (vedette) largeur *= FACTEUR_COLONNE_VEDETTE;
    const plafond = vedette ? LARGEUR_MAX_TEXTE_VEDETTE : LARGEUR_MAX_TEXTE;
    naturelles.set(c, Math.min(plafond, Math.max(LARGEUR_MIN, largeur)));
  }

  const totalNaturel = [...naturelles.values()].reduce((a, b) => a + b, 0);
  if (!largeurDisponible || totalNaturel >= largeurDisponible) {
    return new Map([...naturelles].map(([c, l]) => [c, Math.round(l)]));
  }

  const echelle = largeurDisponible / totalNaturel;
  return new Map([...naturelles].map(([c, l]) => [c, Math.round(l * echelle)]));
}

/** Tableau simple, colonnes triables au clic ou au clavier, et paginé. */
export function tableau(conteneur, lignes) {
  conteneur.innerHTML = "";
  const colonnes = colonnesVisibles(lignes);
  if (!colonnes.length) return;

  // Colonnes booléennes (coches) : largeur figée pour que la largeur de
  // chaque colonne ne dépende plus des lignes affichées — sans ça,
  // `table-layout: fixed` répartirait l'espace en fonction de la première
  // ligne rendue, qui change à chaque page ou tri.
  const colonnesCases = new Set(
    colonnes.filter((c) => typeof lignes[0][c] === "boolean")
  );

  let triPar = null;
  let triAsc = true;
  let lignesTriees = lignes;
  let page = 0;
  let taillePage = TAILLE_PAGE_DEFAUT;

  const zone = el("div", { class: "zone-tableau" });
  const pagination = el("div", { class: "pagination" });
  conteneur.append(zone, pagination);

  const largeurs = largeursColonnes(colonnes, colonnesCases, lignes, zone.clientWidth || 800);

  function nbPages() {
    return Math.max(1, Math.ceil(lignesTriees.length / taillePage));
  }

  function rendreCorps(tbody) {
    tbody.innerHTML = "";
    const debut = page * taillePage;
    const lignesPage = lignesTriees.slice(debut, debut + taillePage);
    for (const ligne of lignesPage) {
      const tr = el("tr", {});
      for (const c of colonnes) tr.append(celluleValeur(ligne[c], c));
      tbody.append(tr);
    }
    // Lignes de remplissage, invisibles mais occupant leur place : sans
    // elles, une dernière page incomplète raccourcit le tableau et fait
    // sauter verticalement ce qui suit — par exemple la section
    // « Substances », juste sous « Médicaments » sur le thème Intox. On
    // n'en met que si le jeu compte au moins une page pleine : sur une
    // recherche qui ne rend que trois lignes en tout, il n'y a rien à
    // stabiliser et un tableau aux trois quarts vide serait absurde.
    const hauteur = Math.min(taillePage, lignesTriees.length);
    for (let i = lignesPage.length; i < hauteur; i++) {
      const tr = el("tr", { class: "ligne-remplissage", "aria-hidden": "true" });
      for (const c of colonnes) tr.append(el("td", {}, " "));
      tbody.append(tr);
    }
  }

  function rendrePagination() {
    pagination.innerHTML = "";
    const total = nbPages();
    const selecteur = el(
      "select",
      {
        "aria-label": "Nombre de lignes par page",
        onchange: (e) => {
          taillePage = Number(e.target.value);
          allerPage(0);
        },
      },
      ...TAILLES_PAGE.map((n) =>
        el("option", { value: String(n), selected: n === taillePage ? "" : undefined }, String(n))
      )
    );

    pagination.append(
      el(
        "button",
        {
          type: "button",
          disabled: page === 0 ? "" : undefined,
          onclick: () => allerPage(page - 1),
        },
        "← Précédent"
      ),
      el(
        "span",
        { class: "pagination-statut", "aria-live": "polite" },
        `Page ${nombre(page + 1)} sur ${nombre(total)}`
      ),
      el(
        "button",
        {
          type: "button",
          disabled: page === total - 1 ? "" : undefined,
          onclick: () => allerPage(page + 1),
        },
        "Suivant →"
      ),
      el("span", { class: "pagination-taille" }, "Lignes par page", selecteur)
    );
  }

  function allerPage(cible) {
    page = Math.min(Math.max(cible, 0), nbPages() - 1);
    rendreCorps(tbody);
    rendrePagination();
  }

  function trier(colonne) {
    triAsc = triPar === colonne ? !triAsc : true;
    triPar = colonne;
    lignesTriees = [...lignes].sort((a, b) => {
      const va = a[colonne];
      const vb = b[colonne];
      if (va === vb) return 0;
      const sens = va > vb ? 1 : -1;
      return triAsc ? sens : -sens;
    });
    page = 0;
    for (const th of thead.querySelectorAll("th")) {
      th.setAttribute(
        "aria-sort",
        th.dataset.colonne === colonne ? (triAsc ? "ascending" : "descending") : "none"
      );
    }
    rendreCorps(tbody);
    rendrePagination();
  }

  const thead = el("thead", {});
  const trEntete = el("tr", {});
  for (const c of colonnes) {
    trEntete.append(
      el(
        "th",
        {
          scope: "col",
          "data-colonne": c,
          "aria-sort": "none",
          tabindex: "0",
          title: `Trier par « ${c} »`,
          style: `width:${largeurs.get(c)}px`,
          onclick: () => trier(c),
          onkeydown: (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            trier(c);
          },
        },
        c
      )
    );
  }
  thead.append(trEntete);

  const tbody = el("tbody", {});
  rendreCorps(tbody);
  rendrePagination();

  // Largeur totale posée sur le <table> : avec `table-layout: fixed`, une
  // largeur de table laissée à `auto` se rabat sur celle du conteneur et
  // les largeurs de colonnes calculées ci-dessus sont alors comprimées au
  // prorata — un libellé d'acte se retrouvait tronqué à quelques
  // caractères. En posant la somme, le tableau déborde et `.zone-tableau`
  // le fait défiler, comme prévu.
  const largeurTotale = [...largeurs.values()].reduce((a, b) => a + b, 0);
  zone.append(
    el(
      "table",
      { class: "tableau-donnees", style: `width:${largeurTotale}px`, "aria-rowcount": String(lignes.length) },
      thead,
      tbody
    )
  );
}

function compteur(affiches, total) {
  const pluriel = affiches > 1 ? "s" : "";
  if (total == null || affiches === total) {
    return [el("strong", {}, nombre(affiches)), ` résultat${pluriel}`];
  }
  return [
    el("strong", {}, nombre(affiches)),
    ` résultat${pluriel} sur ${nombre(total)}`,
  ];
}

/** `tableau()` précédé de son compteur, ou un message si la recherche ne
 *  rend rien. */
export function resultats(conteneur, lignes, { total } = {}) {
  conteneur.innerHTML = "";
  if (!lignes.length) {
    conteneur.append(
      el(
        "p",
        { class: "message-info", role: "status" },
        "Aucun résultat pour cette recherche."
      )
    );
    return;
  }
  conteneur.append(
    el("p", { class: "compteur", "aria-live": "polite" }, ...compteur(lignes.length, total))
  );
  const zone = el("div", {});
  conteneur.append(zone);
  tableau(zone, lignes);
}
