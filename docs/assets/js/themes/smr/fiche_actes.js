// Fiches des actes SMR, ouvertes par la fiche code (fiche.js) :
// - un acte CSARR ou CCAM : type, statut, validité, pondération (par
//   intervenant le cas échéant), modulateurs de lieu, listes d'actes
//   spécialisés, CMA CCAM, erreurs 162 et 163, actes CSAR transcodés vers
//   lui ;
// - un acte CSAR : modalités, modulateurs, transcodage en CSARR par
//   intervenant et modalité, écarts de pondération, caractère spécialisé.
//
// Les règles citées (3.3.1.3, 3.3.1.4, 5.2…) sont celles du volume 1 du
// Manuel des GME.

import { el, nombre } from "../../interface.js";
import { MODALITES, MODULATEURS_LIEU, estSpecialise, gnSansSeverite2 } from "../../smr.js";
import { entete, lien, lienCma, lienCsar, lienFiche, lienGn, note, sousLibelle, table } from "../../smr_interface.js";

// Au-delà, les intervenants d'une ligne de tableau se replient : une ligne
// « tous les autres » en compte souvent une trentaine.
const INTERVENANTS_DEPLIES_MAX = 6;

// Lisez-moi de ACTES_ponderations.xlsx (colonnes « Type » et « Statut »).
const TYPES_ACTE = {
  D: "acte dédié",
  "D/ND": "acte dédié ou non dédié",
  C: "acte collectif",
  A: "appareillage avec étapes",
  PP: "pluriprofessionnel",
  CCAM: "acte CCAM de réadaptation",
};
const STATUTS_ACTE = {
  pond_u: "pondération unique pour tous les intervenants",
  "diff inter": "pondération différenciée selon les intervenants",
  "pond 0": "pondération à 0 pour certains couples acte/intervenant, les autres couples ayant la même pondération",
  "pond 0 / diff inter":
    "pondération à 0 pour certains couples acte/intervenant, les autres couples ayant des pondérations différenciées",
  CCAM: "acte CCAM",
};

// Tableau 4 du volume 1 (3.3.1.4) : le modulateur de lieu CSARR que devient
// chaque modulateur CSAR au transcodage.
const LIEUX_TRANSCODES = { L1: "HW ou LJ", L2: "XH", L3: "L3" };

// ==== Petits composants ====

// `contenu` : un texte, ou les morceaux que rend coupable().
const code = (...contenu) => el("span", { class: "code" }, ...contenu);

/** Nom technique d'une liste d'actes spécialisés (« 0106_09_15_30_45 »,
 *  « 1_aff_cereb_et_autres ») coupable après chaque « _ » : d'un seul
 *  tenant, il élargirait sa colonne de moitié sur un téléphone. */
function coupable(texte) {
  return String(texte ?? "")
    .split("_")
    .flatMap((morceau, i) => (i ? ["_", el("wbr"), morceau] : [morceau]));
}

/** Tableau d'une trentaine d'intervenants : il défile dans son cadre. */
function tableDefilante(entetes, ...corps) {
  const cadre = table(entetes, ...corps);
  cadre.classList.add("defilant");
  return cadre;
}

/** Tableau de définitions : une ligne par propriété, son nom en en-tête de
 *  ligne. */
function definitions(lignes) {
  return table(
    [entete("Propriété"), entete("Valeur")],
    el("tbody", {}, ...lignes.map(([nom, valeur]) => el("tr", {}, el("th", { scope: "row" }, nom), el("td", {}, valeur))))
  );
}

function libelleIntervenant(k, iv) {
  return k.intervenants[iv] ?? `intervenant ${iv}`;
}

/** Étiquette « écart » : visible d'un coup d'œil dans un tableau d'une
 *  trentaine de lignes, lue avec ses deux valeurs par un lecteur d'écran. */
function etiquetteEcart(csarr, fichierCsar) {
  return el(
    "span",
    {
      class: "etiquette-ecart",
      title: `Pondération du fichier CSAR : ${fichierCsar} ; du CSARR transcodé : ${csarr}`,
    },
    "écart"
  );
}

/** Les intervenants d'une ligne de tableau : « Tous les intervenants » s'ils
 *  y sont tous, leur liste s'ils sont peu nombreux, repliée sinon. */
