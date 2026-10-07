// CMA et exclusions en SMR — les complications ou morbidités associées de
// la fonction groupage (codes CIM-10 marqués CMA dans CIM_infos_SMR, actes de
// CMA_CCAM) et leurs listes d'exclusion (CMA_exclusion), qui décident du
// niveau de sévérité d'un séjour d'hospitalisation complète (volume 1, 5.2).
//
// Un vérificateur applique la règle du manuel : une CMA codée en MMP ou en
// DAS est un marqueur de sévérité, sauf si un code ayant orienté un RHS du
// séjour dans le GN retenu l'exclut. L'adresse #/smr/cma/<code> y pré-remplit
// le code candidat (la fiche code y renvoie). Le verdict et les lignes du
// tableau sont calculés par smr.js (evaluerCma, lignesCma).

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, resultats, nombre } from "../../interface.js";
import {
  chargerClassification,
  chargerDiagnostics,
  chargerExclusions,
  evaluerCma,
  gnSansSeverite2,
  graphie,
  libelleGroupe,
  lignesCma,
} from "../../smr.js";
import { lienFiche, sourceFg } from "../../smr_interface.js";

// ==== Vérificateur ====

function verificateur(k, diagnostics, exclusions, candidatInitial) {
  const smr = { classification: k, diagnostics, exclusions };
  const zone = el("div", { class: "verdict-cma", role: "status", "aria-live": "polite" });
  const champ = (id, libelle, exemple, valeur, aide) =>
    el(
      "div",
      { class: "champ" },
      el("label", { for: id }, libelle),
      el("input", {
        type: "text",
        id,
        value: valeur || undefined,
        placeholder: exemple,
        autocomplete: "off",
        spellcheck: "false",
        oninput: () => evaluer(),
      }),
      aide ? el("p", { class: "champ-aide" }, aide) : null
    );
  const blocCandidat = champ("smr_cma_candidat", "Code candidat (MMP, DAS ou acte CCAM) :", "ex. : L89.2, G81.1, EBLA003", candidatInitial);
  const blocOrientants = champ(
    "smr_cma_orientants",
    "Codes ayant orienté le RHS dans le GN :",
    "ex. : G81.1 I63.4",
    "",
    "Le ou les codes (MMP, AE, parfois DAS) qui ont satisfait les tests d'entrée dans le GN du séjour ; plusieurs, séparés par une espace."
  );

  function evaluer() {
    const verdict = evaluerCma(
      smr,
      document.getElementById("smr_cma_candidat").value,
      document.getElementById("smr_cma_orientants").value
    );
    zone.replaceChildren();
    if (!verdict) return;

    if (verdict.cas === "acteCma") {
      const acte = verdict.code;
      zone.append(
        el(
          "p",
          { class: "message-succes" },
          el("strong", {}, `${acte} : acte CCAM CMA. `),
          "Un acte CCAM de la liste des CMA est un marqueur de sévérité sans exclusion possible : codé au cours d'un séjour d'HC, il le classe en niveau 2 si le GME en a un (5.2.3)."
        )
      );
      return;
    }
    if (verdict.cas === "inconnu") {
      zone.append(el("p", { class: "message-info" }, `${verdict.code} : ni code CIM-10 de CIM_infos_SMR, ni acte CCAM CMA.`));
      return;
    }
    if (verdict.cas === "pasCma") {
      zone.append(el("p", { class: "message-info" }, `${graphie(verdict.code)} n'est pas une CMA : il ne modifie pas le niveau de sévérité.`));
      return;
    }
    const { code: c, orientants, inconnus, excluant, taille, exclueParElleMeme } = verdict;
    const lignes = [el("strong", {}, `${graphie(c)} : CMA. `)];
    if (excluant.length) {
      lignes.push(`Exclue par ${excluant.map(graphie).join(", ")} : elle ne compte pas comme marqueur de sévérité dans ce GN.`);
    } else if (orientants.length && !inconnus.length) {
      lignes.push(`Retenue : aucun des codes orientants saisis ne l'exclut. Codée en MMP ou en DAS d'un séjour d'HC, elle le classe en niveau 2 si le GME en a un.`);
    } else if (!orientants.length) {
      lignes.push("Saisir les codes ayant orienté le RHS dans le GN pour vérifier ses exclusions.");
    }
    if (inconnus.length) lignes.push(` Codes inconnus, non vérifiés : ${inconnus.map(graphie).join(", ")}.`);
    zone.append(
      el("p", { class: excluant.length ? "message-avertissement" : orientants.length && !inconnus.length ? "message-succes" : "message-info" }, ...lignes),
      el(
        "p",
        { class: "sous-titre" },
        taille
          ? `Sa liste d'exclusion compte ${nombre(taille)} codes${exclueParElleMeme ? ", dont lui-même : s'il a orienté le RHS dans le GN, il ne compte pas comme CMA" : ""}. `
          : "Aucune liste d'exclusion : aucun code orientant ne l'exclut. ",
        el("a", { class: "lien-texte", href: lienFiche(graphie(c)) }, "Fiche du code")
      )
    );
  }

  const section = el(
    "section",
    { class: "barre-outils outil-cma", "aria-labelledby": "smr_cma_verif_titre" },
    el("h2", { id: "smr_cma_verif_titre" }, "Cette CMA compte-t-elle ?"),
    el("div", { class: "outil-cma-champs" }, blocCandidat, blocOrientants),
    zone
  );
  return { section, evaluer };
}

