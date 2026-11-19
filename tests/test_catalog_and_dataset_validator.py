"""
Tests for Commit 6:
  - catalog/signs_catalog.json v1.4.0 pilot set (8-10 classes, verified sources, 4 rest hard-negative sub-regimes)
  - docs/dataset-generator/FEATURE_SPEC.md v1.4.0 alignment
  - expresat-dataset-generator/scripts/validate_dataset.py hardening against synthetic stubs & empty frames
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "expresat"))
sys.path.insert(0, str(REPO / "expresat-dataset-generator" / "scripts"))

from models.feature_extractor import FEATURE_SPEC_VERSION, extract_window
import validate_dataset as vd


def _make_valid_v140_samples(label: str = "hola", n_samples: int = 4) -> list[list[list[float]]]:
    """Generate realistic valid v1.4.0 windows via canonical extract_window."""
    samples = []
    for s in range(n_samples):
        frames = []
        for i in range(20):
            dx = 0.002 * i + 0.005 * s
            pose = [{"x": 0.50, "y": 0.50, "z": 0.0, "visibility": 0.95} for _ in range(33)]
            pose[0] = {"x": 0.50 + dx * 0.2, "y": 0.20, "z": -0.04, "visibility": 0.99}
            pose[11] = {"x": 0.62, "y": 0.40, "z": 0.0, "visibility": 0.95}
            pose[12] = {"x": 0.38, "y": 0.40, "z": 0.0, "visibility": 0.95}
            pose[13] = {"x": 0.66, "y": 0.55, "z": 0.01, "visibility": 0.90}
            pose[14] = {"x": 0.34, "y": 0.55, "z": -0.01, "visibility": 0.90}
            pose[15] = {"x": 0.68 + dx, "y": 0.65, "z": -0.50, "visibility": 0.92}
            pose[16] = {"x": 0.32, "y": 0.65, "z": -0.50, "visibility": 0.92}
            for idx in range(17, 23):
                pose[idx] = {"x": 0.68 if idx % 2 == 1 else 0.32, "y": 0.68, "z": -0.60, "visibility": 0.85}

            hands = []
            if label != "reposo":
                h = [{"x": 0.68 + dx + 0.002 * k, "y": 0.65 - 0.003 * k, "z": -0.01 * (k % 3)} for k in range(21)]
                hands = [{"landmarks": h, "categoryName": "Left", "score": 0.96}]

            frames.append({"t_ms": float(i * 55.0), "pose": pose, "hands": hands})
        tensor, valid, err = extract_window(frames, target_fps=15, duration_ms=1000.0)
        assert valid and tensor is not None, f"extract_window falló: {err}"
        samples.append(tensor[0].tolist())
    return samples


class TestCatalogAndFeatureSpecDocV140(unittest.TestCase):
    def test_pilot_catalog_v140_contract(self):
        catalog_path = REPO / "catalog" / "signs_catalog.json"
        with open(catalog_path, "r", encoding="utf-8") as f:
            cat = json.load(f)

        self.assertEqual(cat.get("catalog_version"), "1.4.0")
        self.assertEqual(cat.get("feature_spec_version"), FEATURE_SPEC_VERSION)

        signos = cat.get("signos", [])
        self.assertGreaterEqual(len(signos), 8)
        self.assertLessEqual(len(signos), 10)

        ids = [s["id"] for s in signos]
        self.assertEqual(len(ids), len(set(ids)), "IDs duplicados en signs_catalog.json")
        self.assertIn("reposo", ids)

        static_active = [s for s in signos if s["id"] != "reposo" and s["modo"] == "estatica"]
        dynamic_active = [s for s in signos if s["id"] != "reposo" and s["modo"] == "dinamica"]
        self.assertGreaterEqual(len(static_active), 3, "El set piloto debe incluir señas estáticas")
        self.assertGreaterEqual(len(dynamic_active), 3, "El set piloto debe incluir señas dinámicas")

        for s in signos:
            self.assertNotEqual(s.get("fuente"), "PENDIENTE_FUENTE", f"Seña piloto sin fuente: {s['id']}")
            if s["id"] == "reposo":
                subregimes = s.get("hard_negative_subregimes", [])
                self.assertEqual(len(subregimes), 4, "reposo debe declarar exactamente 4 sub-regímenes hard negative")
                sub_ids = {sr["id"] for sr in subregimes}
                self.assertEqual(
                    sub_ids,
                    {
                        "brazos_abajo",
                        "manos_quietas_en_cuadro",
                        "movimiento_cotidiano",
                        "transicion_entrada_salida",
                    },
                )
            else:
                fuente_url = s.get("fuente_url", "")
                self.assertTrue(
                    fuente_url.startswith("https://"),
                    f"Seña piloto '{s['id']}' requiere fuente_url HTTPS verificable",
                )

    def test_feature_spec_md_updated_to_v140(self):
        spec_text = (REPO / "docs" / "dataset-generator" / "FEATURE_SPEC.md").read_text(encoding="utf-8")
        self.assertIn("`1.4.0`", spec_text)
        self.assertIn("2d_iso_4_3", spec_text)
        self.assertIn("P15..P22", spec_text)
        self.assertIn("IncompatibleFeatureSpecError", spec_text)
        self.assertIn("ERR_WINDOW_TAIL_EXTRAPOLATION", spec_text)
        self.assertIn("ERR_WINDOW_LOW_UNIQUE_FRAMES", spec_text)
        self.assertIn("ERR_WINDOW_HIGH_INTERPOLATION", spec_text)


class TestDatasetValidatorHardening(unittest.TestCase):
    def _write_temp_dataset(self, payload: dict) -> Path:
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        p = Path(td.name) / f"{payload.get('label', 'sample')}.json"
        p.write_text(json.dumps(payload), encoding="utf-8")
        return p

    def test_rejects_synthetic_sine_stub_with_unnormalized_shoulders_and_vis_overflow(self):
        # Mimics legacy letra_a_derecha_2.json (D_norm ~ 0.046, visibility > 1.0)
        stub_sample = []
        for t in range(15):
            frame = [0.0] * 178
            for u in range(13):
                frame[u * 4 + 0] = 0.5 + 0.02 * math.cos(t + 0.3 * u)
                frame[u * 4 + 1] = 0.5 + 0.02 * math.sin(t + 0.3 * u)
                frame[u * 4 + 2] = 0.01
                frame[u * 4 + 3] = 1.0201  # visibility overflow from legacy augmenter
            for j in range(52, 115):
                frame[j] = 0.1 * math.sin(t + j)
            stub_sample.append(frame)

        p = self._write_temp_dataset({"label": "letra_a", "data": [stub_sample, stub_sample]})
        res = vd.validate_file(p, strict=False, min_samples=1)
        self.assertEqual(res["status"], "ERROR", f"Stub sintético no fue rechazado: {res}")

    def test_rejects_empty_zero_frames_and_active_sign_without_hands(self):
        zero_sample = [[0.0] * 178 for _ in range(15)]
        p_zero = self._write_temp_dataset({"label": "hola", "data": [zero_sample]})
        res_zero = vd.validate_file(p_zero, strict=False, min_samples=1)
        self.assertEqual(res_zero["status"], "ERROR")

        # Valid pose but zero hands on active sign 'hola' -> MUST fail
        no_hand_samples = _make_valid_v140_samples(label="reposo", n_samples=2)
        p_no_hands = self._write_temp_dataset({"label": "hola", "data": no_hand_samples})
        res_nh = vd.validate_file(p_no_hands, strict=False, min_samples=1)
        self.assertEqual(res_nh["status"], "ERROR", f"Seña activa sin manos no fue rechazada: {res_nh}")

    def test_rejects_frozen_cloned_frames_and_nonzero_p15_z(self):
        valid_samples = _make_valid_v140_samples(label="hola", n_samples=2)

        # Clone frame 0 across all 15 frames (temporal variance == 0)
        frozen = [[list(valid_samples[0][0]) for _ in range(15)] for _ in range(2)]
        p_frozen = self._write_temp_dataset({"label": "hola", "data": frozen})
        res_frozen = vd.validate_file(p_frozen, strict=False, min_samples=1)
        self.assertEqual(res_frozen["status"], "ERROR", f"Frames clonados congelados no rechazados: {res_frozen}")

        # Corrupt P15 z' (index 5*4+2 = 22) to violate v1.4.0 z'=0.0 invariant
        corrupt = json.loads(json.dumps(valid_samples))
        corrupt[0][0][22] = -0.85
        p_corrupt = self._write_temp_dataset({"label": "hola", "data": corrupt})
        res_corrupt = vd.validate_file(p_corrupt, strict=False, min_samples=1)
        self.assertEqual(res_corrupt["status"], "ERROR", f"Violación P15..P22 z'=0 no rechazada: {res_corrupt}")

    def test_accepts_valid_v140_active_and_reposo_datasets(self):
        active_samples = _make_valid_v140_samples(label="hola", n_samples=3)
        p_ok = self._write_temp_dataset({"label": "hola", "data": active_samples})
        res_ok = vd.validate_file(p_ok, strict=False, min_samples=1)
        self.assertEqual(res_ok["status"], "OK", f"Dataset válido v1.4.0 rechazado: {res_ok}")

        reposo_samples = _make_valid_v140_samples(label="reposo", n_samples=3)
        p_rep = self._write_temp_dataset({"label": "reposo", "data": reposo_samples})
        res_rep = vd.validate_file(p_rep, strict=False, min_samples=1)
        self.assertEqual(res_rep["status"], "OK", f"Dataset reposo válido v1.4.0 rechazado: {res_rep}")


if __name__ == "__main__":
    unittest.main()
