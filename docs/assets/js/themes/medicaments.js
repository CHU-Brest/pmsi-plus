// Médicaments de la réserve hospitalière et de la liste en sus — page
// statique, sans donnée tabulée. Port de src/themes/medicaments/page.py :
// où lire le statut d'un médicament, et à quoi le reconnaître.

import { el } from "../interface.js";

const VIDAL = "https://hoptimal.vidal.fr/";

export async function rendre(conteneur) {
  conteneur.innerHTML = "";
  conteneur.append(
    el("h1", {}, "Médicaments de la réserve hospitalière et de la liste en sus"),
    el("p", { class: "sous-titre" }, "Lire le statut d'un médicament dans le VIDAL Hoptimal"),
    el("hr", { class: "separateur" }),

    el(
      "p",
      { class: "message-succes" },
      el("strong", {}, "Pastille verte à croix blanche barrée en rouge = réserve hospitalière."),
      el("br"),
      el("br"),
      "À droite d'une ligne de présentation, la pastille ",
      el("strong", {}, "verte à croix blanche barrée en rouge"),
      " : le médicament n'est pas dispensé en ville, c'est un médicament de la ",
      el("strong", {}, "réserve hospitalière"),
      "."
    ),
    el("img", {
      class: "capture",
      src: "assets/img/rh.png",
      alt: "QUTENZA 179 mg patch cutané dans le VIDAL Hoptimal : pastille verte à croix blanche barrée en rouge",
    }),
    el(
      "p",
      { class: "legende" },
      "QUTENZA 179 mg patch cutané dans le VIDAL Hoptimal : la pastille verte à croix blanche barrée en rouge — réserve hospitalière."
    ),

    el(
      "p",
      { class: "message-succes" },
      el("strong", {}, "Pastille grise GHS barrée = liste en sus."),
      el("br"),
      el("br"),
      "À droite d'une ligne de présentation, la pastille ",
      el("strong", {}, "grise GHS barrée"),
      " : le médicament est facturé en sus du GHS ou de GME (SMR), c'est un médicament de la ",
      el("strong", {}, "liste en sus"),
      "."
    ),
    el("img", {
      class: "capture",
      src: "assets/img/les.png",
      alt: "DYSPORT 300 U SPEYWOOD dans le VIDAL Hoptimal : pastille grise GHS barrée",
    }),
    el(
      "p",
      { class: "legende" },
      "DYSPORT 300 U SPEYWOOD pdre p sol inj dans le VIDAL Hoptimal : la pastille grise GHS barrée — liste en sus."
    ),

    el("h2", {}, "Marche à suivre"),
    el(
      "ol",
      {},
      el("li", {}, "ouvrir le VIDAL Hoptimal et chercher le médicament par son nom commercial ou par sa DCI ;"),
      el(
        "li",
        {},
        "descendre jusqu'à la présentation concernée — dosage et forme compris : deux présentations d'une même spécialité n'ont pas forcément le même statut ;"
      ),
      el("li", {}, "regarder les pastilles à droite de cette ligne.")
    ),
    el(
      "ul",
      {},
      el("li", {}, "pastille verte à croix blanche barrée en rouge → réserve hospitalière ;"),
      el("li", {}, "pastille grise GHS barrée → liste en sus.")
    ),
    el(
      "a",
      { class: "bouton", href: VIDAL, target: "_blank", rel: "noopener" },
      "Ouvrir le VIDAL Hoptimal ↗"
    ),

    el("h2", {}, "Précautions de lecture"),
    el(
      "div",
      { class: "message-erreur" },
      el(
        "ul",
        {},
        el(
          "li",
          {},
          el("strong", {}, "Les médicaments de la réserve hospitalière"),
          " et de la ",
          el("strong", {}, "liste en sus"),
          " doivent être maintenus en hospitalisation (sauf indication contraire)."
        ),
        el(
          "li",
          {},
          el("strong", {}, "Le statut se lit par présentation, pas par molécule"),
          " : une même DCI peut exister en ville et à l'hôpital selon le dosage ou la forme."
        ),
        el(
          "li",
          {},
          el("strong", {}, "En cas de doute, ouvrir la monographie"),
          " — le bouton « Monographie [HTML] » de la ligne : les conditions de prescription, délivrance et facturation y sont en toutes lettres, et c'est ce qui tranche."
        )
      )
    ),

    el("hr", { class: "separateur" }),
    el(
      "p",
      { class: "sous-titre" },
      "Cette page ne tabule aucun statut : un statut périmé se lit avec la même confiance qu'un statut à jour, et le rythme d'actualisation d'un tel tableau dépasse ce que le service peut tenir. Le VIDAL Hoptimal, lui, est maintenu hors du service."
    )
  );
}
