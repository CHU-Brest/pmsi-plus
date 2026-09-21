// Composants d'interface partagés par les thèmes : drapeau de fraîcheur,
// champ de recherche, tableau de résultats. Port de `src/interface.py` de
// pmsi_plus — un seul rendu de tableau, un seul rendu de drapeau, pour que
// deux thèmes ne puissent pas afficher la même chose de deux façons.

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

/** L'âge d'une donnée en clair : « il y a 5 mois » — port de `_depuis()`. */
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
  return el("td", {}, v ?? "");
}

// Les référentiels les plus gros (actes, médicaments) dépassent 20 000
// lignes : sans pagination, une recherche large — y compris la page vide,
// au premier chargement — reconstruisait des dizaines de milliers de <tr>
// à chaque frappe. `st.dataframe`, côté pmsi_plus, évite ce coût par
// virtualisation (seules les lignes visibles sont montées) ; on n'a pas
// cette mécanique ici, donc on pagine : quel que soit le nombre de
// résultats, au plus TAILLE_PAGE lignes sont dans le DOM à la fois.
const TAILLE_PAGE = 10;

/** Tableau simple, colonnes triables au clic — pendant du tri intégré à
 *  `st.dataframe` côté application Streamlit d'origine — et paginé. */
export function tableau(conteneur, lignes) {
  conteneur.innerHTML = "";
  const colonnes = colonnesVisibles(lignes);
  if (!colonnes.length) return;

  let triPar = null;
  let triAsc = true;
  let lignesTriees = lignes;
  let page = 0;

  const zone = el("div", { class: "zone-tableau" });
  const pagination = el("div", { class: "pagination" });
  conteneur.append(zone, pagination);

  function nbPages() {
    return Math.max(1, Math.ceil(lignesTriees.length / TAILLE_PAGE));
  }

  function rendreCorps(tbody) {
    tbody.innerHTML = "";
    const debut = page * TAILLE_PAGE;
    for (const ligne of lignesTriees.slice(debut, debut + TAILLE_PAGE)) {
      const tr = el("tr", {});
      for (const c of colonnes) tr.append(celluleValeur(ligne[c]));
      tbody.append(tr);
    }
  }

  function rendrePagination() {
    pagination.innerHTML = "";
    const total = nbPages();
    if (total <= 1) return;
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
    trEntete.append(el("th", { onclick: () => trier(c) }, c));
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
 *  rend rien — port de `resultats()`. */
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
