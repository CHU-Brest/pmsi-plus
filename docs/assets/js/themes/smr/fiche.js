// Fiche code SMR — ce que la fonction groupage SMR fait d'un code, sur une
// seule page :
// - un diagnostic CIM-10 : CM d'orientation, positions permises, deuxième
//   intention, listes d'entrée en GN et tests de l'arbre qui les emploient,
//   caractère de CMA et liste d'exclusion, avec vérificateur ;
// - un acte CSARR ou CCAM, ou un acte CSAR : les fiches de fiche_actes.js.
//
// Ce module dessine la recherche (suggestions) et la fiche d'un
// diagnostic ; les suggestions (`chercher`), la résolution du code saisi
// (`trouver`) et ce que la fiche en dit sont calculés par smr.js.
//
// Tout vient des jeux de scripts/build_smr.py, chargés et indexés par
// smr.js ; les règles citées (2.2.1, 3.3.1.3, 5.2.3…) sont celles du volume
// 1 du Manuel des GME. La page partage son chemin avec la fiche code MCO
// (`cheminCommun`) : « I634 », « i63.4 » ou « alq247 » y ouvrent la même
// fiche, et l'adresse est réécrite dans la graphie du site.

import { el, fraicheur, nombre } from "../../interface.js";
import {
  chargerSmr,
  chercher,
  cmaDuDiagnostic,
  codesPlusPrecis,
  CONDITIONS,
  erreursParPosition,
  exclusionParOrientant,
  libelleGroupe,
  orienteDansCm,
  POSITIONS,
  positionAutorisee,
  PROFILS,
  roleOrientation,
  trouver,
  usagesDesListes,
} from "../../smr.js";
import {
  entete,
  lien,
  lienArbre,
  lienCma,
  lienCsar,
  lienFiche,
  lienGn,
  lienGroupage,
  lienPonderations,
  note,
  sourceFg,
  sousLibelle,
  table,
} from "../../smr_interface.js";
import { ficheActe, ficheCsar } from "./fiche_actes.js";

// Même délai que les champs de recherche du site (interface.js) : filtrer
// 45 000 codes entre deux touches d'une même saisie ne sert à rien.
const DELAI_FRAPPE = 120;

