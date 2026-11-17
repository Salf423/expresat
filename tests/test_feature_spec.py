"""
Numerical conformance suite against docs/dataset-generator/FEATURE_SPEC.md v1.2.2.

Compares against tests/fixtures/feature_spec_cases.json element-by-element under
L_inf <= 1e-6 for frame cases, window cases, and analytical invariants
(translation, scale, mirror commutativity/involution, and input immutability).
"""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "schemas"))

from validate_recording import validate_recording

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    TOTAL_FEATURES,
    SEQUENCE_LENGTH,
    extract_frame_features,
    extract_window,
    mirror_raw_frame,
    mirror_features_178,
    compute_config_hash,
    get_fixtures_sha256,
    validate_frame_hand_labels,
    assign_hands_to_anatomical_slots,
)

FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "feature_spec_cases.json"


class TestFeatureSpecCasesJson(unittest.TestCase):
    """Element-wise (L_inf) verification against tests/fixtures/feature_spec_cases.json."""

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
        self.assertEqual(FEATURE_SPEC_VERSION, "1.3.0")

    def test_config_hash_incorporates_fixtures_sha256(self):
        fixtures_hash = get_fixtures_sha256()
        self.assertEqual(len(fixtures_hash), 64)
        c_hash = compute_config_hash(fixtures_hash)
        self.assertEqual(len(c_hash), 64)
        self.assertEqual(c_hash, compute_config_hash(fixtures_hash))

    def test_frame_cases_from_json(self):
        """Verify all shared JSON frame cases element-by-element."""
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
        """Verify all shared JSON window cases element-by-element."""
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
        """3D translation invariance: L_inf(Extract(P + delta) - Extract(P)) <= 1e-6."""
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
        """Scale invariance: L_inf(Extract(s * P) - Extract(P)) <= 1e-6."""
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
        """Mirror commutativity: L_inf(Extract(Mirror(raw)) - MirrorFeatures(Extract(raw))) <= 1e-6."""
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
        """Verify extract_window and extract_frame_features do not mutate the raw input."""
        raw_tc01 = self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"]
        raw_copy = copy.deepcopy(raw_tc01)

        _ = extract_frame_features(raw_tc01)
        self.assertEqual(raw_tc01, raw_copy, "extract_frame_features mutó el frame de entrada")

        win_nominal = self.fixtures["window_cases"]["TC_WINDOW_nominal_15_frames"]["input"]
        win_copy = copy.deepcopy(win_nominal)

        _ = extract_window(win_nominal, target_fps=15, duration_ms=1000.0)
        self.assertEqual(win_nominal, win_copy, "extract_window mutó la secuencia de entrada")

    def test_hands_without_label_fails(self):
        """Verify frames with detected hands missing categoryName or marked 'Unknown' fail the label gate."""
        base_raw = copy.deepcopy(self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"])

        # Case 1: Hand present with empty handedness / missing categoryName
        raw_no_label = copy.deepcopy(base_raw)
        raw_no_label["handedness"] = []
        raw_no_label["hands"] = [
            [{"x": 0.63, "y": 0.50, "z": 0.0}] * 21
        ]
        valid, error = validate_frame_hand_labels(raw_no_label)
        self.assertFalse(valid)
        self.assertIn("ERR_HAND_MISSING_LABEL", error)

        # Case 2: Explicit "Unknown" categoryName
        raw_unknown = copy.deepcopy(base_raw)
        raw_unknown["handedness"] = [[{"categoryName": "Unknown", "score": 0.5}]]
        raw_unknown["hands"] = [
            [{"x": 0.63, "y": 0.50, "z": 0.0}] * 21
        ]
        valid, error = validate_frame_hand_labels(raw_unknown)
        self.assertFalse(valid)
        self.assertIn("ERR_HAND_MISSING_LABEL", error)

        # Case 3: Recorder object format with categoryName 'Unknown'
        raw_dev_unknown = copy.deepcopy(base_raw)
        raw_dev_unknown["hands"] = [
            {"landmarks": [{"x": 0.63, "y": 0.50, "z": 0.0}] * 21, "categoryName": "Unknown", "score": 0.5}
        ]
        valid, error = validate_frame_hand_labels(raw_dev_unknown)
        self.assertFalse(valid)
        self.assertIn("ERR_HAND_MISSING_LABEL", error)

        # Case 4: Valid hand label passes
        raw_valid = copy.deepcopy(base_raw)
        raw_valid["hands"] = [
            {"landmarks": [{"x": 0.63, "y": 0.50, "z": 0.0}] * 21, "categoryName": "Right", "score": 0.95}
        ]
        valid, error = validate_frame_hand_labels(raw_valid)
        self.assertTrue(valid)
        self.assertIsNone(error)

    def test_crossed_hands_and_wrists_preserves_identity(self):
        """
        Spatially crossed hands and pose wrists (P16 accompanies physical right hand,
        P15 accompanies physical left hand) must preserve anatomical slot identity.
        """
        raw = copy.deepcopy(self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"])
        pose = raw["pose"]
        D = 0.30

        # Pose wrists crossed in space: P15 at x=0.40, P16 at x=0.60
        pose[15]["x"] = 0.40
        pose[15]["y"] = 0.50
        pose[15]["visibility"] = 0.95

        pose[16]["x"] = 0.60
        pose[16]["y"] = 0.50
        pose[16]["visibility"] = 0.95

        # Physical left hand ('Right' label) near P15; physical right hand ('Left' label) near P16
        hand_left = [{"x": 0.40, "y": 0.50, "z": 0.0}] * 21
        hand_right = [{"x": 0.60, "y": 0.50, "z": 0.0}] * 21

        raw["hands"] = [
            {"landmarks": hand_left, "categoryName": "Right", "score": 0.95},
            {"landmarks": hand_right, "categoryName": "Left", "score": 0.95},
        ]
        raw["handedness"] = [
            [{"categoryName": "Right", "score": 0.95}],
            [{"categoryName": "Left", "score": 0.95}],
        ]

        assigned_l, assigned_r, is_ambig = assign_hands_to_anatomical_slots(raw, pose, D)
        self.assertIsNotNone(assigned_l, "Bloque izquierdo debe estar asignado")
        self.assertIsNotNone(assigned_r, "Bloque derecho debe estar asignado")

        self.assertAlmostEqual(assigned_l[0]["x"], 0.40, places=4)
        self.assertAlmostEqual(assigned_r[0]["x"], 0.60, places=4)

    def test_swapped_pose_wrists_breaks_identity_without_temporal_prior(self):
        """
        If MediaPipe Pose swaps P15 and P16 across physical hands, spatial proximity
        to the swapped wrists outweighs the label penalty (0.50 * D), swapping slots.
        """
        raw = copy.deepcopy(self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"])
        pose = raw["pose"]
        D = 0.30

        # Erroneously swapped pose wrists: P15 placed at physical right (0.65), P16 at physical left (0.35)
        pose[15]["x"] = 0.65
        pose[15]["y"] = 0.50
        pose[15]["visibility"] = 0.95

        pose[16]["x"] = 0.35
        pose[16]["y"] = 0.50
        pose[16]["visibility"] = 0.95

        hand_left = [{"x": 0.35, "y": 0.50, "z": 0.0}] * 21
        hand_right = [{"x": 0.65, "y": 0.50, "z": 0.0}] * 21

        raw["hands"] = [
            {"landmarks": hand_left, "categoryName": "Right", "score": 0.95},
            {"landmarks": hand_right, "categoryName": "Left", "score": 0.95},
        ]
        raw["handedness"] = [
            [{"categoryName": "Right", "score": 0.95}],
            [{"categoryName": "Left", "score": 0.95}],
        ]

        assigned_l, assigned_r, is_ambig = assign_hands_to_anatomical_slots(raw, pose, D)

        # Swapped spatial cost (0.0) beats direct cost (0.60) even with label penalty (0.50 * D = 0.15)
        self.assertAlmostEqual(assigned_l[0]["x"], 0.65, places=4, msg="La identidad se intercambió debido a la inversión de muñecas de pose")
        self.assertAlmostEqual(assigned_r[0]["x"], 0.35, places=4, msg="La identidad se intercambió debido a la inversión de muñecas de pose")


class TestRecorderSchemaAndObjectMirror(unittest.TestCase):
    """JSON Schema validation for recorder payloads and object-hand mirror tests."""

    @classmethod
    def setUpClass(cls):
        fixtures_dir = Path(__file__).resolve().parent / "fixtures"
        with open(fixtures_dir / "feature_spec_cases.json", "r", encoding="utf-8") as f:
            cls.fixtures = json.load(f)
        cls.sample_v131_path = fixtures_dir / "sample_recording_recorder_v1_3_1.json"
        cls.legacy_sample_path = fixtures_dir / "sample_recording_5s.json"
        cls.real_rec_path = (
            Path(__file__).resolve().parent.parent
            / "recordings_local"
            / "grabacion_dev_18s_1794367978455.raw.json"
        )

    def test_schema_accepts_recorder_v1_3_1_fixture(self):
        with open(self.sample_v131_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self.assertEqual(validate_recording(payload), [])

    def test_schema_accepts_real_dev_recording_if_present(self):
        if not self.real_rec_path.exists():
            self.skipTest("recordings_local no presente en este entorno")
        with open(self.real_rec_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self.assertEqual(validate_recording(payload), [])

    def test_schema_rejects_legacy_bare_arrays_and_missing_keys(self):
        with open(self.legacy_sample_path, "r", encoding="utf-8") as f:
            legacy_payload = json.load(f)
        self.assertTrue(validate_recording(legacy_payload), "El formato legado de lista cruda debe fallar el schema del grabador")

        with open(self.sample_v131_path, "r", encoding="utf-8") as f:
            bad_bare_hand = json.load(f)
        bad_bare_hand["frames"][5]["hands"] = [bad_bare_hand["frames"][5]["hands"][0]["landmarks"]]
        self.assertTrue(validate_recording(bad_bare_hand), "Un arreglo crudo sin {landmarks, categoryName, score} debe fallar el schema")

        with open(self.sample_v131_path, "r", encoding="utf-8") as f:
            bad_missing_score = json.load(f)
        del bad_missing_score["frames"][5]["hands"][0]["score"]
        self.assertTrue(validate_recording(bad_missing_score), "Una mano sin 'score' debe fallar el schema")

    def test_tc06_recorder_object_hands_matches_canonical_tc01(self):
        feats_01, v1, _ = extract_frame_features(self.fixtures["frame_cases"]["TC_01_canonical_frame"]["input"])
        feats_06, v6, _ = extract_frame_features(self.fixtures["frame_cases"]["TC_06_recorder_object_hands"]["input"])
        self.assertTrue(v1 and v6)
        self.assertLessEqual(float(np.max(np.abs(feats_01 - feats_06))), 1e-6)

    @unittest.expectedFailure
    def test_mirror_raw_frame_object_hands_flips_x_category_and_involution(self):
        """Expected failure: mirror_raw_frame does not yet handle object-wrapped hand entries."""
        raw = copy.deepcopy(self.fixtures["frame_cases"]["TC_06_recorder_object_hands"]["input"])
        mirrored = mirror_raw_frame(raw)

        self.assertEqual(mirrored["hands"][0]["categoryName"], "Left")
        self.assertEqual(mirrored["hands"][1]["categoryName"], "Right")
        self.assertAlmostEqual(mirrored["hands"][0]["landmarks"][0]["x"], 1.0 - 0.70, places=6)
        self.assertAlmostEqual(mirrored["hands"][1]["landmarks"][0]["x"], 1.0 - 0.30, places=6)

        double_mirrored = mirror_raw_frame(mirrored)
        self.assertEqual(double_mirrored, raw)

    @unittest.expectedFailure
    def test_mirror_raw_frame_object_hands_asymmetric_commutativity_linf(self):
        """Expected failure: asymmetric mirror commutativity on object-wrapped hands."""
        base = copy.deepcopy(self.fixtures["frame_cases"]["TC_06_recorder_object_hands"]["input"])
        one_hand = {"pose": base["pose"], "hands": [base["hands"][0]]}

        mirrored = mirror_raw_frame(one_hand)
        feat_mirrored_raw, vm, _ = extract_frame_features(mirrored)
        feat_base, vb, _ = extract_frame_features(one_hand)
        self.assertTrue(vm and vb)
        feat_mirror_func = mirror_features_178(feat_base)

        max_diff = float(np.max(np.abs(feat_mirrored_raw.astype(np.float32) - feat_mirror_func.astype(np.float32))))
        self.assertLessEqual(max_diff, 1e-6, f"Conmutatividad objeto rota: L_inf={max_diff:.6f}")


class TestRealRecordingLateralityV140XFail(unittest.TestCase):
    """
    Expected-failure tests targeting proposed v1.4.0 direct laterality
    ('Left' -> leftHand, 'Right' -> rightHand) on 15 real dev recording frames
    while FEATURE_SPEC remains at v1.3.0.
    """

    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).resolve().parent / "fixtures" / "real_recording_laterality_15f.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            cls.real_fixture = json.load(f)

    @unittest.expectedFailure
    def test_real_15f_direct_laterality_frame_blocks_v140(self):
        """Expected failure pre-v1.4.0: direct Left->leftHand[52:115] and Right->rightHand[115:178] mapping."""
        for fr in self.real_fixture["frames"]:
            raw = {
                "pose": copy.deepcopy(fr["pose"]),
                "hands": copy.deepcopy(fr["hands"]),
            }
            feat, valid, err = extract_frame_features(raw)
            self.assertTrue(valid, f"Frame {fr['source_frame_idx']} inválido: {err}")

            has_left_block = bool(np.any(np.abs(feat[52:115]) > 1e-9))
            has_right_block = bool(np.any(np.abs(feat[115:178]) > 1e-9))
            expected_slots = fr["expected_pose_slots"]

            self.assertEqual(
                has_left_block,
                "leftHand" in expected_slots,
                f"Frame real {fr['source_frame_idx']} discrepa en slot izquierdo [52:115]",
            )
            self.assertEqual(
                has_right_block,
                "rightHand" in expected_slots,
                f"Frame real {fr['source_frame_idx']} discrepa en slot derecho [115:178]",
            )

            for hand_obj, slot in zip(fr["hands"], expected_slots):
                expected_cat = "Left" if slot == "leftHand" else "Right"
                self.assertEqual(hand_obj["categoryName"], expected_cat)

    @unittest.expectedFailure
    def test_real_15f_window_sequence_direct_laterality_and_ambig_v140(self):
        """Expected failure pre-v1.4.0: extract_window direct laterality mapping across transition and AMBIG frames."""
        dt_step = 1000.0 / 15.0
        window_frames = [
            {
                "t_ms": idx * dt_step,
                "pose": copy.deepcopy(fr["pose"]),
                "hands": copy.deepcopy(fr["hands"]),
            }
            for idx, fr in enumerate(self.real_fixture["frames"])
        ]
        tensor, valid, err = extract_window(window_frames, target_fps=15, duration_ms=1000.0)
        self.assertTrue(valid, f"extract_window falló: {err}")
        self.assertEqual(tensor.shape, (1, 15, 178))

        for k, fr in enumerate(self.real_fixture["frames"]):
            expected_slots = fr["expected_pose_slots"]
            has_left = bool(np.any(np.abs(tensor[0, k, 52:115]) > 1e-9))
            has_right = bool(np.any(np.abs(tensor[0, k, 115:178]) > 1e-9))
            self.assertEqual(
                has_left,
                "leftHand" in expected_slots,
                f"Slot k={k} (frame {fr['source_frame_idx']}) discrepa en leftHand",
            )
            self.assertEqual(
                has_right,
                "rightHand" in expected_slots,
                f"Slot k={k} (frame {fr['source_frame_idx']}) discrepa en rightHand",
            )


if __name__ == "__main__":
    unittest.main()
