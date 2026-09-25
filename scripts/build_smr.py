"""Convertit les fichiers de la fonction groupage SMR (ATIH) en JSON pour le site.

Usage :

    pip install -r scripts/requirements.txt
    python scripts/build_smr.py

Sources, dans data/smr/, sous les noms que leur donne l'ATIH :

- les fichiers associés au Manuel des GME (CIM_infos_SMR.xlsx,
  GN_liste_tests.xlsx, GR_infos.xlsx, GL_infos.xlsx,
  TOTAL_listes_groupes.xlsx, ACTES_ponderations.xlsx, ACTES_listes_SPE.xlsx,
  CMA_exclusion.xlsx, CMA_CCAM.xlsx, CSAR_infos.xlsx, FG_erreurs.TXT) ;
- ACTES_ponderations_CSAR_transcodage.xlsx, des fichiers CSAR de la phase de
  transcodage : le seul à dire quels actes CSAR acceptent un modulateur de
  temps ou de lieu ;
- tarifs.xlsx : les annexes de l'arrêté tarifaire SMR, dont on reprend
  l'annexe I (établissements des a, b et c de l'article L. 162-22 du code de
  la sécurité sociale).

Cibles, dans docs/assets/data/smr/ :

- diagnostics.json : chaque code CIM-10, sa CM, les positions où il peut
  être codé, son orientation en deuxième intention, son caractère de CMA et
  ses listes d'entrée dans les GN ;
- classification.json : libellés des groupes, tests d'entrée dans les GN,
  types de réadaptation et seuils, règles de lourdeur, listes d'actes
  spécialisés, actes CCAM CMA, modulateurs, intervenants, erreurs ;
- exclusions.json : les listes d'exclusion des CMA, en plages de codes ;
- actes.json, actes_spe.json : pondérations des actes CSARR et CCAM, et
  listes d'actes spécialisés ;
- csar.json : transcodage des actes CSAR en actes CSARR ;
- tarifs.json : tarifs des GMT de l'annexe I de l'arrêté tarifaire.

Les règles de l'algorithme (ordre des tests, seuils « par jour ET par
séjour », pondération des actes CSAR…) ne sont pas dans ces fichiers mais
dans le volume 1 du Manuel des GME (data/smr/manuel_gme_volume_1.pdf) : elles
sont transcrites dans docs/assets/js/smr.js.

Comme les autres scripts, celui-ci s'arrête plutôt que de deviner : un
en-tête qui change, un test d'entrée en GN illisible, une liste citée mais
absente, un groupe qui manque d'un fichier à l'autre, une règle de lourdeur
qui ne se lit pas ou un tarif sans GME arrêtent la conversion.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

from millesime import millesime

RACINE = Path(__file__).resolve().parent.parent
SOURCES = RACINE / "data" / "smr"
SORTIE = RACINE / "docs" / "assets" / "data" / "smr"


class ErreurDonnees(Exception):
    pass


# ==== Lecture ====


def feuille(fichier: str, nom: str, ligne_entete: int, attendu: list[str]) -> list[list]:
    """Lignes non vides de la feuille `nom`, sous l'en-tête `attendu` (lu à
    la ligne `ligne_entete`, 1 pour la première). Un en-tête différent arrête
    la conversion : une colonne ajoutée, ôtée ou renommée par l'ATIH ne doit
    pas décaler les valeurs sous le nom d'une autre."""
    classeur = load_workbook(SOURCES / fichier, read_only=True, data_only=True)
    try:
        if nom not in classeur.sheetnames:
            raise ErreurDonnees(f"{fichier} : pas de feuille « {nom} » ({', '.join(classeur.sheetnames)})")
        ws = classeur[nom]
        # En lecture seule, openpyxl s'arrête à l'étendue déclarée par le
        # classeur, qui peut être fausse : on lit jusqu'à la dernière cellule.
        ws.reset_dimensions()
        lignes = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        classeur.close()
    if len(lignes) < ligne_entete:
        raise ErreurDonnees(f"{fichier}, {nom} : pas de ligne d'en-tête")
    entete = [" ".join(str(c).split()) if c is not None else "" for c in lignes[ligne_entete - 1]]
    while entete and not entete[-1]:
        entete.pop()
    if entete != attendu:
        raise ErreurDonnees(f"{fichier}, {nom} : en-tête inattendu {entete}, attendu {attendu}")
    resultat = []
    for n, ligne in enumerate(lignes[ligne_entete:], start=ligne_entete + 1):
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in ligne):
            continue
        if any(v is not None and str(v).strip() for v in ligne[len(attendu):]):
            raise ErreurDonnees(f"{fichier}, {nom}, ligne {n} : valeur hors des colonnes de l'en-tête")
        ligne = (ligne + [None] * len(attendu))[: len(attendu)]
        resultat.append(ligne)
    if not resultat:
        raise ErreurDonnees(f"{fichier}, {nom} : aucune ligne")
    return resultat


def texte(v) -> str:
    """Cellule → texte sans espaces superflus ; None → chaîne vide. Les
    espaces insécables de l'ATIH (« \\xa0AE D-0112 ») deviennent des espaces."""
    if v is None:
        return ""
    # Espace de largeur nulle : présente dans CIM_infos_SMR.xlsx (« Z5185 »).
    return " ".join(str(v).replace("\xa0", " ").replace("\u200b", "").split())


def code_2(v, ou: str) -> str:
    """CM ou GN sur deux ou quatre chiffres : l'ATIH les livre tantôt en
    texte (« 01 »), tantôt en nombre (1)."""
    if isinstance(v, int) and not isinstance(v, bool):
        return str(v)
    t = texte(v)
    if not t.isdigit():
        raise ErreurDonnees(f"{ou} : code illisible {v!r}")
    return t


def code_cim(code: str) -> str:
    """« C169+0 » → « C16.9+0 », « B24+0 » → « B24.+0 », « A09 » → « A09 » :
    la graphie des référentiels MCO du site."""
    return code if len(code) <= 3 else f"{code[:3]}.{code[3:]}"


def cle_cim(code: str) -> str:
    """Graphie sans point de l'ATIH (« C16.9+0 » → « C169+0 »)."""
    return code.replace(".", "")


def drapeau(v, ou: str) -> bool:
    """« X », « x » ou « × » : oui ; vide : non."""
    t = texte(v)
    if t in ("", "0"):
        return False
    if t.lower() in ("x", "×", "oui"):
        return True
    raise ErreurDonnees(f"{ou} : drapeau illisible {v!r}")


def nombre(v, ou: str, *, entier=False, vide=False):
    if v is None or (isinstance(v, str) and not v.strip()):
        if vide:
            return None
        raise ErreurDonnees(f"{ou} : valeur absente")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ErreurDonnees(f"{ou} : nombre illisible {v!r}")
    if entier:
        if v != int(v):
            raise ErreurDonnees(f"{ou} : entier attendu {v!r}")
        return int(v)
    return round(v, 2) if isinstance(v, float) else v