const POSITIONS_LONGUES = {
  MMP: "Manifestation morbide principale (MMP)",
  AE: "Affection étiologique (AE)",
  DAS: "Diagnostic associé significatif (DAS)",
};

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const smr = await chargerSmr();
  const k = smr.classification;
  conteneur.innerHTML = "";

  let minuteur = null;
  const saisie = el("input", {
    type: "search",
    id: "fiche_smr_code",
    placeholder: "ex. : I63.4, G81.1, ALQ+247, 01E08, hémiplégie",
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": "fiche_smr_aide",
    "aria-controls": "fiche_smr_suggestions",
    oninput: () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => suggerer(saisie.value), DELAI_FRAPPE);
    },
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // La frappe n'est peut-être pas encore retombée : on cherche tout de
        // suite plutôt que d'ouvrir une suggestion périmée.
        clearTimeout(minuteur);
        const [premier] = chercher(smr, saisie.value);
        if (premier) ouvrir(premier.code);
        else if (saisie.value.trim()) ouvrir(saisie.value);
      } else if (e.key === "ArrowDown") {
        const bouton = zoneSuggestions.querySelector("button");
        if (bouton) {
          e.preventDefault();
          bouton.focus();
        }
      } else if (e.key === "Escape") {
        if (!zoneSuggestions.childElementCount && !saisie.value) return;
        e.stopPropagation(); // sinon la touche referme aussi le tiroir
        if (zoneSuggestions.childElementCount) viderSuggestions();
        else saisie.value = "";
      }
    },
  });
  const zoneSuggestions = el("div", { class: "fiche-suggestions", id: "fiche_smr_suggestions" });
  const statut = el("p", { class: "visuellement-cache", role: "status" });
  const zoneFiche = el("div", { class: "fiche fiche-smr" });

  conteneur.append(
    el("h1", {}, "Fiche code"),
    sourceFg(),
    fraicheur([
      { libelle: smr.diagnostics.libelle, millesime: smr.diagnostics.millesime },
      { libelle: smr.actes.libelle, millesime: smr.actes.millesime },
      { libelle: smr.actesSpe.libelle, millesime: smr.actesSpe.millesime },
      { libelle: smr.csar.libelle, millesime: smr.csar.millesime },
      { libelle: "listes d'exclusion des CMA", millesime: smr.exclusions.millesime },
      ...Object.entries(k.millesimes).map(([fichier, millesime]) => ({ libelle: fichier, millesime })),
    ]),
    el(
      "p",
      {},
      "Tout ce que la fonction groupage SMR fait d'un code : diagnostic CIM-10 (CM, positions permises, listes d'entrée en GN, CMA), acte CSARR ou CCAM (pondération, modulateurs, caractère spécialisé) ou acte CSAR (transcodage en CSARR). Saisir un code ou quelques mots de son libellé."
    ),
    el(
      "div",
      { class: "barre-outils" },
      el(
        "div",
        { class: "champ" },
        el("label", { for: "fiche_smr_code" }, "Code CIM-10, CSARR, CCAM ou CSAR :"),
        el("div", { class: "champ-recherche" }, el("span", { class: "icone loupe", "aria-hidden": "true" }), saisie),
        el(
          "p",
          { class: "champ-aide", id: "fiche_smr_aide" },
          "Entrée ouvre la première suggestion ; flèche bas pour les parcourir."
        ),
        zoneSuggestions,
        statut
      )
    ),
    zoneFiche,
    el(
      "p",
      { class: "pied-page" },
      "Vues d'ensemble : ",
      el("a", { class: "lien-texte", href: lienGroupage() }, "listes de la fonction groupage"),
      " · ",
      el("a", { class: "lien-texte", href: lienArbre() }, "algorithme de la fonction groupage"),
      " · ",
      el("a", { class: "lien-texte", href: lienCma() }, "CMA et exclusions"),
      " · ",
      el("a", { class: "lien-texte", href: lienPonderations() }, "pondérations des actes"),
      " · ",
      el("a", { class: "lien-texte", href: lienCsar() }, "transcodage CSAR ↔ CSARR"),
      "."
    )
  );

  // ---- Suggestions ----

  function viderSuggestions() {
    clearTimeout(minuteur);
    zoneSuggestions.innerHTML = "";
    statut.textContent = "";
  }

  function suggerer(valeur) {
    zoneSuggestions.innerHTML = "";
    if (valeur.trim().length < 2) {
      statut.textContent = "";
      return;
    }
    const trouves = chercher(smr, valeur);
    if (!trouves.length) {
      zoneSuggestions.append(el("p", { class: "champ-aide" }, "Aucun code de la fonction groupage SMR ne correspond."));
      statut.textContent = "Aucune suggestion.";
      return;
    }
    const boutons = trouves.map((t) =>
      el(
        "button",
        { type: "button", onclick: () => ouvrir(t.code), onkeydown: (e) => naviguer(e) },
        el("strong", {}, t.code),
        ` ${t.libelle}`,
        t.nature === "CIM-10" ? null : ` (acte ${t.nature})`
      )
    );
    zoneSuggestions.append(el("ul", { class: "liste-suggestions" }, ...boutons.map((b) => el("li", {}, b))));
    statut.textContent = `${nombre(trouves.length)} suggestion${trouves.length > 1 ? "s" : ""}.`;
  }

  /** Flèches haut et bas d'une suggestion à l'autre, Échap revient au
   *  champ. */
  function naviguer(e) {
    const boutons = [...zoneSuggestions.querySelectorAll("button")];
    const i = boutons.indexOf(e.target);
    if (e.key === "ArrowDown" && i < boutons.length - 1) {
      e.preventDefault();
      boutons[i + 1].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i > 0 ? boutons[i - 1] : saisie).focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      viderSuggestions();
      saisie.focus();
    }
  }

  // ---- Fiche ----

  function ouvrir(demande, { lienProfond = false } = {}) {
    viderSuggestions();
    const trouve = trouver(smr, demande);
    saisie.value = trouve.affiche;
    // L'adresse dit la fiche ouverte, dans la graphie du site, sans entrée
    // d'historique (replaceState ne lève pas `hashchange`) : comme la fiche
    // MCO, la page se partage et se recharge telle quelle.
    const cible = lienFiche(trouve.affiche);
    if (trouve.affiche && zoneFiche.isConnected && location.hash !== cible) history.replaceState(null, "", cible);
    zoneFiche.innerHTML = "";
    zoneFiche.append(...fiche(smr, trouve).filter(Boolean));
    zoneFiche.querySelector("h2")?.focus({ preventScroll: lienProfond });
  }

  const [demande] = chemin;
  if (demande) ouvrir(demande, { lienProfond: true });
  else saisie.focus();
}

