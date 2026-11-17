"""
Production CPU-only ONNX Runtime inference engine.

Loads the quantized INT8 GRU model and runs thread-safe inference over
15-frame MediaPipe landmark windows normalized relative to shoulder center.
"""

import json
import os
import time
import threading
from pathlib import Path
from typing import Optional

import numpy as np

try:
    from models.feature_extractor import extract_window, FEATURE_SPEC_VERSION
except ImportError:
    try:
        from feature_extractor import extract_window, FEATURE_SPEC_VERSION
    except ImportError:
        from expresat.models.feature_extractor import extract_window, FEATURE_SPEC_VERSION


# Must match train_and_export.py
SEQUENCE_LENGTH = 15
# Upper-body MediaPipe Pose indices (nose, shoulders, elbows, wrists, hand anchors)
POSE_UPPER_INDICES = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
POSE_COORDS = 4
HAND_LANDMARKS = 21
HAND_COORDS = 3

NUM_FEATURES = (len(POSE_UPPER_INDICES) * POSE_COORDS) + (HAND_LANDMARKS * HAND_COORDS * 2)


class InferenceEngine:
    """
    Thread-safe ONNX Runtime inference wrapper for ExpresaT sign classification.
    """

    def __init__(self, model_dir: str, confidence_threshold: float = 0.5):
        """
        Initialize the inference engine from `model_dir` containing the `.onnx`
        artifact and `model_metadata.json`.
        """
        self.model_dir = Path(model_dir)
        self.confidence_threshold = confidence_threshold
        self._lock = threading.Lock()

        self.metadata = self._load_metadata()
        self.labels = self.metadata["labels"]
        self.num_classes = self.metadata["num_classes"]

        self.session = self._create_onnx_session()
        self._input_name = self.session.get_inputs()[0].name

        print(f"    InferenceEngine inicializado")
        print(f"    Modelo:     {self._get_model_path().name}")
        print(f"    Clases:     {self.num_classes}")
        print(f"    Features:   {NUM_FEATURES}")
        print(f"    Threshold:  {self.confidence_threshold}")

    def _load_metadata(self) -> dict:
        """Load model metadata JSON from `model_dir`."""
        meta_path = self.model_dir / "model_metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError(
                f"No se encontró model_metadata.json en {self.model_dir}. "
                f"Ejecuta train_and_export.py primero."
            )
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _get_model_path(self) -> Path:
        """Prefer quantized INT8 ONNX model; fall back to float32."""
        int8_path = self.model_dir / "expresat_gru_int8.onnx"
        float32_path = self.model_dir / "expresat_gru_float32.onnx"

        if int8_path.exists():
            return int8_path
        elif float32_path.exists():
            print("  Modelo INT8 no encontrado, usando float32.")
            return float32_path
        else:
            raise FileNotFoundError(
                f"No se encontró ningún modelo .onnx en {self.model_dir}. "
                f"Ejecuta train_and_export.py primero."
            )

    def _create_onnx_session(self):
        """Create a CPU-optimized ONNX Runtime session (arena disabled to save RAM)."""
        import onnxruntime as ort
        import os

        model_path = str(self._get_model_path())

        cpu_count = os.cpu_count() or 2
        intra_threads = min(cpu_count, 4)

        session_options = ort.SessionOptions()
        session_options.inter_op_num_threads = 1
        session_options.intra_op_num_threads = intra_threads
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_options.enable_cpu_mem_arena = False
        session_options.enable_mem_pattern = True
        session_options.log_severity_level = 3  # ERROR only

        session = ort.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=["CPUExecutionProvider"]
        )

        return session

    def preprocess_batch(self, raw_frames: list[dict]) -> np.ndarray:
        """Preprocess raw frames via canonical `extract_window` into shape (1, 15, 178) float32."""
        tensor, valid, error = extract_window(raw_frames)
        if not valid or tensor is None:
            raise ValueError(f"Preprocesamiento de inferencia falló: {error} (prohibido caer a coordenadas crudas)")
        return tensor

    def _extract_pose_upper(self, pose_landmarks: Optional[list]) -> np.ndarray:
        """Extract the 13 upper-body pose landmarks with visibility into a (52,) array."""
        if not pose_landmarks:
            return np.zeros(len(POSE_UPPER_INDICES) * POSE_COORDS, dtype=np.float32)

        features = []
        for idx in POSE_UPPER_INDICES:
            if idx < len(pose_landmarks):
                lm = pose_landmarks[idx]
                features.extend([
                    lm.get("x", 0.0),
                    lm.get("y", 0.0),
                    lm.get("z", 0.0),
                    lm.get("visibility", 0.0)
                ])
            else:
                features.extend([0.0, 0.0, 0.0, 0.0])

        return np.array(features, dtype=np.float32)

    def _extract_hand(self, hand_landmarks: Optional[list]) -> np.ndarray:
        """Extract 21 hand landmarks into a (63,) float32 array."""
        if not hand_landmarks:
            return np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        try:
            hand_array = np.array(
                [[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                 for lm in hand_landmarks[:HAND_LANDMARKS]],
                dtype=np.float32
            )
            result = hand_array.flatten()

            if result.shape[0] < HAND_LANDMARKS * HAND_COORDS:
                result = np.pad(
                    result,
                    (0, HAND_LANDMARKS * HAND_COORDS - result.shape[0])
                )
            return result

        except (ValueError, TypeError):
            return np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

    def _normalize_to_shoulders(self, features: np.ndarray,
                                 pose_landmarks: list) -> np.ndarray:
        """
        Normalize coordinates relative to the shoulder midpoint (pose 11 and 12)
        and scale by 3D inter-shoulder distance, matching the C++ extractor.
        """
        try:
            left_shoulder = pose_landmarks[11]
            right_shoulder = pose_landmarks[12]

            center_x = (left_shoulder.get("x", 0) + right_shoulder.get("x", 0)) / 2.0
            center_y = (left_shoulder.get("y", 0) + right_shoulder.get("y", 0)) / 2.0
            center_z = (left_shoulder.get("z", 0) + right_shoulder.get("z", 0)) / 2.0

            # Full 3D Euclidean shoulder distance to match C++ normalization
            dx = left_shoulder.get("x", 0) - right_shoulder.get("x", 0)
            dy = left_shoulder.get("y", 0) - right_shoulder.get("y", 0)
            dz = left_shoulder.get("z", 0) - right_shoulder.get("z", 0)
            shoulder_dist = np.sqrt(dx*dx + dy*dy + dz*dz)

            scale = max(shoulder_dist, 1e-6)
            normalized = features.copy()

            # Upper pose: preserve visibility at offset +3
            pose_end = len(POSE_UPPER_INDICES) * POSE_COORDS
            for j in range(0, pose_end, POSE_COORDS):
                normalized[j]     = (features[j]     - center_x) / scale
                normalized[j + 1] = (features[j + 1] - center_y) / scale
                normalized[j + 2] = (features[j + 2] - center_z) / scale

            hand_start = pose_end
            hand_total = HAND_LANDMARKS * HAND_COORDS * 2
            for j in range(hand_start, hand_start + hand_total, HAND_COORDS):
                normalized[j]     = (features[j]     - center_x) / scale
                normalized[j + 1] = (features[j + 1] - center_y) / scale
                normalized[j + 2] = (features[j + 2] - center_z) / scale

            return normalized

        except (IndexError, KeyError, TypeError):
            return features

    def predict(self, raw_frames: list[dict]) -> dict:
        """
        Run preprocessing, ONNX Runtime inference, and softmax post-processing
        over a batch of up to 15 raw MediaPipe frames.
        """
        start_time = time.perf_counter()

        tensor, valid, error = extract_window(raw_frames)
        if not valid or tensor is None:
            return {
                "label": None,
                "confidence": 0.0,
                "valid": False,
                "error": error,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "all_probabilities": {},
            }

        with self._lock:
            logits = self.session.run(
                None,
                {self._input_name: tensor}
            )[0]

        probabilities = self._softmax(logits[0])
        predicted_idx = int(np.argmax(probabilities))
        predicted_confidence = float(probabilities[predicted_idx])

        latency_ms = (time.perf_counter() - start_time) * 1000

        top_indices = np.argsort(probabilities)[::-1][:5]
        top_predictions = {
            self.labels[idx]: round(float(probabilities[idx]), 4)
            for idx in top_indices
        }

        if predicted_confidence < self.confidence_threshold:
            return {
                "label": None,
                "confidence": predicted_confidence,
                "latency_ms": round(latency_ms, 2),
                "all_probabilities": top_predictions
            }

        return {
            "label": self.labels[predicted_idx],
            "confidence": round(predicted_confidence, 4),
            "latency_ms": round(latency_ms, 2),
            "all_probabilities": top_predictions
        }

    @staticmethod
    def _softmax(logits: np.ndarray) -> np.ndarray:
        """Numerically stable softmax (subtracts max logit before exp)."""
        exp_logits = np.exp(logits - np.max(logits))
        return exp_logits / exp_logits.sum()

    def get_info(self) -> dict:
        """Return inference engine metadata for health checks."""
        model_path = self._get_model_path()
        return {
            "engine": "ONNX Runtime",
            "model_file": model_path.name,
            "model_size_kb": round(model_path.stat().st_size / 1024, 1),
            "num_classes": self.num_classes,
            "labels": self.labels,
            "sequence_length": SEQUENCE_LENGTH,
            "num_features": NUM_FEATURES,
            "confidence_threshold": self.confidence_threshold,
            "providers": self.session.get_providers(),
        }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test InferenceEngine")
    parser.add_argument("--model-dir", default="./exported_model",
                        help="Directory containing exported ONNX model")
    parser.add_argument("--quantize", action="store_true",
                        help="Quantize float32 model to dynamic INT8")
    args = parser.parse_args()

    if args.quantize:
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            from pathlib import Path

            model_dir = Path(args.model_dir)
            float32_path = model_dir / "expresat_gru_float32.onnx"
            int8_path    = model_dir / "expresat_gru_int8.onnx"

            if not float32_path.exists():
                print(f"\n  ERROR: {float32_path} not found.")
                print("  Run train_and_export.py first to export FP32 model.")
                exit(1)

            print(f"\n Quantizing {float32_path.name} -> Dynamic INT8...")

            quantize_dynamic(
                model_input=str(float32_path),
                model_output=str(int8_path),
                weight_type=QuantType.QInt8,
                per_channel=False,
                reduce_range=False
            )

            size_fp32 = float32_path.stat().st_size / 1024
            size_int8  = int8_path.stat().st_size  / 1024
            reduction  = (1 - size_int8 / size_fp32) * 100

            print(f"  FP32 Size: {size_fp32:.1f} KB")
            print(f"  INT8 Size: {size_int8:.1f} KB")
            print(f"  Reduction: {reduction:.1f}%")
            print(f"\n  INT8 Model saved: {int8_path}")

        except ImportError:
            print("\n  ERROR: onnxruntime-tools package missing.")
        exit(0)

    engine = InferenceEngine(args.model_dir, confidence_threshold=0.3)

    dummy_frames = []
    for _ in range(15):
        dummy_frames.append({
            "pose": [{"x": np.random.rand(), "y": np.random.rand(),
                       "z": np.random.rand(), "visibility": 1.0}
                      for _ in range(33)],
            "leftHand": [{"x": np.random.rand(), "y": np.random.rand(),
                           "z": np.random.rand()}
                          for _ in range(21)],
            "rightHand": [{"x": np.random.rand(), "y": np.random.rand(),
                            "z": np.random.rand()}
                           for _ in range(21)]
        })

    print("\nEjecutando inferencia de prueba...")
    result = engine.predict(dummy_frames)
    print(f"\nResultado: {json.dumps(result, indent=2, ensure_ascii=False)}")
    print(f"\nInfo del motor: {json.dumps(engine.get_info(), indent=2)}")