# ==== Libellés des groupes ====

RE_GROUPE = {
    "CM": re.compile(r"\d{2}"),
    "GN": re.compile(r"\d{4}"),
    "GR": re.compile(r"\d{4}[PSTUHIJKL]"),
    "GL": re.compile(r"\d{4}[PSTUHIJKL][ABC]"),
    "GME": re.compile(r"\d{4}[PSTUHIJKL][ABC][012]"),
}
HC = "PSTU"  # types de réadaptation d'hospitalisation complète
HTP = "HIJKL"  # et d'hospitalisation à temps partiel


def lire_groupes() -> dict[str, dict[str, list[str]]]:
    lignes = feuille("TOTAL_listes_groupes.xlsx", "libelles", 1, ["quoi", "code", "lib_court", "lib_long"])
    groupes: dict[str, dict[str, list[str]]] = {q: {} for q in RE_GROUPE}
    for n, (quoi, code, court, long_) in enumerate(lignes, start=2):
        ou = f"TOTAL_listes_groupes.xlsx, ligne {n}"
        quoi = texte(quoi)
        if quoi not in RE_GROUPE:
            raise ErreurDonnees(f"{ou} : type de groupe inconnu {quoi!r}")
        code = code_2(code, ou) if quoi in ("CM", "GN") else texte(code)
        if not RE_GROUPE[quoi].fullmatch(code):
            raise ErreurDonnees(f"{ou} : code {quoi} illisible {code!r}")
        if code in groupes[quoi]:
            raise ErreurDonnees(f"{ou} : {quoi} {code} en double")
        groupes[quoi][code] = [texte(court), texte(long_)]
    # Emboîtement : chaque groupe prolonge d'un caractère un groupe du niveau
    # au-dessus (GN = CM + 2 chiffres, GR = GN + type, GL = GR + lourdeur,
    # GME = GL + sévérité).
    for bas, haut, n in (("GN", "CM", 2), ("GR", "GN", 4), ("GL", "GR", 5), ("GME", "GL", 6)):
        orphelins = sorted(c for c in groupes[bas] if c[:n] not in groupes[haut])
        if orphelins:
            raise ErreurDonnees(f"TOTAL_listes_groupes.xlsx : {bas} sans {haut} {orphelins[:10]}")
        steriles = sorted(c for c in groupes[haut] if c != "90" and not any(b[:n] == c for b in groupes[bas]))
        if steriles:
            raise ErreurDonnees(f"TOTAL_listes_groupes.xlsx : {haut} sans aucun {bas} {steriles[:10]}")
    return groupes


# ==== Diagnostics ====

PROFILS = {"NNN", "NNO", "NOO", "ONO", "OOO"}
RE_LISTE_CIM = re.compile(r"(\d{4})(?: (.+))?")


def lire_diagnostics(cm_connues: set[str]):
    lignes = feuille(
        "CIM_infos_SMR.xlsx",
        "DIAG10",
        1,
        ["code", "lib", "cm", "Profil", "profil2", "orientant_deuxieme_intention", "CMA", "liste_1", "liste_2", "liste_3", "liste_4"],
    )
    diagnostics = []
    listes: dict[str, str] = {}  # numéro de liste → libellé
    vus = set()
    for n, (code, lib, cm, profil, _profil2, deuxieme, cma, *cols) in enumerate(lignes, start=2):
        ou = f"CIM_infos_SMR.xlsx, ligne {n}"
        # Quelques codes arrivent avec leur point (« U11.9 ») : même graphie
        # sans point que les autres.
        code = cle_cim(texte(code))
        if not re.fullmatch(r"[A-Z]\d{2}[0-9+]*", code):
            raise ErreurDonnees(f"{ou} : code CIM-10 illisible {code!r}")
        if code in vus:
            raise ErreurDonnees(f"{ou} : code {code} en double")
        vus.add(code)
        cm = code_2(cm, ou).zfill(2)
        if cm not in cm_connues:
            raise ErreurDonnees(f"{ou} : CM inconnue {cm!r}")
        profil = texte(profil)
        if profil not in PROFILS:
            raise ErreurDonnees(f"{ou} : profil inconnu {profil!r}")
        nums = []
        for c in cols:
            t = texte(c)
            if not t:
                continue
            m = RE_LISTE_CIM.fullmatch(t)
            if not m:
                raise ErreurDonnees(f"{ou} : liste illisible {t!r}")
            num, libelle = m.group(1), m.group(2) or ""
            if listes.setdefault(num, libelle) != libelle:
                raise ErreurDonnees(f"{ou} : liste {num} sous deux libellés ({listes[num]!r}, {libelle!r})")
            if num not in nums:
                nums.append(num)
        diagnostics.append(
            [code_cim(code), texte(lib), cm, profil, drapeau(deuxieme, ou), drapeau(cma, ou), nums]
        )
    return diagnostics, listes


# ==== Tests d'entrée dans les GN ====

RE_TEST = re.compile(r"(MMP ou AE|MMP|AE|DAS) D-(\d{4})\b\s*[-–]?\s*(.*)", re.S)
# Conditions écrites en toutes lettres dans le seul test du GN 0871
# (fractures multiples), transcrites en deux règles de smr.js.
CONDITIONS = {
    "Si la MMP et l'AE sont classantes, seul, le code en MMP est retenu comme classant.": "mmpPrioritaire",
    "Les 4 premiers caractères du code classant en DAS doivent être différents des 4 premiers caractères du code classant en MMP ou AE.": "quatreCaracteresDifferents",
}


def lire_test(t, ou: str, listes: dict[str, str]):
    brut = str(t).replace("\xa0", " ").strip()
    m = RE_TEST.fullmatch(brut)
    if not m:
        raise ErreurDonnees(f"{ou} : test illisible {brut!r}")
    positions, liste, reste = m.group(1), m.group(2), m.group(3)
    if liste not in listes:
        raise ErreurDonnees(f"{ou} : liste D-{liste} absente de CIM_infos_SMR.xlsx")
    # Après le numéro de liste : son libellé, ou (GN 0871) une condition
    # écrite en toutes lettres, qui ne peut être qu'une de CONDITIONS.
    reste = " ".join(reste.split())
    conditions = []
    for phrase, regle in CONDITIONS.items():
        if phrase in reste:
            conditions.append(regle)
            reste = reste.replace(phrase, "")
    reste = reste.replace("Conditions supplémentaires :", "").strip(" -")
    if conditions and reste:
        raise ErreurDonnees(f"{ou} : texte inconnu à côté d'une condition {reste!r}")
    if len(reste) > 150:
        raise ErreurDonnees(f"{ou} : libellé de liste trop long, condition inconnue ? {reste!r}")
    libelle = reste or listes[liste]
    return {
        "positions": positions.split(" ou "),
        "liste": liste,
        "texte": f"{positions} D-{liste}" + (f" - {libelle}" if libelle else ""),
    }, conditions


