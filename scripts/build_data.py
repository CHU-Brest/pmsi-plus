"""Convertit les référentiels xlsx de data/ en JSON pour le site statique.

Usage :

    pip install -r scripts/requirements.txt
    python scripts/build_data.py

Un seul rôle : lire chaque xlsx déclaré dans JEUX et écrire son JSON dans
docs/assets/data/<theme>/<fichier>.json. Seul openpyxl est nécessaire pour
lire le xlsx, et rien d'autre que la bibliothèque standard pour écrire le
JSON.

Remplacer un xlsx dans data/, relancer ce script, committer le xlsx et le
JSON regénéré : c'est tout ce qu'il faut pour mettre à jour un référentiel.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_DONNEES = RACINE / "data"
DOSSIER_SORTIE = RACINE / "docs" / "assets" / "data"


@dataclass(frozen=True)
class Jeu:
    theme: str  # sous-dossier commun à data/<theme>/ et docs/assets/data/<theme>/
    fichier: str  # nom du xlsx dans data/<theme>/


# La seule liste à tenir à jour : ajouter un référentiel, c'est ajouter une
# ligne ici (et la déclarer dans assets/js/registry.js côté site).
JEUX: tuple[Jeu, ...] = (
    Jeu("intox", "medicaments.xlsx"),
    Jeu("intox", "substances.xlsx"),
    Jeu("germes", "germes.xlsx"),
    Jeu("actes", "actes.xlsx"),
    Jeu("contextes", "contextes.xlsx"),
    Jeu("acronymes", "acronymes.xlsx"),
    Jeu("groupage", "diagnostics.xlsx"),
    Jeu("groupage", "actes.xlsx"),
)

# Colonnes techniques dont un null xlsx doit se lire comme une chaîne vide et
# non comme une absence de valeur : xlsxwriter ne distingue pas une cellule
# vide d'une cellule nulle, donc le comblement se fait à la lecture.
COLONNES_TEXTE_VIDE_SI_NULLE = {"_caracteristiques"}


def _valeur(v: object) -> object:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def lire(chemin: Path) -> list[dict]:
    """Une ligne par ligne non vide de la feuille active, clefs = en-têtes."""
    classeur = load_workbook(chemin, read_only=True, data_only=True)
    try:
        feuille = classeur.active
        lignes = feuille.iter_rows(values_only=True)
        entetes = [str(c).strip() if c is not None else "" for c in next(lignes)]
        resultat = []
        for ligne in lignes:
            if all(v is None for v in ligne):
                continue
            enregistrement = {}
            for entete, v in zip(entetes, ligne):
                if entete in COLONNES_TEXTE_VIDE_SI_NULLE and v is None:
                    v = ""
                enregistrement[entete] = _valeur(v)
            resultat.append(enregistrement)
        return resultat
    finally:
        classeur.close()


def millesime(chemin: Path) -> str:
    """Date ISO de la dernière modification *committée* de `chemin`.

    Le mtime du fichier sur disque ne survit pas à un `git clone` : il vaut
    la date du checkout, pas celle de la dernière vraie mise à jour du
    référentiel. `git log` est donc la source de vérité ici. Repli sur la
    date du jour si le fichier n'est pas encore suivi par git (première
    conversion avant le premier commit) ou si git est indisponible.
    """
    try:
        sortie = subprocess.run(
            ["git", "log", "-1", "--format=%aI", "--", str(chemin)],
            cwd=RACINE,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sortie = ""
    return sortie[:10] if sortie else date.today().isoformat()


def convertir(jeu: Jeu) -> None:
    source = DOSSIER_DONNEES / jeu.theme / jeu.fichier
    lignes = lire(source)

    dossier_sortie = DOSSIER_SORTIE / jeu.theme
    dossier_sortie.mkdir(parents=True, exist_ok=True)
    cible = dossier_sortie / f"{source.stem}.json"

    # Format colonnaire (en-têtes une fois + lignes en tableaux) plutôt
    # qu'un objet par ligne : ces jeux répètent jusqu'à 19 clefs identiques
    # sur des milliers de lignes, ce qui gonflait le JSON transféré au
    # navigateur de plus de moitié pour rien. `donnees.js` reconstitue les
    # objets à la volée au chargement, donc rien d'autre ne change côté site.
    colonnes = list(lignes[0].keys()) if lignes else []
    valeurs = [[ligne[c] for c in colonnes] for ligne in lignes]
    payload = {"millesime": millesime(source), "colonnes": colonnes, "valeurs": valeurs}
    cible.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"{cible.relative_to(RACINE)} : {len(lignes)} lignes")


def main() -> None:
    for jeu in JEUX:
        convertir(jeu)


if __name__ == "__main__":
    main()
