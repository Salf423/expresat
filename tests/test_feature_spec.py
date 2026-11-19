"""
Numerical conformance suite against docs/dataset-generator/FEATURE_SPEC.md v1.4.0.

Compares against tests/fixtures/feature_spec_cases.json element-by-element under
L_inf <= 1e-6 for frame cases, window cases, hand-calculated analytical mini-fixtures,
and v1.4.0 quality gates (strict <=100ms gaps, D_2D_iso 4:3, P15..P22 z'=0, direct
laterality, wrist TTL expiry, density/bridge/tail gates, and mirror involution).
"""

from __future__ import annotations

import copy
import json
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "schemas"))

from validate_recording import validate_recording

import models.feature_extractor as fe_mod
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
        self.assertEqual(FEATURE_SPEC_VERSION, "1.4.0")

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

        # Physical left hand ('Left' label in v1.4.0 direct convention) near P15; physical right hand ('Right') near P16
        hand_left = [{"x": 0.40, "y": 0.50, "z": 0.0}] * 21
        hand_right = [{"x": 0.60, "y": 0.50, "z": 0.0}] * 21

        raw["hands"] = [
            {"landmarks": hand_left, "categoryName": "Left", "score": 0.95},
            {"landmarks": hand_right, "categoryName": "Right", "score": 0.95},
        ]
        raw["handedness"] = [
            [{"categoryName": "Left", "score": 0.95}],
            [{"categoryName": "Right", "score": 0.95}],
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
            {"landmarks": hand_left, "categoryName": "Left", "score": 0.95},
            {"landmarks": hand_right, "categoryName": "Right", "score": 0.95},
        ]
        raw["handedness"] = [
            [{"categoryName": "Left", "score": 0.95}],
            [{"categoryName": "Right", "score": 0.95}],
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

    def test_mirror_raw_frame_object_hands_flips_x_category_and_involution(self):
        """v1.4.0: mirror_raw_frame handles {landmarks, categoryName, score} and is an exact involution."""
        raw = copy.deepcopy(self.fixtures["frame_cases"]["TC_06_recorder_object_hands"]["input"])
        orig_cat0 = raw["hands"][0]["categoryName"]
        orig_cat1 = raw["hands"][1]["categoryName"]
        exp_cat0 = "Left" if orig_cat0 == "Right" else "Right"
        exp_cat1 = "Left" if orig_cat1 == "Right" else "Right"
        mirrored = mirror_raw_frame(raw)

        self.assertEqual(mirrored["hands"][0]["categoryName"], exp_cat0)
        self.assertEqual(mirrored["hands"][1]["categoryName"], exp_cat1)
        self.assertAlmostEqual(mirrored["hands"][0]["landmarks"][0]["x"], 1.0 - 0.70, places=6)
        self.assertAlmostEqual(mirrored["hands"][1]["landmarks"][0]["x"], 1.0 - 0.30, places=6)

        double_mirrored = mirror_raw_frame(mirrored)
        self.assertEqual(double_mirrored["hands"][0]["categoryName"], orig_cat0)
        self.assertEqual(double_mirrored["hands"][1]["categoryName"], orig_cat1)
        self.assertEqual(double_mirrored["hands"][0]["score"], raw["hands"][0]["score"])
        self.assertEqual(double_mirrored["hands"][1]["score"], raw["hands"][1]["score"])
        for p_dm, p_orig in zip(double_mirrored["pose"], raw["pose"]):
            for k in ("x", "y", "z", "visibility"):
                self.assertAlmostEqual(p_dm[k], p_orig[k], places=12)
        for h_dm, h_orig in zip(double_mirrored["hands"], raw["hands"]):
            for l_dm, l_orig in zip(h_dm["landmarks"], h_orig["landmarks"]):
                for k in ("x", "y", "z"):
                    self.assertAlmostEqual(l_dm[k], l_orig[k], places=12)

    def test_mirror_raw_frame_object_hands_asymmetric_commutativity_linf(self):
        """v1.4.0: asymmetric mirror commutativity on object-wrapped hands."""
        base = copy.deepcopy(self.fixtures["frame_cases"]["TC_06_recorder_object_hands"]["input"])
        one_hand = {"pose": base["pose"], "hands": [base["hands"][0]]}

        mirrored = mirror_raw_frame(one_hand)
        feat_mirrored_raw, vm, _ = extract_frame_features(mirrored)
        feat_base, vb, _ = extract_frame_features(one_hand)
        self.assertTrue(vm and vb)
        feat_mirror_func = mirror_features_178(feat_base)

        max_diff = float(np.max(np.abs(feat_mirrored_raw.astype(np.float32) - feat_mirror_func.astype(np.float32))))
        self.assertLessEqual(max_diff, 1e-6, f"Conmutatividad objeto rota: L_inf={max_diff:.6f}")


class TestRealRecordingLateralityV140(unittest.TestCase):
    """
    Mandatory v1.4.0 direct laterality tests ('Left' -> leftHand, 'Right' -> rightHand)
    on 15 real dev recording frames.
    """

    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).resolve().parent / "fixtures" / "real_recording_laterality_15f.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            cls.real_fixture = json.load(f)

    def test_real_15f_direct_laterality_frame_blocks_v140(self):
        """v1.4.0: direct Left->leftHand[52:115] and Right->rightHand[115:178] mapping."""
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

    def test_real_15f_window_sequence_direct_laterality_and_ambig_v140(self):
        """v1.4.0: extract_window direct laterality mapping across transition and AMBIG frames."""
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