// ==== Vue ====

export async function rendre(conteneur, { chemin = [] } = {}) {
  const [k, diagnostics, exclusions] = await Promise.all([chargerClassification(), chargerDiagnostics(), chargerExclusions()]);
  const lignes = lignesCma(diagnostics, exclusions);
  conteneur.innerHTML = "";

  const [demande = ""] = chemin;
  const outil = verificateur(k, diagnostics, exclusions, demande);
  const zoneResultats = el("div", {});
  const champ = champMotsClefs({
    id: "smr_cma_recherche",
    exemple: "ex. : L89.2, décubitus",
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h1", {}, "CMA et exclusions"),
    sourceFg(),
    fraicheur([
      { libelle: diagnostics.libelle, millesime: diagnostics.millesime },
      { libelle: "listes d'exclusion des CMA", millesime: exclusions.millesime },
      { libelle: "actes CCAM CMA", millesime: k.millesimes["CMA_CCAM.xlsx"] },
    ]),
    el(
      "p",
      {},
      "Les complications ou morbidités associées (CMA) sont des codes CIM-10 et des actes CCAM marqueurs de la sévérité d'un séjour d'hospitalisation complète. Un séjour d'HC qui en compte au moins une est classé en niveau de sévérité 2 (le dernier chiffre du GME), sinon en niveau 1",
      ...gnSansSeverite2(k).map((gn) => ` ; le GN ${gn}, ${libelleGroupe(k, gn).toLowerCase()}, n'a pas de niveau 2`),
      ", et l'hospitalisation à temps partiel est toujours en niveau 0 (volume 1, 5.1 et 5.2.3)."
    ),
    el(
      "ul",
      {},
      el("li", {}, "Un code CIM-10 CMA compte codé en MMP ou en DAS, de n'importe quel RHS du séjour (5.2.1)."),
      el(
        "li",
        {},
        "Il ne compte pas s'il est exclu par un des codes ayant orienté un des RHS du séjour dans le même GN que celui retenu pour le séjour : sa liste d'exclusion énumère ces codes (5.2.2, 5.2.3). La liste est la même quel que soit le GN."
      ),
      el("li", {}, "Un acte CCAM CMA compte toujours : aucune liste d'exclusion ne s'y applique.")
    ),
    outil.section,
    el("h2", {}, "Codes CIM-10 CMA"),
    el("div", { class: "barre-outils" }, champ),
    zoneResultats,
    el("h2", {}, "Actes CCAM CMA"),
    el(
      "div",
      { class: "codes-liste" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Code"), el("th", { scope: "col" }, "Libellé"))),
        el(
          "tbody",
          {},
          ...k.cmaCcam.map(([code, libelle]) =>
            el("tr", {}, el("td", { class: "code" }, el("a", { href: lienFiche(code), title: "Fiche du code" }, code)), el("td", {}, libelle))
          )
        )
      )
    )
  );

  function afficher(requete) {
    resultats(zoneResultats, lignes.filter(recherche.filtre(requete)), { total: lignes.length });
  }
  afficher("");
  outil.evaluer();
  if (demande) document.getElementById("smr_cma_orientants").focus();
}
