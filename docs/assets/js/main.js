// Point d'entrée : barre de navigation et routage par hash (`#/<slug>`).
//
// Chaque thème vit dans assets/js/themes/<module>.js et exporte une fonction
// async `rendre(conteneur)` qui vide puis remplit `conteneur` — jumeau du
// `st.navigation` construit par `socle.construire()` dans pmsi_plus.

import { REGISTRY, themeParDefaut, themeParSlug } from "./registry.js";
import { el } from "./interface.js";

const contenu = document.getElementById("contenu");
const nav = document.getElementById("nav-themes");
const miseEnPage = document.getElementById("mise-en-page");

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
    a.classList.toggle("actif", a.dataset.slug === slug);
  });
}

async function rendreTheme(slug) {
  const theme = themeParSlug(slug) ?? themeParDefaut();
  marquerLienActif(theme.slug);
  miseEnPage.classList.remove("barre-ouverte");

  contenu.innerHTML = '<p class="compteur">Chargement…</p>';
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
}

function auChangementHash() {
  const slug = location.hash.replace(/^#\/?/, "") || themeParDefaut().slug;
  rendreTheme(slug);
}

document.getElementById("bascule-barre-laterale").addEventListener("click", () => {
  miseEnPage.classList.toggle("barre-ouverte");
});

construireNav();
window.addEventListener("hashchange", auChangementHash);
auChangementHash();
