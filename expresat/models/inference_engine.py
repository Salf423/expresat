"""
inference_engine.py — ExpresaT: Motor de Inferencia ONNX Runtime (CPU-Only)
===========================================================================
Clase de producción que carga el modelo GRU cuantizado a INT8 en formato ONNX
y ejecuta inferencia sobre lotes de 15 frames de landmarks de MediaPipe.

    - ONNX Runtime como motor de inferencia (NO PyTorch/TensorFlow en prod)
    - Preprocesamiento vectorizado con NumPy (zero-copy cuando es posible)
    - Normalización relativa a los hombros para invariancia de posición
    - Thread-safe: usa un lock para serializar acceso a la sesión ONNX
    - Latencia objetivo: < 100ms por batch en CPU

Uso:
    engine = InferenceEngine("./exported_model")
    result = engine.predict(batch_15_frames)
    print(result)  # {"label": "hola", "confidence": 0.95, "latency_ms": 3.2}
"""

import json
import os
import time
import threading
from pathlib import Path
from typing import Optional

import numpy as np


# =============================================================================
# CONSTANTES — Deben coincidir con train_and_export.py
# =============================================================================

SEQUENCE_LENGTH = 15

# Pose superior: landmarks de MediaPipe que nos interesan
# Índices de MediaPipe Pose (33 total) que corresponden al torso superior:
#   0: nariz, 11-12: hombros, 13-14: codos, 15-16: muñecas,
#   17-18: meñique, 19-20: índice, 21-22: pulgar, 23-24: caderas
POSE_UPPER_INDICES = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
POSE_COORDS = 4       # x, y, z, visibility
HAND_LANDMARKS = 21
HAND_COORDS = 3       # x, y, z

NUM_FEATURES = (len(POSE_UPPER_INDICES) * POSE_COORDS) + (HAND_LANDMARKS * HAND_COORDS * 2)
# = 52 + 63 + 63 = 178