function celluleIntervenants(k, codes, total, { autres = false } = {}) {
  if (codes.length === total && total > 1) return [`Tous les intervenants (${nombre(total)})`];
  const noms = codes.map((iv) =>
    el("span", { class: "racine-libellee" }, el("strong", { class: "code" }, iv), ` ${libelleIntervenant(k, iv)}`)
  );
  if (codes.length <= INTERVENANTS_DEPLIES_MAX) return noms;
  return [
    el(
      "details",
      {},
      el("summary", {}, autres ? `Les ${nombre(codes.length)} autres intervenants` : `${nombre(codes.length)} intervenants`),
      ...noms
    ),
  ];
}

/** Lignes de transcodage regroupées par transcodage identique — même
 *  modalité, même CSARR, mêmes pondérations — pour qu'un acte CSAR à 32
 *  intervenants tienne en quelques lignes. Groupes par modalité, le plus
 *  nombreux d'abord. `parCsar` (code CSAR → toutes ses lignes) donne le
 *  nombre d'intervenants de chaque acte CSAR, que `lignes` peut ne donner
 *  qu'en partie (fiche d'un CSARR : les seules lignes transcodées en lui). */
function regrouperTranscodage(lignes, parCsar) {
  const groupes = new Map();
  for (const l of lignes) {
    const clef = [l["Modalité"], l["Code CSARR"], l["Pondération CSARR"], l["Pondération CSAR"], l["Équivalent"]].join("|");
    if (!groupes.has(clef)) {
      groupes.set(clef, {
        csar: l["Code CSAR"],
        libelleCsar: l["Libellé CSAR"],
        modalite: l["Modalité"],
        csarr: l["Code CSARR"],
        libelleCsarr: l["Libellé CSARR"],
        ponderation: l["Pondération CSARR"],
        fichierCsar: l["Pondération CSAR"],
        equivalent: l["Équivalent"],
        intervenants: [],
      });
    }
    groupes.get(clef).intervenants.push(l.Intervenant);
  }
  // Nombre d'intervenants transcodés pour chaque acte et modalité : le
  // dénominateur de « tous les intervenants ».
  const total = (csar, modalite) =>
    new Set(parCsar.get(csar).filter((l) => l["Modalité"] === modalite).map((l) => l.Intervenant)).size;
  return [...groupes.values()]
    .map((g) => ({ ...g, ecart: g.ponderation !== g.fichierCsar, total: total(g.csar, g.modalite) }))
    .sort((a, b) => (a.csar === b.csar ? 0 : a.csar < b.csar ? -1 : 1) || a.modalite - b.modalite || b.intervenants.length - a.intervenants.length);
}

// ==== Index ====

/** Transcodage CSAR à rebours : code CSARR → lignes de csar.json. */
function csarVers(smr, csarr) {
  const jeu = smr.csar;
  if (!jeu._ficheParCsarr) {
    jeu._ficheParCsarr = new Map();
    for (const l of jeu.lignes) {
      if (!jeu._ficheParCsarr.has(l["Code CSARR"])) jeu._ficheParCsarr.set(l["Code CSARR"], []);
      jeu._ficheParCsarr.get(l["Code CSARR"]).push(l);
    }
  }
  return jeu._ficheParCsarr.get(csarr) ?? [];
}

/** Les GN pour lesquels un acte CSARR ou CCAM est spécialisé, par liste
 *  d'actes spécialisés : [{ liste, gns }]. La liste des GN vient de
 *  smr.estSpecialise, le test même de la fonction groupage. */
function specialisation(smr, csarr) {
  const k = smr.classification;
  const listes = [...(smr.actesSpe._parCode.get(csarr) ?? [])].sort();
  const gns = Object.keys(k.groupes.GN).filter((gn) => estSpecialise(smr, csarr, gn));
  return listes.map((liste) => ({ liste, gns: gns.filter((gn) => k._listeSpeParGn.get(gn) === liste) }));
}

// ==== Fiche d'un acte CSARR ou CCAM ====

