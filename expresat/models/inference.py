"""
Deprecated mock sign predictor.

OBSOLETE since FEATURE_SPEC v1.2.2 (used random stubs without canonical
normalization). Use `models.inference_engine.InferenceEngine` in production.
"""

import warnings
warnings.warn(
    "inference.py está OBSOLETO y fuera de servicio. Use models.inference_engine.InferenceEngine.",
    DeprecationWarning,
    stacklevel=2
)

import numpy as np


# 178D feature topology (13 upper-pose x 4 + 21 left-hand x 3 + 21 right-hand x 3)
POSE_UPPER_INDICES = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
POSE_COORDS   = 4
HAND_LANDMARKS = 21
HAND_COORDS   = 3
NUM_FEATURES  = len(POSE_UPPER_INDICES) * POSE_COORDS + HAND_LANDMARKS * HAND_COORDS * 2
SEQUENCE_LENGTH = 15

__all__ = ["SignLanguagePredictor"]


class SignLanguagePredictor:
    """
    Deprecated mock predictor kept only for legacy compatibility.
    Use `InferenceEngine` from `inference_engine.py` for real inference.
    """

    def __init__(self):
        warnings.warn(
            "SignLanguagePredictor está DEPRECADO. Use InferenceEngine desde inference_engine.py.",
            DeprecationWarning,
            stacklevel=2
        )
        self.sequence: list = []
        self.sequence_length = SEQUENCE_LENGTH
        self.threshold = 0.8

        # Vocabulary aligned with model_metadata.json
        self.actions = [
            "hola", "gracias", "por_favor", "adios", "si", "no",
            "ayuda", "bien", "mal", "nombre", "como_estas", "mucho_gusto",
            "perdon", "agua", "comida"
        ]

    def extract_keypoints(self, landmarks_dict: dict) -> np.ndarray:
        """
        Extract a 178D feature vector: upper_pose (52) + left_hand (63) + right_hand (63).
        """
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
        pose_arr = np.array(pose_features, dtype=np.float32)

        raw_lh = landmarks_dict.get("leftHand") or []
        if raw_lh:
            lh = np.array([[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                           for lm in raw_lh[:HAND_LANDMARKS]], dtype=np.float32).flatten()
            lh = np.pad(lh, (0, max(0, HAND_LANDMARKS * HAND_COORDS - lh.shape[0])))
        else:
            lh = np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        raw_rh = landmarks_dict.get("rightHand") or []
        if raw_rh:
            rh = np.array([[lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)]
                           for lm in raw_rh[:HAND_LANDMARKS]], dtype=np.float32).flatten()
            rh = np.pad(rh, (0, max(0, HAND_LANDMARKS * HAND_COORDS - rh.shape[0])))
        else:
            rh = np.zeros(HAND_LANDMARKS * HAND_COORDS, dtype=np.float32)

        return np.concatenate([pose_arr, lh, rh])

    def process_frame(self, landmarks_dict: dict):
        """Buffer 15 frames and return a mock prediction. Use InferenceEngine for real inference."""
        if not landmarks_dict:
            return None

        keypoints = self.extract_keypoints(landmarks_dict)
        self.sequence.append(keypoints)
        self.sequence = self.sequence[-self.sequence_length:]

        if len(self.sequence) == self.sequence_length:
            import random
            mock_res = random.choice(self.actions)
            self.sequence = []
            return f"Seña detectada: {mock_res}"

        return None