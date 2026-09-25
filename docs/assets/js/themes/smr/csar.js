// Transcodage CSAR ↔ CSARR — la table de transcodage de CSAR_infos.xlsx
// (csar.json) : pour chaque acte CSAR, l'acte CSARR que la fonction groupage
// retient selon l'intervenant et la modalité, individuelle ou collective
// (volume 1, 3.1.1). Le CSARR reste en 2026 la nomenclature de référence de
// la fonction groupage : pondérations et caractère spécialisé sont ceux de
// l'acte CSARR transcodé.
//
// La même table, lue dans l'autre sens, donne les actes CSAR qui aboutissent
// à un acte CSARR : de quoi retrouver en CSAR un acte qu'on codait en CSARR.
// L'ATIH ne publie pas de table dans ce sens : ce n'est que la lecture
// inverse de la sienne, et un acte CSAR sans correspondance CSARR n'y mène à
// son CSARR « équivalent en pondération » que pour le calcul des scores.
//
// Vue d'ensemble seulement : le détail d'un acte (pondérations par
// intervenant, modulateurs, caractère spécialisé) est dans sa fiche code.
// L'adresse #/smr/csar/<recherche> pré-remplit le champ (« 01E01 »,
// « ALQ+183 », « déglutition »).

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, nombre } from "../../interface.js";
import { chargerClassification, chargerCsar } from "../../smr.js";
import { lienFiche, sourceFg } from "../../smr_interface.js";

const MODALITES = { 0: "individuel", 1: "collectif", 2: "individuel ou collectif" };
// Au-delà, la liste des intervenants d'une condition se résume.
const INTERVENANTS_CITES_MAX = 4;

const comparer = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ==== Préparation ====

/** Pour un acte CSAR : ses CSARR transcodés, chacun avec la condition qui y
 *  mène (modalité, intervenants), la plus fréquente d'abord. */
function transcodages(lignes, k) {
  const modalites = [...new Set(lignes.map((l) => l["Modalité"]))].sort();
  const resultat = [];
  for (const m of modalites) {
    const deLaModalite = lignes.filter((l) => l["Modalité"] === m);
    const tous = new Set(deLaModalite.map((l) => l.Intervenant));
    const parCsarr = new Map();
    for (const l of deLaModalite) {
      if (!parCsarr.has(l["Code CSARR"])) parCsarr.set(l["Code CSARR"], { lignes: [], intervenants: new Set() });
      const g = parCsarr.get(l["Code CSARR"]);
      g.lignes.push(l);
      g.intervenants.add(l.Intervenant);
    }
    const groupes = [...parCsarr.entries()].sort((a, b) => b[1].intervenants.size - a[1].intervenants.size);
    groupes.forEach(([csarr, g], i) => {
      const morceaux = [];
      if (modalites.length > 1) morceaux.push(MODALITES[m] ?? m);
      if (g.intervenants.size < tous.size) {
        // Le groupe le plus nombreux d'une modalité à plusieurs CSARR :
        // « les autres intervenants », plus lisible que leur liste.
        if (i === 0) morceaux.push("les autres intervenants");
        else morceaux.push(citerIntervenants([...g.intervenants].sort(), k));
      }
      resultat.push({
        csarr,
        libelleCsarr: g.lignes[0]["Libellé CSARR"],
        condition: morceaux.join(", "),
        equivalent: g.lignes.some((l) => l["Équivalent"]),
        ecart: g.lignes.some((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]),
      });
    });
  }
  return resultat;
}

function citerIntervenants(codes, k) {
  const noms = codes.map((iv) => `${(k.intervenants[iv] ?? iv).toLowerCase()} (${iv})`);
  if (noms.length <= INTERVENANTS_CITES_MAX) return noms.join(", ");
  return `${noms.slice(0, INTERVENANTS_CITES_MAX).join(", ")} et ${nombre(noms.length - INTERVENANTS_CITES_MAX)} autres`;
}

/** Les deux tables et les écarts, une fois par jeu (gardés sur le jeu, sous
 *  un nom préfixé pour ne pas croiser les index des autres thèmes). */
