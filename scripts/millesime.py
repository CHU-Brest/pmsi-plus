"""Date d'un référentiel, partagée par build_data.py et build_arbre.py.

Bibliothèque standard seulement : chacun des deux scripts garde sa seule
dépendance propre (openpyxl pour l'un, pymupdf pour l'autre).
"""

from __future__ import annotations

import subprocess
from datetime import date
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent


def millesime(chemin: Path) -> str:
    """Date ISO de la dernière modification de `chemin`.

    Le mtime du fichier sur disque ne survit pas à un `git clone` : il vaut
    la date du checkout, pas celle de la dernière vraie mise à jour du
    référentiel. `git log` est donc la source de vérité ici — sauf quand le
    fichier diffère de ce qui est committé : c'est alors la mise à jour en
    cours (fichier remplacé, pas encore committé), datée du jour. Même repli
    si le fichier n'est pas encore suivi par git ou si git est indisponible.
    """

    def git(*arguments: str) -> str:
        return subprocess.run(
            ["git", *arguments, "--", str(chemin)],
            cwd=RACINE,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    try:
        if git("status", "--porcelain"):
            return date.today().isoformat()
        sortie = git("log", "-1", "--format=%aI")
    except (subprocess.CalledProcessError, FileNotFoundError):
        sortie = ""
    return sortie[:10] if sortie else date.today().isoformat()
