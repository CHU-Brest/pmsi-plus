// Composants d'interface partagés par les thèmes : drapeau de fraîcheur,
// champ de recherche, tableau de résultats. Un seul rendu de tableau, un
// seul rendu de drapeau, pour que deux thèmes ne puissent pas afficher la
// même chose de deux façons.

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

  return el("span", { class: "drapeau", title: infobulle ?? undefined }, libelle);
}

// ==== Champ de recherche ====

export function champMotsClefs({ id, exemple, onInput }) {
  const label = el("label", {}, "Mot(s) clef(s) :");
  label.htmlFor = id;
  const input = el("input", {
    type: "text",
    id,
    placeholder: exemple,
    oninput: (e) => onInput(e.target.value),
  });
  return el(
    "div",
    { class: "champ" },
    label,
    input,
    el("p", { class: "champ-aide" }, AIDE_MOTS_CLEFS)
  );
}

// ==== Tableau et compteur ====

function colonnesVisibles(lignes) {
  if (!lignes.length) return [];
  return Object.keys(lignes[0]).filter((c) => !c.startsWith("_"));
}

function celluleValeur(v) {
  if (typeof v === "boolean") {
    return el("td", { class: v ? "oui" : "non" }, v ? "✓" : "");
  }
  // Une seule ligne par cellule (tronquée avec « … » en CSS) : un libellé
  // long ne doit pas rendre sa ligne plus haute que les autres, sans quoi
  // la hauteur du tableau varie encore d'une page ou d'une recherche à
  // l'autre. Le texte complet reste lisible via l'infobulle au survol.
  const texte = v ?? "";
  return el("td", { title: texte || undefined }, texte);
}

// Les référentiels les plus gros (actes, médicaments) dépassent 20 000
// lignes : sans pagination, une recherche large — y compris la page vide,
// au premier chargement — reconstruisait des dizaines de milliers de <tr>
// à chaque frappe. On pagine donc : quel que soit le nombre de résultats,
// au plus TAILLE_PAGE lignes sont dans le DOM à la fois.
const TAILLE_PAGE = 5;

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

/** Tableau simple, colonnes triables au clic, et paginé. */
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

  const zone = el("div", { class: "zone-tableau" });
  const pagination = el("div", { class: "pagination" });
  conteneur.append(zone, pagination);

  const largeurs = largeursColonnes(colonnes, colonnesCases, lignes, zone.clientWidth || 800);

  function nbPages() {
    return Math.max(1, Math.ceil(lignesTriees.length / TAILLE_PAGE));
  }

  function rendreCorps(tbody) {
    tbody.innerHTML = "";
    const debut = page * TAILLE_PAGE;
    const lignesPage = lignesTriees.slice(debut, debut + TAILLE_PAGE);
    for (const ligne of lignesPage) {
      const tr = el("tr", {});
      for (const c of colonnes) tr.append(celluleValeur(ligne[c]));
      tbody.append(tr);
    }
    // Lignes de remplissage, invisibles mais occupant leur place : sans
    // elles, une dernière page incomplète (ou une recherche qui tombe sous
    // TAILLE_PAGE résultats) raccourcit le tableau et fait sauter
    // verticalement ce qui suit — par exemple la section « Substances »,
    // juste sous « Médicaments » sur le thème Intox.
    for (let i = lignesPage.length; i < TAILLE_PAGE; i++) {
      const tr = el("tr", { class: "ligne-remplissage" });
      for (const c of colonnes) tr.append(el("td", {}, " "));
      tbody.append(tr);
    }
  }

  function rendrePagination() {
    pagination.innerHTML = "";
    const total = nbPages();
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
      el("span", { class: "pagination-statut" }, `Page ${nombre(page + 1)} sur ${nombre(total)}`),
      el(
        "button",
        {
          type: "button",
          disabled: page === total - 1 ? "" : undefined,
          onclick: () => allerPage(page + 1),
        },
        "Suivant →"
      )
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
    rendreCorps(tbody);
    rendrePagination();
  }

  const thead = el("thead", {});
  const trEntete = el("tr", {});
  for (const c of colonnes) {
    trEntete.append(
      el("th", { style: `width:${largeurs.get(c)}px`, onclick: () => trier(c) }, c)
    );
  }
  thead.append(trEntete);

  const tbody = el("tbody", {});
  rendreCorps(tbody);
  rendrePagination();

  zone.append(el("table", { class: "tableau-donnees" }, thead, tbody));
}

function compteur(affiches, total) {
  if (total == null || affiches === total) {
    return `${nombre(affiches)} résultat${affiches > 1 ? "s" : ""}`;
  }
  return `${nombre(affiches)} résultats sur ${nombre(total)}`;
}

/** `tableau()` précédé de son compteur, ou un message si la recherche ne
 *  rend rien. */
export function resultats(conteneur, lignes, { total } = {}) {
  conteneur.innerHTML = "";
  if (!lignes.length) {
    conteneur.append(
      el("p", { class: "message-info" }, "Aucun résultat pour cette recherche.")
    );
    return;
  }
  conteneur.append(el("p", { class: "compteur" }, compteur(lignes.length, total)));
  const zone = el("div", {});
  conteneur.append(zone);
  tableau(zone, lignes);
}
