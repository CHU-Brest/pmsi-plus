// Bascule clair / sombre. Par défaut le site suit le réglage du système ;
// un clic pose un choix explicite, retenu dans localStorage et relu par le
// petit script en tête d'index.html — avant le premier rendu, sinon une
// page en mode sombre clignoterait en clair au chargement.

const CLE = "pmsi-theme";

function preferenceSysteme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "sombre"
    : "clair";
}

function themeCourant() {
  return document.documentElement.dataset.theme || preferenceSysteme();
}

function lire() {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null; // navigation privée, stockage bloqué : le site marche sans.
  }
}

function ecrire(valeur) {
  try {
    localStorage.setItem(CLE, valeur);
  } catch {
    /* sans stockage, le choix ne vaut que pour l'onglet courant */
  }
}

export function installerBasculeTheme(bouton, libelle) {
  if (!bouton) return;

  function rafraichir() {
    const sombre = themeCourant() === "sombre";
    const action = sombre ? "Passer en clair" : "Passer en sombre";
    if (libelle) libelle.textContent = sombre ? "Mode sombre" : "Mode clair";
    bouton.setAttribute("aria-label", action);
    bouton.title = action;
  }

  bouton.addEventListener("click", () => {
    const cible = themeCourant() === "sombre" ? "clair" : "sombre";
    document.documentElement.dataset.theme = cible;
    ecrire(cible);
    rafraichir();
  });

  // Tant qu'aucun choix explicite n'a été fait, suivre le système même s'il
  // change en cours de session (bascule automatique jour/nuit de l'OS).
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener?.("change", () => {
      if (!lire()) rafraichir();
    });

  rafraichir();
}
