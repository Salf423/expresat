"""
TDD test suite for Stage-2 vectorized offline dataset pipeline (Commit 7 — v1.4.0).

Covers:
  1. Raw take validation (schema, 4:3 aspect, FPS >= 15, gap <= 100ms, config_hash).
  2. Mode-aware segmentation (estatica, dinamica with displacement >= 0.15*D, reposo).
  3. Leak-free StratifiedGroupKFold grouped by (subject_id, session_id, take_id).
  4. Safe isotropic 4:3 raw augmentation ONLY on train (immutable visibility, mirror commutativity).
  5. End-to-end `.npy` float32 shard + sealed `manifest.json` export passing hardened `validate_dataset.py`.
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

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    HAND_LANDMARKER_SHA256,
    POSE_LANDMARKER_SHA256,
    compute_config_hash,
    extract_window_arrays,
    mirror_features_178,
)
import validate_dataset as vd


def _make_raw_take(
    *,
    sign_label: str,
    sign_type: str,
    subject_id: str,
    session_id: str,
    take_id: str,
    n_frames: int = 36,
    dt_ms: float = 50.0,
    video_w: int = 640,
    video_h: int = 480,
    dynamic_amp: float = 0.12,
    inject_gap_ms: float | None = None,
    rest_subregime: str | None = None,
) -> dict:
    """Build a schema-valid v1.4.0 .raw.json take for pipeline tests."""
    frames = []
    t_acc = 0.0
    for i in range(n_frames):
        if i > 0:
            step = inject_gap_ms if (inject_gap_ms is not None and i == 5) else dt_ms
            t_acc += step

        phase = i / max(1, n_frames - 1)
        # Subtle breathing motion in static/reposo; real trajectory in dynamic
        sway = 0.003 * math.sin(2 * math.pi * phase)
        move_x = dynamic_amp * math.sin(math.pi * phase) if sign_type == "dynamic" else sway
        move_y = -0.5 * dynamic_amp * math.sin(math.pi * phase) if sign_type == "dynamic" else sway

        pose = [{"x": 0.50, "y": 0.50, "z": 0.0, "visibility": 0.95} for _ in range(33)]
        pose[0] = {"x": 0.50 + sway, "y": 0.20, "z": -0.04, "visibility": 0.99}
        pose[11] = {"x": 0.62, "y": 0.40, "z": 0.0, "visibility": 0.95}
        pose[12] = {"x": 0.38, "y": 0.40, "z": 0.0, "visibility": 0.95}
        pose[13] = {"x": 0.66, "y": 0.55, "z": 0.01, "visibility": 0.90}
        pose[14] = {"x": 0.34, "y": 0.55, "z": -0.01, "visibility": 0.90}
        pose[15] = {"x": 0.66 + move_x, "y": 0.62 + move_y, "z": -0.50, "visibility": 0.92}
        pose[16] = {"x": 0.34, "y": 0.62, "z": -0.50, "visibility": 0.92}
        for idx in range(17, 23):
            pose[idx] = {"x": 0.66 if idx % 2 == 1 else 0.34, "y": 0.66, "z": -0.60, "visibility": 0.85}

        hands = []
        handedness = []
        include_hand = sign_label != "reposo" or rest_subregime == "manos_quietas_en_cuadro"
        if include_hand:
            wx = 0.66 + move_x
            wy = 0.62 + move_y
            h_lms = [
                {"x": wx + 0.002 * k, "y": wy - 0.003 * k, "z": -0.005 * (k % 3)}
                for k in range(21)
            ]
            hands = [{"landmarks": h_lms, "categoryName": "Left", "score": 0.96}]
            handedness = [[{"categoryName": "Left", "score": 0.96, "index": 0}]]

        frames.append(
            {
                "t_ms": round(t_acc, 2),
                "videoWidth": video_w,
                "videoHeight": video_h,
                "hands": hands,
                "handedness": handedness,
                "pose": pose,
            }
        )

    duration_ms = round(t_acc + dt_ms, 2)
    avg_fps = round((len(frames) / duration_ms) * 1000.0, 1)
    max_gap = float(inject_gap_ms) if inject_gap_ms is not None else dt_ms
    gaps_over_100 = 1 if max_gap > 100.0 else 0
    is_valid = avg_fps >= 15.0 and max_gap <= 100.0 and abs((video_w / video_h) - (4 / 3)) <= 0.05

    return {
        "version": "1.4.0",
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "config_hash": compute_config_hash(delegate="GPU", pose_cadence=1),
        "pose_cadence": 1,
        "model_artifacts": {
            "hand_landmarker_sha256": HAND_LANDMARKER_SHA256,
            "pose_landmarker_sha256": POSE_LANDMARKER_SHA256,
        },
        "type": "expresat_dev_recording_raw",
        "recorded_at": "2026-11-18T19:00:00.000Z",
        "delegate": "GPU",
        "track_settings": {
            "width": video_w,
            "height": video_h,
            "frameRate": 20,
            "videoWidth": video_w,
            "videoHeight": video_h,
            "effective_resolution": f"{video_w}x{video_h}",
        },
        "recording_metadata": {
            "subject_id": subject_id,
            "session_id": session_id,
            "take_id": take_id,
            "sign_label": sign_label,
            "sign_type": sign_type,
            "rest_subregime": rest_subregime,
        },
        "duration_ms": duration_ms,
        "total_frames": len(frames),
        "avg_fps": avg_fps,
        "min_fps_required": 15.0,
        "interval_metrics": {
            "count": len(frames) - 1,
            "p50_ms": dt_ms,
            "p95_ms": max_gap,
            "p99_ms": max_gap,
            "max_ms": max_gap,
            "max_allowed_ms": 100.0,
            "gaps_over_100ms": gaps_over_100,
            "gaps_over_100ms_count": gaps_over_100,
        },
        "edge_metrics": {
            "border_margin": 0.03,
            "frames_checked": len(frames),
            "frames_with_hand_near_edge": 0,
            "edge_clip_ratio": 0.0,
            "pose_shoulders_oob_frames": 0,
        },
        "hand_presence_metrics": {
            "sign_label": sign_label,
            "is_active_sign": sign_label != "reposo",
            "frames_with_hands": len(frames) if (sign_label != "reposo" or rest_subregime == "manos_quietas_en_cuadro") else 0,
            "hand_presence_ratio": 1.0 if (sign_label != "reposo" or rest_subregime == "manos_quietas_en_cuadro") else 0.0,
            "min_required_ratio": 0.6,
            "passed": True,
        },
        "valid": is_valid,
        "error": None if is_valid else "ERR_CAPTURE_GAP_TOO_LARGE",
        "videoWidth": video_w,
        "videoHeight": video_h,
        "frames": frames,
    }


class TestDatasetPipelineV140(unittest.TestCase):
    def test_module_import_and_raw_validation_gates(self):
        import build_dataset_v140 as pipe

        good = _make_raw_take(
            sign_label="hola", sign_type="dynamic", subject_id="s1", session_id="ses1", take_id="t1"
        )
        ok, err = pipe.validate_raw_take(good, catalog_ids={"hola", "letra_a", "reposo"})
        self.assertTrue(ok, f"Toma válida rechazada: {err}")

        bad_gap = _make_raw_take(
            sign_label="hola", sign_type="dynamic", subject_id="s1", session_id="ses1", take_id="t2",
            inject_gap_ms=130.0,
        )
        ok_g, err_g = pipe.validate_raw_take(bad_gap, catalog_ids={"hola", "letra_a", "reposo"})
        self.assertFalse(ok_g)
        self.assertIsNotNone(err_g)

        bad_aspect = _make_raw_take(
            sign_label="hola", sign_type="dynamic", subject_id="s1", session_id="ses1", take_id="t3",
            video_w=1280, video_h=720,
        )
        ok_a, err_a = pipe.validate_raw_take(bad_aspect, catalog_ids={"hola", "letra_a", "reposo"})
        self.assertFalse(ok_a)
        self.assertIn("ASPECT_RATIO", err_a)

    def test_segmentation_and_safe_43_train_augmentation_invariants(self):
        import build_dataset_v140 as pipe

        take_dyn = _make_raw_take(
            sign_label="hola", sign_type="dynamic", subject_id="s1", session_id="ses1", take_id="t1",
            n_frames=36, dt_ms=50.0, dynamic_amp=0.14,
        )
        packed = pipe.pack_raw_frames_to_arrays(take_dyn["frames"])
        windows = pipe.segment_packed_take(packed, mode="dinamica", label="hola")
        self.assertGreaterEqual(len(windows), 1)

        # Dynamic take with ZERO movement must produce 0 valid dynamic windows (< 0.15 * D displacement)
        take_still = _make_raw_take(
            sign_label="hola", sign_type="dynamic", subject_id="s1", session_id="ses1", take_id="t_still",
            n_frames=36, dt_ms=50.0, dynamic_amp=0.0,
        )
        packed_still = pipe.pack_raw_frames_to_arrays(take_still["frames"])
        still_windows = pipe.segment_packed_take(packed_still, mode="dinamica", label="hola")
        self.assertEqual(len(still_windows), 0, "Seña dinámica sin desplazamiento debe rechazarse")

        # Safe 4:3 augmentation: visibility strictly untouched; mirror commutes within 1e-5
        rng = np.random.default_rng(42)
        base_win = windows[0]
        aug_win = pipe.augment_raw_window_arrays(base_win, rng)
        np.testing.assert_allclose(
            aug_win["pose_upper"][:, :, 3],
            base_win["pose_upper"][:, :, 3],
            atol=0.0,
            err_msg="Augmentation modificó el canal de visibilidad",
        )
        t_aug, v_aug, e_aug = extract_window_arrays(
            aug_win["ts"],
            aug_win["pose_upper"],
            aug_win["lh_coords"],
            aug_win["lh_present"],
            aug_win["rh_coords"],
            aug_win["rh_present"],
        )
        self.assertTrue(v_aug, f"Ventana aumentada inválida: {e_aug}")
        self.assertEqual(t_aug.shape, (1, 15, 178))

        mir_win = pipe.mirror_raw_window_arrays(base_win)
        t_base, vb, _ = extract_window_arrays(
            base_win["ts"], base_win["pose_upper"], base_win["lh_coords"], base_win["lh_present"], base_win["rh_coords"], base_win["rh_present"]
        )
        t_mir, vm, _ = extract_window_arrays(
            mir_win["ts"], mir_win["pose_upper"], mir_win["lh_coords"], mir_win["lh_present"], mir_win["rh_coords"], mir_win["rh_present"]
        )
        self.assertTrue(vb and vm)
        expected_mir = np.stack([mirror_features_178(t_base[0, k]) for k in range(15)], axis=0)
        linf = float(np.max(np.abs(t_mir[0] - expected_mir)))
        self.assertLessEqual(linf, 1e-5, f"Espejo en arrays crudos no conmuta: L_inf={linf}")

    def test_end_to_end_pipeline_zero_group_leakage_and_manifest_validation(self):
        import build_dataset_v140 as pipe

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw_dir = root / "raw"
            out_dir = root / "shards"
            raw_dir.mkdir(parents=True)

            # 5 distinct subjects/sessions/takes per class across 3 pilot classes (15 takes total)
            classes = [
                ("reposo", "rest", None),
                ("letra_a", "static", None),
                ("hola", "dynamic", None),
            ]
            for subj_idx in range(5):
                subj = f"subj_{subj_idx:02d}"
                ses = f"ses_{subj_idx:02d}"
                for cls_label, cls_type, _ in classes:
                    subreg = "manos_quietas_en_cuadro" if (cls_label == "reposo" and subj_idx % 2 == 1) else ("brazos_abajo" if cls_label == "reposo" else None)
                    take = _make_raw_take(
                        sign_label=cls_label,
                        sign_type=cls_type,
                        subject_id=subj,
                        session_id=ses,
                        take_id=f"{cls_label}_t{subj_idx}",
                        n_frames=36,
                        dt_ms=50.0,
                        dynamic_amp=0.14 if cls_type == "dynamic" else 0.0,
                        rest_subregime=subreg,
                    )
                    (raw_dir / f"{subj}_{ses}_{cls_label}.raw.json").write_text(
                        json.dumps(take), encoding="utf-8"
                    )

            # Inject 1 corrupted take (gap=140ms) to confirm rejection audit trail
            bad_take = _make_raw_take(
                sign_label="hola", sign_type="dynamic", subject_id="subj_99", session_id="ses_99",
                take_id="bad_gap", inject_gap_ms=140.0,
            )
            (raw_dir / "subj_99_bad_gap.raw.json").write_text(json.dumps(bad_take), encoding="utf-8")

            manifest = pipe.build_dataset_pipeline(
                raw_dir=raw_dir,
                output_dir=out_dir,
                catalog_path=REPO / "catalog" / "signs_catalog.json",
                n_splits=5,
                train_augment_copies=2,
                seed=42,
            )

            self.assertEqual(manifest["feature_spec_version"], FEATURE_SPEC_VERSION)
            self.assertEqual(manifest["config_hash"], compute_config_hash("GPU", 1))
            self.assertEqual(len(manifest["rejected_takes"]), 1)

            # Strictly ZERO group overlap across train / val / test
            g_train = set(manifest["splits"]["train"]["groups"])
            g_val = set(manifest["splits"]["val"]["groups"])
            g_test = set(manifest["splits"]["test"]["groups"])
            self.assertTrue(g_train and g_val and g_test)
            self.assertEqual(g_train & g_val, set(), "Fuga de grupos entre train y val")
            self.assertEqual(g_train & g_test, set(), "Fuga de grupos entre train y test")
            self.assertEqual(g_val & g_test, set(), "Fuga de grupos entre val y test")

            # Augmentation applied ONLY to train, ZERO to val/test
            self.assertGreater(manifest["splits"]["train"]["num_augmented"], 0)
            self.assertEqual(manifest["splits"]["val"]["num_augmented"], 0)
            self.assertEqual(manifest["splits"]["test"]["num_augmented"], 0)

            # Verify exported float32 shards and validate with hardened validate_dataset.py
            for split_name in ("train", "val", "test"):
                X = np.load(out_dir / manifest["splits"][split_name]["X_file"])
                y = np.load(out_dir / manifest["splits"][split_name]["y_file"])
                self.assertEqual(X.dtype, np.float32)
                self.assertEqual(y.dtype, np.int64)
                self.assertEqual(X.ndim, 3)
                self.assertEqual(X.shape[1:], (15, 178))
                self.assertEqual(X.shape[0], y.shape[0])

            cat_ids = vd._load_catalog_ids(REPO / "catalog" / "signs_catalog.json")
            val_res = vd.validate_manifest_dir(
                out_dir / "manifest.json", strict=False, min_samples=1, catalog_ids=cat_ids
            )
            self.assertEqual(val_res["status"], "OK", f"validate_manifest_dir falló: {val_res}")


if __name__ == "__main__":
    unittest.main()
