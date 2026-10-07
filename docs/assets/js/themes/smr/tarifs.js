// Tarifs des GME — l'annexe I de l'arrêté tarifaire SMR (feuille « Tarifs
// GMT - DAF » de tarifs.xlsx, convertie par scripts/build_smr.py) : une
// ligne par couple GMT-GME, avec les bornes de la zone forfaitaire et les
// tarifs des zones, sur le modèle du thème Tarifs des GHS (MCO).
//
// L'adresse #/smr/tarifs/<recherche> pré-remplit le champ — l'algorithme y
// renvoie pour un GN (« #/smr/tarifs/0147 ») — et la saisie l'y reporte,
// pour qu'une recherche se partage ou se signale telle quelle.
//
// Numéros de GN et de GMT ont la même forme, quatre chiffres, et la plupart
// des GN ont un homonyme parmi les GMT : « 0147 » est le GN des AVC avec
// hémiplégie, et le GMT principal du GME 0130SC1. Une recherche plein texte
// ramènerait ce GME en tête des résultats du GN. Un code de groupe saisi se
// compare donc au début des codes GME, comme dans la recherche de
// l'algorithme, et un numéro de GMT n'est cherché comme tel que s'il n'est
// pas aussi un début de GME ; l'homonyme est signalé au-dessus du tableau.
//
// Le tableau partagé (interface.js) n'affiche que du texte : le lien d'un
// GME vers l'algorithme ne peut pas être posé dans sa cellule. Il est donné
// au-dessus du tableau dès que les résultats ne couvrent qu'un GN.
//
// Lignes, index, recherche et exceptions sont calculés par smr.js
// (preparerTarifs, filtreTarifs…) ; ce module les dessine.

import { el, fraicheur, champMotsClefs, resultats, nombre } from "../../interface.js";
import { chargerTarifsSmr, DUREES, filtreTarifs, groupeCommun, homonymeGmt, MONTANTS, preparerTarifs } from "../../smr.js";
import { lienArbre, lienTarifs } from "../../smr_interface.js";
import { euros, jours } from "../../tarifs.js";

const FORMATS = Object.fromEntries([...DUREES.map((c) => [c, jours]), ...MONTANTS.map((c) => [c, euros])]);

// Longueur d'un préfixe de GME → niveau du groupe qu'il désigne.
const NIVEAUX = { 4: "GN", 5: "GR", 6: "GL", 7: "GME" };

/** Suite de liens séparés par des virgules. */
function liens(codes, href) {
  return codes.flatMap((code, i) => [i ? ", " : null, el("a", { href: href(code) }, code)]);
}

/** « 0147 » saisi seul est lu comme un GN ; s'il est aussi un numéro de
 *  GMT, dire lequel et y mener, plutôt que de le taire. */
function indicationHomonyme(index, requete) {
  const homonyme = homonymeGmt(index, requete);
  if (!homonyme) return null;
  const { code, gmes } = homonyme;
  return el(
    "p",
    { class: "liens-fiches" },
    `« ${code} » est lu comme le GN ${code}. Le GMT ${code} est celui ${gmes.length > 1 ? "des GME" : "du GME"} `,
    ...liens(gmes, lienTarifs),
    "."
  );
}

function indicationAlgorithme(index, trouvees) {
  const code = groupeCommun(trouvees);
  if (!code) return null;
  const gn = code.slice(0, 4);
  const libelle = index.libelleGn.get(gn) ?? "";
  return el(
    "p",
    { class: "liens-fiches" },
    "Dans l'algorithme de la fonction groupage : ",
    el("a", { href: lienArbre(code) }, `${NIVEAUX[code.length]} ${code}`),
    code.length > 4 ? `, du GN ${gn} ${libelle}.` : ` ${libelle}.`
  );
}

/** Les GME d'HC hors de la règle des trois GMT, s'il y en a. */
function phraseExceptions({ liste, doublons }) {
  if (!liste.length) return [];
  const morceaux = liste.flatMap((g, i) => [
    i ? " ; " : null,
    ...(g.complet
      ? [el("a", { href: lienTarifs(g.gn) }, `GN ${g.gn}`), ` ${g.libelle}`]
      : ["GME ", ...liens(g.gmes, lienTarifs)]),
    `, ${nombre(g.nombre)} GMT par GME d'HC`,
  ]);
  return [
    " Font exception dans cet arrêté : ",
    ...morceaux,
    ".",
    doublons.length
      ? ` Quand un GME a plusieurs GMT de même nature (GN ${doublons.join(", ")}), le tableau ne dit pas ce qui les départage.`
      : null,
  ];
}