def lire_tests(groupes, listes):
    lignes = feuille(
        "GN_liste_tests.xlsx", "GN_listes_test", 1, ["cm", "Ordre_intra_CM", "Test_1", "Test_2", "Groupe Nosologique", "GN"]
    )
    tests = []
    ordres = defaultdict(list)
    for n, (cm, ordre, t1, t2, _libelle, gn) in enumerate(lignes, start=2):
        ou = f"GN_liste_tests.xlsx, ligne {n}"
        cm = code_2(cm, ou).zfill(2)
        gn = code_2(gn, ou)
        if gn not in groupes["GN"]:
            raise ErreurDonnees(f"{ou} : GN {gn} absent de TOTAL_listes_groupes.xlsx")
        if gn[:2] != cm:
            raise ErreurDonnees(f"{ou} : GN {gn} hors de la CM {cm}")
        ordre = nombre(ordre, ou, entier=True)
        ordres[cm].append(ordre)
        test_1, conditions = lire_test(t1, ou, listes)
        liste_tests = [test_1]
        if texte(t2):
            test_2, conditions_2 = lire_test(t2, ou, listes)
            liste_tests.append(test_2)
            conditions += conditions_2
        entree = {"cm": cm, "ordre": ordre, "gn": gn, "tests": liste_tests}
        if conditions:
            entree["conditions"] = conditions
        tests.append(entree)
    for cm, vus in ordres.items():
        if vus != list(range(1, len(vus) + 1)):
            raise ErreurDonnees(f"GN_liste_tests.xlsx : ordre des tests de la CM {cm} non continu {vus}")
    sans_test = sorted(set(groupes["GN"]) - {t["gn"] for t in tests})
    if sans_test:
        raise ErreurDonnees(f"GN_liste_tests.xlsx : GN sans test d'entrée {sans_test}")
    return tests


# ==== Groupes de réadaptation ====

COLONNES_GR = [
    "gn", "HC_specialisee", "HC_globale", "HC_autres", "HC_pediatrique",
    "HC_seuil_sejour_spe", "HC_seuil_jour_spe", "HC_seuil_sejour_glob", "HC_seuil_jour_glob",
    "HTP_tres_intense", "HTP_intense", "HTP_moderee", "HTP_indifferenciee", "HTP_pediatrique",
    "htp_seuil_bas", "htp_seuil_haut", "libelle",
]


def lire_gr(groupes):
    lignes = feuille("GR_infos.xlsx", "seuils_et_groupe", 2, COLONNES_GR)
    gr = {}
    for n, ligne in enumerate(lignes, start=3):
        ou = f"GR_infos.xlsx, ligne {n}"
        v = dict(zip(COLONNES_GR, ligne))
        gn = code_2(v["gn"], ou)
        if gn in gr:
            raise ErreurDonnees(f"{ou} : GN {gn} en double")
        oui = lambda c: drapeau(v[c], ou)  # noqa: E731
        types_hc = "".join(t for t, c in zip("STUP", ("HC_specialisee", "HC_globale", "HC_autres", "HC_pediatrique")) if oui(c))
        types_htp = "".join(
            t for t, c in zip("IJKLH", ("HTP_tres_intense", "HTP_intense", "HTP_moderee", "HTP_indifferenciee", "HTP_pediatrique")) if oui(c)
        )
        seuil = lambda c: nombre(v[c], ou, entier=True, vide=True)  # noqa: E731
        entree = {
            "hc": types_hc,
            "htp": types_htp,
            "spe": [seuil("HC_seuil_sejour_spe"), seuil("HC_seuil_jour_spe")],
            "glob": [seuil("HC_seuil_sejour_glob"), seuil("HC_seuil_jour_glob")],
            "htpSeuils": [seuil("htp_seuil_bas"), seuil("htp_seuil_haut")],
        }
        # Cohérence des seuils avec les types présents : un test de score
        # sans seuil, ou un seuil sans type, serait un groupage deviné.
        adultes = types_hc.replace("P", "")
        if "S" in adultes and len(adultes) > 1 and entree["spe"] == [None, None]:
            raise ErreurDonnees(f"{ou} : type spécialisé sans seuil")
        if ("S" not in adultes or len(adultes) == 1) and entree["spe"] != [None, None]:
            raise ErreurDonnees(f"{ou} : seuils spécialisés sans test à faire")
        if "T" in adultes and entree["glob"] == [None, None]:
            raise ErreurDonnees(f"{ou} : type global sans seuil")
        if "T" not in adultes and entree["glob"] != [None, None]:
            raise ErreurDonnees(f"{ou} : seuils globaux sans type global")
        intensites = set(types_htp) & set("IJK")
        if intensites and intensites != set("IJK"):
            raise ErreurDonnees(f"{ou} : types d'HTP très intense, intense et modérée incomplets")
        bas, haut = entree["htpSeuils"]
        if intensites and (bas is None or haut is None or bas >= haut):
            raise ErreurDonnees(f"{ou} : seuils d'HTP illisibles {entree['htpSeuils']}")
        if not intensites and entree["htpSeuils"] != [None, None]:
            raise ErreurDonnees(f"{ou} : seuils d'HTP sans types d'intensité")
        if ("L" in types_htp) == bool(intensites):
            raise ErreurDonnees(f"{ou} : l'HTP doit être indifférenciée ou subdivisée en intensités")
        if not adultes:
            raise ErreurDonnees(f"{ou} : aucun type de réadaptation d'HC pour les adultes")
        gr[gn] = entree
    if set(gr) != set(groupes["GN"]):
        raise ErreurDonnees(f"GR_infos.xlsx : GN différents de TOTAL_listes_groupes.xlsx {sorted(set(gr) ^ set(groupes['GN']))}")
    attendus = {gn + t for gn, e in gr.items() for t in e["hc"] + e["htp"]}
    if attendus != set(groupes["GR"]):
        raise ErreurDonnees(f"GR_infos.xlsx : GR différents de TOTAL_listes_groupes.xlsx {sorted(attendus ^ set(groupes['GR']))}")
    return gr


# ==== Groupes de lourdeur ====

