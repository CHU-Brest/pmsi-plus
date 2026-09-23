"""Extrait les exclusions de CMA du volume 1 du Manuel des GHM.

Usage :

    pip install -r scripts/requirements.txt
    python scripts/build_cma.py

Sources, telles que livrées par l'ATIH :

- data/groupage/manuel_ghm_volume_1_annexe_4.pdf : chaque CMA avec son
  niveau (2 à 4), le numéro de sa liste d'exclusion par le DP et, le cas
  échéant, celui de sa liste d'exclusion par la racine de GHM ;
- data/groupage/manuel_ghm_volume_1_annexe_5.pdf : le contenu de ces
  listes — partie 1, les DP ; partie 2, les racines.

Cible : docs/assets/data/groupage/cma_exclusions.json. Les listes y restent
sous la forme du manuel (« A00 », « R05-R07 », « M0-M62.89* »,
« Racines_en_C »…) : le site les applique à un DP et à une racine donnés.

Comme build_arbre.py, le script s'arrête plutôt que de deviner : une liste
citée par l'annexe 4 et absente de l'annexe 5, une numérotation qui saute,
un élément de liste illisible, ou un niveau qui contredit data/groupage/
cma.csv arrêtent la conversion.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

from millesime import millesime

RACINE = Path(__file__).resolve().parent.parent
ANNEXE_4 = RACINE / "data" / "groupage" / "manuel_ghm_volume_1_annexe_4.pdf"
ANNEXE_5 = RACINE / "data" / "groupage" / "manuel_ghm_volume_1_annexe_5.pdf"
CSV_CMA = RACINE / "data" / "groupage" / "cma.csv"
CIBLE = RACINE / "docs" / "assets" / "data" / "groupage" / "cma_exclusions.json"

# Une ligne de l'annexe 4 : code, niveau, liste de DP, liste de racines (ou
# « - »), libellé — chacun sur sa ligne dans le texte du PDF.
RE_CMA = re.compile(
    r"^([A-Z]\d{2}(?:\.[0-9]*)?(?:\+\d+)?)\s*\n\s*([234])\s*\n\s*(\d+|-)\s*\n\s*(\d+|-)\s*\n",
    re.M,
)
# Un élément de liste de DP : un code (préfixe), éventuellement étoilé, ou
# une plage de deux codes.
CODE = r"[A-Z](?:\d{1,2}(?:\.[0-9]*)?(?:\+\d+)?)?\*?"
RE_ELEMENT_DP = re.compile(rf"^{CODE}(?:-{CODE})?$")
RE_ELEMENT_RACINE = re.compile(r"^(?:\d{2}[CKMZ]\d{2}|CMD\d{2}|Racines_en_[CKMZ]|Sous_CMD\d{2}_[CKMZ])$")
# En-têtes et pieds de page de l'annexe 5, à écarter.
RE_BRUIT = re.compile(r"^(Manuel des GHM|Annexe 5-\d+|.*rbidités associées)")


class ErreurExtraction(Exception):
    pass


def lire_annexe_4() -> list[list]:
    with pymupdf.open(ANNEXE_4) as doc:
        texte = "\n".join(page.get_text() for page in doc)
    cma = []
    for code, niveau, liste_dp, liste_racine in RE_CMA.findall(texte):
        cma.append(
            [
                code,
                int(niveau),
                # « 0 » (U82, U83 : résistances aux antimicrobiens) : liste
                # absente de l'annexe 5, soit aucune exclusion par le DP.
                int(liste_dp) if liste_dp not in ("-", "0") else None,
                int(liste_racine) if liste_racine != "-" else None,
            ]
        )
    if not cma:
        raise ErreurExtraction(f"{ANNEXE_4.name} : aucune CMA lue")
    return cma


def lignes_utiles(doc: pymupdf.Document) -> list[str]:
    lignes = []
    for page in doc:
        for ligne in page.get_text().splitlines():
            ligne = ligne.strip()
            if ligne and not RE_BRUIT.match(ligne):
                lignes.append(ligne)
    return lignes


def listes_numerotees(lignes: list[str], motif: re.Pattern, partie: str) -> dict[int, list[str]]:
    """Recolle les listes « n° élément élément… » d'une partie de l'annexe 5.

    Une liste commence par une ligne dont le premier mot est son numéro, le
    suivant de la précédente ; ses éléments peuvent déborder sur les lignes
    suivantes, une plage coupée après son tiret (« R94.7- » / « R94.8 »)
    comprise. Le texte explicatif qui précède la première liste est écarté.
    """
    listes: dict[int, list[str]] = {}
    numero = 0
    texte = None
    for ligne in lignes:
        mots = ligne.split()
        if mots[0] == str(numero + 1) and all(motif.match(m) for m in mots[1:] if not m.endswith("-")):
            if texte is not None:
                listes[numero] = texte.split()
            numero += 1
            texte = " ".join(mots[1:])
        elif texte is not None:
            texte += ("" if texte.endswith("-") else " ") + ligne
    if texte is not None:
        listes[numero] = texte.split()
    for numero, elements in listes.items():
        illisibles = [e for e in elements if not motif.match(e)]
        if illisibles or not elements:
            raise ErreurExtraction(f"{partie}, liste {numero} : élément(s) illisible(s) {illisibles}")
    return listes


def lire_annexe_5() -> tuple[dict[int, list[str]], dict[int, list[str]]]:
    with pymupdf.open(ANNEXE_5) as doc:
        lignes = lignes_utiles(doc)
    try:
        coupure = next(i for i, l in enumerate(lignes) if l.startswith("Partie 2"))
    except StopIteration:
        raise ErreurExtraction(f"{ANNEXE_5.name} : partie 2 introuvable") from None
    dp = listes_numerotees(lignes[:coupure], RE_ELEMENT_DP, "partie 1 (DP)")
    racines = listes_numerotees(lignes[coupure:], RE_ELEMENT_RACINE, "partie 2 (racines)")
    return dp, racines


def verifier(cma: list[list], dp: dict, racines: dict) -> None:
    manquantes_dp = sorted({c[2] for c in cma if c[2] is not None} - set(dp))
    manquantes_racines = sorted({c[3] for c in cma if c[3] is not None} - set(racines))
    if manquantes_dp or manquantes_racines:
        raise ErreurExtraction(
            f"listes citées par l'annexe 4 et absentes de l'annexe 5 : DP {manquantes_dp}, racines {manquantes_racines}"
        )
    # Le niveau de chaque CMA doit être celui de la liste des CMA en csv.
    if CSV_CMA.exists():
        niveaux = {}
        for ligne in CSV_CMA.read_bytes().decode("cp1252").splitlines()[1:]:
            code, niveau, _ = ligne.split(";", 2)
            code = code.strip()
            niveaux[code if len(code) <= 3 else f"{code[:3]}.{code[3:]}"] = int(niveau)
        ecarts = [(c[0], c[1], niveaux[c[0]]) for c in cma if c[0] in niveaux and niveaux[c[0]] != c[1]]
        absentes = sorted(set(niveaux) - {c[0] for c in cma})
        if ecarts or absentes:
            raise ErreurExtraction(
                f"annexe 4 et cma.csv divergent : niveaux {ecarts[:10]}, CMA absentes de l'annexe {absentes[:10]}"
            )


def main() -> None:
    try:
        cma = lire_annexe_4()
        dp, racines = lire_annexe_5()
        verifier(cma, dp, racines)
    except ErreurExtraction as e:
        sys.exit(f"Extraction impossible : {e}")
    donnees = {
        "millesime": min(millesime(ANNEXE_4), millesime(ANNEXE_5)),
        "cma": cma,
        "dp": {str(n): e for n, e in dp.items()},
        "racines": {str(n): e for n, e in racines.items()},
    }
    CIBLE.write_text(json.dumps(donnees, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"{CIBLE.relative_to(RACINE)} : {len(cma)} CMA, {len(dp)} listes de DP, "
        f"{len(racines)} listes de racines"
    )


if __name__ == "__main__":
    main()
