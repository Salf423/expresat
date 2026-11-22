"""
TDD test suite for Fase D (Commit 8):
  - `expresat/models/train_and_export.py` v1.4.0 training, fair A/B ablation (DS-TCN 1D vs BiGRU),
    post-hoc Temperature Scaling calibration, single-file ONNX export, genuine INT8 quantization,
    PyTorch <-> ONNX parity, and CPU latency benchmarking.
  - `expresat/models/inference_engine.py` smoke-test guard, Temperature Scaling, and 3-gate
    rejection policy (min_confidence, min_margin, max_normalized_entropy -> safe fallback).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "expresat"))

from models.feature_extractor import FEATURE_SPEC_VERSION, SEQUENCE_LENGTH, TOTAL_FEATURES, compute_config_hash
from models.inference_engine import IncompatibleFeatureSpecError, InferenceEngine
import models.train_and_export as train_mod


class TestTrainingAndExportV140(unittest.TestCase):
    def test_cli_fails_explicitly_without_real_dataset_or_smoke_flag(self):
        """Zero silent synthetic fallback: missing dataset MUST fail with non-zero exit code."""
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td) / "out"
            # 1) No --manifest and no --allow-synthetic-smoke-test
            proc_no_arg = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "expresat" / "models" / "train_and_export.py"),
                    "--output",
                    str(out_dir),
                    "--epochs",
                    "2",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(proc_no_arg.returncode, 0)
            self.assertIn("--manifest", proc_no_arg.stderr)
            self.assertFalse((out_dir / "model_metadata.json").exists())

            # 2) Nonexistent --manifest path
            missing_manifest = Path(td) / "nonexistent" / "manifest.json"
            proc_missing = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "expresat" / "models" / "train_and_export.py"),
                    "--manifest",
                    str(missing_manifest),
                    "--output",
                    str(out_dir),
                    "--epochs",
                    "2",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(proc_missing.returncode, 0)
            self.assertIn("manifest.json", proc_missing.stderr)
            self.assertFalse((out_dir / "model_metadata.json").exists())

            # 3) --allow-synthetic-smoke-test refuses to overwrite production exported_model dir
            proc_prod_guard = subprocess.run(
                [
                    sys.executable,
                    str(REPO_ROOT / "expresat" / "models" / "train_and_export.py"),
                    "--allow-synthetic-smoke-test",
                    "--epochs",
                    "1",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc_prod_guard.returncode, 2)
            self.assertIn("producción", proc_prod_guard.stderr)

    def test_load_shard_dataset_uses_mmap_and_rejects_bad_config_hash(self):
        """load_shard_dataset loads .npy shards via mmap_mode='r' and enforces v1.4.0 config_hash."""
        self.assertTrue(hasattr(train_mod, "load_shard_dataset"))
        self.assertTrue(hasattr(train_mod, "build_synthetic_smoke_shards"))

        with tempfile.TemporaryDirectory() as td:
            shards_dir = Path(td) / "shards"
            manifest_path = train_mod.build_synthetic_smoke_shards(
                shards_dir,
                labels=["hola", "gracias", "reposo"],
                samples_per_class=24,
                seed=42,
            )
            loaded = train_mod.load_shard_dataset(manifest_path)
            self.assertIsInstance(loaded["train_dataset"].X, np.memmap)
            self.assertIsInstance(loaded["val_dataset"].X, np.memmap)
            self.assertEqual(loaded["manifest"]["feature_spec_version"], FEATURE_SPEC_VERSION)

            # Tamper config_hash -> must reject explicitly
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["config_hash"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises((ValueError, IncompatibleFeatureSpecError)):
                train_mod.load_shard_dataset(manifest_path)

    def test_kinematic_input_layer_masks_hand_appearance_discontinuity(self):
        """
        When leftHand transitions from all-zeros (absent) at t=4 to present at t=5,
        masked delta must be exact 0.0 at t=5 (no artificial velocity spike), while
        consecutive active frames t=5 -> t=6 keep exact x[6] - x[5].
        """
        self.assertTrue(hasattr(train_mod, "KinematicInputLayer"))
        kin = train_mod.KinematicInputLayer(num_features=TOTAL_FEATURES)
        kin.eval()

        x = torch.zeros((1, SEQUENCE_LENGTH, TOTAL_FEATURES), dtype=torch.float32)
        # Pose active on all frames with constant value 0.2
        x[0, :, :52] = 0.2
        # Left hand absent on t=0..4, appears at t=5 with 1.0, moves to 1.25 at t=6
        x[0, 5, 52:115] = 1.0
        x[0, 6:, 52:115] = 1.25

        # Inspect unnormalized [x, dx] helper before LayerNorm
        self.assertTrue(hasattr(kin, "compute_kinematic_features"))
        raw_kin = kin.compute_kinematic_features(x)
        self.assertEqual(tuple(raw_kin.shape), (1, SEQUENCE_LENGTH, TOTAL_FEATURES * 2))

        dx = raw_kin[0, :, TOTAL_FEATURES:]
        # At t=5 (absent -> present transition), left hand delta MUST be exact 0.0
        self.assertTrue(torch.allclose(dx[5, 52:115], torch.zeros(63), atol=1e-7))
        # At t=6 (present -> present), left hand delta MUST be exact +0.25
        self.assertTrue(torch.allclose(dx[6, 52:115], torch.full((63,), 0.25), atol=1e-6))
        # Full forward output preserves shape and finite values
        out = kin(x)
        self.assertEqual(tuple(out.shape), (1, SEQUENCE_LENGTH, TOTAL_FEATURES * 2))
        self.assertTrue(torch.isfinite(out).all())

    def test_smoke_ablation_end_to_end_quantization_parity_latency_calibration_and_engine_gates(self):
        """
        End-to-end integration test of Commit 8:
          (a) Fair A/B ablation comparing DS-TCN 1D vs BiGRU on identical splits & seed.
          (b) Genuine INT8 quantization on DS-TCN 1D >= 85% of parameters, zero .onnx.data sidecars.
          (c) PyTorch <-> ONNX parity: FP32 L_inf <= 1e-5, INT8 calibrated prob L_inf <= 1e-2.
          (d) CPU ONNX Runtime latency p99 < 3.0 ms.
          (e) Temperature Scaling post-hoc calibration ECE < 0.03 on validation.
          (f) InferenceEngine rejects smoke-test model by default, rejects tampered config_hash & v1.3.0,
              accepts with allow_smoke_test=True, and enforces all 3 rejection gates.
        """
        self.assertTrue(hasattr(train_mod, "run_ablation_ab"))

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            shards_dir = root / "shards"
            out_dir = root / "exported"

            labels = ["adios", "agua", "ayuda", "bien", "gracias", "hola", "no", "reposo", "si"]
            manifest_path = train_mod.build_synthetic_smoke_shards(
                shards_dir,
                labels=labels,
                samples_per_class=60,
                seed=42,
            )

            report = train_mod.run_ablation_ab(
                manifest_path=manifest_path,
                output_dir=out_dir,
                epochs=18,
                batch_size=32,
                lr=3e-3,
                seed=42,
                is_smoke_test=True,
                benchmark_runs=100,
            )

            # (a) Fair A/B ablation contains both ds_tcn and bigru with Macro-F1
            self.assertIn("ds_tcn", report["models"])
            self.assertIn("bigru", report["models"])
            ds_res = report["models"]["ds_tcn"]
            bg_res = report["models"]["bigru"]
            self.assertGreaterEqual(ds_res["val_macro_f1"], 0.90)
            self.assertGreaterEqual(bg_res["val_macro_f1"], 0.90)

            # (b) Genuine INT8 quantization on DS-TCN >= 85% and zero .onnx.data sidecars
            self.assertGreaterEqual(ds_res["quantization"]["quantized_pct"], 85.0)
            self.assertGreater(
                ds_res["quantization"]["quantized_pct"],
                bg_res["quantization"]["quantized_pct"],
                "DS-TCN must achieve higher real INT8 quantization coverage than BiGRU",
            )
            onnx_data_files = list(out_dir.rglob("*.onnx.data"))
            self.assertEqual(onnx_data_files, [], f"Orphaned .onnx.data found: {onnx_data_files}")

            # (c) PyTorch <-> ONNX parity
            self.assertLessEqual(ds_res["parity"]["fp32_logit_linf"], 1e-5)
            self.assertLessEqual(ds_res["parity"]["int8_prob_linf"], 1e-2)
            self.assertLessEqual(bg_res["parity"]["fp32_logit_linf"], 1e-5)
            self.assertLessEqual(bg_res["parity"]["int8_prob_linf"], 1e-2)

            # (d) ONNX Runtime CPU latency p99 < 3.0 ms
            self.assertLess(ds_res["latency_cpu"]["p99_ms"], 3.0)

            # (e) Temperature Scaling calibration ECE < 0.03
            self.assertGreater(ds_res["calibration"]["temperature"], 0.0)
            self.assertLess(ds_res["calibration"]["ece_after"], 0.03)

            # Verify sealed model_metadata.json
            meta_path = out_dir / "model_metadata.json"
            self.assertTrue(meta_path.exists())
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            self.assertEqual(meta["feature_spec_version"], FEATURE_SPEC_VERSION)
            self.assertEqual(meta["config_hash"], compute_config_hash(delegate="GPU", pose_cadence=1))
            self.assertTrue(meta["is_smoke_test"])
            self.assertFalse(meta["production_ready"])
            self.assertIn("temperature", meta)
            self.assertIn("rejection_policy", meta)
            self.assertIn("model_files", meta)

            # (f.1) InferenceEngine MUST refuse smoke-test model by default (production guard)
            with self.assertRaises(IncompatibleFeatureSpecError):
                InferenceEngine(str(out_dir))

            # (f.2) InferenceEngine accepts smoke-test model only when explicitly opted in
            engine = InferenceEngine(str(out_dir), allow_smoke_test=True)
            info = engine.get_info()
            self.assertEqual(info["feature_spec_version"], FEATURE_SPEC_VERSION)
            self.assertEqual(info["config_hash"], meta["config_hash"])
            self.assertAlmostEqual(info["temperature"], meta["temperature"], places=6)

            # Run real ONNX inference on a validation tensor sample
            val_x = np.load(shards_dir / "X_val.npy", mmap_mode="r")
            sample_tensor = np.array(val_x[0:1], dtype=np.float32, copy=True)
            pred = engine.predict_tensor(sample_tensor)
            self.assertIn("confidence", pred)
            self.assertIn("margin", pred)
            self.assertIn("normalized_entropy", pred)
            self.assertIn("rejected", pred)
            self.assertIn("safe_label", pred)

            # (f.3) Verify all 3 rejection gates deterministically
            # Gate 1: low confidence
            g1 = InferenceEngine.evaluate_rejection_gates(
                np.array([0.40, 0.10, 0.10, 0.10, 0.10, 0.05, 0.05, 0.05, 0.05], dtype=np.float64),
                labels,
                min_confidence=0.65,
                min_margin=0.20,
                max_normalized_entropy=0.95,
                fallback_label="reposo",
            )
            self.assertTrue(g1["rejected"])
            self.assertEqual(g1["rejection_reason"], "low_confidence")
            self.assertIsNone(g1["label"])
            self.assertEqual(g1["safe_label"], "reposo")

            # Gate 2: low margin (top1 passes confidence, but top2 is too close)
            g2 = InferenceEngine.evaluate_rejection_gates(
                np.array([0.52, 0.45, 0.005, 0.005, 0.004, 0.004, 0.004, 0.004, 0.004], dtype=np.float64),
                labels,
                min_confidence=0.50,
                min_margin=0.20,
                max_normalized_entropy=0.95,
                fallback_label="reposo",
            )
            self.assertTrue(g2["rejected"])
            self.assertEqual(g2["rejection_reason"], "low_margin")
            self.assertIsNone(g2["label"])
            self.assertEqual(g2["safe_label"], "reposo")

            # Gate 3: high normalized entropy (top1 & margin pass, but tail is diffuse)
            g3 = InferenceEngine.evaluate_rejection_gates(
                np.array([0.52, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06], dtype=np.float64),
                labels,
                min_confidence=0.50,
                min_margin=0.20,
                max_normalized_entropy=0.55,
                fallback_label="reposo",
            )
            self.assertTrue(g3["rejected"])
            self.assertEqual(g3["rejection_reason"], "high_entropy")
            self.assertIsNone(g3["label"])
            self.assertEqual(g3["safe_label"], "reposo")

            # Accepted high-confidence sharp prediction passes all 3 gates
            g_ok = InferenceEngine.evaluate_rejection_gates(
                np.array([0.92, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.005, 0.005], dtype=np.float64),
                labels,
                min_confidence=0.65,
                min_margin=0.20,
                max_normalized_entropy=0.55,
                fallback_label="reposo",
            )
            self.assertFalse(g_ok["rejected"])
            self.assertIsNone(g_ok["rejection_reason"])
            self.assertEqual(g_ok["label"], "adios")
            self.assertEqual(g_ok["safe_label"], "adios")

            # (f.4) Tampered config_hash & v1.3.0 version MUST raise IncompatibleFeatureSpecError
            tampered_hash = dict(meta, config_hash="f" * 64)
            meta_path.write_text(json.dumps(tampered_hash), encoding="utf-8")
            with self.assertRaises(IncompatibleFeatureSpecError):
                InferenceEngine(str(out_dir), allow_smoke_test=True)

            old_ver = dict(meta, feature_spec_version="1.3.0")
            meta_path.write_text(json.dumps(old_ver), encoding="utf-8")
            with self.assertRaises(IncompatibleFeatureSpecError):
                InferenceEngine(str(out_dir), allow_smoke_test=True)

    def test_temperature_scaling_calibrates_overconfident_logits(self):
        """Post-hoc Temperature Scaling must recover T~2.8, reduce NLL, and drive ECE < 0.03."""
        rng = np.random.default_rng(123)
        n_samples, num_classes = 4500, 9
        true_labels = np.repeat(np.arange(num_classes), n_samples // num_classes)
        # Generate calibrated true log-odds, then distort with 2.8x overconfidence
        true_logits = rng.normal(0.0, 1.0, size=(n_samples, num_classes))
        for i, y in enumerate(true_labels):
            true_logits[i, y] += 3.2
        # Sample labels directly from the true softmax so true temperature is exactly 2.8
        true_probs = train_mod.numpy_softmax(true_logits, temperature=1.0)
        sampled_y = np.array([rng.choice(num_classes, p=p) for p in true_probs], dtype=np.int64)
        overconfident_logits = (true_logits * 2.8).astype(np.float32)

        cal = train_mod.fit_temperature_scaling(overconfident_logits, sampled_y)
        self.assertGreater(cal["ece_before"], 0.20)
        self.assertAlmostEqual(cal["temperature"], 2.8, delta=0.15)
        self.assertLess(cal["nll_after"], cal["nll_before"])
        self.assertLess(cal["ece_after"], 0.03)

    def test_no_orphaned_root_exported_model_or_onnx_data_in_repo(self):
        """Canonical export path is expresat/models/exported_model with zero .onnx.data sidecars."""
        self.assertFalse((REPO_ROOT / "exported_model").exists(), "Orphaned root exported_model/ must be removed")
        canonical_dir = REPO_ROOT / "expresat" / "models" / "exported_model"
        self.assertTrue(canonical_dir.exists())
        self.assertEqual(list(canonical_dir.glob("*.onnx.data")), [])


if __name__ == "__main__":
    unittest.main()