CLASSES_AGE = ["0_3", "4_12", "13_17", "18_60", "61_70", "71_75", "76_80", "81_85", "86_plus"]
CLASSES_COG = ["2_6", "7_8"]
CLASSES_PHY = ["4_8", "9_12", "13_16"]
COLONNES_GL = (
    ["GR", "A0_3", "A4_12", "A13_17", "A18_60", "A61_70", "A71_75", "A76_80", "A81_85", "A86_plus",
     "G02_06", "G07_08", "Y04_08", "Y09_12", "Y13_16", "C_Sans", "C_Avec", "regles_combinees", "nb niveaux"]
)
RE_REGLE = re.compile(r"age (\d{2})_(\d{2}|plus) -+> ([ABC])")


def lire_regle_combinee(t: str, ou: str):
    """« age 18_70 -> B; age 71_plus --> A; » → [[18, 70, "B"], [71, null, "A"]].
    Les tranches doivent couvrir les âges de 18 ans (ou 0) à la fin, sans trou."""
    morceaux = [m.strip() for m in t.split(";") if m.strip()]
    regle = []
    for morceau in morceaux:
        m = RE_REGLE.fullmatch(morceau)
        if not m:
            raise ErreurDonnees(f"{ou} : règle combinée illisible {t!r}")
        regle.append([int(m.group(1)), None if m.group(2) == "plus" else int(m.group(2)), m.group(3)])
    for (a, b, _), (c, _, _) in zip(regle, regle[1:]):
        if b is None or c != b + 1:
            raise ErreurDonnees(f"{ou} : tranches d'âge discontinues {t!r}")
    if regle[-1][1] is not None or regle[0][0] not in (0, 18):
        raise ErreurDonnees(f"{ou} : tranches d'âge incomplètes {t!r}")
    return regle


def lire_gl(groupes):
    lignes = feuille("GL_infos.xlsx", "regles", 2, COLONNES_GL)
    gl = {}
    for n, ligne in enumerate(lignes, start=3):
        ou = f"GL_infos.xlsx, ligne {n}"
        v = dict(zip(COLONNES_GL, ligne))
        gr = texte(v["GR"])
        if gr not in groupes["GR"] or gr[4] not in HC:
            raise ErreurDonnees(f"{ou} : GR inconnu ou d'HTP {gr!r}")
        if gr in gl:
            raise ErreurDonnees(f"{ou} : GR {gr} en double")

        def niveau(colonne):
            t = texte(v[colonne])
            if t in ("A", "B", "C", "-"):
                return None if t == "-" else t
            if colonne.startswith("Y") and texte(v["regles_combinees"]) == "oui":
                return lire_regle_combinee(t, ou)
            raise ErreurDonnees(f"{ou}, {colonne} : niveau illisible {t!r}")

        regles = {
            "age": [niveau(f"A{c}") for c in CLASSES_AGE],
            "cog": [niveau(c) for c in ("G02_06", "G07_08")],
            "phy": [niveau(c) for c in ("Y04_08", "Y09_12", "Y13_16")],
            "chir": [niveau("C_Sans"), niveau("C_Avec")],
        }
        combinee = any(isinstance(x, list) for x in regles["phy"])
        if combinee != (texte(v["regles_combinees"]) == "oui"):
            raise ErreurDonnees(f"{ou} : règle combinée annoncée sans être écrite, ou l'inverse")
        # Seule la classe d'âge peut être sans objet (« - ») : enfants d'un GN
        # qui a un GR pédiatrique, adultes d'un GR pédiatrique.
        for variable in ("cog", "phy", "chir"):
            if None in regles[variable]:
                raise ErreurDonnees(f"{ou} : niveau manquant pour {variable}")
        pediatrique = gr[4] == "P"
        attendu_age = [x is not None for x in regles["age"]]
        if pediatrique and attendu_age != [True] * 3 + [False] * 6:
            raise ErreurDonnees(f"{ou} : un GR pédiatrique n'a de niveau que pour les moins de 18 ans")
        if not pediatrique and attendu_age[3:] != [True] * 6:
            raise ErreurDonnees(f"{ou} : niveau manquant pour une classe d'âge adulte")
        # Les niveaux que les règles peuvent donner sont ceux que
        # TOTAL_listes_groupes.xlsx connaît pour ce GR.
        possibles = set()
        for valeurs in regles.values():
            for x in valeurs:
                if isinstance(x, list):
                    possibles |= {r[2] for r in x}
                elif x:
                    possibles.add(x)
        connus = {c[5] for c in groupes["GL"] if c[:5] == gr}
        if possibles != connus:
            raise ErreurDonnees(f"{ou} : niveaux {sorted(possibles)} ≠ groupes de lourdeur {sorted(connus)}")
        gl[gr] = regles
    hc = {c for c in groupes["GR"] if c[4] in HC}
    if set(gl) != hc:
        raise ErreurDonnees(f"GL_infos.xlsx : GR d'HC sans règle {sorted(hc ^ set(gl))}")
    htp_non_a = sorted(c for c in groupes["GL"] if c[4] in HTP and c[5] != "A")
    if htp_non_a:
        raise ErreurDonnees(f"TOTAL_listes_groupes.xlsx : GL d'HTP autres que A {htp_non_a[:10]}")
    return gl


def verifier_gme(groupes, gn_sans_severite_2: set[str]) -> None:
    """Chaque GL d'HC se prolonge en niveaux de sévérité 1 et 2, sauf ceux du
    GN 2303 (soins palliatifs), en 1 seulement ; chaque GL d'HTP en 0."""
    for gl in groupes["GL"]:
        attendus = {"0"} if gl[4] in HTP else ({"1"} if gl[:4] in gn_sans_severite_2 else {"1", "2"})
        lus = {c[6] for c in groupes["GME"] if c[:6] == gl}
        if lus != attendus:
            raise ErreurDonnees(f"TOTAL_listes_groupes.xlsx : GL {gl}, sévérités {sorted(lus)} au lieu de {sorted(attendus)}")


# ==== Actes ====

COLONNES_PONDERATIONS = [
    "code", "nomenclature", "type", "statut", "intervenant", "lib_pmsi", "hiera", "liblong",
    "ponderation_patient", "validite", "debut", "fin", "mod_HW", "mod_LJ", "mod_XH", "mod_L3",
]
TYPES_ACTE = {"D", "D/ND", "A", "CCAM", "C", "PP"}


def lire_intervenants():
    lignes = feuille("ACTES_ponderations.xlsx", "Intervenants", 1, ["10 MÉDECIN"])
    intervenants = {"10": "Médecin"}
    for (t,) in lignes:
        m = re.fullmatch(r"(\d{2}) (.+)", texte(t))
        if not m:
            raise ErreurDonnees(f"ACTES_ponderations.xlsx, Intervenants : ligne illisible {t!r}")
        intervenants[m.group(1)] = m.group(2).capitalize()
    return intervenants


