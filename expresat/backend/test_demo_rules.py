"""
test_demo_rules.py — Pruebas unitarias del motor de reglas deterministas (demo_rules.py)
========================================================================================
# [DEMO] Pruebas sintéticas para validar la correcta clasificación de señas,
# detección dinámica de saludo ("Hola" con vaivén vs mano quieta),
# telemetría de depuración y compatibilidad de formato.
"""

import math
import unittest
from demo_rules import (
    predict_demo,
    analyze_hand_fingers,
    classify_frame_by_rules,
    get_wave_tracker,
    get_hola_confirmation,
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
    if thumb_ext:
        if thumb_up:
            landmarks.append({"x": 0.47 + dx_offset, "y": wrist_y - 0.04, "z": 0.0}) # 1
            landmarks.append({"x": 0.44 + dx_offset, "y": wrist_y - 0.08, "z": 0.0}) # 2
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.14, "z": 0.0}) # 3
            landmarks.append({"x": 0.40 + dx_offset, "y": wrist_y - 0.22, "z": 0.0}) # 4
        else:
            landmarks.append({"x": 0.46 + dx_offset, "y": wrist_y - 0.03, "z": 0.0}) # 1
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.06, "z": 0.0}) # 2
            landmarks.append({"x": 0.36 + dx_offset, "y": wrist_y - 0.07, "z": 0.0}) # 3
            landmarks.append({"x": 0.30 + dx_offset, "y": wrist_y - 0.08, "z": 0.0}) # 4
    else:
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

    def setUp(self):
        # Resetear el rastreador de vaivén antes de cada prueba
        get_wave_tracker().reset()

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

    def test_hola_with_waving_motion(self):
        """[DEMO] 'Hola' se detecta cuando la mano abierta realiza movimiento de saludo (vaivén lateral).
        La confirmación requiere MIN_FRAMES=4 lotes consecutivos antes de confirmar la seña.
        """
        # Reset singletons para aislar este test
        get_wave_tracker().reset()
        get_hola_confirmation().reset()

        palm_scale = 0.12
        frames = []
        # Simular 15 frames de un saludo con 2 ciclos completos de oscilación en X
        for i in range(15):
            t = i / 14.0
            wx = 0.60 + (0.35 * palm_scale) * math.sin(2 * math.pi * 1.8 * t)
            hand = create_hand_skeleton(
                thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
                wrist_y=0.30, wrist_x=wx
            )
            frames.append({"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.50)})

        # Llamar MIN_FRAMES veces para superar la confirmación por debounce
        min_frames = get_hola_confirmation().MIN_FRAMES
        res = None
        for _ in range(min_frames):
            res = predict_demo(frames)

        self.assertEqual(res["label"], "Hola")
        self.assertTrue(res["is_demo"])
        self.assertGreaterEqual(res["confidence"], 0.90)
        self.assertTrue(res["debug"]["is_waving"])
        self.assertGreaterEqual(res["debug"]["direction_changes"], 2)

    def test_open_hand_still_does_not_trigger_hola(self):
        """[DEMO] Mano abierta pero QUIETA no debe clasificarse como 'Hola' (evita falsos positivos).
        La regla 8 retorna None (mano abierta estática) o 'Reposo' si no cumple ninguna regla previa.
        La seña 'Hola' nunca debe aparecer.
        """
        # Reset singletons para aislar este test
        get_wave_tracker().reset()
        get_hola_confirmation().reset()

        # Mano abierta estacionaria lateral (wrist_x=0.60 → no es central → no Gracias → Reposo)
        hand = create_hand_skeleton(
            thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.30, wrist_x=0.60
        )
        # 15 frames sin movimiento
        frames = [{"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.50)} for _ in range(15)]
        res = predict_demo(frames)

        # Lo fundamental: nunca debe clasificarse como "Hola"
        self.assertNotEqual(res["label"], "Hola")
        # La mano abierta quieta cae en "Reposo" (no pasa la regla 7 por ser lateral)
        # o en None si es central, pero NUNCA en "Hola"
        self.assertFalse(res["debug"]["is_waving"])
        # Si sí llega a la Regla 8 y es estática, la razón incluye "estática"
        # Si cae en Reposo (sin pasar Regla 8), el label tampoco es "Hola"
        if res["label"] is None:
            self.assertIn("estática", res["debug"]["rule_reason"])

    def test_gracias_chin_level(self):
        """[DEMO] Reconocimiento de 'Gracias' (mano plana a nivel de barbilla/pecho sin vaivén)."""
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

    def test_probabilities_sum_to_one(self):
        """[DEMO] La suma de probabilidades debe ser exactamente 1.0."""
        hand = create_hand_skeleton(thumb_ext=True, thumb_up=True, wrist_y=0.4)
        res = predict_demo({"rightHand": hand, "pose": create_pose()})
        probs = res["all_probabilities"]
        total = sum(probs.values())
        self.assertAlmostEqual(total, 1.0, places=4)

    def test_none_input_resilience(self):
        """[DEMO] predict_demo debe manejar None sin lanzar excepciones."""
        res = predict_demo(None)
        self.assertIsNone(res["label"])
        self.assertEqual(res["confidence"], 0.0)
        self.assertTrue(res["is_demo"])

    def test_debug_telemetry_fields(self):
        """[DEMO] La respuesta debe incluir el diccionario de telemetría para depuración."""
        hand = create_hand_skeleton(index_ext=True, wrist_y=0.4)
        res = predict_demo({"rightHand": hand, "pose": create_pose()})
        self.assertIn("debug", res)
        debug = res["debug"]
        self.assertIn("hand_detected", debug)
        self.assertIn("fingers", debug)
        self.assertIn("palm_facing_camera", debug)
        self.assertIn("is_waving", debug)
        self.assertIn("rule_reason", debug)


if __name__ == "__main__":
    unittest.main()
