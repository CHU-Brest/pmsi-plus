"""Extrait du volume 2 du Manuel des GHM les diagnostics d'entrée des CMD.

Usage :

    pip install -r scripts/requirements.txt
    python scripts/build_entrees.py

Sources : chaque data/groupage/manuel_ghm_volume_2_cmdXX.pdf, la partie du
volume 2 consacrée à la CMD XX, telle que l'ATIH la publie (vol2cmdXX.pdf).
Elle s'ouvre sur les « diagnostics d'entrée dans la CMD » : en DP, ces codes
orientent le séjour vers la CMD. Seule la CMD 14 est reprise : ses listes
D-14xx n'en contiennent qu'une partie, quand les listes D-CCnn des autres
CMD les contiennent tous (vérifié sur les CMD 01 à 03).

Cible : docs/assets/data/groupage/entrees.json, au format des jeux de
build_data.py (colonnes CMD, Code, Libellé), que lit la fiche code.

Le script s'arrête plutôt que de deviner : une section des diagnostics
d'entrée absente ou en double, une ligne de code illisible, un code sans
libellé ou en double, ou un code des listes D-CCnn de la CMD absent de ses
diagnostics d'entrée arrêtent la conversion.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pymupdf

from millesime import millesime

RACINE = Path(__file__).resolve().parent.parent
DOSSIER = RACINE / "data" / "groupage"
CIBLE = RACINE / "docs" / "assets" / "data" / "groupage" / "entrees.json"
# Les listes publiées (build_data.py) : celles d'une CMD, D-CCnn, doivent
# ne contenir que des diagnostics d'entrée de cette CMD.
DIAGNOSTICS = RACINE / "docs" / "assets" / "data" / "groupage" / "diagnostics.json"

RE_FICHIER = re.compile(r"^manuel_ghm_volume_2_cmd(\d{2})\.pdf$")
# Un diagnostic d'entrée : le code, suivi d'un « ! », puis son libellé, sur
# la même ligne ou sur les suivantes.
RE_CODE = re.compile(r"^([A-Z]\d{2}(?:\.[0-9+]+)?)!\s*(.*)$")
RE_RESSEMBLE_A_UN_CODE = re.compile(r"^[A-Z]\d{2}(?:\.[0-9+]*)?\S*$")
# Pieds de page du volume 2, à écarter.
RE_BRUIT = re.compile(r"^(Manuel des GHM|Catégorie majeure de diagnostic|\d{2}-\d+$)")


class ErreurExtraction(Exception):
    pass


def lire_entrees(chemin: Path, cmd: str) -> list[list[str]]:
    with pymupdf.open(chemin) as doc:
        texte = "\n".join(page.get_text() for page in doc)
    debut = f"Diagnostics d'entrée dans la CMD n° {cmd}"
    fin = f"LISTE DES RACINES DE GHM DE LA CMD n° {cmd}"
    if texte.count(debut) != 1:
        raise ErreurExtraction(f"{chemin.name} : « {debut} » trouvé {texte.count(debut)} fois au lieu d'une")
    section = texte.split(debut, 1)[1].split(fin, 1)
    if len(section) != 2:
        raise ErreurExtraction(f"{chemin.name} : « {fin} » introuvable après les diagnostics d'entrée")
    entrees: list[list[str]] = []
    for ligne in section[0].splitlines():
        ligne = ligne.strip()
        if not ligne or RE_BRUIT.match(ligne):
            continue
        m = RE_CODE.match(ligne)
        if m:
            entrees.append([cmd, m.group(1), m.group(2)])
        elif RE_RESSEMBLE_A_UN_CODE.match(ligne):
            raise ErreurExtraction(f"{chemin.name} : ligne de code illisible « {ligne} »")
        elif not entrees:
            raise ErreurExtraction(f"{chemin.name} : texte avant le premier diagnostic d'entrée « {ligne} »")
        else:
            entrees[-1][2] = f"{entrees[-1][2]} {ligne}".strip()
    if not entrees:
        raise ErreurExtraction(f"{chemin.name} : aucun diagnostic d'entrée lu")
    sans_libelle = [e[1] for e in entrees if not e[2]]
    codes = [e[1] for e in entrees]
    doublons = sorted({c for c in codes if codes.count(c) > 1})
    if sans_libelle or doublons:
        raise ErreurExtraction(f"{chemin.name} : codes sans libellé {sans_libelle[:10]}, en double {doublons[:10]}")
    return entrees


def verifier(cmd: str, entrees: list[list[str]]) -> None:
    """Les codes des listes D-CCnn de la CMD sont tous des diagnostics d'entrée."""
    if not DIAGNOSTICS.exists():
        raise ErreurExtraction(f"{DIAGNOSTICS.relative_to(RACINE)} absent : lancer d'abord scripts/build_data.py")
    jeu = json.loads(DIAGNOSTICS.read_text(encoding="utf-8"))
    i_liste, i_code = jeu["colonnes"].index("Liste"), jeu["colonnes"].index("Code")
    re_liste = re.compile(rf"^D-{cmd}\d{{2}}$")
    des_listes = {v[i_code] for v in jeu["valeurs"] if re_liste.match(v[i_liste])}
    absents = sorted(des_listes - {e[1] for e in entrees})
    if absents:
        raise ErreurExtraction(f"CMD {cmd} : codes des listes D-{cmd}xx absents des diagnostics d'entrée {absents[:10]}")


def main() -> None:
    sources = sorted(c for c in DOSSIER.iterdir() if RE_FICHIER.match(c.name))
    try:
        if not sources:
            raise ErreurExtraction(f"aucun fichier manuel_ghm_volume_2_cmdXX.pdf dans {DOSSIER.relative_to(RACINE)}")
        valeurs = []
        for chemin in sources:
            cmd = RE_FICHIER.match(chemin.name).group(1)
            entrees = lire_entrees(chemin, cmd)
            verifier(cmd, entrees)
            valeurs += entrees
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