def lire_ponderations(intervenants):
    lignes = feuille("ACTES_ponderations.xlsx", "ponderations", 1, COLONNES_PONDERATIONS)
    actes = []
    vus = set()
    for n, ligne in enumerate(lignes, start=2):
        ou = f"ACTES_ponderations.xlsx, ligne {n}"
        v = dict(zip(COLONNES_PONDERATIONS, ligne))
        code, nomenclature, type_ = texte(v["code"]), texte(v["nomenclature"]), texte(v["type"])
        intervenant = texte(v["intervenant"]).zfill(2)
        if nomenclature == "CSARR":
            if not re.fullmatch(r"[A-Z]{3}\+\d{3}", code):
                raise ErreurDonnees(f"{ou} : code CSARR illisible {code!r}")
        elif nomenclature == "CCAM":
            if not re.fullmatch(r"[A-Z]{4}\d{3}", code):
                raise ErreurDonnees(f"{ou} : code CCAM illisible {code!r}")
        else:
            raise ErreurDonnees(f"{ou} : nomenclature inconnue {nomenclature!r}")
        if type_ not in TYPES_ACTE:
            raise ErreurDonnees(f"{ou} : type d'acte inconnu {type_!r}")
        if intervenant != "00" and intervenant not in intervenants:
            raise ErreurDonnees(f"{ou} : intervenant inconnu {intervenant!r}")
        if (code, intervenant) in vus:
            raise ErreurDonnees(f"{ou} : couple {code} / intervenant {intervenant} en double")
        vus.add((code, intervenant))
        ponderation = nombre(v["ponderation_patient"], ou, entier=True)
        if ponderation < 0:
            raise ErreurDonnees(f"{ou} : pondération négative")
        actes.append(
            [
                code, nomenclature, type_, texte(v["statut"]), intervenant, texte(v["hiera"]), texte(v["liblong"]),
                ponderation, drapeau(v["validite"], ou), nombre(v["debut"], ou, entier=True, vide=True),
                nombre(v["fin"], ou, entier=True, vide=True),
                *(drapeau(v[m], ou) for m in ("mod_HW", "mod_LJ", "mod_XH", "mod_L3")),
            ]
        )
    # Un acte différencié selon l'intervenant a une ligne par intervenant ;
    # un acte à pondération unique, une seule ligne « 00 ».
    par_code = defaultdict(set)
    for a in actes:
        par_code[a[0]].add(a[4])
    for code, ivs in par_code.items():
        if "00" in ivs and len(ivs) > 1:
            raise ErreurDonnees(f"ACTES_ponderations.xlsx : {code} a une pondération unique et des pondérations par intervenant")
    return actes


def lire_modulateurs():
    lignes = feuille(
        "ACTES_ponderations.xlsx", "modulateurs", 1,
        ["Code", "Libellé", "Majoration pour les actes individuels", "Majoration pour les actes collectifs"],
    )
    modulateurs = []
    for n, (code, libelle, individuel, collectif) in enumerate(lignes, start=2):
        ou = f"ACTES_ponderations.xlsx, modulateurs, ligne {n}"
        collectif = None if texte(collectif) in ("", "sans objet") else nombre(collectif, ou, entier=True)
        modulateurs.append([texte(code), texte(libelle), nombre(individuel, ou, entier=True), collectif])
    return modulateurs


def lire_actes_spe(groupes, ponderes: set[str]):
    lignes = feuille("ACTES_listes_SPE.xlsx", "total_liste", 1, ["acte", "hier", "type_acte", "libellé", "CM", "GN_liste", "libellé_GN_liste"])
    rattachements = feuille("ACTES_listes_SPE.xlsx", "gn_liste", 1, ["GN", "Lib_GN", "GN_liste", "GR spé unique"])
    gn_liste = {}
    for n, (gn, _lib, liste, unique) in enumerate(rattachements, start=2):
        ou = f"ACTES_listes_SPE.xlsx, gn_liste, ligne {n}"
        gn = code_2(gn, ou)
        if gn not in groupes["GN"]:
            raise ErreurDonnees(f"{ou} : GN inconnu {gn}")
        liste = texte(liste)
        gn_liste[gn] = {"liste": None if liste == "PAS DE LISTE" else liste, "speUnique": drapeau(unique, ou)}
    if set(gn_liste) != set(groupes["GN"]):
        raise ErreurDonnees(f"ACTES_listes_SPE.xlsx : GN différents de TOTAL_listes_groupes.xlsx {sorted(set(gn_liste) ^ set(groupes['GN']))}")
    listes = {}
    actes = []
    for n, (acte, hier, type_, libelle, cm, liste, libelle_liste) in enumerate(lignes, start=2):
        ou = f"ACTES_listes_SPE.xlsx, total_liste, ligne {n}"
        acte, liste = texte(acte), texte(liste)
        if acte not in ponderes:
            raise ErreurDonnees(f"{ou} : acte {acte} absent de ACTES_ponderations.xlsx")
        cm = code_2(cm, ou).zfill(2)
        gns = sorted(g for g, e in gn_liste.items() if e["liste"] == liste)
        if not gns:
            raise ErreurDonnees(f"{ou} : liste {liste} rattachée à aucun GN")
        attendu = {"libelle": texte(libelle_liste), "cm": cm, "gn": gns}
        if listes.setdefault(liste, attendu) != attendu:
            raise ErreurDonnees(f"{ou} : liste {liste} décrite deux fois différemment")
        actes.append([acte, texte(hier), texte(type_), texte(libelle), cm, liste, texte(libelle_liste)])
    sans_actes = sorted({e["liste"] for e in gn_liste.values() if e["liste"]} - set(listes))
    if sans_actes:
        raise ErreurDonnees(f"ACTES_listes_SPE.xlsx : listes sans aucun acte {sans_actes}")
    return actes, listes, gn_liste


def lire_cma_ccam():
    lignes = feuille("CMA_CCAM.xlsx", "ccam", 1, ["code", "libelle_acte", "liste_ccam", "lib_liste"])
    cma = []
    for n, (code, libelle, liste, lib_liste) in enumerate(lignes, start=2):
        ou = f"CMA_CCAM.xlsx, ligne {n}"
        code = texte(code)
        # « EBLA0030 » : le code CCAM et le code de phase (0), que le
        # manuel n'écrit pas (annexe 7.6 : « EBLA003 »).
        if not re.fullmatch(r"[A-Z]{4}\d{3}0", code):
            raise ErreurDonnees(f"{ou} : code CCAM illisible {code!r}")
        if texte(lib_liste) != "CMA":
            raise ErreurDonnees(f"{ou} : liste inattendue {lib_liste!r}")
        cma.append([code[:7], texte(libelle)])
    return cma