export async function rendre(conteneur, { chemin = [] } = {}) {
  const jeu = await chargerTarifsSmr();
  const index = preparerTarifs(jeu);
  const { lignes } = index;
  const exceptions = {
    ...index.exceptions,
    liste: index.exceptions.liste.map((g) => ({ ...g, libelle: index.libelleGn.get(g.gn) ?? "" })),
  };
  conteneur.innerHTML = "";

  // Lien profond (#/smr/tarifs/0147SC2) : le champ arrive rempli.
  const demande = chemin.join("/");
  // Indications et compteur changent avec la saisie : annoncés de même aux
  // lecteurs d'écran.
  const zoneIndication = el("div", { "aria-live": "polite" });
  const zoneResultats = el("div", { class: "smr-tarifs" });
  const champ = champMotsClefs({
    id: "smr_tarifs_recherche",
    exemple: "ex. : 0147, 0147SC2, 7037, hémiplégie",
    valeur: demande,
    onInput: (valeur) => {
      afficher(valeur);
      // La frappe retombe après un délai : entre-temps, la page a pu
      // changer de thème, dont on ne réécrirait pas l'adresse. Pas
      // d'entrée d'historique : le retour arrière quitte la page au lieu
      // de défaire la saisie lettre à lettre.
      if (!zoneResultats.isConnected) return;
      const cible = lienTarifs(valeur.trim());
      if (location.hash.startsWith(lienTarifs()) && location.hash !== cible) history.replaceState(null, "", cible);
    },
  });
  champ.append(
    el(
      "p",
      { class: "champ-aide" },
      "Un code de groupe (« 0147 », « 0147SC2 ») se compare au début du GME ; un numéro de GMT (« 7037 ») trouve ce GMT, sauf s'il est aussi un numéro de GN."
    )
  );

  conteneur.append(
    el("h1", {}, "Tarifs des GME"),
    el(
      "p",
      { class: "sous-titre" },
      ...(jeu.campagne ? [el("strong", { class: "campagne" }, `Campagne ${jeu.campagne}`), " — annexe I"] : ["Annexe I"]),
      " de l'arrêté tarifaire SMR, établissements des a, b et c de l'article L. 162-22 du code de la sécurité sociale"
    ),
    fraicheur([{ libelle: jeu.libelle, millesime: jeu.millesime }]),
    el(
      "p",
      {},
      `Chaque ligne de l'annexe est un couple GMT-GME : le groupe médico-tarifaire (GMT), le groupe médico-économique (GME) qu'il tarife, les bornes de la zone forfaitaire et les tarifs des zones — ${nombre(lignes.length)} lignes pour ${nombre(jeu._parGme.size)} GME. Ce sont les tarifs nationaux, avant coefficients géographique et Ségur.`
    ),
    el(
      "ul",
      {},
      el(
        "li",
        {},
        "Colonnes sous les noms de l'arrêté : DZF, début de zone forfaitaire, et FZF, fin de zone forfaitaire, en jours ; TZB, tarif de la zone basse ; SZB, supplément de la zone basse ; TZF1, TZF2 et TZF3, tarif de la zone forfaitaire, périodes 1, 2 et 3 ; SZH, supplément de la zone haute. Un tiret : pas de montant dans l'arrêté. Le tableau donne les montants, pas la façon de les appliquer à un séjour selon sa durée, qui relève de la notice technique de l'ATIH."
      ),
      el(
        "li",
        {},
        "Un GME d'hospitalisation complète (HC) relève de trois GMT : le GMT principal, un GMT2 et celui des séjours de moins de 8 jours avec transfert ou décès. Le GMT2 et le GMT des séjours courts sont partagés par plusieurs GME d'un même GN : chercher leur numéro les montre tous. Les règles qui affectent un séjour à l'un d'eux sont celles de la notice technique de l'ATIH, pas du Manuel des GME.",
        ...phraseExceptions(exceptions)
      ),
      el(
        "li",
        {},
        "Un GME d'hospitalisation à temps partiel (HTP), dont le code se termine par 0, relève d'un seul GMT, par journée : l'arrêté en donne le tarif en TZF1."
      ),
      el(
        "li",
        {},
        "Hors de ce tableau : les coefficients géographique et Ségur, les forfaits des plateaux techniques spécialisés et les suppléments de transport, que l'arrêté fixe à part. Les tarifs des établissements du d de l'article L. 162-22 (annexe II) ne sont pas repris."
      )
    ),
    el("div", { class: "barre-outils" }, champ),
    zoneIndication,
    zoneResultats
  );

  function afficher(requete) {
    const trouvees = lignes.filter(filtreTarifs(index, requete));
    zoneIndication.replaceChildren(
      ...[indicationHomonyme(index, requete), indicationAlgorithme(index, trouvees)].filter(Boolean)
    );
    resultats(zoneResultats, trouvees, { total: lignes.length, formats: FORMATS });
  }

  afficher(demande);
}
