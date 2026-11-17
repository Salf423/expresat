"""
Unit tests for the deterministic demo rule engine (`demo_rules.py`).
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
    """Build a synthetic 21-landmark hand matching MediaPipe proportions."""
    wrist = {"x": wrist_x, "y": wrist_y, "z": 0.0}
    landmarks = [wrist]

    dx_offset = wrist_x - 0.5

    if thumb_ext:
        if thumb_up:
            landmarks.append({"x": 0.47 + dx_offset, "y": wrist_y - 0.04, "z": 0.0})
            landmarks.append({"x": 0.44 + dx_offset, "y": wrist_y - 0.08, "z": 0.0})
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.14, "z": 0.0})
            landmarks.append({"x": 0.40 + dx_offset, "y": wrist_y - 0.22, "z": 0.0})
        else:
            landmarks.append({"x": 0.46 + dx_offset, "y": wrist_y - 0.03, "z": 0.0})
            landmarks.append({"x": 0.42 + dx_offset, "y": wrist_y - 0.06, "z": 0.0})
            landmarks.append({"x": 0.36 + dx_offset, "y": wrist_y - 0.07, "z": 0.0})
            landmarks.append({"x": 0.30 + dx_offset, "y": wrist_y - 0.08, "z": 0.0})
    else:
        landmarks.append({"x": 0.48 + dx_offset, "y": wrist_y - 0.04, "z": 0.0})
        landmarks.append({"x": 0.47 + dx_offset, "y": wrist_y - 0.07, "z": 0.0})
        landmarks.append({"x": 0.48 + dx_offset, "y": wrist_y - 0.09, "z": 0.0})
        landmarks.append({"x": 0.49 + dx_offset, "y": wrist_y - 0.09, "z": 0.0})

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

    idx_tip_x = 0.44 if index_middle_apart else 0.47
    add_finger(mcp_x=0.47, tip_x=idx_tip_x, ext=index_ext)

    mid_tip_x = 0.53 if index_middle_apart else 0.50
    add_finger(mcp_x=0.50, tip_x=mid_tip_x, ext=middle_ext)

    add_finger(mcp_x=0.53, tip_x=0.53, ext=ring_ext)
    add_finger(mcp_x=0.56, tip_x=0.56, ext=pinky_ext)

    return landmarks


def create_pose(nose_y=0.25, shoulder_y=0.45):
    """Build a synthetic 33-landmark MediaPipe Pose."""
    pose = [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.9} for _ in range(33)]
    pose[0] = {"x": 0.5, "y": nose_y, "z": 0.0, "visibility": 0.9}
    pose[11] = {"x": 0.35, "y": shoulder_y, "z": 0.0, "visibility": 0.9}
    pose[12] = {"x": 0.65, "y": shoulder_y, "z": 0.0, "visibility": 0.9}
    return pose


class TestDemoRules(unittest.TestCase):

    def setUp(self):
        get_wave_tracker().reset()

    def test_bien_thumbs_up(self):
        """Recognize 'Bien' (thumbs up)."""
        hand = create_hand_skeleton(thumb_ext=True, thumb_up=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Bien")
        self.assertTrue(res["is_demo"])
        self.assertGreaterEqual(res["confidence"], 0.85)

    def test_lunes_letter_l(self):
        """Recognize 'Lunes' (L shape)."""
        hand = create_hand_skeleton(thumb_ext=True, index_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Lunes")
        self.assertTrue(res["is_demo"])

    def test_te_quiero_ily(self):
        """Recognize 'Te Quiero' (ILY handshape)."""
        hand = create_hand_skeleton(thumb_ext=True, index_ext=True, pinky_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Te Quiero")
        self.assertTrue(res["is_demo"])

    def test_amor_y_paz(self):
        """Recognize 'Amor y Paz' (V shape)."""
        hand = create_hand_skeleton(index_ext=True, middle_ext=True, index_middle_apart=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Amor y Paz")
        self.assertTrue(res["is_demo"])

    def test_no_pointing_finger(self):
        """Recognize 'No' (raised index finger)."""
        hand = create_hand_skeleton(index_ext=True, wrist_y=0.4)
        frame = {"rightHand": hand, "pose": create_pose()}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "No")
        self.assertTrue(res["is_demo"])

    def test_si_fist(self):
        """Recognize 'Si' (closed fist)."""
        hand = create_hand_skeleton(wrist_y=0.45)
        frame = {"rightHand": hand, "pose": create_pose(shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Si")
        self.assertTrue(res["is_demo"])

    def test_hola_with_waving_motion(self):
        """Recognize 'Hola' after MIN_FRAMES consecutive batches of lateral waving."""
        get_wave_tracker().reset()
        get_hola_confirmation().reset()

        palm_scale = 0.12
        frames = []
        # Simulate 15 frames with two full lateral oscillation cycles
        for i in range(15):
            t = i / 14.0
            wx = 0.60 + (0.35 * palm_scale) * math.sin(2 * math.pi * 1.8 * t)
            hand = create_hand_skeleton(
                thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
                wrist_y=0.30, wrist_x=wx
            )
            frames.append({"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.50)})

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
        """Static open hand must never trigger 'Hola' (falls back to 'Reposo' or None)."""
        get_wave_tracker().reset()
        get_hola_confirmation().reset()

        # Off-center static open hand (wrist_x=0.60 bypasses 'Gracias' central rule)
        hand = create_hand_skeleton(
            thumb_ext=True, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.30, wrist_x=0.60
        )
        frames = [{"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.50)} for _ in range(15)]
        res = predict_demo(frames)

        self.assertNotEqual(res["label"], "Hola")
        self.assertFalse(res["debug"]["is_waving"])
        if res["label"] is None:
            self.assertIn("estática", res["debug"]["rule_reason"])

    def test_gracias_chin_level(self):
        """Recognize 'Gracias' (flat hand at chin/chest height without waving)."""
        hand = create_hand_skeleton(
            thumb_ext=False, index_ext=True, middle_ext=True, ring_ext=True, pinky_ext=True,
            wrist_y=0.35
        )
        frame = {"rightHand": hand, "pose": create_pose(nose_y=0.25, shoulder_y=0.45)}
        res = predict_demo(frame)
        self.assertEqual(res["label"], "Gracias")
        self.assertTrue(res["is_demo"])

    def test_empty_frame(self):
        """Empty frame returns label=None."""
        res = predict_demo({})
        self.assertIsNone(res["label"])
        self.assertEqual(res["confidence"], 0.0)
        self.assertTrue(res["is_demo"])

    def test_probabilities_sum_to_one(self):
        """Class probabilities must sum to 1.0."""
        hand = create_hand_skeleton(thumb_ext=True, thumb_up=True, wrist_y=0.4)
        res = predict_demo({"rightHand": hand, "pose": create_pose()})
        probs = res["all_probabilities"]
        total = sum(probs.values())
        self.assertAlmostEqual(total, 1.0, places=4)

    def test_none_input_resilience(self):
        """predict_demo handles None without raising."""
        res = predict_demo(None)
        self.assertIsNone(res["label"])
        self.assertEqual(res["confidence"], 0.0)
        self.assertTrue(res["is_demo"])

    def test_debug_telemetry_fields(self):
        """Response includes expected debug telemetry keys."""
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