def lire_exclusions(diagnostics):
    """Chaque CMA et sa liste d'exclusion. Une liste (jusqu'à 31 000 codes)
    s'écrit en plages de codes consécutifs dans l'ordre de CIM_infos_SMR.xlsx
    trié : « [A000, A099] » vaut tous les codes du fichier compris entre les
    deux, bornes comprises. Le site teste l'appartenance par comparaison de
    chaînes sur la graphie sans point, dans le même ordre."""
    lignes = feuille("CMA_exclusion.xlsx", "CMA_Exclusions", 1, ["Diagnostic associé CMA", "Liste", "Compteur"])
    cles = sorted(cle_cim(d[0]) for d in diagnostics)
    rang = {c: i for i, c in enumerate(cles)}
    cma = {cle_cim(d[0]) for d in diagnostics if d[5]}
    explicites: dict[str, list[str]] = {}
    renvois: dict[str, str] = {}
    for n, (code, liste, _compteur) in enumerate(lignes, start=2):
        ou = f"CMA_exclusion.xlsx, ligne {n}"
        code = cle_cim(texte(code))
        if code not in cma:
            raise ErreurDonnees(f"{ou} : {code} n'est pas une CMA de CIM_infos_SMR.xlsx")
        if code in explicites or code in renvois:
            raise ErreurDonnees(f"{ou} : {code} en double")
        t = texte(liste)
        m = re.fullmatch(r"Même liste que (\S+)", t)
        if m:
            renvois[code] = cle_cim(m.group(1))
            continue
        # « Compteur » n'est pas le nombre de codes, comme le dit le lisez-moi,
        # mais la longueur du texte de la cellule (à trois caractères près
        # pour T83.5) : il ne sert à rien vérifier.
        codes = [cle_cim(c) for c in t.split()]
        if len(set(codes)) != len(codes):
            raise ErreurDonnees(f"{ou} : code en double dans la liste")
        inconnus = [c for c in codes if c not in rang]
        if inconnus:
            raise ErreurDonnees(f"{ou} : codes absents de CIM_infos_SMR.xlsx {inconnus[:5]}")
        explicites[code] = codes
    for code, cible in renvois.items():
        if cible not in explicites:
            raise ErreurDonnees(f"CMA_exclusion.xlsx : {code} renvoie à la liste de {cible}, qui n'est pas écrite")
    listes: list[list[list[str]]] = []
    index_liste: dict[tuple, int] = {}
    par_cma: dict[str, int] = {}
    for code, codes in explicites.items():
        indices = sorted(rang[c] for c in codes)
        plages: list[list[int]] = []
        for i in indices:
            if plages and i == plages[-1][1] + 1:
                plages[-1][1] = i
            else:
                plages.append([i, i])
        cle = tuple(map(tuple, plages))
        if cle not in index_liste:
            index_liste[cle] = len(listes)
            listes.append([[cles[a], cles[b]] for a, b in plages])
        par_cma[code] = index_liste[cle]
    for code, cible in renvois.items():
        par_cma[code] = par_cma[cible]
    # Les CMA sans ligne dans le fichier n'ont aucune exclusion.
    return {code_cim(c): par_cma.get(c) for c in sorted(cma)}, listes


# ==== CSAR ====


def lire_csar(ponderations, intervenants):
    lignes = feuille(
        "CSAR_infos.xlsx", "transcodage_CSAR_détail", 1,
        ["code_csar", "libelle_csar", "intervenant", "acte_coll", "code_csarr", "libelle_csarr", "commentaire"],
    )
    ponderes = {a[0] for a in ponderations}
    transcodage = []
    vus = set()
    for n, (code, libelle, intervenant, coll, csarr, lib_csarr, commentaire) in enumerate(lignes, start=2):
        ou = f"CSAR_infos.xlsx, transcodage_CSAR_détail, ligne {n}"
        code, csarr, coll = texte(code), texte(csarr), texte(coll)
        intervenant = texte(intervenant).zfill(2)
        if not re.fullmatch(r"\d{2}[A-Z]\d{2}", code):
            raise ErreurDonnees(f"{ou} : code CSAR illisible {code!r}")
        if coll not in ("0", "1", "2"):
            raise ErreurDonnees(f"{ou} : modalité collective illisible {coll!r}")
        if intervenant not in intervenants:
            raise ErreurDonnees(f"{ou} : intervenant inconnu {intervenant!r}")
        if csarr not in ponderes:
            raise ErreurDonnees(f"{ou} : acte CSARR {csarr} absent de ACTES_ponderations.xlsx")
        if (code, intervenant, coll) in vus:
            raise ErreurDonnees(f"{ou} : transcodage en double")
        vus.add((code, intervenant, coll))
        transcodage.append([code, texte(libelle), intervenant, coll, csarr, texte(lib_csarr), bool(texte(commentaire))])
    # « 2 » (individuel ou collectif) exclut « 0 » et « 1 » pour un même acte.
    modalites = defaultdict(set)
    for t in transcodage:
        modalites[t[0]].add(t[3])
    for code, m in modalites.items():
        if "2" in m and m != {"2"}:
            raise ErreurDonnees(f"CSAR_infos.xlsx : {code} mêle la modalité 2 et les modalités 0 ou 1")
    intervenants_csar = feuille("CSAR_infos.xlsx", "transcodage_intervenants", 1, ["Intervenants CSAR", "Intervenants CSARR transcodés"])
    transposition = {}
    for n, (csar, csarr) in enumerate(intervenants_csar, start=2):
        a, b = texte(csar)[:2], texte(csarr)[:2]
        if not (a.isdigit() and b.isdigit()):
            raise ErreurDonnees(f"CSAR_infos.xlsx, transcodage_intervenants, ligne {n} : intervenant illisible")
        if a != b:
            transposition[a] = b
            intervenants.setdefault(a, texte(csar)[3:].capitalize())
    modulateurs = feuille(
        "CSAR_infos.xlsx", "modulateur_modalite_extension", 1,
        ["Type", "Variable", "Modalite", "Niveau_ou_module_de_technicite", "Libelle", "Ponderation",
         "Majoration de pondération des actes CSAR individuels", "Majoration de pondération des actes CSAR collectifs"],
    )
    temps, lieu = [], []
    for n, (type_, variable, modalite, _niveau, libelle, ponderation, individuel, collectif) in enumerate(modulateurs, start=2):
        ou = f"CSAR_infos.xlsx, modulateur_modalite_extension, ligne {n}"
        if texte(type_) != "Modulateur":
            continue
        if texte(variable) == "Temps" and texte(modalite) != "Vide":
            temps.append([texte(modalite), texte(libelle), nombre(ponderation, ou, entier=True)])
        elif texte(variable) == "Lieu":
            coll = None if texte(collectif).lower() in ("", "sans objet") else nombre(collectif, ou, entier=True)
            lieu.append([texte(modalite), texte(libelle), nombre(individuel, ou, entier=True), coll])
    if [t[0] for t in temps] != ["T0", "T1", "T2", "T3", "T4"] or [l[0] for l in lieu] != ["L1", "L2", "L3"]:
        raise ErreurDonnees("CSAR_infos.xlsx : modulateurs de temps ou de lieu inattendus")
    eligibles = feuille(
        "ACTES_ponderations_CSAR_transcodage.xlsx", "pond_csar_transcode", 1,
        ["code_csar", "libelle_csar", "acte_collectif", "intervenant", "ponderation", "mod_tps", "mod_L1", "mod_L2", "mod_L3"],
    )
    modulables = {}
    poids_csar = {}  # (code CSAR, modalité, intervenant ou « 00 ») → pondération du fichier
    for n, (code, _lib, coll, iv, pond, tps, l1, l2, l3) in enumerate(eligibles, start=2):
        ou = f"ACTES_ponderations_CSAR_transcodage.xlsx, ligne {n}"
        code, coll, iv = texte(code), texte(coll), texte(iv).zfill(2)
        if code not in modalites:
            raise ErreurDonnees(f"{ou} : acte CSAR {code} absent du transcodage")
        if coll not in modalites[code]:
            raise ErreurDonnees(f"{ou} : modalité {coll} absente du transcodage de {code}")
        if (code, coll, iv) in poids_csar:
            raise ErreurDonnees(f"{ou} : pondération en double")
        poids_csar[(code, coll, iv)] = nombre(pond, ou, entier=True)
        drapeaux = [drapeau(x, ou) for x in (tps, l1, l2, l3)]
        if modulables.setdefault(code, drapeaux) != drapeaux:
            raise ErreurDonnees(f"{ou} : modulateurs de {code} différents d'une ligne à l'autre")
    if set(modulables) != set(modalites):
        raise ErreurDonnees(f"ACTES_ponderations_CSAR_transcodage.xlsx : actes CSAR manquants {sorted(set(modalites) - set(modulables))[:10]}")
    # Deux pondérations par ligne de transcodage : celle que donne le fichier
    # CSAR de l'ATIH, et celle du CSARR transcodé pour cet intervenant — la
    # seule que la fonction groupage retienne (volume 1, 3.3.1.3). Elles
    # diffèrent pour quelques couples ; le site les montre toutes deux.
    poids_csarr = {(a[0], a[4]): a[7] for a in ponderations}
    for t in transcodage:
        code, _lib, iv, coll, csarr = t[:5]
        fichier = poids_csar.get((code, coll, iv), poids_csar.get((code, coll, "00")))
        if fichier is None:
            raise ErreurDonnees(f"ACTES_ponderations_CSAR_transcodage.xlsx : pas de pondération pour {code}, modalité {coll}, intervenant {iv}")
        transcode = poids_csarr.get((csarr, iv), poids_csarr.get((csarr, "00")))
        if transcode is None:
            raise ErreurDonnees(f"ACTES_ponderations.xlsx : pas de pondération de {csarr} pour l'intervenant {iv}")
        t += [fichier, transcode]
    return transcodage, transposition, temps, lieu, modulables


