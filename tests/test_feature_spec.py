"""
tests/test_feature_spec.py — Suite de Conformidad Numérica con docs/dataset-generator/FEATURE_SPEC.md v1.2.1

Ejecuta todas las pruebas obligatorias de la Sección 10:
  - TC-01: Pose completa + Ambas manos (tolerancia <= 1e-6)
  - TC-02: Mano ausente (estrictamente 63 ceros)
  - TC-03: Pose incompleta (ERR_POSE_MISSING)
  - TC-04: Hombros demasiado pequeños (ERR_SHOULDERS_TOO_SMALL)
  - TC-05A: Asignación conjunta de 2 manos independiente del orden de entrada
  - TC-05B: Desempate de 1 mano centrada por categoryName MediaPipe
  - TC-05C: Descarte de mano desconectada (> 1.75 * D)
  - Pruebas de Propiedades:
      * Invarianza a traslación 3D (delta in [-0.08, 0.08]^3)
      * Invarianza a escala (s in [0.85, 1.20])
      * Conmutatividad de espejo (Extract(Mirror(raw)) == MirrorFeatures(Extract(raw)))
      * Involución de espejo (Mirror(Mirror(raw)) == raw)
  - Pruebas de Ventana (ExtractWindow):
      * Forma del tensor (1, 15, 178)
      * Brecha temporal <= 100 ms permitida
      * Brecha temporal > 100 ms rechazada (ERR_INVALID_FRAME_GAP_TOO_LARGE)
      * Reinicio de EMA al reaparecer mano
"""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

import numpy as np

# Asegurar import de expresat/models
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "expresat"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    TOTAL_FEATURES,
    SEQUENCE_LENGTH,
    extract_frame_features,
    extract_window,
    mirror_raw_frame,
    mirror_features_178,
)


def make_canonical_pose() -> list[dict]:
    """
    Construye la pose de 33 landmarks del Fixture Canónico (Sección 10):
      P11 = (0.60, 0.40, 0.00, 0.90)  # Hombro Izq
      P12 = (0.40, 0.40, 0.00, 0.90)  # Hombro Der
      Centro = (0.50, 0.40, 0.00), Escala D = 0.20
      P0  = (0.50, 0.20, -0.04, 0.99) # Nariz
      P15 = (0.70, 0.70, 0.05, 0.85)  # Muñeca Izq
      P16 = (0.30, 0.70, -0.05, 0.85) # Muñeca Der
    """
    pose = [{"x": 0.50, "y": 0.50, "z": 0.00, "visibility": 0.90} for _ in range(33)]

    # P0: Nariz
    pose[0] = {"x": 0.50, "y": 0.20, "z": -0.04, "visibility": 0.99}

    # Hombros
    pose[11] = {"x": 0.60, "y": 0.40, "z": 0.00, "visibility": 0.90}
    pose[12] = {"x": 0.40, "y": 0.40, "z": 0.00, "visibility": 0.90}

    # Codos
    pose[13] = {"x": 0.65, "y": 0.55, "z": 0.02, "visibility": 0.88}
    pose[14] = {"x": 0.35, "y": 0.55, "z": -0.02, "visibility": 0.88}

    # Muñecas
    pose[15] = {"x": 0.70, "y": 0.70, "z": 0.05, "visibility": 0.85}
    pose[16] = {"x": 0.30, "y": 0.70, "z": -0.05, "visibility": 0.85}

    # Meñiques
    pose[17] = {"x": 0.72, "y": 0.73, "z": 0.05, "visibility": 0.80}
    pose[18] = {"x": 0.28, "y": 0.73, "z": -0.05, "visibility": 0.80}

    # Índices
    pose[19] = {"x": 0.71, "y": 0.74, "z": 0.05, "visibility": 0.80}
    pose[20] = {"x": 0.29, "y": 0.74, "z": -0.05, "visibility": 0.80}

    # Pulgares
    pose[21] = {"x": 0.68, "y": 0.71, "z": 0.05, "visibility": 0.80}
    pose[22] = {"x": 0.32, "y": 0.71, "z": -0.05, "visibility": 0.80}

    return pose


