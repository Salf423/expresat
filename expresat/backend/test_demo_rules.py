"""
test_demo_rules.py — Pruebas unitarias del motor de reglas deterministas (demo_rules.py)
========================================================================================
# [DEMO] Pruebas sintéticas para validar la correcta clasificación de señas
# y la compatibilidad de formato con el pipeline de inferencia.
"""

import unittest
from demo_rules import (
    predict_demo,
    analyze_hand_fingers,
    classify_frame_by_rules,
    DEMO_LABELS
)


def create_hand_skeleton(
    thumb_ext=False,
    index_ext=False,
    middle_ext=False,
    ring_ext=False,
    pinky_ext=False,
    wrist_y=0.4,
    wrist_x=0.5,
    thumb_up=False,
    index_middle_apart=False
):
    """
    Genera un esqueleto sintético de mano de 21 landmarks respetando
    las proporciones anatómicas requeridas por MediaPipe.
    """
    wrist = {"x": wrist_x, "y": wrist_y, "z": 0.0}
    landmarks = [wrist]  # 0: WRIST

    dx_offset = wrist_x - 0.5

    # 1-4: Pulgar
    # CMC, MCP, IP, TIP
    if thumb_ext:
        if thumb_up:
            # Pulgar apuntando hacia arriba (Bien / Thumbs up)
            landmarks.append({"x": 0.47 + dx_offset, "y": wrist_y - 0.04, "z": 0.0}) # 1
            landmarks.append({"x": 0.44 + dx_offset, "y": wrist_y - 0.08, "z": 0.0}) # 2
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.14, "z": 0.0}) # 3
            landmarks.append({"x": 0.40 + dx_offset, "y": wrist_y - 0.22, "z": 0.0}) # 4
        else:
            # Pulgar extendido lateralmente (hacia la izquierda en x)
            landmarks.append({"x": 0.46 + dx_offset, "y": wrist_y - 0.03, "z": 0.0}) # 1
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.06, "z": 0.0}) # 2
            landmarks.append({"x": 0.36 + dx_offset, "y": wrist_y - 0.07, "z": 0.0}) # 3
            landmarks.append({"x": 0.30 + dx_offset, "y": wrist_y - 0.08, "z": 0.0}) # 4
    else:
        # Pulgar doblado sobre la palma hacia el centro
        landmarks.append({"x": 0.48 + dx_offset, "y": wrist_y - 0.04, "z": 0.0}) # 1
        landmarks.append({"x": 0.47 + dx_offset, "y": wrist_y - 0.07, "z": 0.0}) # 2
        landmarks.append({"x": 0.48 + dx_offset, "y": wrist_y - 0.09, "z": 0.0}) # 3
        landmarks.append({"x": 0.49 + dx_offset, "y": wrist_y - 0.09, "z": 0.0}) # 4

    # Helper para generar los 4 dedos
    def add_finger(mcp_x, tip_x, ext):
        mcp_y = wrist_y - 0.12
        pip_y = wrist_y - 0.18
        dip_y = wrist_y - 0.22
        tip_y = wrist_y - 0.27

        if ext:
            landmarks.append({"x": mcp_x + dx_offset, "y": mcp_y, "z": 0.0})
            landmarks.append({"x": mcp_x + dx_offset, "y": pip_y, "z": 0.0})
            landmarks.append({"x": tip_x + dx_offset, "y": dip_y, "z": 0.0})
            landmarks.append({"x": tip_x + dx_offset, "y": tip_y, "z": 0.0})
        else:
            # Doblado en puño (el tip se enrolla hacia la palma / MCP)
            landmarks.append({"x": mcp_x + dx_offset, "y": mcp_y, "z": 0.0})
            landmarks.append({"x": mcp_x + dx_offset, "y": mcp_y - 0.04, "z": 0.05})
            landmarks.append({"x": mcp_x + dx_offset, "y": mcp_y - 0.02, "z": 0.08})
            landmarks.append({"x": mcp_x + dx_offset, "y": mcp_y, "z": 0.07})

    # 5-8: Índice
    idx_tip_x = 0.44 if index_middle_apart else 0.47
    add_finger(mcp_x=0.47, tip_x=idx_tip_x, ext=index_ext)

    # 9-12: Medio
    mid_tip_x = 0.53 if index_middle_apart else 0.50
    add_finger(mcp_x=0.50, tip_x=mid_tip_x, ext=middle_ext)

    # 13-16: Anular
    add_finger(mcp_x=0.53, tip_x=0.53, ext=ring_ext)

    # 17-20: Meñique
    add_finger(mcp_x=0.56, tip_x=0.56, ext=pinky_ext)

    return landmarks


