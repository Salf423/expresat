"""
Contract tests for InferenceEngine FEATURE_SPEC v1.4.0 validation and cleanup.

Verifies:
  1. Dead legacy normalization methods (`_normalize_to_shoulders`, `_extract_pose_upper`,
     `_extract_hand`) are removed from `InferenceEngine`.
  2. `IncompatibleFeatureSpecError` is raised before creating any ONNX session when
     `model_metadata.json` is missing `feature_spec_version` / `config_hash`, uses an
     incompatible major.minor version (e.g. 1.3.0), has a mismatched `config_hash`,
     or mismatches expected `delegate` / `pose_cadence`.
  3. Valid v1.4.0 metadata passes validation and exposes `feature_spec_version` and
     `config_hash` via `get_info()`.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))

from models.feature_extractor import FEATURE_SPEC_VERSION, compute_config_hash
import models.inference_engine as ie_mod
from models.inference_engine import InferenceEngine


class TestInferenceEngineContract(unittest.TestCase):
    def _write_model_dir(self, tmp_dir: Path, metadata: dict) -> None:
        (tmp_dir / "model_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        (tmp_dir / "expresat_gru_int8.onnx").write_bytes(b"fake-onnx-placeholder")

    def _valid_metadata(self, delegate: str = "GPU", pose_cadence: int = 1) -> dict:
        return {
            "labels": ["hola", "gracias", "reposo"],
            "num_classes": 3,
            "sequence_length": 15,
            "num_features": 178,
            "feature_spec_version": FEATURE_SPEC_VERSION,
            "delegate": delegate,
            "pose_cadence": pose_cadence,
            "config_hash": compute_config_hash(delegate=delegate, pose_cadence=pose_cadence),
        }

    def test_dead_legacy_normalization_methods_removed(self):
        self.assertFalse(hasattr(InferenceEngine, "_normalize_to_shoulders"))
        self.assertFalse(hasattr(InferenceEngine, "_extract_pose_upper"))
        self.assertFalse(hasattr(InferenceEngine, "_extract_hand"))

    def test_incompatible_error_class_exported(self):
        self.assertTrue(hasattr(ie_mod, "IncompatibleFeatureSpecError"))
        self.assertTrue(issubclass(ie_mod.IncompatibleFeatureSpecError, RuntimeError))

    def test_rejects_missing_feature_spec_fields(self):
        err_cls = getattr(ie_mod, "IncompatibleFeatureSpecError")
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td)
            self._write_model_dir(model_dir, {"labels": ["hola"], "num_classes": 1})
            with patch.object(InferenceEngine, "_create_onnx_session") as mock_sess:
                with self.assertRaises(err_cls):
                    InferenceEngine(str(model_dir))
                mock_sess.assert_not_called()

    def test_rejects_old_feature_spec_version_1_3_0(self):
        err_cls = getattr(ie_mod, "IncompatibleFeatureSpecError")
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td)
            meta = self._valid_metadata()
            meta["feature_spec_version"] = "1.3.0"
            self._write_model_dir(model_dir, meta)
            with patch.object(InferenceEngine, "_create_onnx_session") as mock_sess:
                with self.assertRaises(err_cls):
                    InferenceEngine(str(model_dir))
                mock_sess.assert_not_called()

    def test_rejects_mismatched_config_hash(self):
        err_cls = getattr(ie_mod, "IncompatibleFeatureSpecError")
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td)
            meta = self._valid_metadata()
            meta["config_hash"] = "a" * 64
            self._write_model_dir(model_dir, meta)
            with patch.object(InferenceEngine, "_create_onnx_session") as mock_sess:
                with self.assertRaises(err_cls):
                    InferenceEngine(str(model_dir))
                mock_sess.assert_not_called()

    def test_rejects_delegate_or_pose_cadence_mismatch(self):
        err_cls = getattr(ie_mod, "IncompatibleFeatureSpecError")
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td)
            self._write_model_dir(model_dir, self._valid_metadata(delegate="CPU", pose_cadence=1))
            with patch.object(InferenceEngine, "_create_onnx_session") as mock_sess:
                with self.assertRaises(err_cls):
                    InferenceEngine(str(model_dir), expected_delegate="GPU")
                with self.assertRaises(err_cls):
                    InferenceEngine(str(model_dir), expected_pose_cadence=2)
                mock_sess.assert_not_called()

    def test_accepts_valid_v140_metadata_and_exposes_contract_in_get_info(self):
        with tempfile.TemporaryDirectory() as td:
            model_dir = Path(td)
            meta = self._valid_metadata(delegate="GPU", pose_cadence=1)
            self._write_model_dir(model_dir, meta)

            fake_input = MagicMock()
            fake_input.name = "input"
            fake_session = MagicMock()
            fake_session.get_inputs.return_value = [fake_input]
            fake_session.get_providers.return_value = ["CPUExecutionProvider"]

            with patch.object(InferenceEngine, "_create_onnx_session", return_value=fake_session):
                engine = InferenceEngine(str(model_dir), expected_delegate="GPU", expected_pose_cadence=1)
                info = engine.get_info()
                self.assertEqual(info["feature_spec_version"], FEATURE_SPEC_VERSION)
                self.assertEqual(info["config_hash"], meta["config_hash"])
                self.assertEqual(info["num_features"], 178)
                self.assertEqual(info["sequence_length"], 15)


if __name__ == "__main__":
    unittest.main()
