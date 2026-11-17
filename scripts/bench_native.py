#!/usr/bin/env python3
"""
Python native performance benchmark using MediaPipe Tasks (HandLandmarker +
PoseLandmarker lite) over 200 640x480 frames, reporting p50/p95/p99/max latency
per stage and CPU utilization.
"""

import math
import os
import sys
import time
from pathlib import Path
import json
import numpy as np
import cv2
import psutil

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

ROOT_DIR = Path(__file__).resolve().parent.parent
HAND_MODEL_PATH = str(ROOT_DIR / "expresat/frontend/public/models/hand_landmarker.task")
POSE_MODEL_PATH = str(ROOT_DIR / "expresat/frontend/public/models/pose_landmarker_lite.task")
TEST_HAND_IMG = str(ROOT_DIR / "expresat/frontend/public/test_hand.png")

NUM_FRAMES = 200
WIDTH = 640
HEIGHT = 480


def calc_percentiles(times_ms: list[float]) -> dict[str, float]:
    arr = np.array(times_ms)
    return {
        "mean": float(np.round(np.mean(arr), 2)),
        "p50": float(np.round(np.percentile(arr, 50), 2)),
        "p95": float(np.round(np.percentile(arr, 95), 2)),
        "p99": float(np.round(np.percentile(arr, 99), 2)),
        "max": float(np.round(np.max(arr), 2)),
    }


