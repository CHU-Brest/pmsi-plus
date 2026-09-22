// Point d'entrée : barre de navigation, tiroir sur petit écran, bascule de
// thème et routage par hash (`#/<slug>`).
//
// Chaque thème vit dans assets/js/themes/<module>.js et exporte une fonction
// async `rendre(conteneur)` qui vide puis remplit `conteneur`.

import { REGISTRY, themeParDefaut, themeParSlug } from "./registry.js";
import { el, squelette } from "./interface.js";

const contenu = document.getElementById("contenu");
const nav = document.getElementById("nav-themes");
const miseEnPage = document.getElementById("mise-en-page");
const bascule = document.getElementById("bascule-barre-laterale");
const voile = document.getElementById("voile");

function construireNav() {
  const sections = new Map();
  for (const theme of REGISTRY) {
    if (!sections.has(theme.section)) sections.set(theme.section, []);
    sections.get(theme.section).push(theme);
  }

  nav.innerHTML = "";
  for (const [section, themes] of sections) {
    const liens = themes.map((t) =>
      el(
        "li",
        {},
        el("a", { href: `#/${t.slug}`, "data-slug": t.slug }, t.titre)
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

// ==== Routage ====

async function rendreTheme(slug, premierRendu) {
  const theme = themeParSlug(slug) ?? themeParDefaut();
  marquerLienActif(theme.slug);
  ouvrirBarre(false);
  document.title =
    theme.slug === "accueil"
      ? "PMSI+ — Aide au codage PMSI"
      : `${theme.titre} — PMSI+`;

  contenu.innerHTML = "";
  contenu.append(squelette());
  try {
    const module = await import(`./themes/${theme.module}.js`);
    await module.rendre(contenu);
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
  if (!premierRendu) {
    window.scrollTo({ top: 0, behavior: "instant" });
    contenu.focus({ preventScroll: true });
  }
}

function auChangementHash(premierRendu = false) {
  const slug = location.hash.replace(/^#\/?/, "") || themeParDefaut().slug;
  rendreTheme(slug, premierRendu);
}

construireNav();
window.addEventListener("hashchange", () => auChangementHash());
auChangementHash(true);
