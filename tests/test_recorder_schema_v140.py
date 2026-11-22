"""
Schema conformance tests for recording_raw.schema.json v1.4.0 and validate_recording.py.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "schemas"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    HAND_LANDMARKER_SHA256,
    POSE_LANDMARKER_SHA256,
    compute_config_hash,
)
from validate_recording import validate_recording


class TestRecordingRawSchemaV140(unittest.TestCase):
    def _make_valid_v140_payload(self) -> dict:
        pose = [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.95} for _ in range(33)]
        hand_lms = [{"x": 0.65, "y": 0.65, "z": 0.0} for _ in range(21)]
        frames = [
            {
                "t_ms": float(i * 50),
                "videoWidth": 640,
                "videoHeight": 480,
                "hands": [{"landmarks": hand_lms, "categoryName": "Left", "score": 0.96}],
                "handedness": [[{"categoryName": "Left", "score": 0.96, "index": 0}]],
                "pose": pose,
            }
            for i in range(20)
        ]
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
                "width": 640,
                "height": 480,
                "frameRate": 30,
                "videoWidth": 640,
                "videoHeight": 480,
                "effective_resolution": "640x480",
            },
            "duration_ms": 1000.0,
            "total_frames": len(frames),
            "avg_fps": 20.0,
            "min_fps_required": 15.0,
            "interval_metrics": {
                "count": 19,
                "p50_ms": 50.0,
                "p95_ms": 50.0,
                "p99_ms": 50.0,
                "max_ms": 50.0,
                "max_allowed_ms": 100.0,
                "gaps_over_100ms": 0,
                "gaps_over_100ms_count": 0,
            },
            "edge_metrics": {
                "border_margin": 0.03,
                "frames_checked": 20,
                "frames_with_hand_near_edge": 0,
                "edge_clip_ratio": 0.0,
                "pose_shoulders_oob_frames": 0,
            },
            "hand_presence_metrics": {
                "sign_label": "hola",
                "is_active_sign": True,
                "frames_with_hands": 20,
                "hand_presence_ratio": 1.0,
                "min_required_ratio": 0.6,
                "passed": True,
            },
            "valid": True,
            "error": None,
            "prompt_timeline": [
                {
                    "index": 0,
                    "start_ms": 0,
                    "end_ms": 3000,
                    "actual_start_ms": 0.0,
                    "actual_end_ms": 1000.0,
                    "actual_timestamp_iso": "2026-11-18T19:00:00.000Z",
                    "label": "reposo",
                    "instruction": "REPOSO — BRAZOS ABAJO",
                }
            ],
            "videoWidth": 640,
            "videoHeight": 480,
            "frames": frames,
        }

    def test_accepts_full_v140_payload(self):
        payload = self._make_valid_v140_payload()
        errors = validate_recording(payload)
        self.assertEqual(errors, [], f"Errores inesperados en payload v1.4.0: {errors}")

    def test_rejects_v140_missing_config_hash_or_artifacts(self):
        payload = self._make_valid_v140_payload()
        del payload["config_hash"]
        errs = validate_recording(payload)
        self.assertTrue(errs, "v1.4.0 sin config_hash debe fallar validación")

        payload2 = self._make_valid_v140_payload()
        del payload2["model_artifacts"]
        errs2 = validate_recording(payload2)
        self.assertTrue(errs2, "v1.4.0 sin model_artifacts debe fallar validación")

        payload3 = self._make_valid_v140_payload()
        payload3["config_hash"] = "not-a-sha256"
        errs3 = validate_recording(payload3)
        self.assertTrue(errs3, "config_hash malformado debe fallar validación")

    def test_backward_compatible_with_v131_fixture(self):
        sample_path = Path(__file__).resolve().parent / "fixtures" / "sample_recording_recorder_v1_3_1.json"
        with open(sample_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(validate_recording(data), [])


if __name__ == "__main__":
    unittest.main()
