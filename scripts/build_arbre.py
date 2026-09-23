"""Extrait l'arbre de décision de la fonction groupage du Manuel des GHM.

Usage :

    pip install -r scripts/requirements.txt
    python scripts/build_arbre.py

Source : data/groupage/manuel_ghm_volume_3.pdf, le volume 3 du Manuel des
GHM tel que livré par l'ATIH. Cible : docs/assets/data/groupage/arbre.json.

L'ATIH ne livre ces arbres qu'en PDF, mais un PDF dessiné, pas scanné :
chaque symbole (DP, A, losange, case de GHM, sablier de renvoi…) y est une
image réutilisée, chaque trait un segment, chaque libellé du texte. Le
script relit donc chaque page comme un schéma :

1. chaque image est reconnue par l'empreinte de ses pixels (SYMBOLES) ;
2. les segments sont raccordés entre eux par leurs extrémités, jamais par
   un simple croisement : deux traits qui se croisent sans que l'un finisse
   sur l'autre ne se rejoignent pas ;
3. depuis chaque sortie d'un test — à droite « condition satisfaite », en
   bas « condition non satisfaite » — le trait est suivi jusqu'à l'entrée
   du symbole suivant ;
4. les libellés en italique sont rattachés au segment qu'ils surmontent ;
5. les sabliers numérotés recousent les pages d'une même CMD.

Le script échoue bruyamment plutôt que de deviner : une image inconnue, un
test sans sortie, un libellé orphelin ou un renvoi de page sans vis-à-vis
arrêtent la conversion en nommant la page et la position en cause. Un
nouveau millésime du manuel qui introduirait un symbole se signale donc
tout seul, au lieu de produire un arbre faux.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "data" / "groupage" / "manuel_ghm_volume_3.pdf"
CIBLE = RACINE / "docs" / "assets" / "data" / "groupage" / "arbre.json"
# Les listes déjà publiées : leurs libellés servent de vocabulaire pour
# recoller un mot coupé en fin de ligne (« Accouchem » / « ent »).
LISTES_PUBLIEES = [
    RACINE / "docs" / "assets" / "data" / "groupage" / "diagnostics.json",
    RACINE / "docs" / "assets" / "data" / "groupage" / "actes.json",
]

# Tolérance de raccord entre deux traits, en points PDF.
TOL = 1.6
# Écart maximal entre l'extrémité d'un trait et l'axe du symbole qu'il aborde.
AXE = 5.0
# Page de l'orientation vers les CM/CMD, dessinée en vecteurs et non avec
# les symboles des autres pages : transcrite à la main, cf. ORIENTATION.
PAGE_ORIENTATION = 9
PREMIERE_PAGE_CMD = 10


# ==== Symboles ====


@dataclass(frozen=True)
class Symbole:
    genre: str  # test, critere, sans_relation, gnn, ghm, erreur, renvoi_page, renvoi_cmd, fleche, ignore
    code: str | None = None  # DP, A, D2… pour un test ; couleur pour un GHM ; sens pour une flèche
    port_bas: bool = False  # le symbole a une sortie « condition non satisfaite »


# Empreinte (sha1 des pixels décodés, 10 premiers caractères) → symbole.
# Deux encodages différents d'un même dessin ont la même empreinte. Les
# symboles des pages de légende (5 à 8) y sont aussi, pour mémoire.
SYMBOLES: dict[str, Symbole] = {
    # Tests sur les données médicales (volume 3, page 6)
    "62661bb4eb": Symbole("test", "DP", True),
    "25ee14bcb5": Symbole("test", "DP", True),
    "d19f857fb6": Symbole("test", "DP"),
    "0ec110cedc": Symbole("test", "DP"),
    "c6b124d724": Symbole("test", "DR", True),
    "660dce37e2": Symbole("test", "DR"),
    "be47ad7541": Symbole("test", "DAS", True),
    "7acceeb81f": Symbole("test", "DAS"),
    "5114d91f53": Symbole("test", "D", True),
    "0a7e14408b": Symbole("test", "D"),
    "1d6657084a": Symbole("test", "D2", True),
    "21da46779f": Symbole("test", "D2"),
    "d618c50b6d": Symbole("test", "Dtous"),
    "8a0612388d": Symbole("test", "A", True),
    "ef464c2178": Symbole("test", "A", True),
    "434ef3049b": Symbole("test", "A"),
    "a613bdb16f": Symbole("test", "A"),
    "4d8067dea8": Symbole("test", "A2", True),
    "389522b9e1": Symbole("test", "A2"),
    "d420de4966": Symbole("test", "Atous", True),
    "d51c476b6c": Symbole("test", "Atous"),
    "0f46729933": Symbole("test", "AG", True),
    "5f362f8612": Symbole("test", "AG", True),
    "975a9445ff": Symbole("test", "AG"),
    "a708c85278": Symbole("test", "DRDP", True),
    "b4e73dd006": Symbole("test", "DRDP"),
    "ca56e95e83": Symbole("test", "DRbarre", True),
    "22148ea103": Symbole("test", "DRbarre", True),
    "a31aa85ae2": Symbole("test", "DRbarre"),
    # Tests sur les données non médicales (page 7) : le texte du losange
    # nomme la donnée testée.
    "550f0d3f80": Symbole("critere", None, True),
    "2c10d35c08": Symbole("critere", None, True),
    "b835a49e44": Symbole("critere", "Inversion", True),
    "f623b7ca3d": Symbole("critere", "Inversion", True),
    # Tests spéciaux (page 8) et groupe du nouveau-né
    "a481d3317b": Symbole("sans_relation"),
    "2856e580ca": Symbole("sans_relation"),
    "abaf1dc978": Symbole("gnn"),
    "ac67e9ec3b": Symbole("gnn"),
    # Groupes (page 5)
    "46df95bf23": Symbole("ghm", None),
    "da966f8e79": Symbole("ghm", "age"),
    "4587879186": Symbole("ghm", "age_gestationnel"),
    "30d70d0689": Symbole("ghm", "age_gestationnel"),
    "a59a99dc8b": Symbole("erreur"),
    "5bb7ef1dcd": Symbole("erreur"),
    # Enchaînements
    "38b3f7828a": Symbole("renvoi_page"),
    "d02411f7e2": Symbole("renvoi_page"),
    "0a1d73fc81": Symbole("renvoi_page"),
    "07a051f70b": Symbole("renvoi_cmd"),
    # Pointes de flèche d'un trait qui en rejoint un autre
    "5b76c510e7": Symbole("fleche", "droite"),
    "03488b97b6": Symbole("fleche", "gauche"),
    "e24361b760": Symbole("fleche", "gauche"),
    # Sans rôle dans l'arbre : case blanche, logo de couverture
    "d60afc3405": Symbole("ignore"),
    "14be8bb9e3": Symbole("ignore"),
}

# Côtés par lesquels le flux entre dans un symbole, et côtés par lesquels il
# en sort. Pour un test : à droite si la condition est satisfaite, en bas
# sinon.
ENTREES = {
    "test": {"haut", "gauche"},
    "critere": {"haut", "gauche"},
    "sans_relation": {"haut"},
    "gnn": {"gauche", "haut"},
    "ghm": {"gauche"},
    "erreur": {"gauche"},
    "renvoi_page": {"haut"},
    "renvoi_cmd": {"haut", "gauche"},
}
SORTIES = {
    "test": {"droite", "bas"},
    "critere": {"droite", "bas"},
    "sans_relation": {"bas"},
    "gnn": {"droite", "bas"},
    "ghm": set(),
    "erreur": set(),
    "renvoi_page": {"bas"},
    "renvoi_cmd": {"droite", "bas"},
}

# Graphies d'une même donnée testée selon les pages.
VARIABLES = {"Age": "Âge"}

RE_LISTE = re.compile(r"\b([AD]-\d{3,4})\b")
RE_GHM = re.compile(r"^\d{2}[A-Z]\d{2}[A-Z0-9]?$")
RE_TITRE = re.compile(r"CATÉGORIE MAJEURE(?: DE DIAGNOSTIC)? N°\s*(\d+)")


class ErreurExtraction(Exception):
    pass


# ==== Primitives d'une page ====


@dataclass
class Rect:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    def contient(self, x: float, y: float, marge: float = 0.0) -> bool:
        return (
            self.x0 - marge <= x <= self.x1 + marge
            and self.y0 - marge <= y <= self.y1 + marge
        )

    def arrondi(self) -> list[float]:
        return [round(self.x0, 1), round(self.y0, 1), round(self.x1, 1), round(self.y1, 1)]


@dataclass
class Segment:
    i: int
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def horizontal(self) -> bool:
        return abs(self.y1 - self.y0) <= 0.5

    @property
    def vertical(self) -> bool:
        return abs(self.x1 - self.x0) <= 0.5

    def extremites(self) -> tuple[tuple[float, float], tuple[float, float]]:
        return (self.x0, self.y0), (self.x1, self.y1)

    def porte(self, x: float, y: float, tol: float = TOL) -> bool:
        """Le point (x, y) est-il sur le segment, à `tol` près ?"""
        if self.horizontal:
            return abs(y - self.y0) <= tol and self.x0 - tol <= x <= self.x1 + tol
        if self.vertical:
            return abs(x - self.x0) <= tol and self.y0 - tol <= y <= self.y1 + tol
        return False


@dataclass
class Texte:
    x0: float
    y0: float
    x1: float
    y1: float
    texte: str
    italique: bool
    gras: bool
    taille: float
    vertical: bool = False

    @property
    def rect(self) -> Rect:
        return Rect(self.x0, self.y0, self.x1, self.y1)


@dataclass
class Objet:
    """Un symbole posé sur la page."""

    id: str
    page: int
    genre: str
    code: str | None
    port_bas: bool
    rect: Rect
    textes: list[Texte] = field(default_factory=list)

    def cote(self, x: float, y: float) -> str:
        """Côté du symbole par lequel arrive un trait qui finit en (x, y)."""
        u = (x - self.rect.cx) / max((self.rect.x1 - self.rect.x0) / 2, 1)
        v = (y - self.rect.cy) / max((self.rect.y1 - self.rect.y0) / 2, 1)
        if abs(v) <= abs(u):
            return "gauche" if u < 0 else "droite"
        return "haut" if v < 0 else "bas"

    def texte(self) -> str:
        lignes = sorted(self.textes, key=lambda t: (round(t.y0), t.x0))
        return " ".join(t.texte for t in lignes)


@dataclass
class Branche:
    libelle: str
    vers: str  # id de l'objet atteint
    fleche: bool  # le trait rejoint sa cible par une pointe de flèche
    y: float  # ordonnée d'arrivée, pour l'ordre des branches
    arrivee: str  # côté d'arrivée sur la cible


@dataclass
class PageLue:
    numero: int
    objets: dict[str, Objet]
    sorties: dict[tuple[str, str], list[Branche]]  # (objet, côté) → cibles
    cmd: str | None
    sous_titre: str | None


def empreinte(doc: pymupdf.Document, xref: int, cache: dict[int, str]) -> str:
    if xref not in cache:
        cache[xref] = hashlib.sha1(pymupdf.Pixmap(doc, xref).samples).hexdigest()[:10]
    return cache[xref]


def lire_textes(page: pymupdf.Page) -> list[Texte]:
    """Une entrée par ligne de texte, les fragments d'une même ligne recollés.

    Le PDF découpe parfois une ligne en plusieurs morceaux (« … de l' »,
    « orbite ») : on les recolle quand ils partagent la ligne de base et se
    touchent presque.
    """
    morceaux: list[Texte] = []
    for bloc in page.get_text("dict")["blocks"]:
        for ligne in bloc.get("lines", []):
            vertical = abs(ligne["dir"][0]) < 0.5
            for s in ligne["spans"]:
                if not s["text"].strip():
                    continue
                police = s["font"]
                morceaux.append(
                    Texte(
                        *s["bbox"],
                        texte=s["text"],
                        italique="Oblique" in police or "Italic" in police,
                        gras="Bold" in police,
                        taille=round(s["size"], 1),
                        vertical=vertical,
                    )
                )
    morceaux.sort(key=lambda t: (round(t.y1), t.x0))
    lignes: list[Texte] = []
    for t in morceaux:
        precedente = next(
            (
                l
                for l in reversed(lignes)
                if not l.vertical
                and not t.vertical
                and abs(l.y1 - t.y1) < 1.0
                and -1.0 <= t.x0 - l.x1 <= 3.5
                and l.italique == t.italique
                and l.gras == t.gras
                and l.taille == t.taille
            ),
            None,
        )
        if precedente is None:
            lignes.append(t)
            continue
        espace = t.x0 - precedente.x1 > 1.0
        precedente.texte += (" " if espace else "") + t.texte
        precedente.x1 = max(precedente.x1, t.x1)
        precedente.y0 = min(precedente.y0, t.y0)
    for l in lignes:
        l.texte = re.sub(r"\s+", " ", l.texte).strip()
    return lignes


def lire_segments(page: pymupdf.Page) -> tuple[list[Segment], list[tuple[str, float, float]]]:
    """Les traits bleus de l'arbre, et les pointes de flèche dessinées en
    vecteurs (deux diagonales qui se rejoignent)."""
    segments: list[Segment] = []
    diagonales: list[tuple[float, float, float, float]] = []
    for dessin in page.get_drawings():
        couleur = dessin.get("color")
        if dessin["type"] != "s" or couleur is None:
            continue
        # Les traits de l'arbre sont bleus ; le noir encadre les titres.
        if not (couleur[2] > 0.9 and couleur[0] < 0.6):
            continue
        for item in dessin["items"]:
            if item[0] != "l":
                continue
            a, b = item[1], item[2]
            if abs(a.x - b.x) > 0.5 and abs(a.y - b.y) > 0.5:
                diagonales.append((a.x, a.y, b.x, b.y))
                continue
            x0, x1 = sorted((a.x, b.x))
            y0, y1 = sorted((a.y, b.y))
            if x1 - x0 < 0.3 and y1 - y0 < 0.3:
                continue
            segments.append(Segment(len(segments), x0, y0, x1, y1))
    # Une pointe vectorielle : deux diagonales partageant une extrémité, la
    # pointe. Son sens se lit de la position des deux autres extrémités.
    pointes: list[tuple[str, float, float]] = []
    prises: set[int] = set()
    for i, d1 in enumerate(diagonales):
        for j in range(i + 1, len(diagonales)):
            if i in prises or j in prises:
                continue
            d2 = diagonales[j]
            for px, py, ax, ay in ((d1[0], d1[1], d1[2], d1[3]), (d1[2], d1[3], d1[0], d1[1])):
                for qx, qy, bx, by in ((d2[0], d2[1], d2[2], d2[3]), (d2[2], d2[3], d2[0], d2[1])):
                    if i in prises:
                        continue
                    if abs(px - qx) < 0.8 and abs(py - qy) < 0.8:
                        mx, my = (ax + bx) / 2, (ay + by) / 2
                        if abs(mx - px) > abs(my - py):
                            sens = "droite" if px > mx else "gauche"
                        else:
                            sens = "bas" if py > my else "haut"
                        pointes.append((sens, px, py))
                        prises.update((i, j))
    restantes = [d for k, d in enumerate(diagonales) if k not in prises]
    if restantes:
        raise ErreurExtraction(
            f"page {page.number + 1} : trait(s) oblique(s) hors pointe de flèche "
            f"{[[round(v, 1) for v in d] for d in restantes]}"
        )
    return segments, pointes


def decouper(segments: list[Segment], objets: list[Objet]) -> list[Segment]:
    """Coupe un trait dessiné d'un seul tenant sous un symbole (page 42 : le
    trait qui descend du sablier passe derrière le losange « DS ») : il
    aboutit alors à l'entrée du symbole et repart de sa sortie, comme s'il
    avait été dessiné en deux morceaux."""
    resultat: list[Segment] = []
    file = list(segments)
    while file:
        s = file.pop()
        coupe = None
        for o in objets:
            r = o.rect
            if s.vertical and abs(s.x0 - r.cx) <= AXE and s.y0 < r.y0 - 1 and s.y1 > r.y1 + 1:
                coupe = (Segment(0, s.x0, s.y0, s.x1, r.y0 + 1), Segment(0, s.x0, r.y1 - 1, s.x1, s.y1))
            elif s.horizontal and abs(s.y0 - r.cy) <= AXE and s.x0 < r.x0 - 1 and s.x1 > r.x1 + 1:
                coupe = (Segment(0, s.x0, s.y0, r.x0 + 1, s.y1), Segment(0, r.x1 - 1, s.y0, s.x1, s.y1))
            if coupe:
                break
        if coupe:
            file.extend(coupe)
        else:
            resultat.append(s)
    resultat.sort(key=lambda s: (s.x0, s.y0, s.x1, s.y1))
    for i, s in enumerate(resultat):
        s.i = i
    return resultat


def prolonger_pointes(
    segments: list[Segment], pointes: list[tuple[str, float, float]]
) -> list[Segment]:
    """Une pointe de flèche vectorielle s'arrête parfois à quelques points
    du trait qu'elle rejoint (page 32) : on comble l'écart par un segment,
    dans le sens de la pointe, jusqu'au premier trait rencontré."""
    ajouts = []
    for sens, px, py in pointes:
        porteurs = [s for s in segments if s.porte(px, py)]
        if any(
            s.porte(x, y) for s in segments for p in porteurs for (x, y) in p.extremites()
            if s not in porteurs and abs(x - px) <= TOL and abs(y - py) <= TOL
        ):
            continue
        dx, dy = {"haut": (0, -1), "bas": (0, 1), "gauche": (-1, 0), "droite": (1, 0)}[sens]
        for pas in range(1, 13):
            x, y = px + dx * pas, py + dy * pas
            if any(s.porte(x, y, 0.6) for s in segments if s not in porteurs):
                x0, x1 = sorted((px, x))
                y0, y1 = sorted((py, y))
                ajouts.append(Segment(len(segments) + len(ajouts), x0, y0, x1, y1))
                break
    return ajouts