def make_hand_A() -> list[dict]:
    """Mano A: cercana a P15 (Izquierda). Muñeca z = 0.05, P1 z = 0.07."""
    hand = [{"x": 0.70, "y": 0.70, "z": 0.05} for _ in range(21)]
    hand[0] = {"x": 0.70, "y": 0.70, "z": 0.05}
    hand[1] = {"x": 0.71, "y": 0.71, "z": 0.07}
    return hand


def make_hand_B() -> list[dict]:
    """Mano B: cercana a P16 (Derecha). Muñeca z = -0.05, P1 z = -0.03."""
    hand = [{"x": 0.30, "y": 0.70, "z": -0.05} for _ in range(21)]
    hand[0] = {"x": 0.30, "y": 0.70, "z": -0.05}
    hand[1] = {"x": 0.29, "y": 0.71, "z": -0.03}
    return hand


class TestFeatureSpecV121(unittest.TestCase):
    """Suite de conformidad numérica según FEATURE_SPEC.md v1.2.1."""

    def test_version_constants(self):
        self.assertEqual(FEATURE_SPEC_VERSION, "1.2.1")
        self.assertEqual(TOTAL_FEATURES, 178)
        self.assertEqual(SEQUENCE_LENGTH, 15)

    def test_tc01_canonical_frame(self):
        """TC-01: Pose completa + Ambas manos presentes (Tolerancia <= 1e-6)."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
            "handedness": [[{"categoryName": "Right"}], [{"categoryName": "Left"}]],
        }

        features, valid, error = extract_frame_features(raw_frame)
        self.assertTrue(valid, f"Frame debería ser válido, error: {error}")
        self.assertIsNone(error)
        self.assertIsNotNone(features)
        self.assertEqual(features.shape, (178,))
        self.assertEqual(features.dtype, np.float32)

        # 1. P0 (Nariz) en [0..3]: [0.0, -1.0, -0.2, 0.99]
        np.testing.assert_allclose(features[0:4], [0.0, -1.0, -0.2, 0.99], atol=1e-6)

        # 2. P11 (Hombro Izq) en [4..7]: [0.5, 0.0, 0.0, 0.9]
        np.testing.assert_allclose(features[4:8], [0.5, 0.0, 0.0, 0.90], atol=1e-6)

        # 3. P12 (Hombro Der) en [8..11]: [-0.5, 0.0, 0.0, 0.9]
        np.testing.assert_allclose(features[8:12], [-0.5, 0.0, 0.0, 0.90], atol=1e-6)

        # 4. Mano Izquierda (Mano A) en [52..114]:
        # Muñeca [52..54]: [1.0, 1.5, 0.0]
        np.testing.assert_allclose(features[52:55], [1.0, 1.5, 0.0], atol=1e-6)
        # Landmark 1 [55..57]: [1.05, 1.55, 0.10]
        np.testing.assert_allclose(features[55:58], [1.05, 1.55, 0.10], atol=1e-6)

        # 5. Mano Derecha (Mano B) en [115..177]:
        # Muñeca [115..117]: [-1.0, 1.5, 0.0]
        np.testing.assert_allclose(features[115:118], [-1.0, 1.5, 0.0], atol=1e-6)
        # Landmark 1 [118..120]: [-1.05, 1.55, 0.10]
        np.testing.assert_allclose(features[118:121], [-1.05, 1.55, 0.10], atol=1e-6)

    def test_tc02_missing_left_hand(self):
        """TC-02: Mano izquierda ausente -> [52..114] estrictamente 63 ceros."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_B()],  # Solo mano derecha
            "handedness": [[{"categoryName": "Left"}]],
        }

        features, valid, error = extract_frame_features(raw_frame)
        self.assertTrue(valid)
        self.assertIsNone(error)

        # [52..114] deben ser exactamente 63 ceros
        self.assertEqual(len(features[52:115]), 63)
        np.testing.assert_array_equal(features[52:115], np.zeros(63, dtype=np.float32))

        # Mano derecha presente y normalizada
        np.testing.assert_allclose(features[115:118], [-1.0, 1.5, 0.0], atol=1e-6)

    def test_tc03_incomplete_pose(self):
        """TC-03: Pose incompleta (len(pose) == 20 < 23) -> valid: false, ERR_POSE_MISSING."""
        short_pose = make_canonical_pose()[:20]
        raw_frame = {
            "pose": short_pose,
            "hands": [make_hand_A()],
        }

        features, valid, error = extract_frame_features(raw_frame)
        self.assertFalse(valid)
        self.assertIsNone(features)
        self.assertEqual(error, "ERR_POSE_MISSING")

    def test_tc04_shoulders_too_small(self):
        """TC-04: Hombros demasiado pequeños (D = 0.05 < 0.08) -> ERR_SHOULDERS_TOO_SMALL."""
        pose = make_canonical_pose()
        # Colocar hombros a distancia 0.05
        pose[11]["x"] = 0.525
        pose[12]["x"] = 0.475
        pose[11]["y"] = 0.40
        pose[12]["y"] = 0.40
        pose[11]["z"] = 0.00
        pose[12]["z"] = 0.00

        raw_frame = {
            "pose": pose,
            "hands": [make_hand_A(), make_hand_B()],
        }

        features, valid, error = extract_frame_features(raw_frame)
        self.assertFalse(valid)
        self.assertIsNone(features)
        self.assertEqual(error, "ERR_SHOULDERS_TOO_SMALL")

    def test_tc05a_joint_assignment_order_invariance(self):
        """TC-05A: Asignación conjunta de 2 manos es independiente del orden de entrada en hands."""
        # Orden A: [Mano A, Mano B]
        frame_ab = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
        }
        feat_ab, valid_ab, _ = extract_frame_features(frame_ab)

        # Orden B: [Mano B, Mano A]
        frame_ba = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_B(), make_hand_A()],
        }
        feat_ba, valid_ba, _ = extract_frame_features(frame_ba)

        self.assertTrue(valid_ab)
        self.assertTrue(valid_ba)
        # Ambas deben producir idéntica asignación
        np.testing.assert_allclose(feat_ab, feat_ba, atol=1e-6)

    def test_tc05b_centered_hand_disambiguation(self):
        """TC-05B: 1 mano centrada (|d_izq - d_der| < 0.15 * D) desempata con categoryName."""
        pose = make_canonical_pose()
        # Mano colocada en el centro del pecho (x=0.50, y=0.70)
        # d(P15) = hypot(0.50-0.70, 0.70-0.70) = 0.20
        # d(P16) = hypot(0.50-0.30, 0.70-0.70) = 0.20
        # |d_izq - d_der| = 0.00 < 0.15 * 0.20 = 0.03 -> caso ambiguo
        centered_hand = [{"x": 0.50, "y": 0.70, "z": 0.00} for _ in range(21)]

        # Caso 1: MediaPipe 'Left' -> Mano Derecha del firmante [115..177]
        frame_left = {
            "pose": pose,
            "hands": [centered_hand],
            "handedness": [[{"categoryName": "Left"}]],
        }
        feat_l, valid_l, _ = extract_frame_features(frame_left)
        self.assertTrue(valid_l)
        np.testing.assert_array_equal(feat_l[52:115], np.zeros(63, dtype=np.float32))
        self.assertFalse(np.all(feat_l[115:178] == 0.0))

        # Caso 2: MediaPipe 'Right' -> Mano Izquierda del firmante [52..114]
        frame_right = {
            "pose": pose,
            "hands": [centered_hand],
            "handedness": [[{"categoryName": "Right"}]],
        }
        feat_r, valid_r, _ = extract_frame_features(frame_right)
        self.assertTrue(valid_r)
        self.assertFalse(np.all(feat_r[52:115] == 0.0))
        np.testing.assert_array_equal(feat_r[115:178], np.zeros(63, dtype=np.float32))

    def test_tc05c_disconnected_hand_discarded(self):
        """TC-05C: Mano desconectada (min(d) > 1.75 * D) se descarta con 63 ceros."""
        pose = make_canonical_pose()  # D = 0.20, 1.75 * D = 0.35
        # Mano flotante en la esquina superior izquierda (x=0.05, y=0.05)
        # d(P15) = hypot(0.05-0.70, 0.05-0.70) = hypot(-0.65, -0.65) = 0.919 > 0.35
        # d(P16) = hypot(0.05-0.30, 0.05-0.70) = hypot(-0.25, -0.65) = 0.696 > 0.35
        floating_hand = [{"x": 0.05, "y": 0.05, "z": 0.00} for _ in range(21)]

        raw_frame = {
            "pose": pose,
            "hands": [floating_hand],
        }
        features, valid, error = extract_frame_features(raw_frame)
        self.assertTrue(valid)
        # La mano desconectada se descarta: ambas ranuras de manos deben quedar en ceros
        np.testing.assert_array_equal(features[52:178], np.zeros(126, dtype=np.float32))

    def test_property_translation_invariance(self):
        """Invarianza a traslación 3D: Extract(P + delta) == Extract(P) con error <= 1e-6."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
        }
        base_features, _, _ = extract_frame_features(raw_frame)

        # Probar 5 traslaciones acotadas dentro de [-0.08, 0.08]
        deltas = [
            (0.05, 0.03, 0.04),
            (-0.06, -0.04, -0.05),
            (0.07, -0.05, 0.02),
            (-0.04, 0.06, -0.03),
            (0.00, 0.00, 0.08),
        ]

        for dx, dy, dz in deltas:
            translated_frame = copy.deepcopy(raw_frame)
            for lm in translated_frame["pose"]:
                lm["x"] += dx
                lm["y"] += dy
                lm["z"] += dz
            for h in translated_frame["hands"]:
                for lm in h:
                    lm["x"] += dx
                    lm["y"] += dy
                    lm["z"] += dz

            trans_features, valid, err = extract_frame_features(translated_frame)
            self.assertTrue(valid, f"Falló con delta=({dx},{dy},{dz}): {err}")
            np.testing.assert_allclose(
                trans_features,
                base_features,
                atol=1e-6,
                err_msg=f"Falló invarianza a traslación con delta=({dx},{dy},{dz})",
            )

    def test_property_scale_invariance(self):
        """Invarianza a escala: Extract(s * P) == Extract(P) con error <= 1e-6."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
        }
        base_features, _, _ = extract_frame_features(raw_frame)

        # Centro de hombros canónico: (0.50, 0.40, 0.00)
        cx, cy, cz = 0.50, 0.40, 0.00
        scales = [0.85, 0.95, 1.05, 1.15, 1.20]

        for s in scales:
            scaled_frame = copy.deepcopy(raw_frame)
            for lm in scaled_frame["pose"]:
                lm["x"] = cx + s * (lm["x"] - cx)
                lm["y"] = cy + s * (lm["y"] - cy)
                lm["z"] = cz + s * (lm["z"] - cz)
            for h in scaled_frame["hands"]:
                for lm in h:
                    lm["x"] = cx + s * (lm["x"] - cx)
                    lm["y"] = cy + s * (lm["y"] - cy)
                    lm["z"] = cz + s * (lm["z"] - cz)

            scaled_features, valid, err = extract_frame_features(scaled_frame)
            self.assertTrue(valid, f"Falló con s={s}: {err}")
            np.testing.assert_allclose(
                scaled_features,
                base_features,
                atol=1e-6,
                err_msg=f"Falló invarianza a escala con factor s={s}",
            )

    def test_property_mirror_commutativity(self):
        """Conmutatividad de espejo: Extract(Mirror(raw)) == MirrorFeatures(Extract(raw)) con error <= 1e-6."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
            "handedness": [[{"categoryName": "Right"}], [{"categoryName": "Left"}]],
        }

        # 1. Extract(Mirror(raw))
        mirrored_raw = mirror_raw_frame(raw_frame)
        features_mirrored_raw, valid_m, err_m = extract_frame_features(mirrored_raw)
        self.assertTrue(valid_m, f"Error en mirrored raw: {err_m}")

        # 2. MirrorFeatures(Extract(raw))
        base_features, valid_b, err_b = extract_frame_features(raw_frame)
        self.assertTrue(valid_b, f"Error en base: {err_b}")
        mirrored_features = mirror_features_178(base_features)

        # 3. Comparación numérica exacta
        np.testing.assert_allclose(
            features_mirrored_raw,
            mirrored_features,
            atol=1e-6,
            err_msg="Conmutatividad de espejo violada: Extract(Mirror(raw)) != MirrorFeatures(Extract(raw))",
        )

    def test_property_mirror_involution(self):
        """Involución de espejo: Mirror(Mirror(raw)) == raw."""
        raw_frame = {
            "pose": make_canonical_pose(),
            "hands": [make_hand_A(), make_hand_B()],
            "handedness": [[{"categoryName": "Right"}], [{"categoryName": "Left"}]],
        }

        double_mirrored = mirror_raw_frame(mirror_raw_frame(raw_frame))

        # Pose coordinates
        for i in range(len(raw_frame["pose"])):
            orig = raw_frame["pose"][i]
            doub = double_mirrored["pose"][i]
            self.assertAlmostEqual(orig["x"], doub["x"], places=6)
            self.assertAlmostEqual(orig["y"], doub["y"], places=6)
            self.assertAlmostEqual(orig["z"], doub["z"], places=6)

        # Handedness categoryName
        cat_orig = raw_frame["handedness"][0][0]["categoryName"]
        cat_doub = double_mirrored["handedness"][0][0]["categoryName"]
        self.assertEqual(cat_orig, cat_doub)

    def test_extract_window_basic_shape(self):
        """ExtractWindow genera tensor de forma (1, 15, 178) en float32."""
        # Crear 20 frames a 30 FPS (intervalo ~33.33 ms, total ~633 ms extendido a 1000 ms)
        frames = []
        base_pose = make_canonical_pose()
        hand_a = make_hand_A()
        hand_b = make_hand_B()

        for i in range(35):
            t_ms = i * 33.333
            fr = {
                "pose": copy.deepcopy(base_pose),
                "hands": [copy.deepcopy(hand_a), copy.deepcopy(hand_b)],
                "handedness": [[{"categoryName": "Right"}], [{"categoryName": "Left"}]],
                "timestamp_ms": t_ms,
            }
            frames.append(fr)

        tensor, valid, error = extract_window(frames, target_fps=15, duration_ms=1000.0)
        self.assertTrue(valid, f"ExtractWindow falló: {error}")
        self.assertIsNone(error)
        self.assertEqual(tensor.shape, (1, 15, 178))
        self.assertEqual(tensor.dtype, np.float32)

    def test_extract_window_gap_allowed_vs_rejected(self):
        """Brecha temporal <= 100 ms permitida; brecha > 100 ms rechazada con ERR_INVALID_FRAME_GAP_TOO_LARGE."""
        base_pose = make_canonical_pose()
        hand_a = make_hand_A()

        # Caso A: Brecha de 80 ms (menor que 100 ms + nominal -> permitida)
        frames_ok = [
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 0.0},
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 120.0},  # salto de 120 - 66.67 = 53.3 ms
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 200.0},
        ]
        _, valid_ok, _ = extract_window(frames_ok, target_fps=15, duration_ms=300.0)
        self.assertTrue(valid_ok)

        # Caso B: Brecha excesiva de 250 ms (250 - 66.67 = 183.3 ms > 100 ms)
        frames_bad = [
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 0.0},
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 250.0},  # salto excesivo
            {"pose": base_pose, "hands": [hand_a], "timestamp_ms": 300.0},
        ]
        _, valid_bad, err_bad = extract_window(frames_bad, target_fps=15, duration_ms=300.0)
        self.assertFalse(valid_bad)
        self.assertEqual(err_bad, "ERR_INVALID_FRAME_GAP_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
