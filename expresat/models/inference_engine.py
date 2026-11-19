"""
Production CPU-only ONNX Runtime inference engine (FEATURE_SPEC v1.4.0).

Documentation & Vault References:
  - Inference Engine Note: `Obsidian_exp/Explicacion del codigo/Funciones_Modelo/INFERENCIA.md`
  - Agent Playbook #4:     `Obsidian_exp/Agentes/02_PLAYBOOKS_POR_TAREA.md`
  - Contract Graph:        `Obsidian_exp/Agentes/03_GRAFO_DEPENDENCIAS_Y_CONTRATOS.md`

Loads a validated self-contained INT8 (or FP32 fallback) ONNX model (`DS-TCN 1D`
or `BiGRU`), enforces `FEATURE_SPEC v1.4.0` + `config_hash` + production readiness,
configures 1-thread ORT execution for lightweight models (< 2 MB, achieving p50=0.319 ms,
p99=0.625 ms), applies post-hoc Temperature Scaling, and evaluates the 3-gate rejection
policy (calibrated confidence >= 0.65, top-1/top-2 margin >= 0.20, and normalized
entropy <= 0.55 -> safe fallback to `reposo` / indeterminate).
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
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
DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "exported_model"
LIGHTWEIGHT_MODEL_MAX_BYTES = 2 * 1024 * 1024  # 2 MB -> 1-thread ORT avoids wakeup jitter


class IncompatibleFeatureSpecError(RuntimeError):
    """Raised when `model_metadata.json` violates FEATURE_SPEC v1.4.0, `config_hash`, or production policy."""


def _major_minor(version_str: str) -> tuple[str, str]:
    parts = str(version_str).strip().split(".")
    if len(parts) < 2:
        return ("", "")
    return (parts[0], parts[1])


def validate_metadata_feature_spec(
    metadata: dict,
    expected_delegate: Optional[str] = None,
    expected_pose_cadence: Optional[int] = None,
    allow_smoke_test: bool = False,
) -> tuple[str, str]:
    """
    Strictly validate `model_metadata.json` against active `FEATURE_SPEC_VERSION`,
    canonical `config_hash`, and production readiness (rejecting smoke-test artifacts
    unless `allow_smoke_test=True`).
    """
    if not isinstance(metadata, dict):
        raise IncompatibleFeatureSpecError("model_metadata.json inválido: se esperaba un objeto JSON.")

    if not allow_smoke_test:
        if bool(metadata.get("is_smoke_test", False)) or metadata.get("production_ready") is False:
            raise IncompatibleFeatureSpecError(
                "Artefacto de smoke-test sintético bloqueado en producción "
                "(is_smoke_test=true / production_ready=false). Entrena con shards reales validados "
                "o pasa allow_smoke_test=True solo en pruebas."
            )

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
    Thread-safe ONNX Runtime inference wrapper for ExpresaT sign classification
    with post-hoc Temperature Scaling and a 3-gate rejection policy.
    """

    def __init__(
        self,
        model_dir: str,
        confidence_threshold: Optional[float] = None,
        expected_delegate: Optional[str] = None,
        expected_pose_cadence: Optional[int] = None,
        *,
        min_margin: Optional[float] = None,
        max_normalized_entropy: Optional[float] = None,
        fallback_label: Optional[str] = None,
        allow_smoke_test: bool = False,
    ):
        """
        Initialize the inference engine from `model_dir` containing the `.onnx`
        artifact and `model_metadata.json`. Validates FEATURE_SPEC, `config_hash`,
        and production readiness before creating the ONNX Runtime session.
        """
        self.model_dir = Path(model_dir)
        self._lock = threading.Lock()
        self.allow_smoke_test = bool(allow_smoke_test)

        self.metadata = self._load_metadata()
        self.feature_spec_version, self.config_hash = validate_metadata_feature_spec(
            self.metadata,
            expected_delegate=expected_delegate,
            expected_pose_cadence=expected_pose_cadence,
            allow_smoke_test=self.allow_smoke_test,
        )
        self.labels = list(self.metadata["labels"])
        self.num_classes = int(self.metadata.get("num_classes", len(self.labels)))
        self.architecture = str(self.metadata.get("architecture", "unknown"))

        # Post-hoc Temperature Scaling scalar (defaults to 1.0 if omitted in legacy tests)
        temp_raw = self.metadata.get("temperature", 1.0)
        try:
            self.temperature = float(temp_raw)
        except (TypeError, ValueError) as exc:
            raise IncompatibleFeatureSpecError(f"temperature inválido en model_metadata.json: {temp_raw!r}") from exc
        if not math.isfinite(self.temperature) or self.temperature <= 0.0:
            raise IncompatibleFeatureSpecError(f"temperature debe ser finito y > 0, encontrado: {self.temperature}")

        # 3-gate rejection policy (caller overrides > metadata policy > safe defaults)
        policy = self.metadata.get("rejection_policy")
        policy_dict = policy if isinstance(policy, dict) else {}
        self.confidence_threshold = float(
            confidence_threshold
            if confidence_threshold is not None
            else policy_dict.get("min_confidence", 0.5)
        )
        self.min_margin = float(
            min_margin if min_margin is not None else policy_dict.get("min_margin", 0.20)
        )
        self.max_normalized_entropy = float(
            max_normalized_entropy
            if max_normalized_entropy is not None
            else policy_dict.get("max_normalized_entropy", 0.55)
        )
        self.fallback_label = str(
            fallback_label if fallback_label is not None else policy_dict.get("fallback_label", "reposo")
        )

        self.session = self._create_onnx_session()
        self._input_name = self.session.get_inputs()[0].name

        print("    InferenceEngine inicializado")
        print(f"    Modelo:     {self._get_model_path().name} ({self.architecture})")
        print(f"    Spec:       {self.feature_spec_version} ({self.config_hash[:12]}...)")
        print(f"    Clases:     {self.num_classes}")
        print(f"    Features:   {NUM_FEATURES}")
        print(f"    Temp / Gates: T={self.temperature:.4f} | conf>={self.confidence_threshold} | margin>={self.min_margin} | H<={self.max_normalized_entropy}")

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
        """Prefer INT8 ONNX declared in `model_files` (then FP32), with canonical filename fallbacks."""
        model_files = self.metadata.get("model_files")
        if isinstance(model_files, dict):
            for key in ("int8", "float32"):
                fname = model_files.get(key)
                if isinstance(fname, str) and fname.strip():
                    candidate = self.model_dir / fname
                    if candidate.exists():
                        return candidate

        candidates = [
            "expresat_ds_tcn_int8.onnx",
            "expresat_ds_tcn_float32.onnx",
            "expresat_bigru_int8.onnx",
            "expresat_bigru_float32.onnx",
            "expresat_gru_int8.onnx",
            "expresat_gru_float32.onnx",
        ]
        for fname in candidates:
            candidate = self.model_dir / fname
            if candidate.exists():
                return candidate

        raise FileNotFoundError(
            f"No se encontró ningún modelo .onnx en {self.model_dir}. "
            f"Ejecuta train_and_export.py primero."
        )

    def _create_onnx_session(self):
        """Create a low-latency CPU ONNX Runtime session (single-threaded for lightweight edge models)."""
        import onnxruntime as ort

        model_path = self._get_model_path()
        model_size_bytes = model_path.stat().st_size if model_path.exists() else 0

        # Lightweight models (< 2 MB) run dramatically faster & with lower p99 jitter
        # on 1 intra-op thread (no thread-pool wakeup overhead).
        if model_size_bytes <= LIGHTWEIGHT_MODEL_MAX_BYTES:
            intra_threads = 1
        else:
            intra_threads = min(os.cpu_count() or 2, 4)

        session_options = ort.SessionOptions()
        session_options.inter_op_num_threads = 1
        session_options.intra_op_num_threads = intra_threads
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_options.enable_cpu_mem_arena = False
        session_options.enable_mem_pattern = True
        session_options.log_severity_level = 3  # ERROR only

        return ort.InferenceSession(
            str(model_path),
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )

    def preprocess_batch(self, raw_frames: list[dict]) -> np.ndarray:
        """Preprocess raw frames via canonical `extract_window` into shape (1, 15, 178) float32."""
        tensor, valid, error = extract_window(raw_frames)
        if not valid or tensor is None:
            raise ValueError(f"Preprocesamiento de inferencia falló: {error} (prohibido caer a coordenadas crudas)")
        return tensor

    @staticmethod
    def _softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
        """Numerically stable temperature-scaled softmax."""
        scaled = np.asarray(logits, dtype=np.float64) / float(temperature)
        exp_logits = np.exp(scaled - np.max(scaled))
        return exp_logits / np.sum(exp_logits)

    @staticmethod
    def evaluate_rejection_gates(
        probabilities: np.ndarray,
        labels: list[str],
        *,
        min_confidence: float = 0.65,
        min_margin: float = 0.20,
        max_normalized_entropy: float = 0.55,
        fallback_label: str = "reposo",
    ) -> dict:
        """
        Evaluate the 3 calibrated rejection gates:
          1. `top1_prob < min_confidence` -> `low_confidence`
          2. `top1_prob - top2_prob < min_margin` -> `low_margin`
          3. `H(p) / log(C) > max_normalized_entropy` -> `high_entropy`

        Rejected predictions return `label=None` (preventing false WebSocket emissions)
        and `safe_label="reposo"` (or `"indeterminado"` if `"reposo"` is not in `labels`).
        """
        probs = np.asarray(probabilities, dtype=np.float64)
        num_classes = int(probs.shape[0])
        order = np.argsort(probs)[::-1]
        top1_idx = int(order[0])
        top1_prob = float(probs[top1_idx])
        top2_prob = float(probs[int(order[1])]) if num_classes >= 2 else 0.0
        margin = top1_prob - top2_prob

        if num_classes >= 2:
            clipped = np.clip(probs, 1e-12, 1.0)
            entropy = float(-np.sum(clipped * np.log(clipped)))
            normalized_entropy = entropy / math.log(num_classes)
        else:
            normalized_entropy = 0.0

        rejection_reason: Optional[str] = None
        if top1_prob < min_confidence:
            rejection_reason = "low_confidence"
        elif margin < min_margin:
            rejection_reason = "low_margin"
        elif normalized_entropy > max_normalized_entropy:
            rejection_reason = "high_entropy"

        rejected = rejection_reason is not None
        raw_top1_label = labels[top1_idx]
        safe_fallback = fallback_label if fallback_label in labels else "indeterminado"

        return {
            "label": None if rejected else raw_top1_label,
            "safe_label": safe_fallback if rejected else raw_top1_label,
            "raw_top1_label": raw_top1_label,
            "confidence": round(top1_prob, 4),
            "margin": round(margin, 4),
            "normalized_entropy": round(normalized_entropy, 4),
            "rejected": rejected,
            "rejection_reason": rejection_reason,
        }

    def predict_tensor(self, tensor: np.ndarray) -> dict:
        """Run ONNX inference, Temperature Scaling, and 3-gate rejection on a `(1, 15, 178)` tensor."""
        start_time = time.perf_counter()
        x = np.asarray(tensor, dtype=np.float32)
        if x.shape != (1, SEQUENCE_LENGTH, NUM_FEATURES):
            raise ValueError(f"Forma de tensor inválida: {x.shape}, esperado (1, {SEQUENCE_LENGTH}, {NUM_FEATURES}).")

        with self._lock:
            logits = self.session.run(None, {self._input_name: x})[0]

        probabilities = self._softmax(logits[0], temperature=self.temperature)
        gate_res = self.evaluate_rejection_gates(
            probabilities,
            self.labels,
            min_confidence=self.confidence_threshold,
            min_margin=self.min_margin,
            max_normalized_entropy=self.max_normalized_entropy,
            fallback_label=self.fallback_label,
        )

        top_indices = np.argsort(probabilities)[::-1][:5]
        top_predictions = {
            self.labels[int(idx)]: round(float(probabilities[int(idx)]), 4)
            for idx in top_indices
        }

        latency_ms = (time.perf_counter() - start_time) * 1000.0
        return {
            **gate_res,
            "temperature": round(self.temperature, 6),
            "latency_ms": round(latency_ms, 2),
            "all_probabilities": top_predictions,
        }

    def predict(self, raw_frames: list[dict]) -> dict:
        """
        Run canonical FEATURE_SPEC v1.4.0 preprocessing, ONNX Runtime inference,
        Temperature Scaling, and 3-gate rejection over raw MediaPipe frames.
        """
        start_time = time.perf_counter()

        tensor, valid, error = extract_window(raw_frames)
        if not valid or tensor is None:
            safe_fb = self.fallback_label if self.fallback_label in self.labels else "indeterminado"
            return {
                "label": None,
                "safe_label": safe_fb,
                "confidence": 0.0,
                "margin": 0.0,
                "normalized_entropy": 1.0,
                "rejected": True,
                "rejection_reason": "invalid_window",
                "valid": False,
                "error": error,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "all_probabilities": {},
            }

        res = self.predict_tensor(tensor)
        res["latency_ms"] = round((time.perf_counter() - start_time) * 1000.0, 2)
        return res

    def get_info(self) -> dict:
        """Return inference engine metadata for health checks and contract audits."""
        model_path = self._get_model_path()
        return {
            "engine": "ONNX Runtime",
            "architecture": self.architecture,
            "model_file": model_path.name,
            "model_size_kb": round(model_path.stat().st_size / 1024, 1),
            "feature_spec_version": self.feature_spec_version,
            "config_hash": self.config_hash,
            "num_classes": self.num_classes,
            "labels": self.labels,
            "sequence_length": SEQUENCE_LENGTH,
            "num_features": NUM_FEATURES,
            "temperature": self.temperature,
            "confidence_threshold": self.confidence_threshold,
            "rejection_policy": {
                "min_confidence": self.confidence_threshold,
                "min_margin": self.min_margin,
                "max_normalized_entropy": self.max_normalized_entropy,
                "fallback_label": self.fallback_label,
            },
            "is_smoke_test": bool(self.metadata.get("is_smoke_test", False)),
            "production_ready": bool(self.metadata.get("production_ready", True)),
            "providers": self.session.get_providers(),
        }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Inspect/Test ExpresaT InferenceEngine v1.4.0")
    parser.add_argument(
        "--model-dir",
        default=str(DEFAULT_MODEL_DIR),
        help="Directory containing exported ONNX model and model_metadata.json",
    )
    parser.add_argument(
        "--allow-smoke-test",
        action="store_true",
        help="Allow loading smoke-test model artifacts (for local verification only)",
    )
    args = parser.parse_args()

    engine = InferenceEngine(args.model_dir, allow_smoke_test=args.allow_smoke_test)
    print(f"\nInfo del motor: {json.dumps(engine.get_info(), indent=2, ensure_ascii=False)}")
