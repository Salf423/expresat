"""
Canonical test fixture generator (FEATURE_SPEC v1.4.0).

Generates tests/fixtures/feature_spec_cases.json for element-by-element
cross-runtime comparison (Python and JavaScript) under L_inf <= 1e-6.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "expresat"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    extract_frame_features,
    extract_window,
    mirror_raw_frame,
    mirror_features_178,
)


def make_canonical_pose() -> list[dict]:
    pose = [{"x": 0.50, "y": 0.50, "z": 0.00, "visibility": 0.90} for _ in range(33)]
    pose[0]  = {"x": 0.50, "y": 0.20, "z": -0.04, "visibility": 0.99}
    pose[11] = {"x": 0.60, "y": 0.40, "z": 0.00, "visibility": 0.90}
    pose[12] = {"x": 0.40, "y": 0.40, "z": 0.00, "visibility": 0.90}
    pose[13] = {"x": 0.65, "y": 0.55, "z": 0.02, "visibility": 0.88}
    pose[14] = {"x": 0.35, "y": 0.55, "z": -0.02, "visibility": 0.88}
    pose[15] = {"x": 0.70, "y": 0.70, "z": 0.05, "visibility": 0.85}
    pose[16] = {"x": 0.30, "y": 0.70, "z": -0.05, "visibility": 0.85}
    pose[17] = {"x": 0.72, "y": 0.73, "z": 0.05, "visibility": 0.80}
    pose[18] = {"x": 0.28, "y": 0.73, "z": -0.05, "visibility": 0.80}
    pose[19] = {"x": 0.71, "y": 0.74, "z": 0.05, "visibility": 0.80}
    pose[20] = {"x": 0.29, "y": 0.74, "z": -0.05, "visibility": 0.80}
    pose[21] = {"x": 0.68, "y": 0.71, "z": 0.05, "visibility": 0.80}
    pose[22] = {"x": 0.32, "y": 0.71, "z": -0.05, "visibility": 0.80}
    return pose


def make_hand_A() -> list[dict]:
    h = [{"x": 0.70, "y": 0.70, "z": 0.05} for _ in range(21)]
    h[0] = {"x": 0.70, "y": 0.70, "z": 0.05}
    h[1] = {"x": 0.71, "y": 0.71, "z": 0.07}
    return h


def make_hand_B() -> list[dict]:
    h = [{"x": 0.30, "y": 0.70, "z": -0.05} for _ in range(21)]
    h[0] = {"x": 0.30, "y": 0.70, "z": -0.05}
    h[1] = {"x": 0.29, "y": 0.71, "z": -0.03}
    return h


def generate_all_cases() -> dict:
    canonical_pose = make_canonical_pose()
    hand_a = make_hand_A()
    hand_b = make_hand_B()

    cases = {
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "description": "Casos de prueba compartidos entre Python y JavaScript con comparación elemento a elemento L_inf <= 1e-6",
        "frame_cases": {},
        "window_cases": {},
    }

    # 1. TC_01_canonical_frame (hand_a at P15 -> 'Left', hand_b at P16 -> 'Right')
    raw_tc01 = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(hand_a), copy.deepcopy(hand_b)],
        "handedness": [[{"categoryName": "Left"}], [{"categoryName": "Right"}]],
    }
    feats_01, val_01, err_01 = extract_frame_features(raw_tc01)
    cases["frame_cases"]["TC_01_canonical_frame"] = {
        "input": raw_tc01,
        "expected": {
            "valid": val_01,
            "error": err_01,
            "features": feats_01.tolist(),
        },
    }

    # 2. TC_02_missing_left_hand (only hand_b at P16 -> 'Right' -> rightHand [115..177])
    raw_tc02 = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(hand_b)],
        "handedness": [[{"categoryName": "Right"}]],
    }
    feats_02, val_02, err_02 = extract_frame_features(raw_tc02)
    cases["frame_cases"]["TC_02_missing_left_hand"] = {
        "input": raw_tc02,
        "expected": {
            "valid": val_02,
            "error": err_02,
            "features": feats_02.tolist(),
        },
    }

    # 3. TC_03_incomplete_pose
    raw_tc03 = {
        "pose": copy.deepcopy(canonical_pose)[:20],
        "hands": [copy.deepcopy(hand_a)],
    }
    feats_03, val_03, err_03 = extract_frame_features(raw_tc03)
    cases["frame_cases"]["TC_03_incomplete_pose"] = {
        "input": raw_tc03,
        "expected": {
            "valid": val_03,
            "error": err_03,
            "features": None,
        },
    }

    # 4. TC_04_shoulders_too_small
    pose_small = copy.deepcopy(canonical_pose)
    pose_small[11]["x"] = 0.525
    pose_small[12]["x"] = 0.475
    raw_tc04 = {
        "pose": pose_small,
        "hands": [copy.deepcopy(hand_a), copy.deepcopy(hand_b)],
    }
    feats_04, val_04, err_04 = extract_frame_features(raw_tc04)
    cases["frame_cases"]["TC_04_shoulders_too_small"] = {
        "input": raw_tc04,
        "expected": {
            "valid": val_04,
            "error": err_04,
            "features": None,
        },
    }

    # 5. TC_05A_order_invariance (Hand B before Hand A in input array)
    raw_tc05a = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(hand_b), copy.deepcopy(hand_a)],
        "handedness": [[{"categoryName": "Right"}], [{"categoryName": "Left"}]],
    }
    feats_05a, val_05a, err_05a = extract_frame_features(raw_tc05a)
    cases["frame_cases"]["TC_05A_order_invariance"] = {
        "input": raw_tc05a,
        "expected": {
            "valid": val_05a,
            "error": err_05a,
            "features": feats_05a.tolist(),
        },
    }

    # 6. TC_05B_centered_hand_left (direct v1.4.0: categoryName = Left -> Left Hand [52..114])
    centered_hand = [{"x": 0.50, "y": 0.70, "z": 0.00} for _ in range(21)]
    raw_tc05b_left = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(centered_hand)],
        "handedness": [[{"categoryName": "Left"}]],
    }
    feats_05b_l, val_05b_l, err_05b_l = extract_frame_features(raw_tc05b_left)
    cases["frame_cases"]["TC_05B_centered_hand_left"] = {
        "input": raw_tc05b_left,
        "expected": {
            "valid": val_05b_l,
            "error": err_05b_l,
            "features": feats_05b_l.tolist(),
        },
    }

    # 7. TC_05B_centered_hand_right (direct v1.4.0: categoryName = Right -> Right Hand [115..177])
    raw_tc05b_right = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(centered_hand)],
        "handedness": [[{"categoryName": "Right"}]],
    }
    feats_05b_r, val_05b_r, err_05b_r = extract_frame_features(raw_tc05b_right)
    cases["frame_cases"]["TC_05B_centered_hand_right"] = {
        "input": raw_tc05b_right,
        "expected": {
            "valid": val_05b_r,
            "error": err_05b_r,
            "features": feats_05b_r.tolist(),
        },
    }

    # 8. TC_05C_disconnected_high_vis (pose wrist vis = 0.85 -> floating hand discarded)
    floating_hand = [{"x": 0.05, "y": 0.05, "z": 0.00} for _ in range(21)]
    raw_tc05c_high = {
        "pose": copy.deepcopy(canonical_pose),
        "hands": [copy.deepcopy(floating_hand)],
    }
    feats_05c_h, val_05c_h, err_05c_h = extract_frame_features(raw_tc05c_high)
    cases["frame_cases"]["TC_05C_disconnected_high_vis"] = {
        "input": raw_tc05c_high,
        "expected": {
            "valid": val_05c_h,
            "error": err_05c_h,
            "features": feats_05c_h.tolist(),
        },
    }

    # 9. TC_05C_disconnected_low_vis_preserved (pose wrist vis = 0.20 < 0.50 -> preserved)
    pose_low_wrist_vis = copy.deepcopy(canonical_pose)
    pose_low_wrist_vis[15]["visibility"] = 0.20
    pose_low_wrist_vis[16]["visibility"] = 0.20
    raw_tc05c_low = {
        "pose": pose_low_wrist_vis,
        "hands": [copy.deepcopy(floating_hand)],
    }
    feats_05c_l, val_05c_l, err_05c_l = extract_frame_features(raw_tc05c_low)
    cases["frame_cases"]["TC_05C_disconnected_low_vis_preserved"] = {
        "input": raw_tc05c_low,
        "expected": {
            "valid": val_05c_l,
            "error": err_05c_l,
            "features": feats_05c_l.tolist(),
        },
    }

    # Window cases (ExtractWindow)
    # 10. TC_WINDOW_nominal_15_frames (30 frames at 33.333 ms -> t_last = 966.657 ms >= 933.333 ms)
    win_nominal = []
    for i in range(30):
        t_ms = i * 33.333
        win_nominal.append({
            "pose": copy.deepcopy(canonical_pose),
            "hands": [copy.deepcopy(hand_a), copy.deepcopy(hand_b)],
            "handedness": [[{"categoryName": "Left"}], [{"categoryName": "Right"}]],
            "timestamp_ms": t_ms,
        })
    tens_nom, val_w_nom, err_w_nom = extract_window(win_nominal, target_fps=15, duration_ms=1000.0)
    cases["window_cases"]["TC_WINDOW_nominal_15_frames"] = {
        "input": win_nominal,
        "options": {"targetFps": 15, "durationMs": 1000.0},
        "expected": {
            "valid": val_w_nom,
            "error": err_w_nom,
            "tensor": tens_nom.reshape(-1).tolist() if tens_nom is not None else None,
        },
    }

    # 11. TC_WINDOW_isolated_invalid_gap (90 ms gap <= 100 ms allowed; unique=12/15, bridges=3/14)
    ts_gap_ok = [0.0, 90.0, 180.0, 262.0, 344.0, 426.0, 508.0, 590.0, 672.0, 754.0, 836.0, 918.0, 1000.0]
    win_gap_ok = [
        {
            "pose": copy.deepcopy(canonical_pose),
            "hands": [copy.deepcopy(hand_a)],
            "handedness": [[{"categoryName": "Left"}]],
            "timestamp_ms": t_ms,
        }
        for t_ms in ts_gap_ok
    ]
    tens_gok, val_gok, err_gok = extract_window(win_gap_ok, target_fps=15, duration_ms=1000.0)
    cases["window_cases"]["TC_WINDOW_isolated_invalid_gap"] = {
        "input": win_gap_ok,
        "options": {"targetFps": 15, "durationMs": 1000.0},
        "expected": {
            "valid": val_gok,
            "error": err_gok,
            "tensor": tens_gok.reshape(-1).tolist() if tens_gok is not None else None,
        },
    }

    # 12. TC_WINDOW_excessive_gap_rejected (150 ms raw gap > 100 ms rejected)
    ts_gap_bad = [0.0, 150.0] + [150.0 + 60.0 * k for k in range(1, 16)]
    win_gap_bad = [
        {
            "pose": copy.deepcopy(canonical_pose),
            "hands": [copy.deepcopy(hand_a)],
            "handedness": [[{"categoryName": "Left"}]],
            "timestamp_ms": t_ms,
        }
        for t_ms in ts_gap_bad
    ]
    tens_gbad, val_gbad, err_gbad = extract_window(win_gap_bad, target_fps=15, duration_ms=1000.0)
    cases["window_cases"]["TC_WINDOW_excessive_gap_rejected"] = {
        "input": win_gap_bad,
        "options": {"targetFps": 15, "durationMs": 1000.0},
        "expected": {
            "valid": val_gbad,
            "error": err_gbad,
            "tensor": None,
        },
    }

    # 13. TC_WINDOW_hand_swap_between_frames
    # Verify per-frame anatomical slot assignment preserves trajectory continuity when array order swaps
    win_swap = []
    for i in range(30):
        t_ms = i * 33.333
        if i % 2 == 0:
            h_order = [copy.deepcopy(hand_a), copy.deepcopy(hand_b)]
            lbl_order = [[{"categoryName": "Left"}], [{"categoryName": "Right"}]]
        else:
            h_order = [copy.deepcopy(hand_b), copy.deepcopy(hand_a)]
            lbl_order = [[{"categoryName": "Right"}], [{"categoryName": "Left"}]]
        win_swap.append({
            "pose": copy.deepcopy(canonical_pose),
            "hands": h_order,
            "handedness": lbl_order,
            "timestamp_ms": t_ms,
        })
    tens_swap, val_swap, err_swap = extract_window(win_swap, target_fps=15, duration_ms=1000.0)
    cases["window_cases"]["TC_WINDOW_hand_swap_between_frames"] = {
        "input": win_swap,
        "options": {"targetFps": 15, "durationMs": 1000.0},
        "expected": {
            "valid": val_swap,
            "error": err_swap,
            "tensor": tens_swap.reshape(-1).tolist() if tens_swap is not None else None,
        },
    }

    # 14. TC_06_recorder_object_hands (recorder schema without top-level handedness; direct v1.4.0 labels)
    raw_tc06 = {
        "t_ms": 500.0,
        "videoWidth": 640,
        "videoHeight": 480,
        "pose": copy.deepcopy(canonical_pose),
        "hands": [
            {"landmarks": copy.deepcopy(hand_a), "categoryName": "Left", "score": 0.94},
            {"landmarks": copy.deepcopy(hand_b), "categoryName": "Right", "score": 0.97},
        ],
    }
    feats_06, val_06, err_06 = extract_frame_features(raw_tc06)
    cases["frame_cases"]["TC_06_recorder_object_hands"] = {
        "input": raw_tc06,
        "expected": {
            "valid": val_06,
            "error": err_06,
            "features": feats_06.tolist() if feats_06 is not None else None,
        },
    }

    # 15. TC_WINDOW_recorder_object_hands (window using {landmarks, categoryName, score} objects)
    win_recorder = [
        {
            "t_ms": float(i) * 50.0,
            "videoWidth": 640,
            "videoHeight": 480,
            "pose": copy.deepcopy(canonical_pose),
            "hands": [
                {"landmarks": copy.deepcopy(hand_a), "categoryName": "Left", "score": 0.94},
                {"landmarks": copy.deepcopy(hand_b), "categoryName": "Right", "score": 0.97},
            ],
        }
        for i in range(25)
    ]
    tens_rec, val_rec, err_rec = extract_window(win_recorder, target_fps=15, duration_ms=1000.0)
    cases["window_cases"]["TC_WINDOW_recorder_object_hands"] = {
        "input": win_recorder,
        "options": {"targetFps": 15, "durationMs": 1000.0},
        "expected": {
            "valid": val_rec,
            "error": err_rec,
            "tensor": tens_rec.reshape(-1).tolist() if tens_rec is not None else None,
        },
    }

    return cases


def generate_recorder_sample() -> dict:
    """Generate a synthetic recording matching the DevRecorder v1.3.1 schema."""
    canonical_pose = make_canonical_pose()
    hand_a = make_hand_A()
    hand_b = make_hand_B()

    frames = []
    for i in range(20):
        t_ms = float(i) * 50.0
        if i < 4:
            hands = []
            handedness = []
        elif i < 9:
            hands = [{"landmarks": copy.deepcopy(hand_b), "categoryName": "Right", "score": 0.96}]
            handedness = [[{"categoryName": "Right", "score": 0.96, "index": 0}]]
        elif i < 14:
            hands = [{"landmarks": copy.deepcopy(hand_a), "categoryName": "Left", "score": 0.95}]
            handedness = [[{"categoryName": "Left", "score": 0.95, "index": 1}]]
        else:
            hands = [
                {"landmarks": copy.deepcopy(hand_a), "categoryName": "Left", "score": 0.94},
                {"landmarks": copy.deepcopy(hand_b), "categoryName": "Right", "score": 0.97},
            ]
            handedness = [
                [{"categoryName": "Left", "score": 0.94, "index": 1}],
                [{"categoryName": "Right", "score": 0.97, "index": 0}],
            ]

        frames.append(
            {
                "t_ms": t_ms,
                "videoWidth": 640,
                "videoHeight": 480,
                "hands": hands,
                "handedness": handedness,
                "pose": copy.deepcopy(canonical_pose),
            }
        )

    return {
        "version": "1.3.1",
        "type": "expresat_dev_recording_raw",
        "recorded_at": "2026-11-12T00:00:00.000Z",
        "delegate": "GPU",
        "duration_ms": 950.0,
        "total_frames": len(frames),
        "avg_fps": 20.0,
        "min_fps_required": 15.0,
        "interval_metrics": {
            "p50_ms": 50.0,
            "p95_ms": 50.0,
            "max_ms": 50.0,
            "max_allowed_ms": 100.0,
            "gaps_over_100ms_count": 0,
        },
        "valid": True,
        "error": None,
        "prompt_timeline": [
            {
                "start_ms": 0,
                "end_ms": 3000,
                "label": "reposo",
                "instruction": "REPOSO — BRAZOS ABAJO",
            },
            {
                "start_ms": 3000,
                "end_ms": 7000,
                "label": "solo_derecha",
                "instruction": "LEVANTA SOLO LA MANO DERECHA",
            },
            {
                "start_ms": 7000,
                "end_ms": 11000,
                "label": "solo_izquierda",
                "instruction": "LEVANTA SOLO LA MANO IZQUIERDA",
            },
            {
                "start_ms": 11000,
                "end_ms": 15000,
                "label": "ambas",
                "instruction": "LEVANTA AMBAS MANOS",
            },
            {
                "start_ms": 15000,
                "end_ms": 18000,
                "label": "cruce",
                "instruction": "CRUZA AMBAS MANOS EN EL PECHO",
            },
        ],
        "videoWidth": 640,
        "videoHeight": 480,
        "frames": frames,
    }


def main():
    fixtures_dir = Path(__file__).resolve().parent
    target_path = fixtures_dir / "feature_spec_cases.json"
    data = generate_all_cases()
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Fixtures generados exitosamente en: {target_path}")
    print(f"Total frame cases: {len(data['frame_cases'])}")
    print(f"Total window cases: {len(data['window_cases'])}")

    rec_sample_path = fixtures_dir / "sample_recording_recorder_v1_3_1.json"
    rec_sample = generate_recorder_sample()
    with open(rec_sample_path, "w", encoding="utf-8") as f:
        json.dump(rec_sample, f, indent=2)
    print(f"Fixture de grabación del grabador generado en: {rec_sample_path} ({rec_sample['total_frames']} frames)")


if __name__ == "__main__":
    main()