export function ficheActe(smr, trouve) {
  const k = smr.classification;
  const { code: c, lignes, nature } = trouve;
  const ligne = lignes?.[0];
  const libelle = ligne?.["Libellé"] ?? trouve.cma ?? "";
  const cma = k._cmaCcam.has(c);
  const spe = ligne ? specialisation(smr, c) : [];
  const nbGn = new Set(spe.flatMap((s) => s.gns)).size;
  const venus = nature === "CSARR" ? csarVers(smr, c) : [];
  const ecarts = venus.some((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]);
  const sansNiveau2 = gnSansSeverite2(k);
  return [
    el("h2", { tabindex: "-1" }, `${c} — ${libelle}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, `Acte ${nature}`),
      ligne && ligne.Type !== "CCAM" ? el("span", { class: "pastille" }, `Type ${ligne.Type}`) : null,
      ligne && !ligne.Valide ? el("span", { class: "pastille attention" }, "Plus valide") : null,
      ligne ? el("span", { class: "pastille" }, nbGn ? `Spécialisé pour ${nbGn} GN` : "Non spécialisé") : null,
      nature === "CCAM" ? el("span", { class: cma ? "pastille cma" : "pastille" }, cma ? "CMA" : "Pas une CMA") : null,
      ecarts ? el("span", { class: "pastille attention" }, "Écart de pondération d'un acte CSAR transcodé") : null
    ),
    ...(ligne
      ? [
          el("h3", {}, "Caractéristiques"),
          definitions([
            ["Nomenclature", ligne.Nomenclature],
            ["Type", `${ligne.Type} — ${TYPES_ACTE[ligne.Type] ?? "type inconnu"}`],
            ["Statut", `${ligne.Statut} — ${STATUTS_ACTE[ligne.Statut] ?? "statut inconnu"}`],
            ["Hiérarchie", ligne["Hiérarchie"].toLowerCase() === "suppr" ? "acte supprimé du catalogue" : ligne["Hiérarchie"]],
            [
              "Validité",
              ligne.Valide
                ? `en cours de validité, depuis ${ligne["Début"] ?? "—"}`
                : `plus valide : utilisé de ${ligne["Début"] ?? "—"} à ${ligne.Fin ?? "—"}`,
            ],
          ]),
          el("h3", {}, "Pondération"),
          ...blocPonderation(k, c, lignes),
          el("h3", {}, "Modulateurs de lieu"),
          ...blocModulateurs(k, ligne),
          el("h3", {}, "Actes spécialisés"),
          ...blocSpecialise(k, spe),
        ]
      : [
          el("h3", {}, "Pondération"),
          el(
            "p",
            { class: "message-info" },
            "Pas un acte de réadaptation : absent de ACTES_ponderations, il ne compte dans aucun score de réadaptation."
          ),
        ]),
    ...(nature === "CCAM"
      ? [
          el("h3", {}, "Niveau de sévérité : CMA"),
          cma
            ? el(
                "p",
                {},
                el("strong", {}, "Acte CCAM CMA. "),
                "Il est marqueur de sévérité et classe un séjour d'hospitalisation complète en niveau 2 si le groupe en a un",
                sansNiveau2.length ? ` (pas ${sansNiveau2.map((gn) => `le GN ${gn}`).join(" ni ")})` : "",
                ". Les listes d'exclusion ne portent que sur les codes CIM-10 : aucun code ne l'exclut."
              )
            : el("p", {}, `${c} n'est pas une CMA : il n'est pas marqueur de sévérité.`),
          cma ? note("Volume 1, 5.2 ; liste de CMA_CCAM.") : null,
          cma
            ? el("p", {}, el("a", { class: "lien-texte", href: lienCma(c) }, "Voir dans la liste des CMA"))
            : null,
        ]
      : []),
    ...(nature === "CSARR" ? [el("h3", {}, "Actes CSAR transcodés en cet acte"), ...blocCsarVers(k, venus, smr.csar._parCode)] : []),
  ];
}

function blocPonderation(k, c, lignes) {
  const blocs = [];
  if (lignes.length === 1) {
    const l = lignes[0];
    blocs.push(
      el(
        "p",
        {},
        "Pondération unique : ",
        el("strong", {}, String(l["Pondération"])),
        l.Nomenclature === "CCAM" ? " (acte CCAM : une seule pondération, quel que soit l'intervenant)." : ", quel que soit l'intervenant."
      )
    );
  } else {
    const triees = [...lignes].sort((a, b) => (a.Intervenant < b.Intervenant ? -1 : 1));
    blocs.push(
      el("p", {}, resumePonderations(k, triees)),
      tableDefilante(
        [entete("Intervenant"), entete("Libellé"), entete("Pondération")],
        el(
          "tbody",
          {},
          ...triees.map((l) =>
            el(
              "tr",
              {},
              el("td", { class: "code" }, l.Intervenant),
              el("td", {}, libelleIntervenant(k, l.Intervenant)),
              el(
                "td",
                { class: l["Pondération"] === 0 ? "non-attendu" : "nombre" },
                l["Pondération"] === 0 ? "0 — non attendu" : String(l["Pondération"])
              )
            )
          )
        )
      )
    );
    if (triees.some((l) => l["Pondération"] === 0)) {
      blocs.push(
        note(
          "Pondération 0 : intervenant non attendu pour cet acte ; les modulateurs de temps et de lieu n'ont alors pas d'effet. Volume 1, 3.3.1.2 à 3.3.1.4."
        )
      );
    }
  }
  // Erreurs non bloquantes de FG_erreurs dont la liste d'actes cite celui-ci.
  for (const numero of ["162", "163"]) {
    if (!(k.actesErreurs[numero] ?? []).some(([a]) => a === c)) continue;
    const erreur = k._erreurs.get(Number(numero));
    blocs.push(
      el(
        "p",
        { class: "message-avertissement" },
        el("strong", {}, `Erreur ${numero}${erreur?.bloquant === false ? " (non bloquante)" : ""} : `),
        `« ${erreur?.libelle ?? ""} ». L'acte figure dans la liste des actes concernés (FG_erreurs).`
      )
    );
  }
  return blocs;
}