function fiche(smr, trouve) {
  if (!trouve.connu) return ficheInconnue(trouve);
  if (trouve.nature === "CIM-10") return ficheDiagnostic(smr, trouve);
  if (trouve.nature === "CSAR") return ficheCsar(smr, trouve);
  return ficheActe(smr, trouve);
}

function ficheInconnue({ nature, affiche }) {
  const message = {
    "CIM-10": `${affiche} ne figure pas parmi les codes CIM-10 de la fonction groupage SMR (CIM_infos_SMR).`,
    CSARR: `${affiche} ne figure pas parmi les actes CSARR pondérés (ACTES_ponderations) : la fonction groupage lève l'erreur 82.`,
    CCAM: `${affiche} n'est ni un acte CCAM de réadaptation pondéré (ACTES_ponderations), ni un acte CCAM CMA.`,
    CSAR: `${affiche} ne figure pas dans le transcodage CSAR (CSAR_infos) : la fonction groupage lève l'erreur 91.`,
  }[nature];
  return [
    el("h2", { tabindex: "-1" }, "Code inconnu"),
    el(
      "p",
      { class: "message-info" },
      message ??
        `« ${affiche} » n'a la forme d'aucun code : CIM-10 (I63.4), CSARR (ALQ+247), CCAM (AHQP002) ou CSAR (01E08).`
    ),
  ];
}

// ==== Fiche d'un diagnostic ====

function ficheDiagnostic(smr, { diag, affiche }) {
  const k = smr.classification;
  const nnn = diag.Profil === "NNN";
  const permises = POSITIONS.filter((p) => positionAutorisee(diag, p));
  return [
    el("h2", { tabindex: "-1" }, `${affiche} — ${diag["Libellé"]}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, orienteDansCm(diag) ? `CM ${diag.CM}` : "CM 90 : aucune CM"),
      diag["Deuxième intention"] ? el("span", { class: "pastille attention" }, "Oriente en deuxième intention") : null,
      el(
        "span",
        { class: nnn ? "pastille attention" : "pastille" },
        nnn ? "Code non utilisable" : `Permis en ${permises.join(", ")}`
      ),
      el("span", { class: diag.CMA ? "pastille cma" : "pastille" }, diag.CMA ? "CMA" : "Pas une CMA"),
      el(
        "span",
        { class: "pastille" },
        diag.Listes.length
          ? `${diag.Listes.length} liste${diag.Listes.length > 1 ? "s" : ""} d'entrée en GN`
          : "Aucune liste d'entrée en GN"
      )
    ),
    el("h3", {}, "Catégorie majeure"),
    ...blocCm(k, diag),
    el("h3", {}, "Positions permises"),
    ...blocPositions(smr, diag),
    el("h3", {}, "Listes d'entrée en GN et tests qui les emploient"),
    ...blocListes(k, diag),
    el("h3", {}, "Niveau de sévérité : CMA"),
    ...blocCma(smr, diag, affiche),
  ];
}

// Ce que le code fait de l'orientation en CM, selon les positions que son
// profil permet (smr.roleOrientation).
const RAPPEL_AE = "quand l'AE est testée : MMP qui n'appartient à aucune liste d'entrée dans une CM, ou qui oriente en deuxième intention";