def create_pose(nose_y=0.25, shoulder_y=0.45):
    """Crea una pose sintética para MediaPipe (33 puntos)."""
    pose = [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.9} for _ in range(33)]
    pose[0] = {"x": 0.5, "y": nose_y, "z": 0.0, "visibility": 0.9}
    pose[11] = {"x": 0.35, "y": shoulder_y, "z": 0.0, "visibility": 0.9} # hombro izq
    pose[12] = {"x": 0.65, "y": shoulder_y, "z": 0.0, "visibility": 0.9} # hombro der
    return pose


class TestDemoRules(unittest.TestCase):

    def test_bien_thumbs_up(self):
        """[DEMO] Reconocimiento de 'Bien' (pulgar arriba)."""
        hand = create_hand_skeleton(thumb_ext=True, thumb_up=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Bien")
        self.assertTrue(res["is_demo"])
        self.assertGreaterEqual(res["confidence"], 0.85)

    def test_lunes_letter_l(self):
        """[DEMO] Reconocimiento de 'Lunes' (letra L)."""
        hand = create_hand_skeleton(thumb_ext=True, index_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Lunes")
        self.assertTrue(res["is_demo"])

    def test_te_quiero_ily(self):
        """[DEMO] Reconocimiento de 'Te Quiero' (ILY: pulgar, índice, meñique)."""
        hand = create_hand_skeleton(thumb_ext=True, index_ext=True, pinky_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Te Quiero")
        self.assertTrue(res["is_demo"])

    def test_amor_y_paz(self):
        """[DEMO] Reconocimiento de 'Amor y Paz' (letra V)."""
        hand = create_hand_skeleton(index_ext=True, middle_ext=True, index_middle_apart=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Amor y Paz")
        self.assertTrue(res["is_demo"])

    def test_no_pointing_finger(self):
        """[DEMO] Reconocimiento de 'No' (dedo índice levantado)."""
        hand = create_hand_skeleton(index_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "No")
        self.assertTrue(res["is_demo"])

    def test_si_fist(self):
        """[DEMO] Reconocimiento de 'Si' (puño / afirmación)."""
        hand = create_hand_skeleton(wrist_y=0.45)
        frame = {"rightHand": hand, "pose": create_pose(shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Si")
        self.assertTrue(res["is_demo"])

    def test_hola_raised_hand(self):
        """[DEMO] Reconocimiento de 'Hola' (mano abierta levantada sobre hombros lateralmente)."""
        hand = create_hand_skeleton(
            thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.25, wrist_x=0.70 # mano alzada al costado (saludo)
        )
        frame = {"rightHand": hand, "pose": create_pose(nose_y=0.20, shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Hola")
        self.assertTrue(res["is_demo"])

    def test_gracias_chin_level(self):
        """[DEMO] Reconocimiento de 'Gracias' (mano abierta plana a nivel de barbilla/pecho)."""
        hand = create_hand_skeleton(
            thumb_ext=False, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.35 # entre nariz (0.25) y hombros (0.45)
        )
        frame = {"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Gracias")
        self.assertTrue(res["is_demo"])

    def test_empty_frame(self):
        """[DEMO] Frame vacío retorna label=None."""
        res = predict_demo({})
        self.assertIsNone(res["label"])
        self.assertEqual(res["confidence"], 0.0)
        self.assertTrue(res["is_demo"])

    def test_batch_mode_sequence(self):
        """[DEMO] Secuencia de 15 frames en lote."""
        hand = create_hand_skeleton(index_ext=True, wrist_y=0.4)
        frames = [{"rightHand": hand, "pose": create_pose()} for _ in range(15)]
        res = predict_demo(frames)
        self.assertEqual(res["label"], "No")
        self.assertIn("latency_ms", res)
        self.assertIn("all_probabilities", res)

    def test_probabilities_sum_to_one(self):
        """[DEMO] La suma de probabilidades debe ser exactamente 1.0."""
        hand = create_hand_skeleton(thumb_ext=True, thumb_up=True, wrist_y=0.4)
        res = predict_demo({"rightHand": hand, "pose": create_pose()})
        probs = res["all_probabilities"]
        total = sum(probs.values())
        self.assertAlmostEqual(total, 1.0, places=4)

    def test_hola_forehead_level_not_gracias(self):
        """[DEMO] Mano abierta a la altura de la frente/ojos debe ser Hola, no Gracias."""
        # Nariz en 0.25, mano en 0.20 (arriba de la nariz / frente)
        hand = create_hand_skeleton(
            thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.20, wrist_x=0.50
        )
        frame = {"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Hola")

    def test_none_input_resilience(self):
        """[DEMO] predict_demo debe manejar None sin lanzar excepciones."""
        res = predict_demo(None)
        self.assertIsNone(res["label"])
        self.assertEqual(res["confidence"], 0.0)
        self.assertTrue(res["is_demo"])


if __name__ == "__main__":
    unittest.main()