function preparer(jeu, k) {
  if (jeu._csarVue) return jeu._csarVue;
  const parCsar = new Map();
  for (const l of jeu.lignes) {
    if (!parCsar.has(l["Code CSAR"])) parCsar.set(l["Code CSAR"], []);
    parCsar.get(l["Code CSAR"]).push(l);
  }
  const actes = [...parCsar.entries()]
    .sort((a, b) => comparer(a[0], b[0]))
    .map(([code, lignes]) => {
      const cibles = transcodages(lignes, k);
      return {
        code,
        libelle: lignes[0]["Libellé CSAR"],
        modalites: new Set(lignes.map((l) => l["Modalité"])),
        cibles,
        equivalent: cibles.some((c) => c.equivalent),
        ecart: cibles.some((c) => c.ecart),
      };
    });
  // Sens inverse : chaque CSARR et les actes CSAR qui y mènent, avec la
  // même condition que dans le sens direct.
  const parCsarr = new Map();
  for (const a of actes) {
    for (const c of a.cibles) {
      if (!parCsarr.has(c.csarr)) parCsarr.set(c.csarr, { code: c.csarr, libelle: c.libelleCsarr, sources: [] });
      parCsarr.get(c.csarr).sources.push({ code: a.code, libelle: a.libelle, condition: c.condition, equivalent: c.equivalent });
    }
  }
  const csarrs = [...parCsarr.values()].sort((a, b) => comparer(a.code, b.code));
  for (const a of actes) {
    a._recherche = recherche.normaliser(
      [a.code, a.libelle, ...a.cibles.flatMap((c) => [c.csarr, c.libelleCsarr])].join(" ")
    );
  }
  for (const c of csarrs) {
    c._recherche = recherche.normaliser([c.code, c.libelle, ...c.sources.flatMap((s) => [s.code, s.libelle])].join(" "));
  }
  const ecarts = jeu.lignes.filter((l) => l["Pondération CSAR"] !== l["Pondération CSARR"]);
  jeu._csarVue = { actes, csarrs, ecarts };
  return jeu._csarVue;
}

// ==== Affichage ====

const lien = (code) => el("a", { href: lienFiche(code), title: "Fiche du code" }, code);
const sousLibelle = (texte) => el("span", { class: "racine-libellee" }, texte);
const entete = (texte, titre) => el("th", { scope: "col", title: titre }, texte);

function table(entetes, lignes) {
  return el(
    "div",
    { class: "codes-liste" },
    el("table", {}, el("thead", {}, el("tr", {}, ...entetes)), el("tbody", {}, ...lignes))
  );
}

/** Une ligne par acte CSAR : ses CSARR transcodés et leurs conditions. */
function ligneActe(a) {
  return el(
    "tr",
    {},
    el("td", { class: "code" }, lien(a.code)),
    el("td", {}, a.libelle),
    el(
      "td",
      {},
      ...a.cibles.map((c) =>
        el(
          "span",
          { class: "racine-libellee" },
          el("strong", { class: "code" }, lien(c.csarr)),
          " ",
          c.libelleCsarr,
          c.condition ? el("span", { class: "csar-condition" }, ` — ${c.condition}`) : null,
          c.equivalent ? el("span", { class: "csar-condition" }, " — équivalent en pondération") : null,
          c.ecart ? el("span", { class: "etiquette-ecart", title: "Pondération du fichier CSAR différente de celle du CSARR transcodé" }, "écart") : null
        )
      )
    )
  );
}

/** Une ligne par acte CSARR : les actes CSAR que la fonction groupage y
 *  transcode, et à quelle condition. */
function ligneCsarr(c) {
  return el(
    "tr",
    {},
    el("td", { class: "code" }, lien(c.code)),
    el("td", {}, c.libelle),
    el(
      "td",
      {},
      ...c.sources.map((s) =>
        el(
          "span",
          { class: "racine-libellee" },
          el("strong", { class: "code" }, lien(s.code)),
          " ",
          s.libelle,
          s.condition ? el("span", { class: "csar-condition" }, ` — ${s.condition}`) : null,
          s.equivalent ? el("span", { class: "csar-condition" }, " — sans correspondance, équivalent en pondération seulement") : null
        )
      )
    )
  );
}

function blocEcarts(k, ecarts) {
  if (!ecarts.length) return null;
  return el(
    "div",
    { class: "message-avertissement" },
    el("strong", {}, `${nombre(ecarts.length)} écart${ecarts.length > 1 ? "s" : ""} de pondération. `),
    "Pour ces couples acte CSAR / intervenant, la pondération du fichier CSAR de l'ATIH (ACTES_ponderations_CSAR_transcodage) diffère de celle du CSARR transcodé. La fonction groupage retient celle du CSARR transcodé, ou celle du modulateur de temps si l'acte l'accepte et qu'elle est plus élevée — sauf pour un intervenant non attendu (pondération 0), pour qui le modulateur est sans effet (volume 1, 3.3.1.3).",
    el(
      "ul",
      {},
      ...ecarts.map((l) =>
        el(
          "li",
          {},
          lien(l["Code CSAR"]),
          ` ${l["Libellé CSAR"]}, ${(k.intervenants[l.Intervenant] ?? l.Intervenant).toLowerCase()} (${l.Intervenant}) : `,
          lien(l["Code CSARR"]),
          ` ${l["Pondération CSARR"]}${l["Pondération CSARR"] === 0 ? " (non attendu)" : ""}, retenue ; fichier CSAR ${l["Pondération CSAR"]}.`
        )
      )
    )
  );
}

