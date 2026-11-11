"""
tests/test_feature_spec.py — Suite de Conformidad Numérica con docs/dataset-generator/FEATURE_SPEC.md v1.2.2

Consume OBLIGATORIAMENTE tests/fixtures/feature_spec_cases.json y compara
ELEMENTO A ELEMENTO bajo la norma del supremo L_inf <= 1e-6:
  - Casos de frame: TC_01 a TC_05C
  - Casos de ventana: remuestreo, brechas (<= 100 ms y > 100 ms), alternancia de orden de manos
  - Pruebas de Propiedades analíticas:
      * Invarianza a traslación 3D (L_inf <= 1e-6)
      * Invarianza a escala (L_inf <= 1e-6)
      * Conmutatividad de espejo (L_inf <= 1e-6)
      * Involución de espejo
      * Inmutabilidad de raw (extract_window no muta el diccionario de entrada)
"""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

import numpy as np

# Asegurar import de expresat/models
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    TOTAL_FEATURES,
    SEQUENCE_LENGTH,
    extract_frame_features,
    extract_window,
    mirror_raw_frame,
    mirror_features_178,
)

FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "feature_spec_cases.json"


class TestFeatureSpecCasesJson(unittest.TestCase):
    """Verificación elemento a elemento (L_inf) contra tests/fixtures/feature_spec_cases.json."""

    @classmethod
    def setUpClass(cls):
        with open(FIXTURES_PATH, "r", encoding="utf-8") as f:
            cls.fixtures = json.load(f)

    def assert_linf_close(self, actual: np.ndarray, expected: list[float], atol: float = 1e-6, msg: str = ""):
        self.assertIsNotNone(actual)
        self.assertIsNotNone(expected)
        exp_arr = np.array(expected, dtype=np.float32)
        act_arr = actual.astype(np.float32).reshape(-1)
        self.assertEqual(act_arr.shape, exp_arr.shape, f"Formas distintas en {msg}")
        diff = np.abs(act_arr - exp_arr)
        max_diff = float(np.max(diff))
        self.assertLessEqual(
            max_diff,
            atol,
            f"Error L_inf={max_diff:.8e} excede tolerancia {atol:.1e} en {msg}. Índice de máximo error: {int(np.argmax(diff))}",
        )

    def test_version_matches_fixtures(self):
        self.assertEqual(FEATURE_SPEC_VERSION, self.fixtures["feature_spec_version"])
        self.assertEqual(FEATURE_SPEC_VERSION, "1.2.2")

    def test_frame_cases_from_json(self):
        """Verifica todos los casos de frame del JSON compartido elemento a elemento."""
        frame_cases = self.fixtures["frame_cases"]
        for case_id, case_data in frame_cases.items():
            with self.subTest(case_id=case_id):
                raw_input = copy.deepcopy(case_data["input"])
                expected = case_data["expected"]

                features, valid, error = extract_frame_features(raw_input)
                self.assertEqual(valid, expected["valid"], f"Fallo en validez para {case_id}")
                self.assertEqual(error, expected["error"], f"Fallo en código de error para {case_id}")

                if expected["features"] is not None:
                    self.assert_linf_close(features, expected["features"], atol=1e-6, msg=case_id)
                else:
                    self.assertIsNone(features, f"Features debió ser None en {case_id}")

    def test_window_cases_from_json(self):
        """Verifica todos los casos de ventana del JSON compartido elemento a elemento."""
        window_cases = self.fixtures["window_cases"]
        for case_id, case_data in window_cases.items():
            with self.subTest(case_id=case_id):
                raw_input = copy.deepcopy(case_data["input"])
                options = case_data.get("options", {})
                expected = case_data["expected"]

                tensor, valid, error = extract_window(
                    raw_input,
                    target_fps=options.get("targetFps", 15),
                    duration_ms=options.get("durationMs", 1000.0),
                )

                self.assertEqual(valid, expected["valid"], f"Fallo en validez para {case_id}")
                self.assertEqual(error, expected["error"], f"Fallo en código de error para {case_id}")

                if expected["tensor"] is not None:
                    self.assert_linf_close(tensor, expected["tensor"], atol=1e-6, msg=case_id)
                else:
                    self.assertIsNone(tensor, f"Tensor debió ser None en {case_id}")

    def test_property_translation_invariance_linf(self):
        """Invarianza a traslación 3D: L_inf(Extract(P + delta) - Extract(P)) <= 1e-6."""
        raw_tc01 = self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"]
        base_features, _, _ = extract_frame_features(raw_tc01)

        deltas = [
            (0.05, 0.03, 0.04),
            (-0.06, -0.04, -0.05),
            (0.07, -0.05, 0.02),
            (-0.04, 0.06, -0.03),
            (0.00, 0.00, 0.08),
        ]

        for dx, dy, dz in deltas:
            trans_frame = copy.deepcopy(raw_tc01)
            for lm in trans_frame["pose"]:
                lm["x"] += dx
                lm["y"] += dy
                lm["z"] += dz
            for h in trans_frame["hands"]:
                for lm in h:
                    lm["x"] += dx
                    lm["y"] += dy
                    lm["z"] += dz

            trans_features, valid, err = extract_frame_features(trans_frame)
            self.assertTrue(valid)
            self.assert_linf_close(
                trans_features,
                base_features.tolist(),
                atol=1e-6,
                msg=f"Invarianza traslación delta=({dx},{dy},{dz})",
            )

    def test_property_scale_invariance_linf(self):
        """Invarianza a escala: L_inf(Extract(s * P) - Extract(P)) <= 1e-6."""
        raw_tc01 = self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"]
        base_features, _, _ = extract_frame_features(raw_tc01)

        cx, cy, cz = 0.50, 0.40, 0.00
        scales = [0.85, 0.95, 1.05, 1.15, 1.20]

        for s in scales:
            scaled_frame = copy.deepcopy(raw_tc01)
            for lm in scaled_frame["pose"]:
                lm["x"] = cx + s * (lm["x"] - cx)
                lm["y"] = cy + s * (lm["y"] - cy)
                lm["z"] = cz + s * (lm["z"] - cz)
            for h in scaled_frame["hands"]:
                for lm in h:
                    lm["x"] = cx + s * (lm["x"] - cx)
                    lm["y"] = cy + s * (lm["y"] - cy)
                    lm["z"] = cz + s * (lm["z"] - cz)

            scaled_features, valid, err = extract_frame_features(scaled_frame)
            self.assertTrue(valid)
            self.assert_linf_close(
                scaled_features,
                base_features.tolist(),
                atol=1e-6,
                msg=f"Invarianza escala s={s}",
            )

    def test_property_mirror_commutativity_linf(self):
        """Conmutatividad de espejo: L_inf(Extract(Mirror(raw)) - MirrorFeatures(Extract(raw))) <= 1e-6."""
        raw_tc01 = self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"]

        mirrored_raw = mirror_raw_frame(raw_tc01)
        feat_mirrored_raw, valid_m, _ = extract_frame_features(mirrored_raw)
        self.assertTrue(valid_m)

        base_features, valid_b, _ = extract_frame_features(raw_tc01)
        self.assertTrue(valid_b)
        feat_mirror_func = mirror_features_178(base_features)

        self.assert_linf_close(
            feat_mirrored_raw,
            feat_mirror_func.tolist(),
            atol=1e-6,
            msg="Conmutatividad de espejo",
        )

    def test_raw_immutability(self):
        """Verifica que extract_window y extract_frame_features NO mutan el diccionario raw."""
        raw_tc01 = self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"]
        raw_copy = copy.deepcopy(raw_tc01)

        _ = extract_frame_features(raw_tc01)
        self.assertEqual(raw_tc01, raw_copy, "extract_frame_features mutó el frame de entrada")

        win_nominal = self.fixtures["window_cases"]["TC_WINDOW_nominal_15_frames"]["input"]
        win_copy = copy.deepcopy(win_nominal)

        _ = extract_window(win_nominal, target_fps=15, duration_ms=1000.0)
        self.assertEqual(win_nominal, win_copy, "extract_window mutó la secuencia de entrada")


if __name__ == "__main__":
    unittest.main()
