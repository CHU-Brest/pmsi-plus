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
// « ALQ+183 », « déglutition »). Les deux tables sont préparées par smr.js
// (preparerCsar) ; ce module les dessine.

import * as recherche from "../../recherche.js";
import { el, fraicheur, champMotsClefs, nombre } from "../../interface.js";
import { chargerClassification, chargerCsar, preparerCsar } from "../../smr.js";
import { lienCsar, lienFiche, sourceFg } from "../../smr_interface.js";

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
  const { actes, csarrs, ecarts } = preparerCsar(jeu, k);
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
    const cible = lienCsar(requete.trim());
    if (zoneActes.isConnected && location.hash !== cible) history.replaceState(null, "", cible);
  }

  afficher(demande);
}
