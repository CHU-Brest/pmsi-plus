"""Tests des fonctions pures des scripts de conversion.

    pip install -r scripts/requirements.txt
    python -m unittest discover tests
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_arbre  # noqa: E402
import build_cma  # noqa: E402
import build_data  # noqa: E402
import build_smr  # noqa: E402


class CodeCim(unittest.TestCase):
    def test_point_apres_la_categorie(self):
        self.assertEqual(build_data.code_cim("C169+0"), "C16.9+0")
        self.assertEqual(build_data.code_cim("B24+0"), "B24.+0")
        self.assertEqual(build_data.code_cim(" A09 "), "A09")
        self.assertEqual(build_smr.code_cim("C169+0"), "C16.9+0")


class EnteteTarifs(unittest.TestCase):
    ATTENDU = list(build_data.COLONNES_XLSX["tarifs.xlsx"])

    def test_intitules_sur_plusieurs_lignes_et_cellules_vides_au_bout(self):
        lus = [e.replace("TARIF (en euros)", "TARIF\n(en euros)") for e in self.ATTENDU] + ["", ""]
        self.assertEqual(build_data.renommer("tarifs.xlsx", lus)[5], "Tarif")

    def test_colonne_deplacee(self):
        with self.assertRaises(build_data.ErreurDonnees):
            build_data.renommer("tarifs.xlsx", self.ATTENDU[1:] + self.ATTENDU[:1])


def ligne_tarif(**remplace):
    ligne = {
        "GHS": 22, "GHM": "01C031", "Libellé": "Craniotomies", "Borne basse": 0, "Borne haute": 30,
        "Tarif": 10000.5, "Forfait EXB": 0, "Tarif EXB": 0, "Tarif EXH": 300.0,
    }
    return ligne | remplace


class VerifierTarifs(unittest.TestCase):
    def verifier(self, *lignes):
        with self.assertRaises(build_data.ErreurDonnees) as e:
            build_data.verifier_tarifs(list(lignes))
        return str(e.exception)

    def test_couple_en_double(self):
        self.assertIn("couple en double", self.verifier(ligne_tarif(), ligne_tarif()))

    def test_borne_haute_sous_la_borne_basse(self):
        self.assertIn("borne haute", self.verifier(ligne_tarif(**{"Borne basse": 30, "Borne haute": 30})))

    def test_extreme_bas_sans_borne_basse(self):
        self.assertIn("extrême bas sans borne basse", self.verifier(ligne_tarif(**{"Tarif EXB": 50.0})))

    def test_montant_au_dela_du_centime(self):
        self.assertIn("Tarif illisible", self.verifier(ligne_tarif(Tarif=10.001)))

    def test_meme_ghs_deux_tarifs(self):
        self.assertIn("différents", self.verifier(ligne_tarif(), ligne_tarif(GHM="01C032", Tarif=1.0)))

    def test_ligne_valide(self):
        build_data.verifier_tarifs([ligne_tarif()])


class CouvertureRacines(unittest.TestCase):
    def test_racine_inconnue(self):
        with self.assertRaisesRegex(build_data.ErreurDonnees, r"absente\(s\) de racines.xlsx \['01C03'\]"):
            build_data.verifier_couverture_racines([ligne_tarif()], {"01C04"} | build_data.RACINES_SANS_TARIF)

    def test_racine_sans_tarif(self):
        with self.assertRaisesRegex(build_data.ErreurDonnees, r"sans aucun GHS \['01C04'\]"):
            build_data.verifier_couverture_racines([ligne_tarif()], {"01C03", "01C04"})

    def test_racines_sans_tarif_connues(self):
        build_data.verifier_couverture_racines([ligne_tarif()], {"01C03"} | build_data.RACINES_SANS_TARIF)


class RegleCombinee(unittest.TestCase):
    def test_tranches_continues(self):
        self.assertEqual(
            build_smr.lire_regle_combinee("age 18_70 -> B; age 71_plus --> A;", "t"),
            [[18, 70, "B"], [71, None, "A"]],
        )

    def test_tranches_discontinues(self):
        with self.assertRaises(build_smr.ErreurDonnees):
            build_smr.lire_regle_combinee("age 18_70 -> B; age 72_plus -> A", "t")

    def test_tranches_sans_fin(self):
        with self.assertRaises(build_smr.ErreurDonnees):
            build_smr.lire_regle_combinee("age 18_70 -> B", "t")


class CellulesSmr(unittest.TestCase):
    def test_drapeau(self):
        self.assertTrue(build_smr.drapeau("x", "t"))
        self.assertFalse(build_smr.drapeau(None, "t"))
        with self.assertRaises(build_smr.ErreurDonnees):
            build_smr.drapeau("peut-être", "t")

    def test_nombre(self):
        self.assertEqual(build_smr.nombre(3.0, "t", entier=True), 3)
        self.assertIsNone(build_smr.nombre("  ", "t", vide=True))
        with self.assertRaises(build_smr.ErreurDonnees):
            build_smr.nombre(3.5, "t", entier=True)
        with self.assertRaises(build_smr.ErreurDonnees):
            build_smr.nombre("12", "t")


class ListesAnnexe5(unittest.TestCase):
    def test_listes_recollees(self):
        lignes = ["Texte explicatif", "1 A00 B01-", "B02", "2 C00"]
        self.assertEqual(
            build_cma.listes_numerotees(lignes, build_cma.RE_ELEMENT_DP, "t"),
            {1: ["A00", "B01-B02"], 2: ["C00"]},
        )

    def test_numerotation_qui_saute(self):
        with self.assertRaises(build_cma.ErreurExtraction):
            build_cma.listes_numerotees(["1 A00", "3 C00"], build_cma.RE_ELEMENT_DP, "t")


class NiveauxCma(unittest.TestCase):
    def test_csv_absent(self):
        with mock.patch.object(build_cma, "CSV_CMA", Path(__file__).parent / "absent" / "cma.csv"):
            with self.assertRaisesRegex(build_cma.ErreurExtraction, "cma.csv introuvable"):
                build_cma.verifier([["A00.0", 2, None, None]], {}, {})


class ArbreSansBoucle(unittest.TestCase):
    def test_boucle(self):
        noeuds = {"a": {"suite": {"vers": "b"}}, "b": {"sinon": {"vers": "a"}}}
        with self.assertRaises(build_arbre.ErreurExtraction):
            build_arbre.verifier_sans_boucle(noeuds)

    def test_noeud_rejoint_par_deux_chemins(self):
        noeuds = {"a": {"branches": [{"vers": "c"}], "sinon": {"vers": "b"}}, "b": {"suite": {"vers": "c"}}, "c": {}}
        build_arbre.verifier_sans_boucle(noeuds)


if __name__ == "__main__":
    unittest.main()
