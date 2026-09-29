"""Relit les diagnostics d'entrée des CMD, donnés par le volume 2 du Manuel des GHM.

Usage :

    python scripts/build_data.py      # d'abord : les listes D-CCnn servent au contrôle
    python scripts/build_entrees.py

Sources : les fichiers « Diagnostics d entrée dans la CMD n°XX.csv » livrés
avec le volume 2, sous leur nom, dans data/groupage/volume_2/ (point-virgule,
Windows-1252, sans en-tête : code, libellé abrégé). En DP, un diagnostic
d'entrée oriente le séjour vers sa CMD. Les listes D-CCnn de diagnostics.xlsx
n'en contiennent qu'une partie dans certaines CMD (I21.00 en CMD 05, O80.0 en
CMD 14, Z38.0 en CMD 15…).

Cible : docs/assets/data/groupage/entrees.json, au format des jeux de
build_data.py (colonnes CMD, Code, Libellé), que lit la fiche code.

Bibliothèque standard seulement. Le script s'arrête plutôt que de deviner :
un fichier sans diagnostic, une ligne illisible, un code en double dans une
CMD, ou un code d'une liste D-CCnn absent des diagnostics d'entrée de la
CMD CC arrêtent la conversion.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

from millesime import millesime

RACINE = Path(__file__).resolve().parent.parent
DOSSIER = RACINE / "data" / "groupage" / "volume_2"
CIBLE = RACINE / "docs" / "assets" / "data" / "groupage" / "entrees.json"
# Les listes publiées (build_data.py) : chaque code d'une liste D-CCnn doit
# être un diagnostic d'entrée de la CMD CC.
DIAGNOSTICS = RACINE / "docs" / "assets" / "data" / "groupage" / "diagnostics.json"

RE_FICHIER = re.compile(r"^Diagnostics d entrée dans la CMD n°(\d{2})\.csv$")
RE_CODE = re.compile(r"^[A-Z]\d{2}(?:\.[0-9+]+)?$")
RE_LISTE_CMD = re.compile(r"^D-(\d{2})\d{2}$")


class ErreurExtraction(Exception):
    pass


def lire_entrees(chemin: Path, cmd: str) -> list[list[str]]:
    texte = chemin.read_bytes().decode("cp1252")
    entrees: list[list[str]] = []
    for n, ligne in enumerate(csv.reader(texte.splitlines(), delimiter=";"), start=1):
        if not any(v.strip() for v in ligne):
            continue
        code = ligne[0].strip()
        libelle = " ".join(ligne[1].split()) if len(ligne) == 2 else ""
        if not RE_CODE.match(code) or not libelle:
            raise ErreurExtraction(f"{chemin.name}, ligne {n} : ligne illisible {ligne}")
        entrees.append([cmd, code, libelle])
    if not entrees:
        raise ErreurExtraction(f"{chemin.name} : aucun diagnostic d'entrée lu")
    doublons = sorted(c for c, k in Counter(e[1] for e in entrees).items() if k > 1)
    if doublons:
        raise ErreurExtraction(f"{chemin.name} : codes en double {doublons[:10]}")
    return entrees


def verifier(entrees: list[list[str]]) -> None:
    """Les codes des listes D-CCnn sont tous des diagnostics d'entrée de la CMD CC."""
    if not DIAGNOSTICS.exists():
        raise ErreurExtraction(f"{DIAGNOSTICS.relative_to(RACINE)} absent : lancer d'abord scripts/build_data.py")
    jeu = json.loads(DIAGNOSTICS.read_text(encoding="utf-8"))
    i_liste, i_code = jeu["colonnes"].index("Liste"), jeu["colonnes"].index("Code")
    des_listes = {(m.group(1), v[i_code]) for v in jeu["valeurs"] if (m := RE_LISTE_CMD.match(v[i_liste]))}
    absents = sorted(des_listes - {(e[0], e[1]) for e in entrees})
    if absents:
        raise ErreurExtraction(f"codes des listes D-CCnn absents des diagnostics d'entrée de leur CMD (CMD, code) {absents[:10]}")


def main() -> None:
    sources = sorted(c for c in DOSSIER.iterdir() if RE_FICHIER.match(c.name)) if DOSSIER.is_dir() else []
    try:
        if not sources:
            raise ErreurExtraction(f"aucun fichier « Diagnostics d entrée dans la CMD n°XX.csv » dans {DOSSIER.relative_to(RACINE)}")
        valeurs = []
        for chemin in sources:
            valeurs += lire_entrees(chemin, RE_FICHIER.match(chemin.name).group(1))
        verifier(valeurs)
    except ErreurExtraction as e:
        sys.exit(f"Extraction impossible : {e}")
    donnees = {
        "millesime": min(millesime(c) for c in sources),
        "colonnes": ["CMD", "Code", "Libellé"],
        "valeurs": valeurs,
    }
    CIBLE.write_text(json.dumps(donnees, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{CIBLE.relative_to(RACINE)} : {len(valeurs)} diagnostics d'entrée ({len(sources)} CMD)")


if __name__ == "__main__":
    main()