def regrouper(lignes: list[Texte]) -> list[list[Texte]]:
    """Recolle en paragraphes les lignes d'un libellé sur plusieurs lignes :
    interligne régulier, lignes qui se chevauchent horizontalement (certains
    libellés sont centrés, leur marge gauche varie de quelques points)."""
    paragraphes: list[list[Texte]] = []
    for l in lignes:
        suite = next(
            (
                p
                for p in paragraphes
                if not l.vertical
                and not p[-1].vertical
                and abs(p[-1].x0 - l.x0) < 12
                and min(p[-1].x1, l.x1) - max(p[-1].x0, l.x0) > 2
                and 0 < l.y0 - p[-1].y0 < 11.5
            ),
            None,
        )
        if suite is None:
            paragraphes.append([l])
        else:
            suite.append(l)
    return paragraphes


def mots(texte: str) -> list[str]:
    return re.findall(r"[\wÀ-ÿ'’]+", texte.lower())


def recoller(lignes: list[str], vocabulaire: Vocabulaire) -> str:
    """Rejoint les lignes d'un paragraphe. Un mot coupé faute de place
    (« Accouchem » / « ent ») est recollé sans espace quand le mot entier
    figure dans le manuel et qu'aucune des deux moitiés n'est un mot des
    libellés de listes."""
    texte = lignes[0]
    for suite in lignes[1:]:
        fin = (mots(texte)[-1:] or [""])[0]
        debut = (mots(suite)[:1] or [""])[0]
        if (
            fin
            and debut
            and fin + debut in vocabulaire.manuel
            and fin not in vocabulaire.listes
            and debut not in vocabulaire.listes
        ):
            texte += suite
        else:
            texte += " " + suite
    return texte


