// Point d'entrée : sélecteur de champ (MCO, SMR), barre de navigation,
// tiroir sur petit écran, lien « Signaler un problème », bascule de thème et
// routage par hash (`#/<champ>/<slug>`).
//
// Chaque thème vit dans assets/js/themes/<module>.js et exporte une fonction
// async `rendre(conteneur, { chemin, champ })` qui vide puis remplit
// `conteneur`. `chemin` porte ce qui suit le slug dans le hash
// (`#/mco/arbre/01` → ["01"]), `champ` le champ affiché (`"mco"`) : un thème
// qui n'en a pas l'usage les ignore. `rendre` peut rendre `true` quand il a
// lui-même placé la vue (lien profond vers une étape) : le routeur ne la
// ramène alors pas en haut de page.

import { CHAMPS, champParId, themeParDefaut, themeParSlug, themesDuChamp } from "./registry.js";
import { el, squelette } from "./interface.js";

const contenu = document.getElementById("contenu");
const nav = document.getElementById("nav-themes");
const selecteurChamp = document.getElementById("champs-pmsi");
const titreBarreHaute = document.querySelector(".barre-haute-titre");
const miseEnPage = document.getElementById("mise-en-page");
const bascule = document.getElementById("bascule-barre-laterale");
const voile = document.getElementById("voile");

// La liste des thèmes n'est reconstruite qu'au changement de champ.
let champDeLaNav = null;

function construireNav(champ) {
  if (champ === champDeLaNav) return;
  champDeLaNav = champ;

  const sections = new Map();
  for (const theme of themesDuChamp(champ)) {
    if (theme.cache) continue;
    if (!sections.has(theme.section)) sections.set(theme.section, []);
    sections.get(theme.section).push(theme);
  }

  nav.innerHTML = "";
  for (const [section, themes] of sections) {
    const liens = themes.map((t) =>
      el(
        "li",
        {},
        el(
          "a",
          { href: `#/${champ}/${t.slug}`, "data-slug": t.slug },
          t.titre,
          t.travaux
            ? el("span", { class: "travaux", role: "img", "aria-label": "en travaux", title: "En travaux" }, " 🚧")
            : null
        )
      )
    );
    nav.append(el("h2", {}, section), el("ul", {}, ...liens));
  }
}