class InferenceEngine:
    """
    Attributes:
        session: Sesión de ONNX Runtime configurada para CPU
        labels: Lista de etiquetas de señas
        metadata: Metadatos del modelo (dimensiones, config, etc.)
        confidence_threshold: Umbral mínimo de confianza para reportar
    """

    def __init__(self, model_dir: str, confidence_threshold: float = 0.5):
        """
        Inicializa el motor de inferencia.

        Args:
            model_dir: Directorio que contiene el modelo .onnx y model_metadata.json
            confidence_threshold: Confianza mínima (0-1) para considerar una predicción válida

        Raises:
            FileNotFoundError: Si no se encuentra el modelo o los metadatos
            RuntimeError: Si ONNX Runtime no puede cargar el modelo
        """
        self.model_dir = Path(model_dir)
        self.confidence_threshold = confidence_threshold
        self._lock = threading.Lock()

        # --- Cargar metadatos ---
        self.metadata = self._load_metadata()
        self.labels = self.metadata["labels"]
        self.num_classes = self.metadata["num_classes"]

        # --- Inicializar sesión ONNX Runtime ---
        self.session = self._create_onnx_session()

        # --- Cachear nombre del input para evitar lookups repetidos ---
        self._input_name = self.session.get_inputs()[0].name

        print(f"    InferenceEngine inicializado")
        print(f"    Modelo:     {self._get_model_path().name}")
        print(f"    Clases:     {self.num_classes}")
        print(f"    Features:   {NUM_FEATURES}")
        print(f"    Threshold:  {self.confidence_threshold}")

    def _load_metadata(self) -> dict:
        """Carga y valida el archivo de metadatos del modelo."""
        meta_path = self.model_dir / "model_metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError(
                f"No se encontró model_metadata.json en {self.model_dir}. "
                f"Ejecuta train_and_export.py primero."
            )
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _get_model_path(self) -> Path:
        """
        Busca el mejor modelo disponible (prefiere INT8 cuantizado).
        Orden de preferencia: int8.onnx > float32.onnx
        """
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
        """
        Crea una sesión de ONNX Runtime optimizada para CPU.

        Configuración de rendimiento:
          - CPUExecutionProvider: Único proveedor (no GPU)
          - inter_op_num_threads=1: Un hilo entre operaciones (evita overhead)
          - intra_op_num_threads=2: Dos hilos dentro de cada operación
          - graph_optimization_level: Máximas optimizaciones del grafo
          - execution_mode: Secuencial (mejor para modelos pequeños)
        """
        import onnxruntime as ort

        model_path = str(self._get_model_path())

        # Opciones de sesión optimizadas para baja latencia en CPU
        session_options = ort.SessionOptions()
        session_options.inter_op_num_threads = 1
        session_options.intra_op_num_threads = 2
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        # Deshabilitar logging de ONNX Runtime para reducir overhead
        session_options.log_severity_level = 3  # ERROR only

        session = ort.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=["CPUExecutionProvider"]
        )

        return session

    # =========================================================================
    # PREPROCESAMIENTO — Normalización vectorizada con NumPy
    # =========================================================================

    def preprocess_batch(self, raw_frames: list[dict]) -> np.ndarray:
        """
        Args:
            raw_frames: Lista de 15 diccionarios, cada uno con:
                - "pose": lista de 33 landmarks [{x, y, z}, ...]
                - "leftHand": lista de 21 landmarks o null
                - "rightHand": lista de 21 landmarks o null

        Returns:
            np.ndarray de forma (1, 15, 178) dtype float32
        """
        processed_frames = np.zeros(
            (SEQUENCE_LENGTH, NUM_FEATURES), dtype=np.float32
        )

        num_frames = min(len(raw_frames), SEQUENCE_LENGTH)

        for i in range(num_frames):
            frame = raw_frames[i]
            if frame is None:
                continue

            # --- Extraer pose superior ---
            pose_features = self._extract_pose_upper(frame.get("pose"))

            # --- Extraer manos ---
            left_hand_features = self._extract_hand(frame.get("leftHand"))
            right_hand_features = self._extract_hand(frame.get("rightHand"))

            # --- Concatenar features del frame ---
            frame_features = np.concatenate([
                pose_features, left_hand_features, right_hand_features
            ])

            # --- Normalización relativa a los hombros ---
            if frame.get("pose") and len(frame["pose"]) > 12:
                frame_features = self._normalize_to_shoulders(
                    frame_features, frame["pose"]
                )

            processed_frames[i] = frame_features

        # Expandir dimensión de batch: (15, 178) → (1, 15, 178)
        return np.expand_dims(processed_frames, axis=0)

    def _extract_pose_upper(self, pose_landmarks: Optional[list]) -> np.ndarray:
        """
        Extrae los 13 landmarks del torso superior con visibility.

        Returns:
            np.ndarray de forma (52,) → 13 landmarks × 4 coordenadas
        """
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

        if not hand_landmarks:
            return np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        # Vectorización NumPy: convertir lista de dicts a array directamente
        try:
            hand_array = np.array(
                [[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                 for lm in hand_landmarks[:HAND_LANDMARKS]],
                dtype=np.float32
            )
            result = hand_array.flatten()

            # Pad si hay menos de 21 landmarks
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
        Normaliza las coordenadas haciéndolas relativas al punto medio
        entre los hombros (landmarks 11 y 12 de MediaPipe Pose).
        Args:
            features: Vector de features del frame (178,)
            pose_landmarks: Lista completa de 33 landmarks de pose

        Returns:
            features normalizadas (178,)
        """
        try:
            left_shoulder = pose_landmarks[11]
            right_shoulder = pose_landmarks[12]

            # Punto medio entre hombros como origen
            center_x = (left_shoulder.get("x", 0) + right_shoulder.get("x", 0)) / 2.0
            center_y = (left_shoulder.get("y", 0) + right_shoulder.get("y", 0)) / 2.0
            center_z = (left_shoulder.get("z", 0) + right_shoulder.get("z", 0)) / 2.0

            # Distancia entre hombros como factor de escala
            # Esto normaliza por el tamaño aparente de la persona
            shoulder_dist = np.sqrt(
                (left_shoulder.get("x", 0) - right_shoulder.get("x", 0)) ** 2 +
                (left_shoulder.get("y", 0) - right_shoulder.get("y", 0)) ** 2
            )

            # Evitar división por cero
            scale = max(shoulder_dist, 1e-6)

            normalized = features.copy()

            # --- Normalizar pose superior (13 landmarks × 4 coords) ---
            pose_end = len(POSE_UPPER_INDICES) * POSE_COORDS  # 52
            for j in range(0, pose_end, POSE_COORDS):
                normalized[j] = (features[j] - center_x) / scale       # x
                normalized[j + 1] = (features[j + 1] - center_y) / scale  # y
                normalized[j + 2] = (features[j + 2] - center_z) / scale  # z
                # visibility (j+3) se deja sin modificar

            # --- Normalizar manos (21 landmarks × 3 coords cada una) ---
            hand_start = pose_end  # 52
            hand_total = HAND_LANDMARKS * HAND_COORDS * 2  # 126
            for j in range(hand_start, hand_start + hand_total, HAND_COORDS):
                normalized[j] = (features[j] - center_x) / scale       # x
                normalized[j + 1] = (features[j + 1] - center_y) / scale  # y
                normalized[j + 2] = (features[j + 2] - center_z) / scale  # z

            return normalized

        except (IndexError, KeyError, TypeError):
            # Si falla la normalización, devolver features sin normalizar
            return features

    # =========================================================================
    # INFERENCIA
    # =========================================================================

    def predict(self, raw_frames: list[dict]) -> dict:
        """
        Args:
            raw_frames: Lista de hasta 15 frames de landmarks de MediaPipe.

        Returns:
            dict con:
                - "label": str — Seña detectada (o None si bajo threshold)
                - "confidence": float — Probabilidad de la predicción
                - "latency_ms": float — Tiempo total del pipeline
                - "all_probabilities": dict — Probabilidades por clase (top 5)
        """
        start_time = time.perf_counter()

        # 1. Preprocesar
        input_tensor = self.preprocess_batch(raw_frames)

        # 2. Inferir (thread-safe)
        with self._lock:
            logits = self.session.run(
                None,
                {self._input_name: input_tensor}
            )[0]  # Shape: (1, num_classes)

        # 3. Post-procesar
        probabilities = self._softmax(logits[0])
        predicted_idx = int(np.argmax(probabilities))
        predicted_confidence = float(probabilities[predicted_idx])

        latency_ms = (time.perf_counter() - start_time) * 1000

        # Top-5 predicciones para debugging/UI
        top_indices = np.argsort(probabilities)[::-1][:5]
        top_predictions = {
            self.labels[idx]: round(float(probabilities[idx]), 4)
            for idx in top_indices
        }

        # Aplicar threshold de confianza
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
        exp_logits = np.exp(logits - np.max(logits))
        return exp_logits / exp_logits.sum()

    # =========================================================================
    # UTILIDADES
    # =========================================================================

    def get_info(self) -> dict:
        """Retorna información del motor de inferencia para health checks."""
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


# =============================================================================
# MODO STANDALONE — Para pruebas rápidas
# =============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Test InferenceEngine")
    parser.add_argument("--model-dir", default="./exported_model",
                        help="Directorio del modelo exportado")
    args = parser.parse_args()

    engine = InferenceEngine(args.model_dir, confidence_threshold=0.3)

    # Generar batch sintético de 15 frames
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