@dataclass
class Vocabulaire:
    manuel: set[str]  # tous les mots du PDF, fragments compris
    listes: set[str]  # les mots des libellés de listes publiés, tous entiers


# ==== Lecture d'une page ====


def lire_page(
    doc: pymupdf.Document, numero: int, cache: dict[int, str], vocabulaire: Vocabulaire
) -> PageLue:
    page = doc[numero - 1]
    objets: dict[str, Objet] = {}
    fleches: list[tuple[str, float, float]] = []
    inconnues = []
    for info in page.get_image_info(xrefs=True):
        h = empreinte(doc, info["xref"], cache)
        symbole = SYMBOLES.get(h)
        r = Rect(*info["bbox"])
        if symbole is None:
            inconnues.append((h, r.arrondi()))
            continue
        if symbole.genre == "ignore":
            continue
        if symbole.genre == "fleche":
            fleches.append((symbole.code, r.cx, r.cy))
            continue
        oid = f"p{numero}-{len(objets) + 1}"
        objets[oid] = Objet(oid, numero, symbole.genre, symbole.code, symbole.port_bas, r)
    if inconnues:
        raise ErreurExtraction(
            f"page {numero} : image(s) inconnue(s) {inconnues} — à ajouter à SYMBOLES"
        )

    segments, pointes = lire_segments(page)
    fleches.extend(pointes)
    segments.extend(prolonger_pointes(segments, pointes))
    segments = decouper(segments, list(objets.values()))
    textes = lire_textes(page)

    # -- Textes : en-tête, intérieur des symboles, libellés des traits --
    cmd = sous_titre = None
    libres: list[Texte] = []
    for t in textes:
        if t.taille >= 13:
            m = RE_TITRE.search(t.texte)
            if not m:
                raise ErreurExtraction(f"page {numero} : titre inattendu « {t.texte} »")
            cmd = m.group(1).zfill(2)
            continue
        if t.y1 < 40 or t.y0 > 790:  # numéro de page, pied de page
            continue
        if t.taille >= 9.5 and not t.gras and not t.italique:
            sous_titre = t.texte
            continue
        porteur = None
        if not t.italique:
            porteur = next(
                (o for o in objets.values() if o.rect.contient(t.rect.cx, t.rect.cy, 1.0)),
                None,
            )
        if porteur is not None:
            porteur.textes.append(t)
        else:
            libres.append(t)
    orphelins = [t for t in libres if not t.italique]
    if orphelins:
        raise ErreurExtraction(
            f"page {numero} : texte(s) hors symbole et hors libellé "
            f"{[(t.texte, t.rect.arrondi()) for t in orphelins]}"
        )

    def dans_un_objet(x: float, y: float) -> bool:
        return any(o.rect.contient(x, y, 1.0) for o in objets.values())

    # -- Raccords entre segments : une extrémité posée sur un autre trait,
    # hors de tout symbole (dans un symbole, c'est une entrée ou une sortie,
    # pas un embranchement) --
    voisins: dict[int, set[int]] = defaultdict(set)
    for s in segments:
        for x, y in s.extremites():
            if dans_un_objet(x, y):
                continue
            for autre in segments:
                if autre.i != s.i and autre.porte(x, y):
                    voisins[s.i].add(autre.i)
                    voisins[autre.i].add(s.i)

    # -- Accroches : extrémité de segment → (objet, côté). Un trait aborde
    # toujours un symbole dans l'axe : à mi-hauteur par la gauche ou la
    # droite, au milieu par le haut ou le bas. Une extrémité qui tombe dans
    # le cadre d'une image mais hors de ses axes (le coin d'une case de GHM
    # frôlée par un trait voisin) n'est pas une accroche. --
    accroches: dict[int, list[tuple[str, str, float, float]]] = defaultdict(list)
    for s in segments:
        for x, y in s.extremites():
            for o in objets.values():
                if not o.rect.contient(x, y, 2.0):
                    continue
                cote = o.cote(x, y)
                ecart = abs(y - o.rect.cy) if cote in ("gauche", "droite") else abs(x - o.rect.cx)
                if ecart <= AXE:
                    accroches[s.i].append((o.id, cote, x, y))

    def fleche_en(x: float, y: float) -> bool:
        return any(abs(fx - x) <= 3.5 and abs(fy - y) <= 3.5 for _, fx, fy in fleches)

    # -- Libellés : un paragraphe en italique posé sur un trait --
    paragraphes = regrouper(sorted(libres, key=lambda t: (t.y0, t.x0)))
    libelles: dict[int, list[tuple[float, float, str]]] = defaultdict(list)
    for par in paragraphes:
        tete = par[0]
        texte = recoller([l.texte for l in par], vocabulaire)
        if tete.vertical:
            candidats = [
                s
                for s in segments
                if s.vertical
                and tete.x0 - 8 <= s.x0 <= tete.x1 + 8
                and s.y0 - 2 <= tete.y1
                and s.y1 + 2 >= tete.y0
            ]
            candidats.sort(key=lambda s: abs(s.x0 - tete.x0))
        else:
            candidats = [
                s
                for s in segments
                if s.horizontal
                and tete.y1 - 3.0 <= s.y0 <= tete.y1 + 4.5
                and s.x0 - 4 <= tete.x0 <= s.x1 - 2
            ]
            candidats.sort(key=lambda s: (abs(s.y0 - tete.y1), tete.x0 - s.x0))
        if not candidats:
            raise ErreurExtraction(
                f"page {numero} : libellé sans trait « {texte} » en {tete.rect.arrondi()}"
            )
        libelles[candidats[0].i].append((tete.y0, tete.x0, texte))

    # -- Suivi des traits depuis chaque sortie de symbole --
    sorties: dict[tuple[str, str], list[Branche]] = {}
    places: set[int] = set()
    for o in objets.values():
        for cote in sorted(SORTIES[o.genre]):
            depart = sorted(
                {
                    s.i
                    for s in segments
                    for (oid, c, _, _) in accroches[s.i]
                    if oid == o.id and c == cote
                }
            )
            if not depart:
                continue
            branches, vus = suivre(o.id, depart, segments, voisins, accroches, objets, libelles, fleche_en)
            places |= vus
            sorties[(o.id, cote)] = branches

    # Chaque libellé doit avoir servi à une branche, sinon il décrit un
    # trait qu'aucune sortie n'atteint.
    perdus = [t for i, ts in libelles.items() if i not in places for t in ts]
    if perdus:
        raise ErreurExtraction(f"page {numero} : libellé(s) sur un trait isolé {perdus}")

    return PageLue(numero, objets, sorties, cmd, sous_titre)