# ==== Erreurs ====


def lire_erreurs():
    """Les erreurs (« code|libellé|Bloquant ») puis, pour certaines, la liste
    des actes concernés (« Erreur 162 : liste des actes concernés », puis une
    ligne « code<tab>libellé » par acte)."""
    erreurs, actes_concernes = [], {}
    section = None
    for n, ligne in enumerate((SOURCES / "FG_erreurs.TXT").read_bytes().decode("cp1252").splitlines(), start=1):
        if not ligne.strip():
            continue
        ou = f"FG_erreurs.TXT, ligne {n}"
        morceaux = [m.strip() for m in ligne.split("|")]
        m = re.fullmatch(r"Erreur (\d+)\s*:.*", texte(ligne))
        if len(morceaux) == 3 and section is None:
            if not morceaux[0].isdigit() or morceaux[2] not in ("Bloquant", "Non-bloquant"):
                raise ErreurDonnees(f"{ou} : ligne illisible {ligne!r}")
            erreurs.append([int(morceaux[0]), morceaux[1], morceaux[2] == "Bloquant"])
        elif m:
            section = int(m.group(1))
            if section not in {e[0] for e in erreurs} or section in actes_concernes:
                raise ErreurDonnees(f"{ou} : liste d'actes d'une erreur inconnue ou déjà lue")
            actes_concernes[section] = []
        elif section is not None and re.fullmatch(r"[A-Z]{3}\+\d{3}\t.+", ligne.strip()):
            code, libelle = ligne.strip().split("\t", 1)
            actes_concernes[section].append([code, texte(libelle)])
        else:
            raise ErreurDonnees(f"{ou} : ligne illisible {ligne!r}")
    return erreurs, actes_concernes


# ==== Tarifs ====

COLONNES_TARIFS = {
    "GMT": "GMT",
    "GME": "GME",
    "Libellé": "Libellé",
    "Début de zone forfaitaire (DZF)": "DZF",
    "Fin de Zone Forfaitaire (FZF)": "FZF",
    "Tarif de la zone basse (TZB)": "TZB",
    "Supplément de la zone basse (SZB)": "SZB",
    "Tarif de la Zone Forfaitaire - Période 1 (TZF1)": "TZF1",
    "Tarif de la Zone Forfaitaire - Période 2 (TZF2)": "TZF2",
    "Tarif de la Zone Forfaitaire - Période 3 (TZF3)": "TZF3",
    "Supplément de la Zone Haute (SZH)": "SZH",
}
FEUILLE_TARIFS = "Tarifs GMT - DAF"
TITRE_TARIFS = "Annexe I : Tarifs des groupes médico-tarifaires (GMT) des établissements de santé mentionnés aux a, b et c de l'article L. 162-22 du code de la sécurité sociale."

# Campagne de l'arrêté, que le classeur ne nomme nulle part : déclarée ici
# avec l'empreinte SHA-256 du classeur. Remplacer tarifs.xlsx sans mettre
# cette ligne à jour arrête la conversion.
CAMPAGNE_TARIFS = (2026, "da188708ac9e94ab1cd416b1881c766c3dcd4b37c9e6e7120fa5825e9ce44e76")


