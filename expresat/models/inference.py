"""
inference.py — ExpresaT: Módulo Legacy (DEPRECADO — usar inference_engine.py)
==============================================================================
⚠️  ADVERTENCIA: Este módulo usa la topología INCORRECTA de features (33×3=99
    para pose completa en vez de 13×4=52 para upper pose). El vector resultante
    tiene 225 dimensiones en vez de las 178 requeridas por el modelo GRU.

    Para inferencia de producción, usar:
        from models.inference_engine import InferenceEngine

    Este archivo se conserva solo como referencia histórica y para no romper
    imports legados. NO conectar al pipeline de entrenamiento ni al backend.
"""

import numpy as np


# =============================================================================
# CONSTANTES CORRECTAS — Topología 178D (ExpresaT GRU)
# =============================================================================
# Upper Pose: índices MediaPipe {0,11,12,13,14,15,16,17,18,19,20,21,22} = 13 pts × 4D
POSE_UPPER_INDICES = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
POSE_COORDS   = 4   # x, y, z, visibility
HAND_LANDMARKS = 21
HAND_COORDS   = 3   # x, y, z
NUM_FEATURES  = len(POSE_UPPER_INDICES) * POSE_COORDS + HAND_LANDMARKS * HAND_COORDS * 2  # 178
SEQUENCE_LENGTH = 15  # frames


class SignLanguagePredictor:
    """
    DEPRECADO. Usa InferenceEngine de inference_engine.py para producción.

    Esta clase se mantiene por compatibilidad con código anterior.
    La topología de features ha sido corregida para coincidir con el modelo GRU
    entrenado: vector 178D (upper_pose:52 + left_hand:63 + right_hand:63).
    """

    def __init__(self):
        self.sequence: list = []
        self.sequence_length = SEQUENCE_LENGTH
        self.threshold = 0.8

        # Vocabulario de señas (debe coincidir con model_metadata.json en producción)
        self.actions = [
            "hola", "gracias", "por_favor", "adios", "si", "no",
            "ayuda", "bien", "mal", "nombre", "como_estas", "mucho_gusto",
            "perdon", "agua", "comida"
        ]

    def extract_keypoints(self, landmarks_dict: dict) -> np.ndarray:
        """
        Extrae y normaliza landmarks a un vector de 178 dimensiones.

        Topología correcta:
          [0:52]   — Upper Pose: 13 landmarks × (x, y, z, visibility)
          [52:115] — Mano Izquierda: 21 landmarks × (x, y, z)
          [115:178]— Mano Derecha:   21 landmarks × (x, y, z)

        Returns:
            np.ndarray de forma (178,) dtype float32
        """
        # ── Upper Pose (13 landmarks × 4 coords) ──────────────────────────
        raw_pose = landmarks_dict.get("pose") or []
        pose_features = []
        for idx in POSE_UPPER_INDICES:
            if idx < len(raw_pose):
                lm = raw_pose[idx]
                pose_features.extend([
                    lm.get("x", 0.0), lm.get("y", 0.0),
                    lm.get("z", 0.0), lm.get("visibility", 0.0)
                ])
            else:
                pose_features.extend([0.0, 0.0, 0.0, 0.0])
        pose_arr = np.array(pose_features, dtype=np.float32)  # (52,)

        # ── Mano izquierda (21 landmarks × 3 coords) ──────────────────────
        raw_lh = landmarks_dict.get("leftHand") or []
        if raw_lh:
            lh = np.array([[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                           for lm in raw_lh[:HAND_LANDMARKS]], dtype=np.float32).flatten()
            lh = np.pad(lh, (0, max(0, HAND_LANDMARKS * HAND_COORDS - lh.shape[0])))
        else:
            lh = np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        # ── Mano derecha (21 landmarks × 3 coords) ────────────────────────
        raw_rh = landmarks_dict.get("rightHand") or []
        if raw_rh:
            rh = np.array([[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                           for lm in raw_rh[:HAND_LANDMARKS]], dtype=np.float32).flatten()
            rh = np.pad(rh, (0, max(0, HAND_LANDMARKS * HAND_COORDS - rh.shape[0])))
        else:
            rh = np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        return np.concatenate([pose_arr, lh, rh])  # (178,)

    def process_frame(self, landmarks_dict: dict):
        """
        Recibe un frame, extrae puntos y, cuando acumula 15, dispara inferencia.

        ⚠️  Este método usa inferencia MOCK. Para inferencia real, usar InferenceEngine.
        """
        if not landmarks_dict:
            return None

        keypoints = self.extract_keypoints(landmarks_dict)
        self.sequence.append(keypoints)
        self.sequence = self.sequence[-self.sequence_length:]

        if len(self.sequence) == self.sequence_length:
            # ── Inferencia real (descomentar cuando el modelo esté listo) ──
            # from models.inference_engine import InferenceEngine
            # engine = InferenceEngine("./exported_model")
            # result = engine.predict(batch_of_15_frame_dicts)

            # ── Mock para desarrollo ───────────────────────────────────────
            import random
            mock_res = random.choice(self.actions)
            self.sequence = []
            return f"Seña detectada: {mock_res}"

        return None