def suivre(origine, depart, segments, voisins, accroches, objets, libelles, fleche_en):
    """Parcourt le réseau de traits depuis une sortie et rend chaque entrée
    de symbole atteinte, avec le libellé propre à son chemin.

    Le parcours ne traverse jamais un symbole : les raccords situés dans un
    symbole ont été écartés en amont, si bien qu'un trait qui y aboutit
    n'y a plus de voisin.
    """
    parent: dict[int, int | None] = {i: None for i in depart}
    file = deque(depart)
    cibles: dict[str, tuple[int, str, float, float]] = {}
    while file:
        i = file.popleft()
        for oid, cote, x, y in accroches[i]:
            if oid == origine:
                continue
            o = objets[oid]
            if cote in ENTREES[o.genre]:
                cibles.setdefault(oid, (i, cote, x, y))
            elif cote not in SORTIES[o.genre]:
                raise ErreurExtraction(f"{oid} : trait accroché par le côté {cote}, ni entrée ni sortie")
        for j in sorted(voisins[i]):
            if j not in parent:
                parent[j] = i
                file.append(j)

    chemins: dict[str, list[int]] = {}
    for oid, (i, _, _, _) in cibles.items():
        chemin = []
        k: int | None = i
        while k is not None:
            chemin.append(k)
            k = parent[k]
        chemins[oid] = chemin[::-1]
    usage: dict[int, int] = defaultdict(int)
    for chemin in chemins.values():
        for i in chemin:
            usage[i] += 1

    branches = []
    for oid, (i, cote, x, y) in cibles.items():
        chemin = chemins[oid]
        # Libellé d'une branche : ceux des traits qui ne mènent qu'à elle,
        # précédés de ceux du tronc commun à toutes les branches.
        propres = sorted(t for k in chemin if usage[k] == 1 for t in libelles.get(k, []))
        tronc = sorted(
            t for k in chemin if usage[k] == len(cibles) > 1 for t in libelles.get(k, [])
        )
        libelle = " ".join(t for _, _, t in tronc + propres)
        fleche = any(fleche_en(px, py) for k in chemin for (px, py) in segments[k].extremites())
        branches.append(Branche(libelle, oid, fleche, y, cote))
    branches.sort(key=lambda b: (b.y, b.vers))
    return branches, set(parent)