def lire_tarifs(groupes):
    annee, empreinte = CAMPAGNE_TARIFS
    lue = hashlib.sha256((SOURCES / "tarifs.xlsx").read_bytes()).hexdigest()
    if lue != empreinte:
        raise ErreurDonnees(f"tarifs.xlsx a changé : déclarer sa campagne dans CAMPAGNE_TARIFS, avec son empreinte {lue}")
    classeur = load_workbook(SOURCES / "tarifs.xlsx", read_only=True, data_only=True)
    try:
        ws = classeur[FEUILLE_TARIFS]
        ws.reset_dimensions()
        brutes = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        classeur.close()
    titres = [i for i, r in enumerate(brutes) if r and texte(r[0]) == texte(TITRE_TARIFS)]
    entetes = [i for i, r in enumerate(brutes) if r and texte(r[0]) == "GMT"]
    if len(titres) != 1 or len(entetes) != 1 or entetes[0] < titres[0]:
        raise ErreurDonnees(f"tarifs.xlsx, {FEUILLE_TARIFS} : titre ou en-tête introuvable")
    entete = [texte(c) for c in brutes[entetes[0]]]
    while entete and not entete[-1]:
        entete.pop()
    if entete != list(COLONNES_TARIFS):
        raise ErreurDonnees(f"tarifs.xlsx : en-tête inattendu {entete}")
    tarifs = []
    couples = set()
    for n, r in enumerate(brutes[entetes[0] + 1:], start=entetes[0] + 2):
        r = (r + [None] * 11)[:11] if len(r) >= 11 else r + [None] * (11 - len(r))
        if all(v is None or not texte(v) for v in r):
            continue
        ou = f"tarifs.xlsx, ligne {n}"
        gmt, gme = texte(r[0]), texte(r[1])
        if not re.fullmatch(r"\d{4}", gmt):
            raise ErreurDonnees(f"{ou} : GMT illisible {gmt!r}")
        if gme not in groupes["GME"]:
            raise ErreurDonnees(f"{ou} : GME {gme!r} absent de TOTAL_listes_groupes.xlsx")
        if (gmt, gme) in couples:
            raise ErreurDonnees(f"{ou} : couple GMT {gmt} / GME {gme} en double")
        couples.add((gmt, gme))
        dzf, fzf = nombre(r[3], ou, entier=True), nombre(r[4], ou, entier=True)
        if fzf < dzf:
            raise ErreurDonnees(f"{ou} : fin de zone forfaitaire avant son début")
        montants = [nombre(x, ou, vide=True) for x in r[5:]]
        if montants[2] is None:
            raise ErreurDonnees(f"{ou} : tarif de la zone forfaitaire (période 1) absent")
        tarifs.append([gmt, gme, texte(r[2]), dzf, fzf, *montants])
    sans_tarif = sorted(set(groupes["GME"]) - {t[1] for t in tarifs})
    if sans_tarif:
        raise ErreurDonnees(f"tarifs.xlsx : GME sans tarif {sans_tarif[:10]}")
    return annee, tarifs


# ==== Écriture ====


def ecrire(nom: str, contenu: dict) -> None:
    SORTIE.mkdir(parents=True, exist_ok=True)
    cible = SORTIE / f"{nom}.json"
    cible.write_text(json.dumps(contenu, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{cible.relative_to(RACINE)} : {cible.stat().st_size // 1024} Ko")


def colonnaire(colonnes: list[str], valeurs: list[list], source: str, **extra) -> dict:
    """Le format de build_data.py, que chargerJeu() (donnees.js) relit."""
    return {"millesime": millesime(SOURCES / source), **extra, "colonnes": colonnes, "valeurs": valeurs}


def main() -> None:
    try:
        groupes = lire_groupes()
        cm_connues = set(groupes["CM"])
        diagnostics, listes = lire_diagnostics(cm_connues)
        tests = lire_tests(groupes, listes)
        gr = lire_gr(groupes)
        gl = lire_gl(groupes)
        verifier_gme(groupes, {"2303"})
        intervenants = lire_intervenants()
        ponderations = lire_ponderations(intervenants)
        modulateurs = lire_modulateurs()
        actes_spe, listes_spe, gn_liste = lire_actes_spe(groupes, {a[0] for a in ponderations})
        cma_ccam = lire_cma_ccam()
        exclusions_cma, listes_exclusion = lire_exclusions(diagnostics)
        transcodage, transposition, temps, lieu_csar, modulables = lire_csar(ponderations, intervenants)
        erreurs, actes_erreurs = lire_erreurs()
        campagne, tarifs = lire_tarifs(groupes)
    except ErreurDonnees as e:
        sys.exit(f"Conversion impossible : {e}")

    ecrire(
        "diagnostics",
        colonnaire(
            ["Code", "Libellé", "CM", "Profil", "Deuxième intention", "CMA", "Listes"],
            diagnostics,
            "CIM_infos_SMR.xlsx",
        ),
    )
    ecrire(
        "classification",
        {
            "millesimes": {
                f: millesime(SOURCES / f)
                for f in ("TOTAL_listes_groupes.xlsx", "GN_liste_tests.xlsx", "GR_infos.xlsx", "GL_infos.xlsx",
                          "ACTES_listes_SPE.xlsx", "CMA_CCAM.xlsx", "CSAR_infos.xlsx", "FG_erreurs.TXT")
            },
            "groupes": groupes,
            "listes": listes,
            "tests": tests,
            "gr": gr,
            "gl": gl,
            "classesAge": CLASSES_AGE,
            "listesSpe": listes_spe,
            "gnListeSpe": gn_liste,
            "cmaCcam": cma_ccam,
            "intervenants": intervenants,
            "modulateurs": modulateurs,
            "csar": {"transposition": transposition, "temps": temps, "lieu": lieu_csar, "modulables": modulables},
            "erreurs": erreurs,
            "actesErreurs": actes_erreurs,
        },
    )
    ecrire(
        "exclusions",
        {"millesime": millesime(SOURCES / "CMA_exclusion.xlsx"), "cma": exclusions_cma, "listes": listes_exclusion},
    )
    ecrire(
        "actes",
        colonnaire(
            ["Code", "Nomenclature", "Type", "Statut", "Intervenant", "Hiérarchie", "Libellé", "Pondération",
             "Valide", "Début", "Fin", "HW", "LJ", "XH", "L3"],
            ponderations,
            "ACTES_ponderations.xlsx",
        ),
    )
    ecrire(
        "actes_spe",
        colonnaire(["Code", "Hiérarchie", "Nomenclature", "Libellé", "CM", "Liste", "Libellé liste"], actes_spe, "ACTES_listes_SPE.xlsx"),
    )
    ecrire(
        "csar",
        colonnaire(
            ["Code CSAR", "Libellé CSAR", "Intervenant", "Modalité", "Code CSARR", "Libellé CSARR", "Équivalent",
             "Pondération CSAR", "Pondération CSARR"],
            transcodage,
            "CSAR_infos.xlsx",
        ),
    )
    ecrire(
        "tarifs",
        colonnaire(list(COLONNES_TARIFS.values()), tarifs, "tarifs.xlsx", campagne=campagne),
    )


if __name__ == "__main__":
    main()