/** « Pondération 35 pour 29 intervenants ; 130 pour neuropsychologue (33),
 *  psychotechnicien (72) ; 85 pour orthophoniste (24). » */
function resumePonderations(k, lignes) {
  const parValeur = new Map();
  for (const l of lignes) {
    if (!parValeur.has(l["Pondération"])) parValeur.set(l["Pondération"], []);
    parValeur.get(l["Pondération"]).push(l.Intervenant);
  }
  const morceaux = [...parValeur]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([valeur, ivs]) => {
      const qui =
        ivs.length > 4
          ? `${nombre(ivs.length)} intervenants`
          : ivs.map((iv) => `${libelleIntervenant(k, iv).toLowerCase()} (${iv})`).join(", ");
      return `${valeur}${valeur === 0 ? " (non attendu)" : ""} pour ${qui}`;
    });
  return `Pondération différenciée selon l'intervenant : ${morceaux.join(" ; ")}.`;
}

function blocModulateurs(k, ligne) {
  const collectif = ligne.Type === "C";
  const lignes = MODULATEURS_LIEU.map((m) => {
    const [, libelle, individuel, coll] = k.modulateurs.find(([c]) => c === m) ?? [m, "", 0, null];
    const accepte = !!ligne[m];
    return el(
      "tr",
      {},
      el("th", { scope: "row" }, m, sousLibelle(libelle)),
      el("td", { class: accepte ? undefined : "non-attendu" }, accepte ? "oui" : "non"),
      el(
        "td",
        {},
        `+${individuel} en individuel`,
        sousLibelle(coll == null ? "sans objet en collectif" : `+${coll} en collectif`)
      )
    );
  });
  return [
    table([entete("Modulateur"), entete("Accepté"), entete("Majoration")], el("tbody", {}, ...lignes)),
    note(
      MODULATEURS_LIEU.some((m) => ligne[m])
        ? `Majoration ajoutée à la pondération ${collectif ? "d'un acte collectif (type C) : celle « en collectif »" : "d'un acte individuel : celle « en individuel »"}, sans effet pour un intervenant non attendu. `
        : "L'acte n'accepte aucun modulateur de lieu qui majore sa pondération. ",
      "Seuls les modulateurs qui majorent la pondération sont notés dans ACTES_ponderations. Volume 1, 3.3.1.4."
    ),
  ];
}

function blocSpecialise(k, spe) {
  if (!spe.length) {
    return [
      el(
        "p",
        {},
        "Acte non spécialisé : sa pondération compte dans le score de réadaptation globale, pas dans le score de réadaptation spécialisée."
      ),
      note("Volume 1, 3.2 et 3.3.2."),
    ];
  }
  return [
    el(
      "p",
      {},
      "Acte spécialisé, marqueur de la réadaptation des déficiences liées à la pathologie qui motive le séjour : dans les GN ci-dessous, sa pondération compte dans le score de réadaptation spécialisée, en plus du score global."
    ),
    table(
      [entete("Liste"), entete("CM"), entete("GN couverts")],
      el(
        "tbody",
        {},
        ...spe.map(({ liste, gns }) =>
          el(
            "tr",
            {},
            el("td", {}, code(...coupable(liste)), sousLibelle(coupable(k.listesSpe[liste]?.libelle))),
            el("td", { class: "code" }, k.listesSpe[liste]?.cm ?? ""),
            el("td", {}, ...gns.map((gn) => el("span", { class: "racine-libellee" }, lienGn(k, gn))))
          )
        )
      )
    ),
    note("Listes de ACTES_listes_SPE. Volume 1, 3.2 et 3.3.2."),
  ];
}