def main():
    print("================================================================================")
    print("   EXPRESAT — SPIKE DE MEDICIÓN NATIVA PYTHON (MEDIANTE MEDIAPIPE TASKS)")
    print("================================================================================")
    print(f"Python:       {sys.version.split()[0]}")
    print(f"MediaPipe:    {mp.__version__}")
    print(f"Hand Model:   {HAND_MODEL_PATH}")
    print(f"Pose Model:   {POSE_MODEL_PATH}")
    print(f"Resolución:   {WIDTH}x{HEIGHT}")
    print(f"Frames:       {NUM_FRAMES}")

    if not os.path.exists(HAND_MODEL_PATH):
        raise FileNotFoundError(f"No existe {HAND_MODEL_PATH}")
    if not os.path.exists(POSE_MODEL_PATH):
        raise FileNotFoundError(f"No existe {POSE_MODEL_PATH}")

    stimulus_base = cv2.imread(TEST_HAND_IMG)
    if stimulus_base is None:
        stimulus_base = np.zeros((300, 260, 3), dtype=np.uint8)
        cv2.circle(stimulus_base, (130, 150), 80, (200, 180, 160), -1)

    base_options_hand = python.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    options_hand = vision.HandLandmarkerOptions(
        base_options=base_options_hand,
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.45,
        min_hand_presence_confidence=0.45,
        min_tracking_confidence=0.45,
    )
    hand_detector = vision.HandLandmarker.create_from_options(options_hand)

    base_options_pose = python.BaseOptions(model_asset_path=POSE_MODEL_PATH)
    options_pose = vision.PoseLandmarkerOptions(
        base_options=base_options_pose,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    pose_detector = vision.PoseLandmarker.create_from_options(options_pose)

    hand_latencies = []
    pose_latencies = []
    total_latencies = []

    process = psutil.Process(os.getpid())
    cpu_before = psutil.cpu_percent(interval=None)
    proc_times_before = process.cpu_times()
    wall_start = time.perf_counter()

    # Warm up MediaPipe graphs before timing
    for w in range(5):
        frame = np.full((HEIGHT, WIDTH, 3), 30, dtype=np.uint8)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        hand_detector.detect_for_video(mp_image, w * 33)
        pose_detector.detect_for_video(mp_image, w * 33)

    print("Ejecutando 200 frames...")

    for i in range(NUM_FRAMES):
        ts_ms = (i + 10) * 33

        frame = np.full((HEIGHT, WIDTH, 3), 30, dtype=np.uint8)
        hx = int(180 + math.sin(i * 0.1) * 20)
        hy = int(100 + math.cos(i * 0.1) * 15)
        sh, sw = stimulus_base.shape[:2]
        frame[hy : hy + sh, hx : hx + sw] = stimulus_base

        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)

        t_f0 = time.perf_counter_ns()

        t_h0 = time.perf_counter_ns()
        hand_res = hand_detector.detect_for_video(mp_image, ts_ms)
        t_h1 = time.perf_counter_ns()
        dt_hand_ms = (t_h1 - t_h0) / 1e6
        hand_latencies.append(dt_hand_ms)

        t_p0 = time.perf_counter_ns()
        pose_res = pose_detector.detect_for_video(mp_image, ts_ms)
        t_p1 = time.perf_counter_ns()
        dt_pose_ms = (t_p1 - t_p0) / 1e6
        pose_latencies.append(dt_pose_ms)

        t_f1 = time.perf_counter_ns()
        dt_total_ms = (t_f1 - t_f0) / 1e6
        total_latencies.append(dt_total_ms)

    wall_end = time.perf_counter()
    wall_duration = wall_end - wall_start
    proc_times_after = process.cpu_times()
    cpu_after = psutil.cpu_percent(interval=None)

    user_cpu = proc_times_after.user - proc_times_before.user
    system_cpu = proc_times_after.system - proc_times_before.system
    total_cpu_time = user_cpu + system_cpu
    process_cpu_pct = (total_cpu_time / wall_duration) * 100.0

    hand_stats = calc_percentiles(hand_latencies)
    pose_stats = calc_percentiles(pose_latencies)
    total_stats = calc_percentiles(total_latencies)

    effective_fps = NUM_FRAMES / (sum(total_latencies) / 1000.0)

    report = {
        "environment": {
            "python_version": sys.version.split()[0],
            "mediapipe_version": mp.__version__,
            "cpu_model": "AMD Ryzen 3 7320U with Radeon Graphics (4C/8T)",
            "frames": NUM_FRAMES,
            "resolution": f"{WIDTH}x{HEIGHT}",
        },
        "stages": {
            "hand_landmarker": hand_stats,
            "pose_landmarker": pose_stats,
            "total_frame": total_stats,
        },
        "performance": {
            "effective_fps_mean": float(np.round(effective_fps, 2)),
            "fps_p50": float(np.round(1000.0 / total_stats["p50"], 2)),
            "fps_p95": float(np.round(1000.0 / total_stats["p95"], 2)),
        },
        "cpu_usage": {
            "process_cpu_percent": float(np.round(process_cpu_pct, 2)),
            "user_cpu_seconds": float(np.round(user_cpu, 2)),
            "system_cpu_seconds": float(np.round(system_cpu, 2)),
            "wall_duration_seconds": float(np.round(wall_duration, 2)),
        },
    }

    out_file = ROOT_DIR / "docs/dataset-generator/BENCHMARK_NATIVE_PYTHON.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n--------------------------------------------------------------------------------")
    print("   RESULTADOS MEDIDOS: SPIKE NATIVO PYTHON (MEDIAPIPE TASKS C++ BACKEND)")
    print("--------------------------------------------------------------------------------")
    print(f"HandLandmarker:  Media: {hand_stats['mean']} ms | p50: {hand_stats['p50']} ms | p95: {hand_stats['p95']} ms | p99: {hand_stats['p99']} ms | Max: {hand_stats['max']} ms")
    print(f"PoseLandmarker:  Media: {pose_stats['mean']} ms | p50: {pose_stats['p50']} ms | p95: {pose_stats['p95']} ms | p99: {pose_stats['p99']} ms | Max: {pose_stats['max']} ms")
    print(f"TOTAL FRAME:     Media: {total_stats['mean']} ms | p50: {total_stats['p50']} ms | p95: {total_stats['p95']} ms | p99: {total_stats['p99']} ms | Max: {total_stats['max']} ms")
    print("--------------------------------------------------------------------------------")
    print(f"TASA EFECTIVA:   Media: {effective_fps:.2f} FPS | p50: {1000.0/total_stats['p50']:.2f} FPS | p95: {1000.0/total_stats['p95']:.2f} FPS")
    print(f"USO DE CPU:      {process_cpu_pct:.1f}% de 1 núcleo (User: {user_cpu:.2f}s, System: {system_cpu:.2f}s, Wall: {wall_duration:.2f}s)")
    print(f"Reporte guardado en: {out_file}")
    print("================================================================================\n")


if __name__ == "__main__":
    main()