# ==== Orientation (page 9) ====

# La page 9 n'emploie aucun des symboles des autres pages (hexagone, cadres
# de texte, triangles vectoriels) : six étapes, transcrites ici. Chaque
# libellé est vérifié mot pour mot contre le texte de la page, si bien
# qu'une page 9 remaniée dans un prochain manuel arrête le script.
ORIENTATION = [
    # (forme dessinée, texte du test, libellé du trait « oui », CM/CMD visée)
    ("critere", "Type d’hospitalisation", "Séance", "28"),
    ("A", "A", "Spécifique des groupes de transplantation", "27"),
    ("cadre", "DP = traumatisme et 2 diagnostics traumatisme sur 2 sites différents", "Traumatisme multiple grave", "26"),
    (
        "cadre",
        "[DP=Infection VIH et DAS diagnostic lié au VIH] ou [DP=diagnostic lié au VIH et DAS infection VIH]",
        "Infection par le VIH",
        "25",
    ),
    (
        "cadre",
        "Âge < 8 jours ou [ Mode d’entrée 7 Et (Poids < 2500g ou Âge < 29jours) ]",
        "Nouveau-nés et affections de la période périnatale",
        "15",
    ),
    ("DP", "DP", "Détermination de la CMD", None),
]


def lire_orientation(doc: pymupdf.Document) -> list[dict]:
    texte = re.sub(r"\s+", " ", doc[PAGE_ORIENTATION - 1].get_text())
    etapes = []
    for forme, test, libelle, cmd in ORIENTATION:
        for morceau in (test, libelle):
            if morceau not in texte:
                raise ErreurExtraction(
                    f"page {PAGE_ORIENTATION} : « {morceau} » introuvable — orientation remaniée ?"
                )
        etapes.append({"forme": forme, "test": test, "libelle": libelle, "cmd": cmd})
    return etapes