function blocCsarVers(k, venus, parCsar) {
  if (!venus.length) return [el("p", {}, "Aucun acte CSAR n'est transcodé en cet acte.")];
  const groupes = regrouperTranscodage(venus, parCsar);
  // La modalité n'a sa colonne que si elle varie d'une ligne à l'autre.
  const modalite = new Set(groupes.map((g) => g.modalite)).size > 1;
  return [
    table(
      [entete("Acte CSAR"), modalite ? entete("Modalité") : null, entete("Intervenants"), entete("Pondération")].filter(Boolean),
      el(
        "tbody",
        {},
        ...groupes.map((g) =>
          el(
            "tr",
            { class: g.ecart ? "ecart" : undefined },
            el("td", {}, el("strong", { class: "code" }, lien(lienFiche(g.csar), g.csar)), sousLibelle(g.libelleCsar)),
            modalite ? el("td", {}, MODALITES[g.modalite] ?? g.modalite) : null,
            el("td", {}, ...celluleIntervenants(k, g.intervenants, g.total)),
            celluleEcart(g)
          )
        )
      )
    ),
    modalite ? null : note(`Modalité : ${MODALITES[groupes[0].modalite] ?? groupes[0].modalite}.`),
    groupes.some((g) => g.ecart)
      ? note("Écart : la pondération du fichier CSAR de l'ATIH diffère de celle de cet acte ; la fonction groupage retient celle de cet acte (volume 1, 3.3.1.3). Le détail est sur la fiche de l'acte CSAR.")
      : null,
  ];
}

/** Pondération du CSARR transcodé, et, en cas d'écart, l'étiquette et la
 *  valeur du fichier CSAR. */
function celluleEcart(g) {
  if (!g.ecart) return el("td", { class: "nombre" }, String(g.ponderation));
  return el(
    "td",
    {},
    String(g.ponderation),
    etiquetteEcart(g.ponderation, g.fichierCsar),
    el("span", { class: "ecart-detail" }, `fichier CSAR : ${g.fichierCsar}`)
  );
}

// ==== Fiche d'un acte CSAR ====