function marquerLienActif(slug) {
  nav.querySelectorAll("a[data-slug]").forEach((a) => {
    const actif = a.dataset.slug === slug;
    a.classList.toggle("actif", actif);
    // `aria-current` dit la page courante aux lecteurs d'écran ; la classe
    // ne fait que la colorer.
    if (actif) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// ==== Tiroir (petit écran) ====

function ouvrirBarre(ouverte) {
  miseEnPage.classList.toggle("barre-ouverte", ouverte);
  bascule.setAttribute("aria-expanded", String(ouverte));
}

bascule.addEventListener("click", () => {
  ouvrirBarre(!miseEnPage.classList.contains("barre-ouverte"));
});
voile.addEventListener("click", () => ouvrirBarre(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && miseEnPage.classList.contains("barre-ouverte")) {
    ouvrirBarre(false);
    bascule.focus();
  }
});

// ==== Signaler un problème ====

// Le bouton du pied de la barre latérale ouvre un mail prérempli avec
// l'adresse de la page : le signalement arrive situé, même quand on ne pense
// pas à dire où. Elle est lue au dernier moment, la fiche code et
// l'algorithme réécrivant le hash sans passer par le routeur (replaceState).
// Le destinataire est écrit dans index.html.
const signaler = document.querySelector("a.signaler");
const destinataire = signaler.href;

function actualiserSignalement() {
  const sujet = "Signalement PMSI+";
  // Fins de ligne CRLF : celles que la RFC 6068 demande dans un lien mailto.
  const corps = `Page : ${location.href}\r\n\r\nProblème constaté :\r\n`;
  signaler.href = `${destinataire}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

for (const type of ["pointerenter", "focus", "click"]) signaler.addEventListener(type, actualiserSignalement);

// ==== Champ (MCO, SMR) ====

// Le dernier champ affiché vaut pour les adresses qui n'en nomment pas :
// arrivée sur le site, ancien lien vers un thème commun. Sans stockage
// (navigation privée, stockage bloqué), c'est le premier champ.
const CLE_CHAMP = "pmsi-plus:champ";

function champRetenu() {
  try {
    const id = localStorage.getItem(CLE_CHAMP);
    if (champParId(id)) return id;
  } catch {
    // stockage indisponible
  }
  return CHAMPS[0].id;
}

function retenirChamp(id) {
  try {
    localStorage.setItem(CLE_CHAMP, id);
  } catch {
    // stockage indisponible : le champ ne survivra pas à la page
  }
}

// Les adresses sans champ (`#/arbre/01`) datent d'avant le SMR : elles
// visent le MCO.
const CHAMP_DES_ANCIENNES_ADRESSES = "mco";

/** Le hash découpé : `#/smr/fiche/I10` → { champ: "smr", slug: "fiche",
 *  chemin: ["I10"] }, segments encore encodés. `champ` est nul quand le
 *  hash n'en nomme pas. */
function lireAdresse() {
  const segments = location.hash.replace(/^#\/?/, "").split("/");
  const champ = champParId(segments[0]) ? segments.shift() : null;
  const [slug = "", ...chemin] = segments;
  return { champ, slug, chemin };
}

/** Le thème que désigne une adresse, et le champ où l'afficher. Un thème
 *  demandé dans un champ qui ne l'a pas s'ouvre dans celui qui l'a ; un
 *  thème commun reste dans le champ demandé, à défaut le dernier affiché.
 *  Un slug inconnu mène à l'accueil. */
function resoudre({ champ, slug }) {
  const theme = slug ? themeParSlug(slug, champ ?? CHAMP_DES_ANCIENNES_ADRESSES) ?? themeParSlug(slug) : null;
  if (!theme) return { theme: themeParDefaut(), champ: champ ?? champRetenu() };
  return { theme, champ: theme.champ ?? champ ?? champRetenu() };
}

// ==== Sélecteur de champ ====

/** L'adresse de la page en cours dans le champ `cible` : le même thème s'il
 *  est commun ; sinon son pendant (même slug) s'il en a un, avec la suite de
 *  l'adresse quand les deux la déclarent `cheminCommun` ; sinon l'accueil
 *  du champ. */
function pendant(cible) {
  const adresse = lireAdresse();
  const { theme, champ } = resoudre(adresse);
  if (champ === cible) return location.hash;
  const suite = adresse.slug === theme.slug ? adresse.chemin : [];
  if (!theme.champ) return `#/${[cible, theme.slug, ...suite].join("/")}`;
  const vis = themeParSlug(theme.slug, cible);
  if (!vis) return `#/${cible}/${themeParDefaut().slug}`;
  return `#/${[cible, vis.slug, ...(theme.cheminCommun && vis.cheminCommun ? suite : [])].join("/")}`;
}

// Un lien par champ : changer de champ est une navigation comme une autre
// (historique, nouvel onglet). Sa cible est recalculée au dernier moment,
// comme celle du signalement.
const liensChamp = CHAMPS.map((champ) => {
  const lien = el("a", { href: `#/${champ.id}`, title: champ.libelle, "data-champ": champ.id }, champ.titre);
  const actualiser = () => {
    lien.href = pendant(champ.id);
  };
  for (const type of ["pointerenter", "focus", "click"]) lien.addEventListener(type, actualiser);
  return lien;
});
selecteurChamp.append(...liensChamp);

function marquerChamp(champ) {
  for (const lien of liensChamp) {
    if (lien.dataset.champ === champ) lien.setAttribute("aria-current", "true");
    else lien.removeAttribute("aria-current");
    lien.href = pendant(lien.dataset.champ);
  }
}

// ==== Routage ====

let dernierRendu = 0;

async function rendreTheme(theme, champ, premierRendu, chemin = []) {
  const rendu = ++dernierRendu;
  const titreChamp = champParId(champ).titre;
  retenirChamp(champ);
  construireNav(champ);
  marquerLienActif(theme.slug);
  marquerChamp(champ);
  titreBarreHaute.textContent = `PMSI+ · ${titreChamp}`;
  ouvrirBarre(false);
  document.title =
    theme.slug === "accueil"
      ? "PMSI+ — Aide au codage PMSI"
      : theme.champ
        ? `${theme.titre} · ${titreChamp} — PMSI+`
        : `${theme.titre} — PMSI+`;

  contenu.innerHTML = "";
  contenu.append(squelette());
  let positionne = false;
  try {
    const module = await import(`./themes/${theme.module}.js`);
    positionne = (await module.rendre(contenu, { chemin, champ })) === true;
    // Un thème propre à un champ le rappelle au-dessus de son titre : la
    // page ouverte depuis un lien, ou imprimée, dit de quel champ elle parle.
    if (theme.champ && rendu === dernierRendu) contenu.prepend(el("p", { class: "champ-pmsi" }, titreChamp));
  } catch (erreur) {
    console.error(erreur);
    contenu.innerHTML = "";
    contenu.append(
      el(
        "div",
        { class: "message-erreur" },
        el("strong", {}, "Impossible d'afficher ce thème."),
        el("p", {}, String(erreur?.message ?? erreur))
      )
    );
  }

  // Naviguer d'un thème à l'autre ramène en haut et déplace le focus sur le
  // contenu : sans ça, le clavier reste dans la barre latérale et l'écran
  // garde le défilement de la page précédente.
  if (!premierRendu && !positionne) {
    window.scrollTo({ top: 0, behavior: "instant" });
    contenu.focus({ preventScroll: true });
  }
}

// Un segment mal échappé (« %zz ») arrive tel quel au thème plutôt que de
// faire échouer tout le routage.
function decoder(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function auChangementHash(premierRendu = false) {
  const adresse = lireAdresse();
  const { theme, champ } = resoudre(adresse);
  // L'adresse nomme toujours le champ affiché, pour que le retour arrière le
  // retrouve : une adresse qui n'en nomme pas (arrivée sur le site, lien
  // d'avant le SMR) ou qui en nomme un autre (thème absent du champ demandé)
  // le reçoit, sans entrée d'historique (replaceState ne lève pas
  // `hashchange`).
  if (champ !== adresse.champ) {
    const suite = adresse.slug ? [adresse.slug, ...adresse.chemin] : [];
    history.replaceState(null, "", `#/${[champ, ...suite].join("/")}`);
  }
  rendreTheme(theme, champ, premierRendu, adresse.chemin.map(decoder));
}

// Le lien d'évitement mène au contenu sans passer par le hash : `#contenu`
// serait lu par le routeur comme un thème inconnu, et remplacerait la page.
document.querySelector(".lien-evitement")?.addEventListener("click", (e) => {
  e.preventDefault();
  contenu.focus();
});

window.addEventListener("hashchange", () => auChangementHash());
auChangementHash(true);