# ==== Assemblage ====


def decrire_ghm(o: Objet) -> dict:
    racine = [t for t in o.textes if t.gras and t.taille >= 9.5]
    suffixes = [t for t in o.textes if t.gras and t.taille < 9.5]
    autres = [t for t in o.textes if not t.gras]
    if len(racine) != 1 or not RE_GHM.match(racine[0].texte) or autres:
        raise ErreurExtraction(f"{o.id} : case de GHM illisible {[t.texte for t in o.textes]}")
    haut = [t.texte for t in suffixes if t.rect.cy < o.rect.cy]
    bas = [t.texte for t in suffixes if t.rect.cy >= o.rect.cy]
    if len(haut) > 1 or len(bas) > 1:
        raise ErreurExtraction(f"{o.id} : plusieurs lettres dans une case de GHM {[t.texte for t in suffixes]}")
    return {
        "racine": racine[0].texte,
        "haut": haut[0] if haut else None,
        "bas": bas[0] if bas else None,
        "couleur": o.code,
    }


def listes_de(libelle: str) -> list[str]:
    return list(dict.fromkeys(RE_LISTE.findall(libelle)))


def vocabulaire_de(doc: pymupdf.Document) -> Vocabulaire:
    manuel: set[str] = set()
    for page in doc:
        manuel.update(mots(page.get_text()))
    listes: set[str] = set()
    for chemin in LISTES_PUBLIEES:
        if chemin.exists():
            jeu = json.loads(chemin.read_text(encoding="utf-8"))
            i = jeu["colonnes"].index("Libellé liste")
            for ligne in jeu["valeurs"]:
                listes.update(mots(str(ligne[i])))
    return Vocabulaire(manuel | listes, listes)


def millesime(chemin: Path) -> str:
    """Date ISO du dernier commit touchant `chemin`, comme build_data.py."""
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