function notes(k, actes) {
  const transposition = Object.entries(k.csar.transposition);
  const memeTranscodage = actes.filter((a) => a.modalites.has("2")).length;
  return el(
    "ul",
    {},
    el(
      "li",
      {},
      `Modalité : un acte CSAR codable en individuel et en collectif a, le plus souvent, un CSARR transcodé pour chacune ; ${nombre(memeTranscodage)} actes (modalité « individuel ou collectif ») gardent le même dans les deux cas (3.1.1).`
    ),
    transposition.length
      ? el(
          "li",
          {},
          `Intervenants propres au CSAR : ${transposition.map(([csar, csarr]) => `${csar} (${(k.intervenants[csar] ?? "").toLowerCase()}) transposé en ${csarr} (${(k.intervenants[csarr] ?? "").toLowerCase()})`).join(" ; ")}, avant le transcodage (3.3.1.2).`
        )
      : null,
    el(
      "li",
      {},
      `Modulateur de temps : ${k.csar.temps.map(([m, , p]) => `${m} ${p}`).join(", ")} ; la pondération retenue est la plus élevée de celle-ci et de celle du CSARR transcodé (3.3.1.3). Modulateurs de lieu : L1 transcodé en HW ou LJ, L2 en XH, L3 en L3 ; même majoration qu'en CSARR (3.3.1.4).`
    )
  );
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const [jeu, k] = await Promise.all([chargerCsar(), chargerClassification()]);
  const { actes, csarrs, ecarts } = preparer(jeu, k);
  conteneur.innerHTML = "";

  const [demande = ""] = chemin;
  const zoneActes = el("div", {});
  const zoneCsarr = el("div", {});
  const compteurActes = el("p", { class: "compteur", role: "status" });
  const compteurCsarr = el("p", { class: "compteur", role: "status" });
  const champ = champMotsClefs({
    id: "csar_recherche",
    exemple: "ex. : 01E01, ALQ+183, déglutition",
    valeur: demande,
    onInput: (valeur) => afficher(valeur),
  });

  conteneur.append(
    el("h1", {}, "Transcodage CSAR ↔ CSARR"),
    sourceFg(),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      "En 2026, les actes de réadaptation se codent en CSARR ou dans la nouvelle nomenclature, le CSAR. Le CSARR reste la référence de la fonction groupage : elle transcode chaque acte CSAR en un acte CSARR, selon l'intervenant et la modalité, et c'est l'acte CSARR transcodé qui donne la pondération et le caractère spécialisé (volume 1, 1.1 et 3.1.1). Le premier tableau suit ce sens. Le second lit la même table à l'envers — les actes CSAR qui aboutissent à un acte CSARR —, pour retrouver en CSAR un acte qu'on codait en CSARR ; l'ATIH ne publie pas de table dans ce sens."
    ),
    blocEcarts(k, ecarts),
    notes(k, actes),
    el("div", { class: "barre-outils" }, champ),
    el("h2", {}, "Du CSAR au CSARR"),
    compteurActes,
    zoneActes,
    el("h2", {}, "Du CSARR au CSAR"),
    el(
      "p",
      { class: "champ-aide" },
      "Un acte CSAR « sans correspondance » ne traduit pas son CSARR : la fonction groupage ne lui en emprunte que la pondération."
    ),
    compteurCsarr,
    zoneCsarr
  );

  function afficher(requete) {
    const garde = recherche.filtre(requete);
    const a = actes.filter(garde);
    const c = csarrs.filter(garde);
    compteurActes.textContent = `${nombre(a.length)} acte${a.length > 1 ? "s" : ""} CSAR sur ${nombre(actes.length)}`;
    compteurCsarr.textContent = `${nombre(c.length)} acte${c.length > 1 ? "s" : ""} CSARR sur ${nombre(csarrs.length)}`;
    zoneActes.replaceChildren(
      a.length
        ? table([entete("CSAR"), entete("Libellé"), entete("CSARR transcodé", "Acte CSARR retenu par la fonction groupage, et à quelle condition")], a.map(ligneActe))
        : el("p", { class: "message-info" }, "Aucun acte CSAR ne correspond.")
    );
    zoneCsarr.replaceChildren(
      c.length
        ? table([entete("CSARR"), entete("Libellé"), entete("Actes CSAR", "Actes CSAR que la fonction groupage transcode en cet acte CSARR")], c.map(ligneCsarr))
        : el("p", { class: "message-info" }, "Aucun acte CSARR ne correspond.")
    );
    // L'adresse suit la recherche, pour qu'elle se partage ou se signale
    // telle quelle (sans entrée d'historique).
    const cible = requete.trim() ? `#/smr/csar/${encodeURIComponent(requete.trim())}` : "#/smr/csar";
    if (location.hash !== cible) history.replaceState(null, "", cible);
  }

  afficher(demande);
}