function blocCm(k, diag) {
  const { cas, mmp, ae } = roleOrientation(diag);
  if (cas === "aucuneCm") {
    return [
      el("p", {}, el("strong", {}, "CM 90 : n'oriente dans aucune CM."), ` ${libelleGroupe(k, "90")}.`),
      el(
        "p",
        {},
        "Ce code n'appartient à aucune liste d'entrée dans une CM.",
        mmp
          ? " Codé en MMP, il laisse l'AE orienter le RHS ; si l'AE n'appartient pas non plus à une liste d'entrée dans une CM, le RHS est orienté vers la CM 90, non groupable ou sans objet (erreur 300)."
          : ae
            ? " Codé en AE, il n'oriente pas le RHS : si la MMP n'oriente pas non plus, le RHS est orienté vers la CM 90, non groupable ou sans objet (erreur 300)."
            : ""
      ),
      note("Volume 1, 2.2.1."),
    ];
  }
  const cm = el("p", {}, "Oriente dans la ", el("strong", {}, `CM ${diag.CM}`), ` — ${libelleGroupe(k, diag.CM)}.`);
  if (cas === "dasSeulement") {
    return [
      cm,
      el("p", {}, "Son profil ne le permet qu'en DAS : il ne sert donc pas à orienter le RHS en CM, que seules la MMP et l'AE déterminent."),
      note("Volume 1, 2.2.1."),
    ];
  }
  if (cas === "premiereIntention") {
    return [
      cm,
      el(
        "p",
        {},
        mmp ? "Codé en MMP, il oriente le RHS dans cette CM." : "Son profil ne permet pas de le coder en MMP.",
        ae ? ` Codé en AE, il l'y oriente ${RAPPEL_AE}.` : " Son profil ne permet pas de le coder en AE."
      ),
      note("Volume 1, 2.2.1."),
    ];
  }
  return [
    cm,
    el(
      "div",
      { class: "message-info" },
      el("strong", {}, "Oriente en deuxième intention. "),
      `Codé en MMP, il ne classe le RHS dans la CM ${diag.CM} que si l'AE n'appartient à aucune liste d'entrée dans une CM : sinon, c'est la CM de l'AE qui est retenue. Ces codes correspondent généralement à des symptômes, non spécifiques d'un système fonctionnel (une dyspnée R06.0 en MMP avec une insuffisance cardiaque I50.9 en AE oriente dans la CM 05).`,
      ae
        ? " La notion n'existe que pour la MMP : codé en AE, ce code oriente dans sa CM comme tout autre."
        : " Son profil ne permet pas de le coder en AE."
    ),
    note("Volume 1, 2.2.1."),
  ];
}

function blocPositions(smr, diag) {
  // Les erreurs que lèverait le code à chaque position : celles du contrôle
  // des diagnostics de smr.js (erreursParPosition).
  const lignes = erreursParPosition(smr, diag).map(({ position: p, permise: oui, erreur, bloquante }) => {
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, p, sousLibelle(POSITIONS_LONGUES[p])),
      el("td", { class: oui ? undefined : "non-attendu" }, oui ? "oui" : "non"),
      el(
        "td",
        {},
        erreur ? [`Erreur ${erreur.code}${bloquante ? " (bloquante)" : ""} : `, erreur.libelle].join("") : "—"
      )
    );
  });
  const blocs = [
    table([entete("Position"), entete("Permise"), entete("Codé à cette position")], el("tbody", {}, ...lignes)),
    note(`Profil ${diag.Profil} de CIM_infos_SMR (MMP, AE, DAS) : ${PROFILS[diag.Profil] ?? "profil inconnu"}.`),
  ];
  if (diag.Profil === "NNN") {
    const enfants = codesPlusPrecis(smr.diagnostics, diag.Code);
    blocs.push(
      el(
        "div",
        { class: "message-avertissement fiche-frontiere" },
        el("strong", {}, "Code non utilisable : "),
        "il faut coder l'un des codes plus précis qu'il regroupe.",
        enfants.length
          ? el(
              "ul",
              {},
              ...enfants.slice(0, 30).map((l) => el("li", {}, lien(lienFiche(l.Code), l.Code), ` ${l["Libellé"]}`)),
              enfants.length > 30 ? el("li", {}, `… et ${nombre(enfants.length - 30)} autres.`) : null
            )
          : null
      )
    );
  }
  return blocs;
}

function blocListes(k, diag) {
  if (!diag.Listes.length) return [el("p", { class: "message-info" }, "Ce code n'appartient à aucune liste d'entrée en GN.")];
  const listes = usagesDesListes(k, diag);
  const horsCm = listes.some(({ usages }) => usages.some((u) => u.autreCm));
  const corps = listes.map(({ liste, usages }) => {
    const enTete = el(
      "th",
      { scope: "rowgroup", rowspan: String(Math.max(1, usages.length)) },
      `D-${liste}`,
      sousLibelle(k.listes[liste])
    );
    if (!usages.length) {
      return el(
        "tbody",
        {},
        el("tr", {}, enTete, el("td", { colspan: "2", class: "non-attendu" }, "Aucun test d'entrée en GN n'emploie cette liste."))
      );
    }
    return el(
      "tbody",
      {},
      ...usages.map(({ noeud, test, rang, nbTests, autreCm, autre }, i) => {
        // Une cellule pour tout le nœud, une ligne par élément : où il se
        // trouve dans l'arbre, à quelle position le code y est lu, le second
        // test éventuel et les conditions du GN 0871.
        return el(
          "tr",
          {},
          i === 0 ? enTete : null,
          el(
            "td",
            {},
            el("strong", {}, `CM ${noeud.cm}, test ${noeud.ordre} sur ${nbTests}`),
            autreCm ? sousLibelle(`autre CM que celle du code (${diag.CM})`) : null,
            sousLibelle(
              `Code lu en ${test.positions.join(" ou ")}${noeud.tests.length > 1 ? ` (${rang === 0 ? "premier" : "second"} test du nœud)` : ""}`
            ),
            autre ? sousLibelle(`et ${autre.texte}`) : null,
            ...(noeud.conditions ?? []).map((c) => sousLibelle(CONDITIONS[c] ?? c))
          ),
          el("td", {}, lienGn(k, noeud.gn))
        );
      })
    );
  });
  return [
    table([entete("Liste"), entete("Test d'entrée en GN"), entete("GN d'arrivée")], ...corps),
    note(
      "Dans sa CM, le RHS passe les tests dans l'ordre de leur rang : le premier nœud dont le test — ou les deux tests — est positif donne le GN. ",
      horsCm ? "Un test d'une autre CM que celle du code ne le lit que dans un RHS orienté dans cette CM par un autre code. " : "",
      "Volume 1, 2.2.2 et annexe 7.2."
    ),
  ];
}