def construire(doc: pymupdf.Document) -> dict:
    cache: dict[int, str] = {}
    vocabulaire = vocabulaire_de(doc)
    version = next(
        (m.group(0) for m in [re.search(r"Manuel des GHM Version \d{4}", doc[PAGE_ORIENTATION - 1].get_text())] if m),
        None,
    )

    # -- Lecture des pages, rattachées à leur CMD --
    pages: list[PageLue] = []
    cmd_courante = None
    titres: dict[str, str] = {}
    for numero in range(PREMIERE_PAGE_CMD, doc.page_count + 1):
        lue = lire_page(doc, numero, cache, vocabulaire)
        if not lue.objets:
            continue
        if lue.cmd:
            cmd_courante = lue.cmd
            if lue.sous_titre:
                titres[lue.cmd] = lue.sous_titre
        if cmd_courante is None:
            raise ErreurExtraction(f"page {numero} : arbre avant tout titre de CMD")
        lue.cmd = cmd_courante
        pages.append(lue)

    objets: dict[str, Objet] = {oid: o for p in pages for oid, o in p.objets.items()}
    cmd_de = {oid: p.cmd for p in pages for oid in p.objets}
    sorties = {cle: b for p in pages for cle, b in p.sorties.items()}

    # -- Renvois de page : un sablier numéroté en bas d'une page (entrée par
    # le haut) reprend sur le sablier de même numéro de la page suivante de
    # la même CMD (sortie par le bas). --
    entrees_page: dict[tuple[str, int, str], str] = {}  # (cmd, page, numéro) → objet
    for oid, o in objets.items():
        if o.genre == "renvoi_page" and (oid, "bas") in sorties:
            entrees_page[(cmd_de[oid], o.page, o.texte())] = oid

    def entree_de_page(oid: str) -> str:
        o = objets[oid]
        numero = o.texte()
        candidates = sorted(
            (page, eid)
            for (cmd, page, n), eid in entrees_page.items()
            if cmd == cmd_de[oid] and n == numero and page > o.page
        )
        if not candidates:
            raise ErreurExtraction(f"{oid} : renvoi de page « {numero} » sans suite")
        return candidates[0][1]

    def suite_de_page(oid: str) -> Branche:
        eid = entree_de_page(oid)
        cible = sorties[(eid, "bas")]
        if len(cible) != 1:
            raise ErreurExtraction(f"{eid} : un renvoi de page doit mener à un seul symbole")
        return cible[0]

    # -- Renvois vers une CM/CMD : celui qui nomme une entrée de la même
    # CMD (CM15 en bas de la page 15, CM15 en tête de la page 16) s'y
    # raccorde ; les autres sont des sorties vers une autre CMD. --
    entrees_cmd: dict[tuple[str, str], str] = {}
    for oid, o in objets.items():
        if o.genre == "renvoi_cmd" and any((oid, c) in sorties for c in SORTIES["renvoi_cmd"]):
            entrees_cmd[(cmd_de[oid], o.texte())] = oid

    def sortie_unique(oid: str) -> Branche:
        cibles = [b for c in sorted(SORTIES[objets[oid].genre]) for b in sorties.get((oid, c), [])]
        if len(cibles) != 1:
            raise ErreurExtraction(f"{oid} : une seule sortie attendue, {len(cibles)} trouvée(s)")
        return cibles[0]

    def resoudre(b: Branche) -> Branche:
        """Suit les renvois jusqu'au symbole qui porte vraiment la suite. La
        branche rendue garde le libellé d'origine, mais arrive comme le
        dernier trait suivi."""
        vus = set()
        fleche = b.fleche
        while True:
            oid = b.vers
            if oid in vus:
                raise ErreurExtraction(f"{oid} : boucle de renvois")
            vus.add(oid)
            o = objets[oid]
            cle = (cmd_de[oid], o.texte())
            if o.genre == "renvoi_page" and (oid, "bas") not in sorties:
                suite = suite_de_page(oid)
            elif o.genre == "renvoi_page":
                suite = sortie_unique(oid)
            elif o.genre == "renvoi_cmd" and cle in entrees_cmd and oid != entrees_cmd[cle]:
                suite = sortie_unique(entrees_cmd[cle])
            elif o.genre == "renvoi_cmd" and oid in entrees_cmd.values():
                suite = sortie_unique(oid)
            else:
                return Branche(b.libelle, oid, fleche, b.y, b.arrivee)
            fleche = fleche or suite.fleche
            b = Branche(b.libelle, suite.vers, fleche, suite.y, suite.arrivee)

    def colonne(branches: list[Branche]) -> tuple[list[Branche], Branche | None]:
        restes = [b for b in branches if b.arrivee == "haut" and not b.libelle]
        if len(restes) != 1:
            return branches, None
        return [b for b in branches if b is not restes[0]], restes[0]

    # -- Nœuds de l'arbre publié --
    noeuds: dict[str, dict] = {}
    aretes: list[Arete] = []

    def lien(de: str, b: Branche, role: str) -> dict:
        arrivee = resoudre(b)
        aretes.append(Arete(de, arrivee.vers, arrivee.fleche, role, arrivee.arrivee))
        return {"vers": arrivee.vers}

    for oid, o in objets.items():
        if o.genre in ("renvoi_page",) or oid in entrees_cmd.values():
            continue
        base = {"page": o.page, "cmd": cmd_de[oid]}
        if o.genre == "ghm":
            noeuds[oid] = {"genre": "ghm", **decrire_ghm(o), **base}
        elif o.genre == "erreur":
            racine = o.texte()
            if not RE_GHM.match(racine):
                raise ErreurExtraction(f"{oid} : groupe d'erreur illisible « {racine} »")
            noeuds[oid] = {"genre": "erreur", "racine": racine, **base}
        elif o.genre == "renvoi_cmd":
            if (cmd_de[oid], o.texte()) in entrees_cmd:
                continue  # raccordé à une entrée de la même CMD
            noeuds[oid] = {"genre": "renvoi", "texte": o.texte(), **base}
        elif o.genre in ("sans_relation", "gnn"):
            # Une seule suite, par le bas ou par la droite selon la page.
            cibles = [b for c in sorted(SORTIES[o.genre]) for b in sorties.get((oid, c), [])]
            if len(cibles) != 1:
                raise ErreurExtraction(f"{oid} : {o.genre} avec {len(cibles)} sortie(s)")
            noeud = {"genre": o.genre, **base}
            if cibles[0].libelle:
                noeud["libelle"] = cibles[0].libelle
            noeud["suite"] = lien(oid, cibles[0], "suite")
            noeuds[oid] = noeud
        elif o.genre in ("test", "critere"):
            oui = sorties.get((oid, "droite"), [])
            non = sorties.get((oid, "bas"), [])
            # Le petit rond sous le symbole annonce la sortie « non », mais
            # c'est le trait qui fait foi : quelques symboles sans rond en
            # ont une (page 11, aphérèse sanguine).
            if len(non) > 1 or (o.port_bas and not non):
                raise ErreurExtraction(f"{oid} ({o.code}) : {len(non)} sortie(s) « non » en {o.rect.arrondi()}")
            sinon = non[0] if non else None
            if not oui and o.code == "DRDP" and sinon:
                # Inversion DP/DR sans sortie à droite (page 14) : l'inversion
                # s'applique s'il y a lieu, et le parcours continue dessous.
                noeuds[oid] = {"genre": "inversion", **base, "suite": lien(oid, sinon, "suite")}
                continue
            if not oui:
                raise ErreurExtraction(f"{oid} ({o.code}) : aucune sortie « oui » en {o.rect.arrondi()}")
            if sinon is None and len(oui) > 1:
                # Un test sans sortie basse qui dessert plusieurs cibles :
                # une colonne de cas, examinés de haut en bas. Le trait qui
                # poursuit la colonne sans libellé, jusqu'à un symbole
                # atteint par le haut, porte le cas « aucun ».
                oui, sinon = colonne(oui)
                # La colonne peut se poursuivre sur la page suivante : le
                # sablier d'arrivée dessert alors lui-même plusieurs cas
                # (page 21 → 22 → 23 pour les DP de la CMD 01).
                while (
                    sinon is not None
                    and objets[sinon.vers].genre == "renvoi_page"
                    and (sinon.vers, "bas") not in sorties
                    and len(sorties[(entree_de_page(sinon.vers), "bas")]) > 1
                ):
                    suite, sinon = colonne(sorties[(entree_de_page(sinon.vers), "bas")])
                    oui = oui + suite
            sans_libelle = [b for b in oui if not b.libelle]
            if len(oui) > 1 and sans_libelle:
                raise ErreurExtraction(
                    f"{oid} ({o.code}) : branche(s) sans libellé parmi {len(oui)} "
                    f"{[b.vers for b in sans_libelle]}"
                )
            noeud = {"genre": o.genre, **base}
            if o.genre == "test":
                noeud["symbole"] = o.code
            else:
                noeud["variable"] = (
                    "Inversion DP/DR" if o.code == "Inversion" else VARIABLES.get(o.texte(), o.texte())
                )
            noeud["branches"] = [
                {"libelle": b.libelle, "listes": listes_de(b.libelle), **lien(oid, b, "oui")}
                for b in oui
            ]
            noeud["sinon"] = lien(oid, sinon, "non") if sinon else None
            noeuds[oid] = noeud
        else:
            raise ErreurExtraction(f"{oid} : genre {o.genre} non géré")

    verifier_sans_boucle(noeuds)

    # -- Racine de chaque CMD : le seul nœud de sa première page que rien
    # n'atteint. --
    atteints = {a.vers for a in aretes}
    cmds = []
    for cmd in dict.fromkeys(p.cmd for p in pages):
        ses_pages = [p.numero for p in pages if p.cmd == cmd]
        racines = [
            nid
            for nid, n in noeuds.items()
            if n["cmd"] == cmd and nid not in atteints and n["page"] == ses_pages[0]
        ]
        if len(racines) != 1:
            raise ErreurExtraction(f"CMD {cmd} : {len(racines)} racine(s) {racines}")
        orphelins = [
            nid for nid, n in noeuds.items() if n["cmd"] == cmd and nid not in atteints and nid != racines[0]
        ]
        if orphelins:
            raise ErreurExtraction(f"CMD {cmd} : nœud(s) que rien n'atteint {orphelins}")
        cmds.append({"cmd": cmd, "titre": titres.get(cmd), "pages": ses_pages, "racine": racines[0]})

    # -- Renvois internes : un nœud atteint par plusieurs traits n'est
    # dessiné qu'à un endroit ; les autres traits le « rejoignent ». Le
    # trait qui le porte est, dans l'ordre : celui qui n'arrive pas par une
    # pointe de flèche, celui qui arrive par le haut (la colonne qui
    # descend), puis le premier rencontré en descendant l'arbre. Les
    # feuilles (GHM, erreurs, renvois) n'ont pas de suite : elles sont
    # simplement répétées. --
    ordre = ordre_de_parcours(noeuds, [c["racine"] for c in cmds])
    entrants: dict[str, list[Arete]] = defaultdict(list)
    for a in aretes:
        entrants[a.vers].append(a)
    for nid, liste in entrants.items():
        if noeuds[nid]["genre"] in ("ghm", "erreur", "renvoi") or len(liste) < 2:
            continue
        porteur = min(liste, key=lambda a: (a.fleche, a.arrivee != "haut", ordre[a.de]))
        for a in liste:
            if a is porteur:
                continue
            for lien_ in liens_de(noeuds[a.de], a.role, a.vers):
                lien_["rejoint"] = True

    return {
        "millesime": millesime(SOURCE),
        "version": version,
        "orientation": lire_orientation(doc),
        "cmd": cmds,
        "listes": decrire_listes(noeuds),
        "noeuds": noeuds,
    }