export function ficheCsar(smr, { code: c, lignes }) {
  const k = smr.classification;
  const modalites = new Set(lignes.map((l) => l["Modalité"]));
  const [temps, l1, l2, l3] = k.csar.modulables[c] ?? [false, false, false, false];
  const groupes = regrouperTranscodage(lignes, smr.csar._parCode);
  const ecarts = groupes.filter((g) => g.ecart);
  const equivalents = lignes.filter((l) => l["Équivalent"]).length;
  const csarrs = [...new Set(lignes.map((l) => l["Code CSARR"]))].sort();
  // Les CSARR transcodés d'un même acte CSAR ont souvent les mêmes listes
  // (ALQ+137 et ALQ+247 pour 01E08) : une ligne pour eux tous.
  const spe = [];
  for (const csarr of csarrs) {
    const listes = specialisation(smr, csarr);
    const signature = JSON.stringify(listes);
    const meme = spe.find((x) => x.signature === signature);
    if (meme) meme.csarrs.push(csarr);
    else spe.push({ csarrs: [csarr], listes, signature });
  }
  const nbGn = new Set(spe.flatMap((s) => s.listes.flatMap((x) => x.gns))).size;
  // La modalité n'a sa colonne que si l'acte en a plusieurs : sinon, la
  // section « Modalités » la dit, et la colonne ne ferait que la répéter.
  const avecModalite = new Set(groupes.map((g) => g.modalite)).size > 1;

  // Le plus nombreux des groupes d'une modalité est « les autres » quand
  // d'autres groupes existent pour la même modalité.
  const plusNombreux = new Map();
  for (const g of groupes) if (!plusNombreux.has(g.modalite)) plusNombreux.set(g.modalite, g);
  const parModalite = (m) => groupes.filter((g) => g.modalite === m).length;

  return [
    el("h2", { tabindex: "-1" }, `${c} — ${lignes[0]["Libellé CSAR"]}`),
    el(
      "p",
      { class: "fiche-resume" },
      el("span", { class: "pastille" }, "Acte CSAR"),
      el("span", { class: "pastille" }, texteModalites(modalites, true)),
      equivalents ? el("span", { class: "pastille attention" }, "Sans correspondance CSARR") : null,
      ecarts.length ? el("span", { class: "pastille attention" }, texteEcarts(ecarts)) : null,
      el("span", { class: "pastille" }, nbGn ? `Spécialisé pour ${nbGn} GN` : "Non spécialisé")
    ),
    el("h3", {}, "Modalités"),
    el("p", {}, texteModalites(modalites, false)),
    note("Colonne « acte_coll » de CSAR_infos. Volume 1, 3.1.1."),
    el("h3", {}, "Modulateurs acceptés"),
    blocModulateursCsar(k, { temps, L1: l1, L2: l2, L3: l3 }),
    note(
      "Sans effet pour un intervenant non attendu (pondération 0 du CSARR transcodé). Drapeaux de ACTES_ponderations_CSAR_transcodage. Volume 1, 3.3.1.3 et 3.3.1.4."
    ),
    el("h3", {}, "Transcodage en CSARR"),
    equivalents
      ? el(
          "p",
          { class: "message-info" },
          el("strong", {}, "Acte sans correspondance CSARR, équivalent en pondération. "),
          "Le CSARR indiqué n'est pas une traduction de l'acte mais un acte de pondération équivalente, fourni pour faciliter le transcodage (commentaire de CSAR_infos)."
        )
      : null,
    table(
      [
        avecModalite ? entete("Modalité") : null,
        entete("Intervenants"),
        entete("CSARR", "Acte CSARR transcodé"),
        entete("Pondération", "Pondération du CSARR transcodé pour ces intervenants"),
      ].filter(Boolean),
      el(
        "tbody",
        {},
        ...groupes.map((g) =>
          el(
            "tr",
            { class: g.ecart ? "ecart" : undefined },
            avecModalite ? el("td", {}, MODALITES[g.modalite] ?? g.modalite) : null,
            el(
              "td",
              {},
              ...celluleIntervenants(k, g.intervenants, g.total, {
                autres: plusNombreux.get(g.modalite) === g && parModalite(g.modalite) > 1,
              })
            ),
            el(
              "td",
              {},
              el("strong", { class: "code" }, lien(lienFiche(g.csarr), g.csarr)),
              sousLibelle(g.libelleCsarr),
              g.equivalent && equivalents < lignes.length ? sousLibelle("équivalent en pondération") : null
            ),
            celluleEcart(g)
          )
        )
      )
    ),
    ecarts.length ? blocEcarts(k, ecarts, temps) : null,
    Object.keys(k.csar.transposition).length
      ? note(
          `Intervenants ${Object.keys(k.csar.transposition).join(" et ")} du CSAR : transposés en ${[...new Set(Object.values(k.csar.transposition))].map((iv) => `${iv} (${libelleIntervenant(k, iv).toLowerCase()})`).join(", ")} avant le transcodage. Volume 1, 3.3.1.2.`
        )
      : null,
    el("p", {}, el("a", { class: "lien-texte", href: lienCsar(c) }, "Voir dans le transcodage CSAR ↔ CSARR")),
    el("h3", {}, "Caractère spécialisé"),
    el(
      "p",
      {},
      "Le caractère spécialisé d'un acte CSAR et les GN associés sont ceux de l'acte CSARR retenu par le transcodage."
    ),
    table(
      [entete("CSARR transcodé"), entete("Liste"), entete("GN pour lesquels il est spécialisé")],
      ...spe.map(({ csarrs: codes, listes }) =>
        el(
          "tbody",
          {},
          ...(listes.length ? listes : [null]).map((x, i) =>
            el(
              "tr",
              {},
              i === 0
                ? el(
                    "th",
                    { scope: "rowgroup", rowspan: String(Math.max(1, listes.length)) },
                    ...codes.map((csarr) => el("span", { class: "racine-libellee" }, lien(lienFiche(csarr), csarr)))
                  )
                : null,
              x
                ? el("td", {}, code(...coupable(x.liste)), sousLibelle(coupable(k.listesSpe[x.liste]?.libelle)))
                : el("td", { class: "non-attendu" }, "—"),
              x
                ? el("td", {}, ...x.gns.map((gn) => el("span", { class: "racine-libellee" }, lienGn(k, gn))))
                : el("td", { class: "non-attendu" }, "Non spécialisé : ne compte que dans le score global.")
            )
          )
        )
      )
    ),
    note("Volume 1, 3.2.1 et 3.2.3."),
  ];
}

