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
    from models.feature_extractor import (
        FEATURE_SPEC_VERSION,
        SEQUENCE_LENGTH,
        TOTAL_FEATURES,
        compute_config_hash,
        extract_window,
    )
except ImportError:
    try:
        from feature_extractor import (
            FEATURE_SPEC_VERSION,
            SEQUENCE_LENGTH,
            TOTAL_FEATURES,
            compute_config_hash,
            extract_window,
        )
    except ImportError:
        from expresat.models.feature_extractor import (
            FEATURE_SPEC_VERSION,
            SEQUENCE_LENGTH,
            TOTAL_FEATURES,
            compute_config_hash,
            extract_window,
        )


NUM_FEATURES = TOTAL_FEATURES


class IncompatibleFeatureSpecError(RuntimeError):
    """Raised when `model_metadata.json` violates the active FEATURE_SPEC contract or `config_hash`."""


def _major_minor(version_str: str) -> tuple[str, str]:
    parts = str(version_str).strip().split(".")
    if len(parts) < 2:
        return ("", "")
    return (parts[0], parts[1])


def validate_metadata_feature_spec(
    metadata: dict,
    expected_delegate: Optional[str] = None,
    expected_pose_cadence: Optional[int] = None,
) -> tuple[str, str]:
    """
    Strictly validate `model_metadata.json` against active `FEATURE_SPEC_VERSION` and `config_hash`.
    Raises `IncompatibleFeatureSpecError` on missing fields, major.minor mismatch, delegate/cadence
    mismatch, tensor shape mismatch, or digest mismatch.
    """
    if not isinstance(metadata, dict):
        raise IncompatibleFeatureSpecError("model_metadata.json inválido: se esperaba un objeto JSON.")

    meta_version = metadata.get("feature_spec_version")
    if not isinstance(meta_version, str) or not meta_version.strip():
        raise IncompatibleFeatureSpecError(
            f"model_metadata.json carece de 'feature_spec_version' obligatorio (esperado {FEATURE_SPEC_VERSION})."
        )

    if _major_minor(meta_version) != _major_minor(FEATURE_SPEC_VERSION):
        raise IncompatibleFeatureSpecError(
            f"Versión FEATURE_SPEC incompatible: modelo={meta_version}, runtime={FEATURE_SPEC_VERSION}. "
            f"Re-entrena y exporta el modelo con FEATURE_SPEC {FEATURE_SPEC_VERSION}."
        )

    meta_seq_len = metadata.get("sequence_length")
    if meta_seq_len is not None and int(meta_seq_len) != SEQUENCE_LENGTH:
        raise IncompatibleFeatureSpecError(
            f"sequence_length incompatible: modelo={meta_seq_len}, runtime={SEQUENCE_LENGTH}."
        )

    meta_num_features = metadata.get("num_features")
    if meta_num_features is not None and int(meta_num_features) != TOTAL_FEATURES:
        raise IncompatibleFeatureSpecError(
            f"num_features incompatible: modelo={meta_num_features}, runtime={TOTAL_FEATURES}."
        )

    meta_delegate = str(metadata.get("delegate", "GPU"))
    try:
        meta_pose_cadence = int(metadata.get("pose_cadence", 1))
    except (TypeError, ValueError) as exc:
        raise IncompatibleFeatureSpecError(
            f"pose_cadence inválido en model_metadata.json: {metadata.get('pose_cadence')!r}"
        ) from exc

    if expected_delegate is not None and meta_delegate != str(expected_delegate):
        raise IncompatibleFeatureSpecError(
            f"Delegado incompatible: modelo={meta_delegate}, esperado={expected_delegate}."
        )

    if expected_pose_cadence is not None and meta_pose_cadence != int(expected_pose_cadence):
        raise IncompatibleFeatureSpecError(
            f"pose_cadence incompatible: modelo={meta_pose_cadence}, esperado={expected_pose_cadence}."
        )

    meta_hash = metadata.get("config_hash")
    if not isinstance(meta_hash, str) or len(meta_hash) != 64:
        raise IncompatibleFeatureSpecError(
            "model_metadata.json carece de 'config_hash' SHA-256 válido (64 hex)."
        )

    expected_hash = compute_config_hash(delegate=meta_delegate, pose_cadence=meta_pose_cadence)
    if meta_hash != expected_hash:
        raise IncompatibleFeatureSpecError(
            f"config_hash incompatible (delegate={meta_delegate}, pose_cadence={meta_pose_cadence}): "
            f"modelo={meta_hash[:12]}..., runtime={expected_hash[:12]}.... "
            f"Verifica parámetros FEATURE_SPEC {FEATURE_SPEC_VERSION} y checksums .task."
        )

    return meta_version, meta_hash


class InferenceEngine:
    """
    Thread-safe ONNX Runtime inference wrapper for ExpresaT sign classification.
    """

    def __init__(
        self,
        model_dir: str,
        confidence_threshold: float = 0.5,
        expected_delegate: Optional[str] = None,
        expected_pose_cadence: Optional[int] = None,
    ):
        """
        Initialize the inference engine from `model_dir` containing the `.onnx`
        artifact and `model_metadata.json`. Validates FEATURE_SPEC and `config_hash`
        before creating the ONNX Runtime session.
        """
        self.model_dir = Path(model_dir)
        self.confidence_threshold = confidence_threshold
        self._lock = threading.Lock()

        self.metadata = self._load_metadata()
        self.feature_spec_version, self.config_hash = validate_metadata_feature_spec(
            self.metadata,
            expected_delegate=expected_delegate,
            expected_pose_cadence=expected_pose_cadence,
        )
        self.labels = self.metadata["labels"]
        self.num_classes = self.metadata["num_classes"]

        self.session = self._create_onnx_session()
        self._input_name = self.session.get_inputs()[0].name

        print("    InferenceEngine inicializado")
        print(f"    Modelo:     {self._get_model_path().name}")
        print(f"    Spec:       {self.feature_spec_version} ({self.config_hash[:12]}...)")
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
            "feature_spec_version": self.feature_spec_version,
            "config_hash": self.config_hash,
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