def decrire_listes(noeuds: dict[str, dict]) -> dict[str, dict]:
    """Nom et taille de chaque liste citée par l'arbre, lus dans les listes
    déjà publiées : le site affiche ainsi le nom d'une liste sans charger
    les milliers de codes qu'elle regroupe. Une liste citée mais absente
    des listes publiées (A-001, « Acte opératoire » : tous les actes
    classants opératoires) garde un libellé nul."""
    citees = sorted({l for n in noeuds.values() for b in n.get("branches", []) for l in b["listes"]})
    connues: dict[str, dict] = {}
    for chemin, nature in zip(LISTES_PUBLIEES, ("diagnostics", "actes")):
        if not chemin.exists():
            continue
        jeu = json.loads(chemin.read_text(encoding="utf-8"))
        i_liste = jeu["colonnes"].index("Liste")
        i_libelle = jeu["colonnes"].index("Libellé liste")
        i_code = jeu["colonnes"].index("Code")
        for ligne in jeu["valeurs"]:
            fiche = connues.setdefault(
                ligne[i_liste], {"libelle": ligne[i_libelle], "nature": nature, "codes": set()}
            )
            fiche["codes"].add(ligne[i_code])
    return {
        code: (
            {"libelle": connues[code]["libelle"], "nature": connues[code]["nature"], "codes": len(connues[code]["codes"])}
            if code in connues
            else {"libelle": None, "nature": "actes" if code.startswith("A") else "diagnostics", "codes": 0}
        )
        for code in citees
    }


@dataclass
class Arete:
    de: str
    vers: str
    fleche: bool
    role: str  # oui, non, suite
    arrivee: str


def suites(noeud: dict) -> list[str]:
    """Les successeurs d'un nœud : cas « non » d'abord, puis les cas « oui »,
    pour qu'un parcours en profondeur suive d'abord la colonne principale."""
    liens = []
    if noeud.get("sinon"):
        liens.append(noeud["sinon"]["vers"])
    if noeud.get("suite"):
        liens.append(noeud["suite"]["vers"])
    liens.extend(b["vers"] for b in noeud.get("branches", []))
    return liens


def verifier_sans_boucle(noeuds: dict[str, dict]) -> None:
    """Un arbre de décision ne revient jamais sur ses pas : une boucle
    trahirait un trait mal suivi, et ferait tourner le site sans fin."""
    etat: dict[str, int] = {}  # 1 : en cours d'exploration, 2 : terminé
    for depart in noeuds:
        if depart in etat:
            continue
        pile = [(depart, iter(suites(noeuds[depart])))]
        etat[depart] = 1
        while pile:
            nid, reste = pile[-1]
            suivant = next(reste, None)
            if suivant is None:
                etat[nid] = 2
                pile.pop()
            elif etat.get(suivant) == 1:
                raise ErreurExtraction(f"boucle dans l'arbre : {nid} → {suivant}")
            elif suivant not in etat:
                etat[suivant] = 1
                pile.append((suivant, iter(suites(noeuds[suivant]))))


def ordre_de_parcours(noeuds: dict[str, dict], racines: list[str]) -> dict[str, int]:
    ordre: dict[str, int] = {}
    for racine in racines:
        pile = [racine]
        while pile:
            nid = pile.pop()
            if nid in ordre:
                continue
            ordre[nid] = len(ordre)
            pile.extend(reversed(suites(noeuds[nid])))
    return ordre


def liens_de(noeud: dict, role: str, vers: str) -> list[dict]:
    if role == "suite":
        return [noeud["suite"]]
    if role == "non":
        return [noeud["sinon"]]
    return [b for b in noeud["branches"] if b["vers"] == vers]


def main() -> None:
    doc = pymupdf.open(SOURCE)
    try:
        arbre = construire(doc)
    except ErreurExtraction as e:
        sys.exit(f"Extraction impossible : {e}")
    finally:
        doc.close()
    CIBLE.parent.mkdir(parents=True, exist_ok=True)
    CIBLE.write_text(
        json.dumps(arbre, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    ghm = sum(1 for n in arbre["noeuds"].values() if n["genre"] == "ghm")
    print(
        f"{CIBLE.relative_to(RACINE)} : {len(arbre['cmd'])} CM/CMD, "
        f"{len(arbre['noeuds'])} nœuds dont {ghm} cases de GHM"
    )


if __name__ == "__main__":
    main()