/** « Écart de pondération : 4 intervenants » — pour la pastille. */
function texteEcarts(ecarts) {
  const n = ecarts.reduce((somme, g) => somme + g.intervenants.length, 0);
  return `Écart de pondération : ${nombre(n)} intervenant${n > 1 ? "s" : ""}`;
}

/** « Individuel seulement », « Individuel ou collectif, transcodés
 *  séparément »… — `court` pour la pastille. */
function texteModalites(modalites, court) {
  if (modalites.has("2")) {
    return court
      ? "Individuel ou collectif"
      : "Codable en individuel ou en collectif, avec le même transcodage dans les deux cas.";
  }
  if (modalites.has("0") && modalites.has("1")) {
    return court
      ? "Individuel ou collectif"
      : "Codable en individuel ou en collectif : chaque modalité a son propre CSARR transcodé.";
  }
  if (modalites.has("1")) return court ? "Collectif seulement" : "Codable en collectif seulement.";
  return court
    ? "Individuel seulement"
    : "Codable en individuel seulement : codé en collectif, il lève l'erreur 179 (modalité collective non acceptée pour l'acte CSAR).";
}

function blocModulateursCsar(k, acceptes) {
  const temps = k.csar.temps.map(([m, , p]) => `${m} ${p}`).join(" · ");
  const lignes = [
    el(
      "tr",
      {},
      el("th", { scope: "row" }, "Temps", sousLibelle("Durée de la séance, de T0 à T4")),
      el("td", { class: acceptes.temps ? undefined : "non-attendu" }, acceptes.temps ? "oui" : "non"),
      el("td", {}, `Pondération ${temps} ; la plus élevée de celle-ci et de celle du CSARR transcodé est retenue.`)
    ),
    ...k.csar.lieu.map(([m, libelle, individuel, collectif]) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, m, sousLibelle(libelle)),
        el("td", { class: acceptes[m] ? undefined : "non-attendu" }, acceptes[m] ? "oui" : "non"),
        el(
          "td",
          {},
          `+${individuel} (individuel)`,
          collectif == null ? ", sans objet en collectif" : `, +${collectif} (collectif)`,
          LIEUX_TRANSCODES[m] ? ` ; transcodé en ${LIEUX_TRANSCODES[m]}.` : "."
        )
      )
    ),
  ];
  return table([entete("Modulateur"), entete("Accepté"), entete("Effet")], el("tbody", {}, ...lignes));
}

/** Les écarts entre la pondération du fichier CSAR de l'ATIH et celle du
 *  CSARR transcodé : la fonction groupage ne lit que la seconde (3.3.1.3).
 *  Signalés un par un, avec les deux valeurs. */
function blocEcarts(k, ecarts, tempsAccepte) {
  return el(
    "div",
    { class: "message-avertissement fiche-frontiere" },
    el("strong", {}, "Écart de pondération. "),
    "Pour ces intervenants, la pondération que donne le fichier CSAR de l'ATIH (ACTES_ponderations_CSAR_transcodage) diffère de celle du CSARR transcodé. La fonction groupage retient celle du CSARR transcodé",
    tempsAccepte
      ? " — ou celle du modulateur de temps si elle est plus élevée, sauf pour un intervenant non attendu (pondération 0), pour qui le modulateur est sans effet"
      : "",
    " (volume 1, 3.3.1.3).",
    el(
      "ul",
      {},
      ...ecarts.map((g) =>
        el(
          "li",
          {},
          g.intervenants.map((iv) => `${libelleIntervenant(k, iv)} (${iv})`).join(", "),
          `, ${MODALITES[g.modalite] ?? g.modalite} : `,
          lien(lienFiche(g.csarr), g.csarr),
          ` ${g.ponderation}${g.ponderation === 0 ? " (non attendu)" : ""}, retenue ; fichier CSAR ${g.fichierCsar}.`
        )
      )
    )
  );
}
