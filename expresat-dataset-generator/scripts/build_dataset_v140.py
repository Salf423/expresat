#!/usr/bin/env python3
"""
build_dataset_v140.py — Stage-2 Vectorized Offline Dataset Pipeline (FEATURE_SPEC v1.4.0).

Documentation & Vault References:
  - Stage-2 Architecture: `Obsidian_exp/Explicacion del codigo/Dataset_Generator/06_Arquitectura_Dataset_Generator_v2.md`
  - Agent Playbook #2:    `Obsidian_exp/Agentes/02_PLAYBOOKS_POR_TAREA.md`
  - Feature Contract:     `Obsidian_exp/Especificacion_Feature_Spec_v1_4_0.md`

Pipeline stages:
  1. Raw take validation against `tests/schemas/recording_raw.schema.json` + strict v1.4.0 gates
     (4:3 aspect ratio ±0.05, FPS >= 15.0, max raw gap <= 100.0 ms, canonical `config_hash`).
  2. Vectorized raw frame packing & mode-aware segmentation (`estatica`, `dinamica`, `reposo`)
     with zero `copy.deepcopy`.
  3. Leak-free `StratifiedGroupKFold` split grouped strictly by `(subject_id, session_id, take_id)`.
  4. Safe isotropic 4:3 raw data augmentation applied EXCLUSIVELY to `train` raw arrays
     (visibility channel strictly immutable; zero augmentation on `val`/`test`).
  5. Feature extraction via vectorized `extract_window_arrays` v1.4.0 -> `(1, 15, 178)` float32.
  6. Export to `.npy` float32 shards (`X_train.npy`, `y_train.npy`, `X_val.npy`, `y_val.npy`,
     `X_test.npy`, `y_test.npy`) + `manifest.json` sealed with `config_hash` and SHA-256 checksums.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT / "expresat") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "expresat"))
if str(REPO_ROOT / "tests" / "schemas") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "tests" / "schemas"))

from models.feature_extractor import (  # noqa: E402
    ASPECT_RATIO,
    FEATURE_SPEC_VERSION,
    HAND_COORDS,
    HAND_LANDMARKS,
    HAND_LANDMARKER_SHA256,
    MAX_GAP_MS,
    POSE_COORDS,
    POSE_LANDMARKER_SHA256,
    POSE_UPPER_INDICES,
    SEQUENCE_LENGTH,
    SHOULDER_VIS_THRESH,
    SHOULDERS_D_MIN,
    TOTAL_FEATURES,
    UPPER_BILATERAL_INDEX_PAIRS,
    WRIST_MEMORY_TTL_MS,
    assign_hands_to_anatomical_slots,
    compute_config_hash,
    dist2d_iso,
    extract_window_arrays,
)
from validate_recording import validate_recording  # noqa: E402

PIPELINE_VERSION = "1.4.0"
ASPECT_RATIO_TOLERANCE = 0.05
MIN_CAPTURE_FPS = 15.0
WINDOW_DURATION_MS = 1000.0
STATIC_MIN_SPAN_MS = 1200.0
DYNAMIC_MIN_DISPLACEMENT_D = 0.15
ACTIVE_MIN_HAND_FRAC = 0.60


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_catalog(catalog_path: Path) -> dict[str, dict[str, Any]]:
    """Load `catalog/signs_catalog.json` indexed by sign `id`."""
    with open(catalog_path, "r", encoding="utf-8") as f:
        cat = json.load(f)
    return {s["id"]: s for s in cat.get("signos", []) if isinstance(s, dict) and "id" in s}


def validate_raw_take(
    payload: dict[str, Any],
    *,
    catalog_ids: Optional[set[str]] = None,
    expected_delegate: Optional[str] = None,
    expected_pose_cadence: Optional[int] = None,
) -> tuple[bool, Optional[str]]:
    """
    Stage 2.1 — Strictly validate an original raw `.raw.json` take before segmentation/augmentation.
    """
    schema_errors = validate_recording(payload)
    if schema_errors:
        return False, f"ERR_SCHEMA_INVALID: {schema_errors[0]}"

    vw = int(payload.get("videoWidth", 0) or 0)
    vh = int(payload.get("videoHeight", 0) or 0)
    if vw <= 0 or vh <= 0 or abs((vw / vh) - ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE:
        return False, f"ERR_INVALID_ASPECT_RATIO: {vw}x{vh}"

    frames = payload.get("frames", [])
    if len(frames) < 12:
        return False, f"ERR_WINDOW_LOW_UNIQUE_FRAMES: solo {len(frames)} frames"

    ts = np.array([float(fr.get("t_ms", 0.0)) for fr in frames], dtype=np.float64)
    if not np.all(np.isfinite(ts)):
        return False, "ERR_NON_FINITE_LANDMARKS: timestamps no finitos"

    diffs = np.diff(ts)
    if diffs.size > 0:
        if float(np.min(diffs)) < 0.0:
            return False, "ERR_NON_MONOTONIC_TIMESTAMPS"
        max_gap = float(np.max(diffs))
        if max_gap > MAX_GAP_MS:
            return False, f"ERR_INVALID_FRAME_GAP_TOO_LARGE: max_gap={max_gap:.2f}ms > {MAX_GAP_MS}ms"

    duration_ms = float(payload.get("duration_ms", 0.0) or 0.0)
    span_ms = float(ts[-1] - ts[0]) if ts.size > 1 else 0.0
    eff_dur = max(duration_ms, span_ms)
    eff_fps = (len(frames) / eff_dur) * 1000.0 if eff_dur > 0 else 0.0
    if eff_fps < MIN_CAPTURE_FPS:
        return False, f"ERR_CAPTURE_FPS_TOO_LOW: {eff_fps:.2f} < {MIN_CAPTURE_FPS}"

    version_str = str(payload.get("version", ""))
    if version_str.startswith("1.4."):
        delegate = str(payload.get("delegate") or "GPU")
        pose_cadence = int(payload.get("pose_cadence", 1))
        if expected_delegate is not None and delegate != expected_delegate:
            return False, f"ERR_DELEGATE_MISMATCH: {delegate} != {expected_delegate}"
        if expected_pose_cadence is not None and pose_cadence != int(expected_pose_cadence):
            return False, f"ERR_POSE_CADENCE_MISMATCH: {pose_cadence} != {expected_pose_cadence}"
        exp_hash = compute_config_hash(delegate=delegate, pose_cadence=pose_cadence)
        if payload.get("config_hash") != exp_hash:
            return False, f"ERR_CONFIG_HASH_MISMATCH: {payload.get('config_hash')} != {exp_hash}"

    meta = payload.get("recording_metadata") or {}
    sign_label = meta.get("sign_label") or (payload.get("hand_presence_metrics") or {}).get("sign_label")
    if catalog_ids is not None and sign_label is not None and sign_label not in catalog_ids:
        return False, f"ERR_UNKNOWN_SIGN_LABEL: '{sign_label}' fuera del catálogo"

    if payload.get("valid") is False:
        return False, str(payload.get("error") or "ERR_CAPTURE_MARKED_INVALID")

    return True, None


def pack_raw_frames_to_arrays(raw_frames: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    """
    Pack raw JSON frames ONCE into contiguous NumPy arrays with v1.4.0 anatomical slot assignment
    (direct laterality, `dist2d_iso` 4:3, wrist memory TTL = 200 ms).
    """
    valid_entries: list[tuple[float, dict[str, Any]]] = []
    for fr in raw_frames:
        pose = fr.get("pose")
        if not isinstance(pose, list) or len(pose) < 23:
            continue
        p11 = pose[11]
        p12 = pose[12]
        try:
            t_val = float(fr.get("t_ms", fr.get("timestamp_ms", 0.0)))
            x11, y11, v11 = float(p11["x"]), float(p11["y"]), float(p11.get("visibility", 1.0))
            x12, y12, v12 = float(p12["x"]), float(p12["y"]), float(p12.get("visibility", 1.0))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(val) for val in (t_val, x11, y11, v11, x12, y12, v12)):
            continue
        if v11 < SHOULDER_VIS_THRESH or v12 < SHOULDER_VIS_THRESH:
            continue
        if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
            continue
        valid_entries.append((t_val, fr))

    valid_entries.sort(key=lambda pair: pair[0])
    m = len(valid_entries)

    ts = np.empty(m, dtype=np.float64)
    pose_upper = np.empty((m, len(POSE_UPPER_INDICES), POSE_COORDS), dtype=np.float64)
    lh_coords = np.zeros((m, HAND_LANDMARKS, HAND_COORDS), dtype=np.float64)
    lh_present = np.zeros(m, dtype=bool)
    rh_coords = np.zeros((m, HAND_LANDMARKS, HAND_COORDS), dtype=np.float64)
    rh_present = np.zeros(m, dtype=bool)

    prev_left_w: Optional[tuple[float, float]] = None
    prev_left_t: float = -1e18
    prev_right_w: Optional[tuple[float, float]] = None
    prev_right_t: float = -1e18

    for fi, (t_curr, fr) in enumerate(valid_entries):
        ts[fi] = t_curr
        pose = fr["pose"]
        for ui, p_idx in enumerate(POSE_UPPER_INDICES):
            lm = pose[p_idx]
            pose_upper[fi, ui, 0] = float(lm.get("x", 0.0))
            pose_upper[fi, ui, 1] = float(lm.get("y", 0.0))
            pose_upper[fi, ui, 2] = float(lm.get("z", 0.0))
            pose_upper[fi, ui, 3] = float(lm.get("visibility", 1.0))

        if prev_left_w is not None and (t_curr - prev_left_t) > WRIST_MEMORY_TTL_MS:
            prev_left_w = None
        if prev_right_w is not None and (t_curr - prev_right_t) > WRIST_MEMORY_TTL_MS:
            prev_right_w = None

        d_frame = dist2d_iso(
            pose_upper[fi, 1, 0], pose_upper[fi, 1, 1],
            pose_upper[fi, 2, 0], pose_upper[fi, 2, 1],
        )
        assigned_l, assigned_r, _ = assign_hands_to_anatomical_slots(
            fr, pose, d_frame, prev_left_w, prev_right_w
        )

        if assigned_l is not None:
            lh_present[fi] = True
            for i in range(min(HAND_LANDMARKS, len(assigned_l))):
                lm = assigned_l[i]
                lh_coords[fi, i, 0] = float(lm.get("x", 0.0))
                lh_coords[fi, i, 1] = float(lm.get("y", 0.0))
                lh_coords[fi, i, 2] = float(lm.get("z", 0.0))
            prev_left_w = (float(lh_coords[fi, 0, 0]), float(lh_coords[fi, 0, 1]))
            prev_left_t = t_curr

        if assigned_r is not None:
            rh_present[fi] = True
            for i in range(min(HAND_LANDMARKS, len(assigned_r))):
                lm = assigned_r[i]
                rh_coords[fi, i, 0] = float(lm.get("x", 0.0))
                rh_coords[fi, i, 1] = float(lm.get("y", 0.0))
                rh_coords[fi, i, 2] = float(lm.get("z", 0.0))
            prev_right_w = (float(rh_coords[fi, 0, 0]), float(rh_coords[fi, 0, 1]))
            prev_right_t = t_curr

    return {
        "ts": ts,
        "pose_upper": pose_upper,
        "lh_coords": lh_coords,
        "lh_present": lh_present,
        "rh_coords": rh_coords,
        "rh_present": rh_present,
    }


def _slice_packed(packed: dict[str, np.ndarray], start_i: int, end_i: int) -> dict[str, np.ndarray]:
    return {
        "ts": packed["ts"][start_i:end_i].copy(),
        "pose_upper": packed["pose_upper"][start_i:end_i].copy(),
        "lh_coords": packed["lh_coords"][start_i:end_i].copy(),
        "lh_present": packed["lh_present"][start_i:end_i].copy(),
        "rh_coords": packed["rh_coords"][start_i:end_i].copy(),
        "rh_present": packed["rh_present"][start_i:end_i].copy(),
    }


def _cumulative_hand_displacement_d(win: dict[str, np.ndarray]) -> float:
    """Compute cumulative isotropic 2D wrist displacement normalized by median shoulder span D."""
    p11 = win["pose_upper"][:, 1, :]
    p12 = win["pose_upper"][:, 2, :]
    d_med = float(
        np.median(np.hypot((p11[:, 0] - p12[:, 0]) * ASPECT_RATIO, p11[:, 1] - p12[:, 1]) / ASPECT_RATIO)
    )
    if d_med < SHOULDERS_D_MIN:
        return 0.0

    best_disp = 0.0
    for coords, pres in ((win["lh_coords"], win["lh_present"]), (win["rh_coords"], win["rh_present"])):
        active_idx = np.flatnonzero(pres)
        if active_idx.size < 2:
            continue
        wrists = coords[active_idx, 0, :2]  # (K, 2)
        deltas = np.diff(wrists, axis=0)
        steps = np.hypot(deltas[:, 0] * ASPECT_RATIO, deltas[:, 1]) / ASPECT_RATIO
        best_disp = max(best_disp, float(np.sum(steps)) / d_med)
    return best_disp


def segment_packed_take(
    packed: dict[str, np.ndarray],
    *,
    mode: str,
    label: str,
    window_ms: float = WINDOW_DURATION_MS,
    stride_ms: float = 250.0,
) -> list[dict[str, np.ndarray]]:
    """
    Stage 2.2 — Segment a packed raw take into valid raw window array slices according to mode:
      - `reposo`: sliding 1000 ms windows across any valid span (0, 1, or 2 hands allowed).
      - `estatica`: requires raw span >= 1200 ms and active hand presence >= 60% per window.
      - `dinamica`: requires active hand presence >= 60% and cumulative displacement >= 0.15 * D.
    """
    ts = packed["ts"]
    m = int(ts.shape[0])
    if m < 12:
        return []

    total_span_ms = float(ts[-1] - ts[0])
    min_needed_ms = window_ms * (14.0 / 15.0)
    if total_span_ms + 1e-6 < min_needed_ms:
        return []

    is_reposo = label.lower() == "reposo"
    if not is_reposo and mode == "estatica" and total_span_ms < STATIC_MIN_SPAN_MS:
        return []

    # Build sliding window start times
    t_start = float(ts[0])
    t_max_start = float(ts[-1]) - min_needed_ms
    starts = []
    cur = t_start
    while cur <= t_max_start + 1e-6:
        starts.append(cur)
        cur += stride_ms
    if not starts:
        starts = [t_start]

    windows: list[dict[str, np.ndarray]] = []
    seen_ranges: set[tuple[int, int]] = set()

    for s_ms in starts:
        i0 = int(np.searchsorted(ts, s_ms, side="left"))
        # Include enough tail margin (up to window_ms + 80ms) for clean resampling & speed aug
        i1 = int(np.searchsorted(ts, ts[i0] + window_ms + 80.0, side="right"))
        if i1 - i0 < 12:
            continue
        if (i0, i1) in seen_ranges:
            continue
        seen_ranges.add((i0, i1))

        win = _slice_packed(packed, i0, i1)

        # Active sign hand presence gate
        if not is_reposo:
            has_any_hand = win["lh_present"] | win["rh_present"]
            if float(np.mean(has_any_hand)) < ACTIVE_MIN_HAND_FRAC:
                continue

        # Dynamic trajectory kinematic gate
        if not is_reposo and mode == "dinamica":
            if _cumulative_hand_displacement_d(win) < DYNAMIC_MIN_DISPLACEMENT_D:
                continue

        # Verify raw window passes v1.4.0 extract_window_arrays gates cleanly
        tensor, valid, _ = extract_window_arrays(
            win["ts"],
            win["pose_upper"],
            win["lh_coords"],
            win["lh_present"],
            win["rh_coords"],
            win["rh_present"],
            duration_ms=window_ms,
        )
        if valid and tensor is not None:
            windows.append(win)

    return windows


def mirror_raw_window_arrays(win: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """
    Exact horizontal mirror on packed raw window arrays (`x -> 1 - x`, bilateral pose swap,
    `lh <-> rh` swap). Commutes with `mirror_features_178` within `L_inf <= 1e-5`.
    """
    pose_m = win["pose_upper"].copy()
    pose_m[:, :, 0] = 1.0 - pose_m[:, :, 0]
    for idx_l, idx_r in UPPER_BILATERAL_INDEX_PAIRS:
        tmp = pose_m[:, idx_l, :].copy()
        pose_m[:, idx_l, :] = pose_m[:, idx_r, :]
        pose_m[:, idx_r, :] = tmp

    lh_pres_m = win["rh_present"].copy()
    rh_pres_m = win["lh_present"].copy()

    lh_m = np.zeros_like(win["rh_coords"])
    if np.any(lh_pres_m):
        lh_m[lh_pres_m] = win["rh_coords"][lh_pres_m]
        lh_m[lh_pres_m, :, 0] = 1.0 - lh_m[lh_pres_m, :, 0]

    rh_m = np.zeros_like(win["lh_coords"])
    if np.any(rh_pres_m):
        rh_m[rh_pres_m] = win["lh_coords"][rh_pres_m]
        rh_m[rh_pres_m, :, 0] = 1.0 - rh_m[rh_pres_m, :, 0]

    return {
        "ts": win["ts"].copy(),
        "pose_upper": pose_m,
        "lh_coords": lh_m,
        "lh_present": lh_pres_m,
        "rh_coords": rh_m,
        "rh_present": rh_pres_m,
    }


def augment_raw_window_arrays(
    win: dict[str, np.ndarray],
    rng: np.random.Generator,
    *,
    max_angle_deg: float = 10.0,
    scale_range: tuple[float, float] = (0.92, 1.08),
    translate_max: float = 0.03,
    noise_sigma: float = 0.002,
    enable_mirror: bool = False,
) -> dict[str, np.ndarray]:
    """
    Stage 2.4 — Safe isotropic 4:3 augmentation on raw packed window arrays (train split ONLY).
    Guarantees:
      - `pose_upper[:, :, 3]` (visibility) is NEVER modified.
      - 2D rotation around window shoulder center C respects 4:3 aspect ratio `A = 4/3`.
      - Shoulders P11/P12 stay strictly inside `[0.01, 0.99]`.
      - Timestamps preserve monotonicity, `max_gap <= 99.0 ms`, and zero tail extrapolation.
    """
    base = mirror_raw_window_arrays(win) if (enable_mirror and bool(rng.integers(0, 2))) else win

    ts = base["ts"].copy()
    pose = base["pose_upper"].copy()
    lh = base["lh_coords"].copy()
    lh_pres = base["lh_present"].copy()
    rh = base["rh_coords"].copy()
    rh_pres = base["rh_present"].copy()

    # Window shoulder center C
    cx = float(np.median((pose[:, 1, 0] + pose[:, 2, 0]) * 0.5))
    cy = float(np.median((pose[:, 1, 1] + pose[:, 2, 1]) * 0.5))

    theta = math.radians(float(rng.uniform(-max_angle_deg, max_angle_deg)))
    cos_t = math.cos(theta)
    sin_t = math.sin(theta)
    scale = float(rng.uniform(scale_range[0], scale_range[1]))
    tx = float(rng.uniform(-translate_max, translate_max))
    ty = float(rng.uniform(-translate_max, translate_max))

    def _transform_xy(xy: np.ndarray) -> np.ndarray:
        x_rel = (xy[..., 0] - cx) * ASPECT_RATIO * scale
        y_rel = (xy[..., 1] - cy) * scale
        x_rot = x_rel * cos_t - y_rel * sin_t
        y_rot = x_rel * sin_t + y_rel * cos_t
        out = np.empty_like(xy)
        out[..., 0] = cx + (x_rot / ASPECT_RATIO) + tx
        out[..., 1] = cy + y_rot + ty
        return out

    # Apply isotropic 4:3 rigid transform + scale + translation
    pose[:, :, :2] = _transform_xy(pose[:, :, :2])
    if np.any(lh_pres):
        lh[lh_pres, :, :2] = _transform_xy(lh[lh_pres, :, :2])
    if np.any(rh_pres):
        rh[rh_pres, :, :2] = _transform_xy(rh[rh_pres, :, :2])

    # Keep shoulders strictly inside [0.02, 0.98] by shifting whole scene back if needed
    sh_x = pose[:, 1:3, 0]
    sh_y = pose[:, 1:3, 1]
    shift_x = 0.0
    if float(np.min(sh_x)) < 0.02:
        shift_x = 0.02 - float(np.min(sh_x))
    elif float(np.max(sh_x)) > 0.98:
        shift_x = 0.98 - float(np.max(sh_x))
    shift_y = 0.0
    if float(np.min(sh_y)) < 0.02:
        shift_y = 0.02 - float(np.min(sh_y))
    elif float(np.max(sh_y)) > 0.98:
        shift_y = 0.98 - float(np.max(sh_y))

    if shift_x != 0.0 or shift_y != 0.0:
        pose[:, :, 0] += shift_x
        pose[:, :, 1] += shift_y
        if np.any(lh_pres):
            lh[lh_pres, :, 0] += shift_x
            lh[lh_pres, :, 1] += shift_y
        if np.any(rh_pres):
            rh[rh_pres, :, 0] += shift_x
            rh[rh_pres, :, 1] += shift_y

    # Gaussian sensor noise on (x, y, z) ONLY — NEVER touch visibility [:, :, 3]
    if noise_sigma > 0.0:
        pose[:, :, :3] += rng.normal(0.0, noise_sigma, size=pose[:, :, :3].shape)
        if np.any(lh_pres):
            lh[lh_pres] += rng.normal(0.0, noise_sigma, size=lh[lh_pres].shape)
        if np.any(rh_pres):
            rh[rh_pres] += rng.normal(0.0, noise_sigma, size=rh[rh_pres].shape)

    # Safe temporal speed perturbation preserving max_gap <= 99 ms and zero tail extrapolation
    if ts.size > 1:
        diffs = np.diff(ts)
        max_dt = float(np.max(diffs))
        span = float(ts[-1] - ts[0])
        min_speed = max(0.92, (WINDOW_DURATION_MS * 14.0 / 15.0 + 1.0) / span) if span > 0 else 1.0
        max_speed = min(1.08, 98.0 / max_dt) if max_dt > 0 else 1.0
        if min_speed <= max_speed:
            speed_factor = float(rng.uniform(min_speed, max_speed))
            ts = ts[0] + (ts - ts[0]) * speed_factor

    return {
        "ts": ts,
        "pose_upper": pose,
        "lh_coords": lh,
        "lh_present": lh_pres,
        "rh_coords": rh,
        "rh_present": rh_pres,
    }


def stratified_group_kfold_split(
    y: list[int],
    groups: list[str],
    *,
    n_splits: int = 5,
    seed: int = 42,
) -> list[int]:
    """
    Pure-NumPy deterministic StratifiedGroupKFold assigning each sample to a fold `0..n_splits-1`
    such that every unique group stays entirely inside ONE fold while balancing class histograms.
    """
    if len(y) != len(groups):
        raise ValueError("y y groups deben tener la misma longitud")
    unique_groups = sorted(set(groups))
    if len(unique_groups) < n_splits:
        raise ValueError(f"Se requieren al menos {n_splits} grupos únicos, se recibieron {len(unique_groups)}")

    classes = sorted(set(y))
    cls_to_idx = {c: idx for idx, c in enumerate(classes)}
    n_classes = len(classes)

    group_to_counts: dict[str, np.ndarray] = {
        g: np.zeros(n_classes, dtype=np.int64) for g in unique_groups
    }
    for yi, gi in zip(y, groups):
        group_to_counts[gi][cls_to_idx[yi]] += 1

    total_counts = np.zeros(n_classes, dtype=np.float64)
    for cnt in group_to_counts.values():
        total_counts += cnt
    ideal_per_fold = total_counts / float(n_splits)

    rng = np.random.default_rng(seed)
    tie_keys = {g: float(rng.random()) for g in unique_groups}

    # Sort descending by group size, then class concentration, with seeded tie-breaker
    ordered_groups = sorted(
        unique_groups,
        key=lambda g: (
            -int(np.sum(group_to_counts[g])),
            -float(np.max(group_to_counts[g]) / max(1, int(np.sum(group_to_counts[g])))),
            tie_keys[g],
        ),
    )

    fold_counts = np.zeros((n_splits, n_classes), dtype=np.float64)
    group_fold: dict[str, int] = {}
    denom = np.maximum(ideal_per_fold, 1.0)

    for g in ordered_groups:
        g_cnt = group_to_counts[g]
        best_fold = 0
        best_delta = float("inf")
        best_total = float("inf")
        for f in range(n_splits):
            before = float(np.sum(((fold_counts[f] - ideal_per_fold) / denom) ** 2))
            after = float(np.sum(((fold_counts[f] + g_cnt - ideal_per_fold) / denom) ** 2))
            delta = after - before
            fold_total = float(np.sum(fold_counts[f]))
            if delta < best_delta - 1e-12 or (abs(delta - best_delta) <= 1e-12 and fold_total < best_total):
                best_delta = delta
                best_total = fold_total
                best_fold = f
        group_fold[g] = best_fold
        fold_counts[best_fold] += g_cnt

    return [group_fold[g] for g in groups]


def _extract_group_and_label(payload: dict[str, Any], file_path: Path) -> tuple[str, str, str, str]:
    meta = payload.get("recording_metadata") or {}
    subject_id = str(meta.get("subject_id") or "unknown_subject")
    session_id = str(meta.get("session_id") or "unknown_session")
    take_id = str(meta.get("take_id") or file_path.stem)
    sign_label = str(
        meta.get("sign_label")
        or (payload.get("hand_presence_metrics") or {}).get("sign_label")
        or file_path.parent.name
    )
    return subject_id, session_id, take_id, sign_label


def build_dataset_pipeline(
    *,
    raw_dir: Path,
    output_dir: Path,
    catalog_path: Path,
    n_splits: int = 5,
    train_augment_copies: int = 2,
    enable_mirror_aug: bool = False,
    delegate: str = "GPU",
    pose_cadence: int = 1,
    seed: int = 42,
) -> dict[str, Any]:
    """
    Run the complete Stage-2 offline vectorized pipeline from raw `.raw.json` takes
    to sharded `.npy` float32 datasets + sealed `manifest.json`.
    """
    catalog = load_catalog(catalog_path)
    catalog_ids = set(catalog.keys())

    raw_files = sorted(raw_dir.rglob("*.raw.json"))
    if not raw_files:
        raise FileNotFoundError(f"No se encontraron archivos *.raw.json en {raw_dir}")

    window_records: list[dict[str, Any]] = []
    rejected_takes: list[dict[str, str]] = []

    for rpath in raw_files:
        try:
            with open(rpath, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            rejected_takes.append({"file": rpath.name, "error": f"ERR_JSON_DECODE: {exc}"})
            continue

        ok, err = validate_raw_take(
            payload,
            catalog_ids=catalog_ids,
            expected_delegate=delegate,
            expected_pose_cadence=pose_cadence,
        )
        if not ok:
            rejected_takes.append({"file": rpath.name, "error": str(err)})
            continue

        subject_id, session_id, take_id, sign_label = _extract_group_and_label(payload, rpath)
        if sign_label not in catalog:
            rejected_takes.append({"file": rpath.name, "error": f"ERR_UNKNOWN_SIGN_LABEL: {sign_label}"})
            continue

        mode = str(catalog[sign_label].get("modo", "estatica"))
        packed = pack_raw_frames_to_arrays(payload["frames"])
        seg_windows = segment_packed_take(packed, mode=mode, label=sign_label)
        if not seg_windows:
            rejected_takes.append({"file": rpath.name, "error": f"ERR_NO_VALID_WINDOWS_SEGMENTED ({mode})"})
            continue

        group_key = f"{subject_id}|{session_id}|{take_id}"
        for win in seg_windows:
            window_records.append(
                {
                    "label": sign_label,
                    "group": group_key,
                    "subject_id": subject_id,
                    "session_id": session_id,
                    "take_id": take_id,
                    "win": win,
                }
            )

    if not window_records:
        raise RuntimeError(f"Ninguna toma válida generó ventanas en {raw_dir} (rechazadas: {len(rejected_takes)})")

    labels = sorted({r["label"] for r in window_records})
    label_to_id = {lbl: idx for idx, lbl in enumerate(labels)}
    y_all = [label_to_id[r["label"]] for r in window_records]
    g_all = [r["group"] for r in window_records]

    effective_splits = max(3, min(n_splits, len(set(g_all))))
    folds = stratified_group_kfold_split(y_all, g_all, n_splits=effective_splits, seed=seed)

    # Fold mapping: [0 .. effective_splits-3] -> train, [effective_splits-2] -> val, [effective_splits-1] -> test
    val_fold = effective_splits - 2
    test_fold = effective_splits - 1

    split_records: dict[str, list[dict[str, Any]]] = {"train": [], "val": [], "test": []}
    for rec, fold_id in zip(window_records, folds):
        if fold_id == test_fold:
            split_records["test"].append(rec)
        elif fold_id == val_fold:
            split_records["val"].append(rec)
        else:
            split_records["train"].append(rec)

    output_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)

    splits_manifest: dict[str, Any] = {}
    for split_name in ("train", "val", "test"):
        recs = split_records[split_name]
        x_list: list[np.ndarray] = []
        y_list: list[int] = []
        num_augmented = 0
        groups_in_split = sorted({r["group"] for r in recs})

        for r in recs:
            win = r["win"]
            cls_id = label_to_id[r["label"]]
            t_orig, v_orig, _ = extract_window_arrays(
                win["ts"],
                win["pose_upper"],
                win["lh_coords"],
                win["lh_present"],
                win["rh_coords"],
                win["rh_present"],
                duration_ms=WINDOW_DURATION_MS,
            )
            if v_orig and t_orig is not None:
                x_list.append(t_orig[0])
                y_list.append(cls_id)

            # Safe 4:3 augmentation ONLY on train split (NEVER on val/test)
            if split_name == "train" and train_augment_copies > 0:
                for _ in range(train_augment_copies):
                    aug_win = augment_raw_window_arrays(
                        win, rng, enable_mirror=enable_mirror_aug
                    )
                    t_aug, v_aug, _ = extract_window_arrays(
                        aug_win["ts"],
                        aug_win["pose_upper"],
                        aug_win["lh_coords"],
                        aug_win["lh_present"],
                        aug_win["rh_coords"],
                        aug_win["rh_present"],
                        duration_ms=WINDOW_DURATION_MS,
                    )
                    if v_aug and t_aug is not None:
                        x_list.append(t_aug[0])
                        y_list.append(cls_id)
                        num_augmented += 1

        if x_list:
            X_arr = np.stack(x_list, axis=0).astype(np.float32)
            y_arr = np.asarray(y_list, dtype=np.int64)
        else:
            X_arr = np.zeros((0, SEQUENCE_LENGTH, TOTAL_FEATURES), dtype=np.float32)
            y_arr = np.zeros((0,), dtype=np.int64)

        x_file = f"X_{split_name}.npy"
        y_file = f"y_{split_name}.npy"
        np.save(output_dir / x_file, X_arr)
        np.save(output_dir / y_file, y_arr)

        cls_counts = Counter(labels[int(yi)] for yi in y_arr)
        splits_manifest[split_name] = {
            "X_file": x_file,
            "y_file": y_file,
            "num_samples": int(X_arr.shape[0]),
            "num_augmented": num_augmented,
            "groups": groups_in_split,
            "class_counts": dict(sorted(cls_counts.items())),
            "x_sha256": _sha256_file(output_dir / x_file),
            "y_sha256": _sha256_file(output_dir / y_file),
        }

    manifest = {
        "pipeline_version": PIPELINE_VERSION,
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "delegate": delegate,
        "pose_cadence": int(pose_cadence),
        "config_hash": compute_config_hash(delegate=delegate, pose_cadence=pose_cadence),
        "model_artifacts": {
            "hand_landmarker_sha256": HAND_LANDMARKER_SHA256,
            "pose_landmarker_sha256": POSE_LANDMARKER_SHA256,
        },
        "sequence_length": SEQUENCE_LENGTH,
        "num_features": TOTAL_FEATURES,
        "labels": labels,
        "group_key_fields": ["subject_id", "session_id", "take_id"],
        "n_splits": effective_splits,
        "seed": seed,
        "train_augment_copies": train_augment_copies,
        "enable_mirror_aug": enable_mirror_aug,
        "splits": splits_manifest,
        "rejected_takes": rejected_takes,
    }

    with open(output_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="ExpresaT Stage-2 Offline Vectorized Dataset Pipeline v1.4.0")
    parser.add_argument("--raw-dir", type=Path, required=True, help="Directorio raíz con tomas *.raw.json")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directorio destino para shards .npy y manifest.json")
    parser.add_argument(
        "--catalog",
        type=Path,
        default=REPO_ROOT / "catalog" / "signs_catalog.json",
        help="Ruta a catalog/signs_catalog.json",
    )
    parser.add_argument("--n-splits", type=int, default=5, help="Folds para StratifiedGroupKFold (def: 5)")
    parser.add_argument("--augment-copies", type=int, default=2, help="Copias aumentadas por ventana solo en train")
    parser.add_argument("--enable-mirror", action="store_true", help="Habilitar espejo horizontal en train")
    parser.add_argument("--delegate", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--pose-cadence", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    manifest = build_dataset_pipeline(
        raw_dir=args.raw_dir,
        output_dir=args.output_dir,
        catalog_path=args.catalog,
        n_splits=args.n_splits,
        train_augment_copies=args.augment_copies,
        enable_mirror_aug=args.enable_mirror,
        delegate=args.delegate,
        pose_cadence=args.pose_cadence,
        seed=args.seed,
    )
    print(f"Dataset v{manifest['feature_spec_version']} exportado en {args.output_dir}")
    print(f"config_hash: {manifest['config_hash']}")
    for sp, info in manifest["splits"].items():
        print(f"  {sp:<5}: {info['num_samples']} muestras (aug={info['num_augmented']}, grupos={len(info['groups'])})")
    print(f"Tomas rechazadas: {len(manifest['rejected_takes'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