function blocCma(smr, diag, affiche) {
  const cma = cmaDuDiagnostic(smr, diag);
  if (!cma) {
    return [el("p", {}, `${affiche} n'est pas une CMA : il n'est pas marqueur de sévérité.`)];
  }
  const { index, taille: n, sansNiveau2 } = cma;
  const k = smr.classification;
  const blocs = [
    el(
      "p",
      {},
      el("strong", {}, "CMA. "),
      "Codée en MMP ou en DAS, elle est marqueur de sévérité et classe un séjour d'hospitalisation complète en niveau 2, sauf si elle est exclue par un des codes ayant orienté un RHS du séjour dans le GN retenu, ou si le groupe n'a pas de niveau 2",
      sansNiveau2.length ? ` (${sansNiveau2.map((gn) => `GN ${gn}, ${libelleGroupe(k, gn).toLowerCase()}`).join(" ; ")})` : "",
      ". En hospitalisation à temps partiel, le niveau de sévérité est toujours 0."
    ),
    note("Volume 1, 5.1 et 5.2."),
  ];
  if (index == null) {
    blocs.push(el("p", { class: "message-info" }, "Aucune liste d'exclusion : aucun code orientant ne l'exclut."));
  } else {
    blocs.push(
      el("p", { class: "fiche-sous-titre" }, `Liste d'exclusion : ${nombre(n)} code${n > 1 ? "s" : ""} l'excluent quand ils orientent le RHS dans le GN du séjour.`),
      verificateur(smr, diag, affiche)
    );
  }
  blocs.push(
    el("p", {}, el("a", { class: "lien-texte", href: lienCma(affiche) }, "Voir la CMA et sa liste d'exclusion complète"))
  );
  return blocs;
}

/** « Exclue par ce code orientant ? » : smr.exclusionParOrientant, le test
 *  même de la fonction groupage, sur un code saisi ; un code inconnu est
 *  signalé avant. */
function verificateur(smr, diag, affiche) {
  const verdict = el("p", { class: "fiche-verdict", role: "status" });
  const champ = el("input", {
    type: "text",
    id: "fiche_smr_orientant",
    placeholder: "ex. : I63.4",
    autocomplete: "off",
    spellcheck: "false",
    oninput: () => {
      const saisie = champ.value.trim();
      verdict.innerHTML = "";
      verdict.className = "fiche-verdict";
      if (!saisie) return;
      const { orientant, exclue } = exclusionParOrientant(smr, diag.Code, saisie);
      if (!orientant) {
        verdict.classList.add("message-info");
        verdict.append(`${saisie.toUpperCase()} n'est pas un code CIM-10 de la fonction groupage SMR.`);
        return;
      }
      verdict.classList.add(exclue ? "message-avertissement" : "message-succes");
      verdict.append(
        exclue
          ? `Exclue : si ${orientant} a orienté un RHS du séjour dans le GN retenu, ${affiche} n'est pas marqueur de sévérité.`
          : `Retenue : ${orientant} n'exclut pas ${affiche}.`
      );
    },
  });
  return el(
    "div",
    { class: "champ fiche-dp" },
    el("label", { for: "fiche_smr_orientant" }, "Exclue par ce code orientant (MMP, AE ou DAS classant) ?"),
    champ,
    verdict
  );
}