class TestFeatureSpecV140AnalyticalAndGates(unittest.TestCase):
    """
    Independent hand-calculated mini-fixtures and strict FEATURE_SPEC v1.4.0 gates:
      - D_2D_iso (4:3) immune to pose.z noise
      - pose.z' = 0.0 on P15..P22 and clip [-2.0, 2.0] on P00, P11..P14
      - Hand-calculated 3-frame LERP and 4-step EMA with absence reset
      - Strict <=100ms raw gap, tail extrapolation, unique_real_frames >= 12, bridges <= 3/14
      - Unified 1-hand spatial+label cost, wrist TTL expiry (>200ms), NaN rejection, leftHand/rightHand mirror swap
    """

    @staticmethod
    def _make_base_pose() -> list[dict]:
        pose = [{"x": 0.50, "y": 0.50, "z": 0.00, "visibility": 0.95} for _ in range(33)]
        pose[0] = {"x": 0.50, "y": 0.20, "z": -0.05, "visibility": 0.99}
        pose[11] = {"x": 0.65, "y": 0.40, "z": 0.00, "visibility": 0.95}
        pose[12] = {"x": 0.35, "y": 0.40, "z": 0.00, "visibility": 0.95}
        pose[13] = {"x": 0.70, "y": 0.55, "z": -0.05, "visibility": 0.90}
        pose[14] = {"x": 0.30, "y": 0.55, "z": -0.05, "visibility": 0.90}
        pose[15] = {"x": 0.70, "y": 0.70, "z": -0.80, "visibility": 0.95}
        pose[16] = {"x": 0.30, "y": 0.70, "z": -0.80, "visibility": 0.95}
        for idx in range(17, 23):
            pose[idx] = {"x": 0.70 if idx % 2 == 1 else 0.30, "y": 0.72, "z": -1.40, "visibility": 0.90}
        return pose

    def _make_window_from_ts(self, ts_list: list[float]) -> list[dict]:
        pose = self._make_base_pose()
        hand_l = [{"x": 0.70, "y": 0.70, "z": -0.02} for _ in range(21)]
        return [
            {
                "t_ms": float(t),
                "pose": copy.deepcopy(pose),
                "hands": [{"landmarks": copy.deepcopy(hand_l), "categoryName": "Left", "score": 0.96}],
            }
            for t in ts_list
        ]

    def test_hand_calculated_d_2d_iso_and_pose_z_policy(self):
        """Exact analytical rational check: tilted shoulders D_2D_iso=0.375, P0 z' clipped -2.0, P15..P22 z'=0.0."""
        pose = [{"x": 0.55, "y": 0.40, "z": 0.0, "visibility": 0.90} for _ in range(33)]
        # P11=(0.70, 0.55, 0.40), P12=(0.40, 0.25, -0.40):
        # dx=0.30 -> dx*4/3=0.40, dy=0.30 -> hypot(0.40,0.30)=0.50 -> D_2D_iso = 0.50/(4/3) = 0.375 exact (immune to dz=0.80!)
        pose[0] = {"x": 0.55, "y": 0.25, "z": -1.20, "visibility": 1.25}   # raw z' = -1.20/0.375 = -3.20 -> clip -2.0; vis -> 1.0
        pose[11] = {"x": 0.70, "y": 0.55, "z": 0.40, "visibility": 0.95}   # z' = +0.40/0.375 = +1.0666667
        pose[12] = {"x": 0.40, "y": 0.25, "z": -0.40, "visibility": 0.95}  # z' = -0.40/0.375 = -1.0666667
        pose[13] = {"x": 0.70, "y": 0.65, "z": 1.125, "visibility": 0.90}  # raw z' = +3.0 -> clip +2.0
        pose[14] = {"x": 0.40, "y": 0.65, "z": -0.375, "visibility": 0.90} # z' = -1.0
        pose[15] = {"x": 0.70, "y": 0.70, "z": -1.50, "visibility": 0.90}  # P15..P22 -> z' MUST be 0.0
        pose[16] = {"x": 0.40, "y": 0.70, "z": -1.50, "visibility": 0.90}
        for idx in range(17, 23):
            pose[idx] = {"x": 0.70, "y": 0.70, "z": -1.80, "visibility": 0.90}

        hand_l = [{"x": 0.70, "y": 0.70, "z": -0.05} for _ in range(21)]
        hand_l[8] = {"x": 0.70, "y": 0.55, "z": -0.20}  # y'=(0.55-0.40)/0.375=0.40, z'=(-0.20+0.05)/0.375=-0.40

        frame = {
            "pose": pose,
            "hands": [{"landmarks": hand_l, "categoryName": "Left", "score": 0.98}],
        }
        feats, valid, err = extract_frame_features(frame)
        self.assertTrue(valid, f"Error inesperado: {err}")
        self.assertIsNone(err)

        # P00 [0..3]: x'=0, y'=-0.40, z'=-2.0 (clipped), vis=1.0 (clamped)
        self.assertAlmostEqual(float(feats[0]), 0.0, places=6)
        self.assertAlmostEqual(float(feats[1]), -0.40, places=6)
        self.assertAlmostEqual(float(feats[2]), -2.0, places=6)
        self.assertAlmostEqual(float(feats[3]), 1.0, places=6)

        # P11 [4..7] and P13 [12..15]
        self.assertAlmostEqual(float(feats[4]), 0.40, places=6)
        self.assertAlmostEqual(float(feats[5]), 0.40, places=6)
        self.assertAlmostEqual(float(feats[6]), 0.40 / 0.375, places=5)
        self.assertAlmostEqual(float(feats[14]), 2.0, places=6)  # P13 z' clipped +2.0

        # P15..P22 (upper indices 5..12) MUST have exact z' == 0.0
        for upper_i in range(5, 13):
            self.assertEqual(float(feats[upper_i * 4 + 2]), 0.0, f"upper pose idx {upper_i} z' debe ser 0.0")

        # Left hand [52..114]: wrist=(0.40, 0.80, 0.0), index tip #8=(0.40, 0.40, -0.40)
        self.assertAlmostEqual(float(feats[52 + 0]), 0.40, places=6)
        self.assertAlmostEqual(float(feats[52 + 1]), 0.80, places=6)
        self.assertAlmostEqual(float(feats[52 + 2]), 0.0, places=6)
        self.assertAlmostEqual(float(feats[52 + 8 * 3 + 0]), 0.40, places=6)
        self.assertAlmostEqual(float(feats[52 + 8 * 3 + 1]), 0.40, places=6)
        self.assertAlmostEqual(float(feats[52 + 8 * 3 + 2]), -0.40, places=6)

        # Right hand [115..177] absent -> 63 exact zeros
        self.assertTrue(np.all(feats[115:178] == 0.0))

    def test_hand_calculated_3frame_lerp_helper(self):
        """Independent hand-computed 3-frame LERP verification (zero circularity)."""
        self.assertTrue(hasattr(fe_mod, "resample_sequence_blocks"), "Falta resample_sequence_blocks")
        p0 = [{"x": 0.20, "y": 0.10, "z": 0.00, "visibility": 0.80}] * 33
        p1 = [{"x": 0.40, "y": 0.30, "z": -0.20, "visibility": 0.90}] * 33
        p2 = [{"x": 1.00, "y": 0.50, "z": 0.20, "visibility": 1.00}] * 33
        lh0 = [{"x": 0.60, "y": 0.50, "z": 0.00}] * 21
        lh1 = [{"x": 0.80, "y": 0.70, "z": -0.10}] * 21
        blocks = [
            {"timestamp_ms": 0.0, "pose": p0, "left_hand": lh0, "right_hand": None},
            {"timestamp_ms": 50.0, "pose": p1, "left_hand": lh1, "right_hand": None},
            {"timestamp_ms": 100.0, "pose": p2, "left_hand": None, "right_hand": None},
        ]
        targets = [0.0, 25.0, 50.0, 60.0, 75.0, 100.0]
        out = fe_mod.resample_sequence_blocks(blocks, targets)
        self.assertEqual(len(out), 6)

        exp_px = [0.20, 0.30, 0.40, 0.52, 0.70, 1.00]
        exp_py = [0.10, 0.20, 0.30, 0.34, 0.40, 0.50]
        exp_pz = [0.00, -0.10, -0.20, -0.12, 0.00, 0.20]
        exp_pv = [0.80, 0.85, 0.90, 0.92, 0.95, 1.00]
        exp_lhx = [0.60, 0.70, 0.80, 0.80, None, None]

        for idx in range(6):
            self.assertAlmostEqual(out[idx]["pose"][0]["x"], exp_px[idx], places=6)
            self.assertAlmostEqual(out[idx]["pose"][0]["y"], exp_py[idx], places=6)
            self.assertAlmostEqual(out[idx]["pose"][0]["z"], exp_pz[idx], places=6)
            self.assertAlmostEqual(out[idx]["pose"][0]["visibility"], exp_pv[idx], places=6)
            if exp_lhx[idx] is None:
                self.assertIsNone(out[idx]["left_hand"])
            else:
                self.assertIsNotNone(out[idx]["left_hand"])
                self.assertAlmostEqual(out[idx]["left_hand"][0]["x"], exp_lhx[idx], places=6)

    def test_hand_calculated_4step_ema_helper_with_hand_reset(self):
        """Independent hand-computed 4-step EMA (alpha=0.50) with hand absence reset."""
        self.assertTrue(hasattr(fe_mod, "apply_block_ema"), "Falta apply_block_ema")
        pose_xs = [1.0, 3.0, 5.0, 9.0]
        pose_vs = [0.9, 0.8, 0.7, 0.6]
        lh_xs = [0.20, 0.60, None, 0.90]
        blocks = [
            {
                "timestamp_ms": k * 66.67,
                "pose": [{"x": pose_xs[k], "y": 0.0, "z": 0.0, "visibility": pose_vs[k]}] * 33,
                "left_hand": ([{"x": lh_xs[k], "y": 0.0, "z": 0.0}] * 21) if lh_xs[k] is not None else None,
                "right_hand": None,
            }
            for k in range(4)
        ]
        out = fe_mod.apply_block_ema(blocks, alpha=0.50)
        exp_pose_x = [1.0, 2.0, 3.5, 6.25]
        exp_lh_x = [0.20, 0.40, None, 0.90]
        for k in range(4):
            self.assertAlmostEqual(out[k]["pose"][0]["x"], exp_pose_x[k], places=6)
            self.assertAlmostEqual(out[k]["pose"][0]["visibility"], pose_vs[k], places=6)
            if exp_lh_x[k] is None:
                self.assertIsNone(out[k]["left_hand"])
            else:
                self.assertAlmostEqual(out[k]["left_hand"][0]["x"], exp_lh_x[k], places=6)

    def test_strict_raw_gap_gate_rejects_above_100ms_regardless_of_duration(self):
        """Strict <=100.0ms raw gap gate: must reject 100.1ms/166.6ms (1000ms) and 150ms (2500ms)."""
        # 100.1ms gap inside an otherwise dense 1000ms window
        ts_100_1 = [0.0, 100.1] + [100.1 + 60.0 * k for k in range(1, 18)]
        _, valid, err = extract_window(self._make_window_from_ts(ts_100_1), target_fps=15, duration_ms=1000.0)
        self.assertFalse(valid)
        self.assertEqual(err, "ERR_INVALID_FRAME_GAP_TOO_LARGE")

        # 166.6ms gap (previously accepted under broken gap - dt_nominal!)
        ts_166_6 = [0.0, 166.6] + [166.6 + 60.0 * k for k in range(1, 18)]
        _, valid2, err2 = extract_window(self._make_window_from_ts(ts_166_6), target_fps=15, duration_ms=1000.0)
        self.assertFalse(valid2)
        self.assertEqual(err2, "ERR_INVALID_FRAME_GAP_TOO_LARGE")

        # 150.0ms gap with duration_ms=2500.0 MUST ALSO be rejected (absolute, no scaling)
        ts_2500 = [0.0, 150.0] + [150.0 + 60.0 * k for k in range(1, 45)]
        _, valid3, err3 = extract_window(self._make_window_from_ts(ts_2500), target_fps=15, duration_ms=2500.0)
        self.assertFalse(valid3)
        self.assertEqual(err3, "ERR_INVALID_FRAME_GAP_TOO_LARGE")

    def test_plan_mejora_density_bridge_and_tail_gates(self):
        """Verify PLAN_MEJORA §1.3 worked cases: PASA, BORDE, FALLA (unique<12), HIGH_INTERP (>3/14), and TAIL."""
        # Case 1 — PASA (16 FPS alternating 60/65ms)
        ts_pasa = [0.0]
        for i in range(20):
            ts_pasa.append(ts_pasa[-1] + (60.0 if i % 2 == 0 else 65.0))
        t1, v1, e1 = extract_window(self._make_window_from_ts(ts_pasa), target_fps=15, duration_ms=1000.0)
        self.assertTrue(v1, f"Case 1 PASA falló: {e1}")
        self.assertEqual(t1.shape, (1, 15, 178))

        # Case 2 — BORDE (max_gap=90ms, unique=12/15, bridges=3/14)
        ts_borde = [0.0, 90.0, 180.0, 262.0, 344.0, 426.0, 508.0, 590.0, 672.0, 754.0, 836.0, 918.0, 1000.0]
        t2, v2, e2 = extract_window(self._make_window_from_ts(ts_borde), target_fps=15, duration_ms=1000.0)
        self.assertTrue(v2, f"Case 2 BORDE falló: {e2}")
        self.assertEqual(t2.shape, (1, 15, 178))

        # Case 3 — FALLA (89ms steps: max_gap<=100, tail=0, but unique=11/15 < 12)
        ts_falla = [0.0, 89.0, 178.0, 267.0, 356.0, 445.0, 534.0, 623.0, 712.0, 801.0, 890.0, 979.0]
        t3, v3, e3 = extract_window(self._make_window_from_ts(ts_falla), target_fps=15, duration_ms=1000.0)
        self.assertFalse(v3)
        self.assertIsNone(t3)
        self.assertEqual(e3, "ERR_WINDOW_LOW_UNIQUE_FRAMES")

        # Case 4 — HIGH_INTERP (unique>=12, max_gap=85<=100, tail=0, bridges=5/14 > 3/14)
        ts_bridge = [0.0, 85.0, 170.0, 255.0, 340.0] + [340.0 + 50.0 * k for k in range(1, 14)]
        t4, v4, e4 = extract_window(self._make_window_from_ts(ts_bridge), target_fps=15, duration_ms=1000.0)
        self.assertFalse(v4)
        self.assertIsNone(t4)
        self.assertEqual(e4, "ERR_WINDOW_HIGH_INTERPOLATION")

        # Case 5 — TAIL EXTRAPOLATION (15 frames @ 30 FPS = 466.7ms < 933.33ms; and all t_ms=0.0)
        ts_30fps_short = [i * (1000.0 / 30.0) for i in range(15)]
        t5, v5, e5 = extract_window(self._make_window_from_ts(ts_30fps_short), target_fps=15, duration_ms=1000.0)
        self.assertFalse(v5)
        self.assertIsNone(t5)
        self.assertEqual(e5, "ERR_WINDOW_TAIL_EXTRAPOLATION")

        ts_zero = [0.0] * 15
        t6, v6, e6 = extract_window(self._make_window_from_ts(ts_zero), target_fps=15, duration_ms=1000.0)
        self.assertFalse(v6)
        self.assertIsNone(t6)
        self.assertEqual(e6, "ERR_WINDOW_TAIL_EXTRAPOLATION")

    def test_single_hand_unified_cost_resists_mislabeled_hand_far_from_wrong_wrist(self):
        """Unified 1-hand scoring: spatial proximity to P15/P16 rescues a mislabeled hand on both sides."""
        pose = self._make_base_pose()
        D = 0.30
        hand_at_p15 = [{"x": 0.70, "y": 0.70, "z": 0.0} for _ in range(21)]
        for lbl in ("Left", "Right"):
            al, ar, _ = assign_hands_to_anatomical_slots(
                {"pose": pose, "hands": [{"landmarks": hand_at_p15, "categoryName": lbl, "score": 0.80}]},
                pose,
                D,
            )
            self.assertIsNotNone(al, f"Mano sobre P15 con etiqueta '{lbl}' debe ir a leftHand")
            self.assertIsNone(ar)

        hand_at_p16 = [{"x": 0.30, "y": 0.70, "z": 0.0} for _ in range(21)]
        for lbl in ("Left", "Right"):
            al, ar, _ = assign_hands_to_anatomical_slots(
                {"pose": pose, "hands": [{"landmarks": hand_at_p16, "categoryName": lbl, "score": 0.80}]},
                pose,
                D,
            )
            self.assertIsNone(al)
            self.assertIsNotNone(ar, f"Mano sobre P16 con etiqueta '{lbl}' debe ir a rightHand")

    def test_stale_wrist_memory_expires_after_200ms_absence(self):
        """prev_left_w must expire after >200ms absence so an unlabeled hand on P16 lands in rightHand."""
        pose = self._make_base_pose()
        frames = []
        # Frame 0 (t=0): unlabeled hand at x=0.55 (closer to P15=0.70 than P16=0.30) -> sets prev_left_w
        frames.append({
            "t_ms": 0.0,
            "pose": copy.deepcopy(pose),
            "hands": [[{"x": 0.55, "y": 0.70, "z": 0.0}] * 21],
            "handedness": [],
        })
        # Frames 1..5 (t=66.67..333.33ms): no hands (>200ms absence!)
        for k in range(1, 6):
            frames.append({"t_ms": k * (1000.0 / 15.0), "pose": copy.deepcopy(pose), "hands": []})
        # Frames 6..14 (t=400..933.33ms): unlabeled hand right on top of P16 (0.30, 0.70)
        for k in range(6, 15):
            frames.append({
                "t_ms": k * (1000.0 / 15.0),
                "pose": copy.deepcopy(pose),
                "hands": [[{"x": 0.30, "y": 0.70, "z": 0.0}] * 21],
                "handedness": [],
            })
        tensor, valid, err = extract_window(frames, target_fps=15, duration_ms=1000.0)
        self.assertTrue(valid, f"Error inesperado: {err}")
        # At k=6..14, rightHand [115:178] MUST be active and leftHand [52:115] MUST be zero
        self.assertEqual(float(np.linalg.norm(tensor[0, 6, 52:115])), 0.0)
        self.assertGreater(float(np.linalg.norm(tensor[0, 6, 115:178])), 0.1)

    def test_mirror_raw_frame_swaps_lefthand_righthand_keys_and_rejects_nan(self):
        """mirror_raw_frame must swap leftHand<->rightHand keys; non-finite coords must be rejected."""
        pose = self._make_base_pose()
        lh = [{"x": 0.70, "y": 0.70, "z": 0.0} for _ in range(21)]
        frame = {"pose": pose, "leftHand": lh, "rightHand": None}
        mirrored = mirror_raw_frame(frame)
        self.assertIsNone(mirrored["leftHand"])
        self.assertIsNotNone(mirrored["rightHand"])
        self.assertAlmostEqual(mirrored["rightHand"][0]["x"], 0.30, places=6)

        bad_nan = {"pose": copy.deepcopy(pose), "hands": []}
        bad_nan["pose"][11]["x"] = float("nan")
        feats, valid, err = extract_frame_features(bad_nan)
        self.assertFalse(valid)
        self.assertIsNone(feats)


if __name__ == "__main__":
    unittest.main()
