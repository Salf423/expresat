"""
Canonical 178D feature vector extractors (FEATURE_SPEC v1.4.0).

Frame layout:
  - [0..51]   Upper Pose (13 landmarks x 4: x, y, z, visibility)
              * P00, P11..P14 z' clipped to [-2.0, 2.0]
              * P15..P22 z' fixed to 0.0 (eliminates monocular hip-extrapolation bias)
  - [52..114] Left Hand  (21 landmarks x 3: x, y, z)
  - [115..177] Right Hand (21 landmarks x 3: x, y, z)
Total: 178 float32 features per frame; window tensor shape (1, 15, 178).

v1.4.0 invariants:
  - Isotropic 2D 4:3 shoulder scale D = hypot((x11 - x12) * A, y11 - y12) / A, A = 4/3
  - Direct MediaPipe Tasks laterality: 'Left' -> leftHand [52..114] (P15),
    'Right' -> rightHand [115..177] (P16)
  - Unified spatial + label + temporal assignment with wrist memory TTL = 200 ms
  - Strict raw temporal gap <= 100.0 ms (absolute, independent of duration_ms)
  - Window density gates: tail_extrapolation == 0, unique_real_frames >= 12/15,
    interpolated_bridge_fraction <= 3/14
  - Vectorized NumPy core (zero copy.deepcopy in extract_window)
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Optional

import numpy as np

FEATURE_SPEC_VERSION: str = "1.4.0"
TOTAL_FEATURES: int = 178
SEQUENCE_LENGTH: int = 15

ASPECT_RATIO: float = 4.0 / 3.0

POSE_UPPER_INDICES: list[int] = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
_POSE_UPPER_IDX_ARRAY: np.ndarray = np.array(POSE_UPPER_INDICES, dtype=np.int64)
POSE_COORDS: int = 4  # x, y, z, visibility
POSE_FEATURES_COUNT: int = len(POSE_UPPER_INDICES) * POSE_COORDS  # 52

# Upper-pose positions [0..4] -> P00, P11, P12, P13, P14 (clipped z')
# Upper-pose positions [5..12] -> P15..P22 (z' forced to 0.0)
POSE_Z_CLIP_ABS: float = 2.0
POSE_Z_ZERO_INDICES: tuple[int, ...] = (15, 16, 17, 18, 19, 20, 21, 22)
_POSE_Z_ZERO_UPPER_POS: tuple[int, ...] = (5, 6, 7, 8, 9, 10, 11, 12)

HAND_LANDMARKS: int = 21
HAND_COORDS: int = 3  # x, y, z
HAND_FEATURES_COUNT: int = HAND_LANDMARKS * HAND_COORDS  # 63

# Bilateral pairs for mirroring
POSE_BILATERAL_PAIRS: list[tuple[int, int]] = [
    (11, 12),  # Shoulders
    (13, 14),  # Elbows
    (15, 16),  # Wrists
    (17, 18),  # Pinkies
    (19, 20),  # Indexes
    (21, 22),  # Thumbs
]

UPPER_BILATERAL_INDEX_PAIRS: list[tuple[int, int]] = [
    (1, 2),
    (3, 4),
    (5, 6),
    (7, 8),
    (9, 10),
    (11, 12),
]

SHOULDER_VIS_THRESH: float = 0.40
SHOULDERS_D_MIN: float = 0.08
HAND_DISCONNECTED_THRESH: float = 1.75
HAND_AMBIGUITY_THRESH: float = 0.15
POSE_WRIST_MIN_VIS: float = 0.50
MAX_GAP_MS: float = 100.0
MIN_UNIQUE_REAL_FRAMES: int = 12
MAX_BRIDGE_COUNT: int = 3
MAX_BRIDGE_RATIO: float = 3.0 / 14.0
TAIL_EXTRAPOLATION_TOL_MS: float = 1e-6
WRIST_MEMORY_TTL_MS: float = 200.0
EMA_ALPHA: float = 0.50

# Hand assignment cost weights in units of shoulder span D
WEIGHT_LABEL_PENALTY: float = 0.25
WEIGHT_TEMPORAL_CONTINUITY: float = 0.50

# Canonical SHA-256 checksums of the MediaPipe Tasks bundles used in production/capture
HAND_LANDMARKER_SHA256: str = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
POSE_LANDMARKER_SHA256: str = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"


def dist2d_iso(x1: float, y1: float, x2: float, y2: float, aspect_ratio: float = ASPECT_RATIO) -> float:
    """Isotropic 2D Euclidean distance in 4:3 normalized image coordinates."""
    return math.hypot((x1 - x2) * aspect_ratio, y1 - y2) / aspect_ratio


def _is_finite_num(val: Any) -> bool:
    try:
        return math.isfinite(float(val))
    except (TypeError, ValueError):
        return False


def get_canonical_config_dict(
    delegate: str = "GPU",
    pose_cadence: int = 1,
    hand_landmarker_sha256: str = HAND_LANDMARKER_SHA256,
    pose_landmarker_sha256: str = POSE_LANDMARKER_SHA256,
) -> dict[str, Any]:
    """
    Build the canonical FEATURE_SPEC v1.4.0 configuration dictionary sealed into `config_hash`.
    Completely decoupled from `tests/fixtures/` so production builds never depend on test artifacts.
    """
    return {
        "aspect_ratio": "4:3",
        "d_metric": "2d_iso_4_3",
        "delegate": str(delegate),
        "duration_ms": 1000,
        "ema_alpha": EMA_ALPHA,
        "feature_spec_version": FEATURE_SPEC_VERSION,
        "hand_ambiguity_thresh": HAND_AMBIGUITY_THRESH,
        "hand_disconnected_thresh": HAND_DISCONNECTED_THRESH,
        "hand_landmarker_sha256": str(hand_landmarker_sha256),
        "handedness_convention": "direct",
        "max_bridge_count": MAX_BRIDGE_COUNT,
        "max_gap_ms": int(MAX_GAP_MS),
        "min_unique_real_frames": MIN_UNIQUE_REAL_FRAMES,
        "pose_cadence": int(pose_cadence),
        "pose_landmarker_sha256": str(pose_landmarker_sha256),
        "pose_upper_indices": list(POSE_UPPER_INDICES),
        "pose_wrist_min_vis": POSE_WRIST_MIN_VIS,
        "pose_z_clip_abs": int(POSE_Z_CLIP_ABS),
        "pose_z_zero_indices": list(POSE_Z_ZERO_INDICES),
        "sequence_length": SEQUENCE_LENGTH,
        "shoulder_vis_thresh": SHOULDER_VIS_THRESH,
        "shoulders_d_min": SHOULDERS_D_MIN,
        "target_fps": 15,
        "total_features": TOTAL_FEATURES,
        "weight_label_penalty": WEIGHT_LABEL_PENALTY,
        "weight_temporal_continuity": WEIGHT_TEMPORAL_CONTINUITY,
        "wrist_memory_ttl_ms": int(WRIST_MEMORY_TTL_MS),
    }


def serialize_canonical_config(
    delegate: str = "GPU",
    pose_cadence: int = 1,
    hand_landmarker_sha256: str = HAND_LANDMARKER_SHA256,
    pose_landmarker_sha256: str = POSE_LANDMARKER_SHA256,
) -> str:
    """Serialize canonical v1.4.0 config into compact sorted JSON identical to JS `serializeCanonicalConfig`."""
    canonical_dict = get_canonical_config_dict(
        delegate=delegate,
        pose_cadence=pose_cadence,
        hand_landmarker_sha256=hand_landmarker_sha256,
        pose_landmarker_sha256=pose_landmarker_sha256,
    )
    return json.dumps(canonical_dict, sort_keys=True, separators=(",", ":"))


def compute_config_hash(
    delegate: str = "GPU",
    pose_cadence: int = 1,
    hand_landmarker_sha256: str = HAND_LANDMARKER_SHA256,
    pose_landmarker_sha256: str = POSE_LANDMARKER_SHA256,
) -> str:
    """Compute SHA-256 `config_hash` sealing FEATURE_SPEC v1.4.0, delegate, pose_cadence, and .task hashes."""
    raw_bytes = serialize_canonical_config(
        delegate=delegate,
        pose_cadence=pose_cadence,
        hand_landmarker_sha256=hand_landmarker_sha256,
        pose_landmarker_sha256=pose_landmarker_sha256,
    ).encode("utf-8")
    return hashlib.sha256(raw_bytes).hexdigest()


def _get_category_label(h_item: Any) -> Optional[str]:
    """Extract MediaPipe categoryName from a string, dict, or nested list."""
    if isinstance(h_item, list) and len(h_item) > 0:
        return _get_category_label(h_item[0])
    if isinstance(h_item, dict):
        return (
            h_item.get("categoryName")
            or h_item.get("label")
            or h_item.get("displayName")
        )
    if isinstance(h_item, str):
        return h_item
    return None


def _get_detected_hands_and_labels(raw_frame: dict) -> tuple[list[list[dict]], list[Optional[str]]]:
    """
    Normalize the input frame into parallel lists of hand landmarks and category labels,
    supporting both array and dev-recorder object formats (v1.4.0 direct convention).
    """
    hands: list[list[dict]] = []
    labels: list[Optional[str]] = []

    if "hands" in raw_frame and isinstance(raw_frame["hands"], list):
        hands_raw = raw_frame["hands"]
        handedness_raw = raw_frame.get("handedness", [])
        for i, h in enumerate(hands_raw):
            if isinstance(h, dict) and "landmarks" in h and isinstance(h["landmarks"], list):
                if len(h["landmarks"]) > 0:
                    hands.append(h["landmarks"])
                    lbl = h.get("categoryName") or h.get("label")
                    if not lbl and isinstance(handedness_raw, list) and i < len(handedness_raw):
                        lbl = _get_category_label(handedness_raw[i])
                    labels.append(lbl)
            elif isinstance(h, list) and len(h) > 0:
                hands.append(h)
                lbl = None
                if isinstance(handedness_raw, list) and i < len(handedness_raw):
                    lbl = _get_category_label(handedness_raw[i])
                labels.append(lbl)
        return hands, labels

    # Direct v1.4.0 convention: leftHand -> 'Left', rightHand -> 'Right'
    if "leftHand" in raw_frame and raw_frame["leftHand"]:
        hands.append(raw_frame["leftHand"])
        labels.append("Left")
    if "rightHand" in raw_frame and raw_frame["rightHand"]:
        hands.append(raw_frame["rightHand"])
        labels.append("Right")

    return hands, labels


def _hand_to_features(
    raw_hand: list[dict],
    D: float,
    Cx: float,
    Cy: float,
) -> Optional[np.ndarray]:
    """Normalize 21 hand landmarks into a 63-element float64 vector (returns None if non-finite)."""
    out = np.zeros(HAND_FEATURES_COUNT, dtype=np.float64)
    if not raw_hand:
        return out

    zw_raw = raw_hand[0].get("z", 0.0)
    if not _is_finite_num(zw_raw):
        return None
    z_wrist = float(zw_raw)

    n = min(HAND_LANDMARKS, len(raw_hand))
    inv_d = 1.0 / D
    for i in range(n):
        lm = raw_hand[i]
        rx = lm.get("x", 0.0)
        ry = lm.get("y", 0.0)
        rz = lm.get("z", 0.0)
        if not (_is_finite_num(rx) and _is_finite_num(ry) and _is_finite_num(rz)):
            return None
        out[i * 3 + 0] = (float(rx) - Cx) * inv_d
        out[i * 3 + 1] = (float(ry) - Cy) * inv_d
        out[i * 3 + 2] = (float(rz) - z_wrist) * inv_d

    return out


def assign_hands_to_anatomical_slots(
    raw_frame: dict,
    pose: list[dict],
    D: float,
    prev_left_wrist: Optional[tuple[float, float]] = None,
    prev_right_wrist: Optional[tuple[float, float]] = None,
) -> tuple[Optional[list[dict]], Optional[list[dict]], bool]:
    """
    Assign detected hands to anatomical (left_hand, right_hand) slots (FEATURE_SPEC v1.4.0).
    Returns (left_hand, right_hand, is_ambiguous).

    Rules (direct MediaPipe Tasks convention: 'Left' -> leftHand/P15, 'Right' -> rightHand/P16):
      1. Drop disconnected hands: min(d_left, d_right) > 1.75 * D (isotropic 4:3) when closer pose wrist vis >= 0.50.
      2. For 2 hands, minimize joint isotropic spatial distance + direct label penalty + temporal continuity.
      3. For 1 hand, use unified spatial + direct label + symmetric temporal scoring (no blind label override).
      4. Mark ambiguous when cost margin < 0.15 * D or pose wrist visibility < 0.50 (1-hand).
    """
    detected_hands, detected_labels = _get_detected_hands_and_labels(raw_frame)

    pw15_x = float(pose[15].get("x", 0.0))
    pw15_y = float(pose[15].get("y", 0.0))
    pw15_vis = float(pose[15].get("visibility", 1.0))

    pw16_x = float(pose[16].get("x", 0.0))
    pw16_y = float(pose[16].get("y", 0.0))
    pw16_vis = float(pose[16].get("visibility", 1.0))

    valid_hands: list[tuple[list[dict], Optional[str], float, float, float, float]] = []
    for h, lbl in zip(detected_hands, detected_labels):
        rx = h[0].get("x", 0.0)
        ry = h[0].get("y", 0.0)
        if not (_is_finite_num(rx) and _is_finite_num(ry)):
            continue
        hw_x = float(rx)
        hw_y = float(ry)
        d_left = dist2d_iso(hw_x, hw_y, pw15_x, pw15_y)
        d_right = dist2d_iso(hw_x, hw_y, pw16_x, pw16_y)

        closer_wrist_vis = pw15_vis if d_left <= d_right else pw16_vis
        is_disconnected = (min(d_left, d_right) > HAND_DISCONNECTED_THRESH * D) and (
            closer_wrist_vis >= POSE_WRIST_MIN_VIS
        )

        if not is_disconnected:
            valid_hands.append((h, lbl, d_left, d_right, hw_x, hw_y))

    assigned_left: Optional[list[dict]] = None
    assigned_right: Optional[list[dict]] = None
    is_ambiguous: bool = False

    if len(valid_hands) >= 2:
        h0, lbl0, d0_l, d0_r, hw0_x, hw0_y = valid_hands[0]
        h1, lbl1, d1_l, d1_r, hw1_x, hw1_y = valid_hands[1]

        cost_A = d0_l + d1_r  # H0 -> Left, H1 -> Right
        cost_B = d1_l + d0_r  # H1 -> Left, H0 -> Right

        # Direct v1.4.0 convention: 'Left' -> leftHand, 'Right' -> rightHand
        penalty_A = 0.0
        penalty_B = 0.0

        if lbl0 == "Right":
            penalty_A += WEIGHT_LABEL_PENALTY * D
        elif lbl0 == "Left":
            penalty_B += WEIGHT_LABEL_PENALTY * D

        if lbl1 == "Left":
            penalty_A += WEIGHT_LABEL_PENALTY * D
        elif lbl1 == "Right":
            penalty_B += WEIGHT_LABEL_PENALTY * D

        if prev_left_wrist is not None and prev_right_wrist is not None:
            c_temp_A = (
                dist2d_iso(hw0_x, hw0_y, prev_left_wrist[0], prev_left_wrist[1])
                + dist2d_iso(hw1_x, hw1_y, prev_right_wrist[0], prev_right_wrist[1])
            )
            c_temp_B = (
                dist2d_iso(hw1_x, hw1_y, prev_left_wrist[0], prev_left_wrist[1])
                + dist2d_iso(hw0_x, hw0_y, prev_right_wrist[0], prev_right_wrist[1])
            )
            penalty_A += WEIGHT_TEMPORAL_CONTINUITY * c_temp_A
            penalty_B += WEIGHT_TEMPORAL_CONTINUITY * c_temp_B

        total_cost_A = cost_A + penalty_A
        total_cost_B = cost_B + penalty_B

        if abs(total_cost_A - total_cost_B) < HAND_AMBIGUITY_THRESH * D:
            is_ambiguous = True

        if total_cost_A <= total_cost_B:
            assigned_left = h0
            assigned_right = h1
        else:
            assigned_left = h1
            assigned_right = h0

    elif len(valid_hands) == 1:
        h0, lbl0, d0_l, d0_r, hw0_x, hw0_y = valid_hands[0]
        pose_wrists_reliable = (pw15_vis >= POSE_WRIST_MIN_VIS) and (pw16_vis >= POSE_WRIST_MIN_VIS)

        cost_left = d0_l if pose_wrists_reliable else 0.0
        cost_right = d0_r if pose_wrists_reliable else 0.0

        if lbl0 == "Right":
            cost_left += WEIGHT_LABEL_PENALTY * D
        elif lbl0 == "Left":
            cost_right += WEIGHT_LABEL_PENALTY * D

        if prev_left_wrist is not None and prev_right_wrist is not None:
            cost_left += WEIGHT_TEMPORAL_CONTINUITY * dist2d_iso(
                hw0_x, hw0_y, prev_left_wrist[0], prev_left_wrist[1]
            )
            cost_right += WEIGHT_TEMPORAL_CONTINUITY * dist2d_iso(
                hw0_x, hw0_y, prev_right_wrist[0], prev_right_wrist[1]
            )

        if abs(cost_left - cost_right) < HAND_AMBIGUITY_THRESH * D or not pose_wrists_reliable:
            is_ambiguous = True

        if cost_left < cost_right:
            assigned_left = h0
        elif cost_right < cost_left:
            assigned_right = h0
        else:
            # Exact tie fallback: label -> pose distance
            if lbl0 == "Left":
                assigned_left = h0
            elif lbl0 == "Right":
                assigned_right = h0
            elif d0_l <= d0_r:
                assigned_left = h0
            else:
                assigned_right = h0

    return assigned_left, assigned_right, is_ambiguous


def validate_frame_hand_labels(raw_frame: dict) -> tuple[bool, Optional[str]]:
    """Verify every detected hand in the frame carries a valid 'Left' or 'Right' label."""
    detected_hands, detected_labels = _get_detected_hands_and_labels(raw_frame)
    if not detected_hands:
        return True, None

    for i, lbl in enumerate(detected_labels):
        if lbl is None or str(lbl).strip() == "" or str(lbl).lower() == "unknown":
            return False, f"ERR_HAND_MISSING_LABEL: mano #{i} carece de etiqueta categoryName válida"
        if str(lbl) not in ("Left", "Right"):
            return False, f"ERR_HAND_INVALID_LABEL: mano #{i} tiene etiqueta no canónica ('{lbl}')"

    return True, None


def extract_frame_features(raw_frame: dict) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """Extract and normalize a single frame to 178 float32 features per FEATURE_SPEC v1.4.0."""
    pose = raw_frame.get("pose") if isinstance(raw_frame, dict) else None
    if pose is None or len(pose) < 23:
        return None, False, "ERR_POSE_MISSING"

    p11 = pose[11]
    p12 = pose[12]
    for key in ("x", "y", "z"):
        if not (_is_finite_num(p11.get(key, 0.0)) and _is_finite_num(p12.get(key, 0.0))):
            return None, False, "ERR_NON_FINITE_LANDMARKS"
    if not (_is_finite_num(p11.get("visibility", 1.0)) and _is_finite_num(p12.get("visibility", 1.0))):
        return None, False, "ERR_NON_FINITE_LANDMARKS"

    vis_11 = float(p11.get("visibility", 1.0))
    vis_12 = float(p12.get("visibility", 1.0))
    if vis_11 < SHOULDER_VIS_THRESH or vis_12 < SHOULDER_VIS_THRESH:
        return None, False, "ERR_SHOULDER_VISIBILITY"

    x11 = float(p11.get("x", 0.0))
    y11 = float(p11.get("y", 0.0))
    x12 = float(p12.get("x", 0.0))
    y12 = float(p12.get("y", 0.0))
    if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
        return None, False, "ERR_OUT_OF_BOUNDS"

    z11 = float(p11.get("z", 0.0))
    z12 = float(p12.get("z", 0.0))
    cx = (x11 + x12) * 0.5
    cy = (y11 + y12) * 0.5
    cz = (z11 + z12) * 0.5

    D = dist2d_iso(x11, y11, x12, y12)
    if D < SHOULDERS_D_MIN:
        return None, False, "ERR_SHOULDERS_TOO_SMALL"

    features = np.zeros(TOTAL_FEATURES, dtype=np.float64)
    inv_d = 1.0 / D

    # Upper Pose [0..51]
    for i, p_idx in enumerate(POSE_UPPER_INDICES):
        lm = pose[p_idx]
        rx = lm.get("x", 0.0)
        ry = lm.get("y", 0.0)
        rz = lm.get("z", 0.0)
        rv = lm.get("visibility", 1.0)
        if not (_is_finite_num(rx) and _is_finite_num(ry) and _is_finite_num(rz) and _is_finite_num(rv)):
            return None, False, "ERR_NON_FINITE_LANDMARKS"

        features[i * 4 + 0] = (float(rx) - cx) * inv_d
        features[i * 4 + 1] = (float(ry) - cy) * inv_d
        if i >= 5:
            # P15..P22: fixed z' = 0.0 (FEATURE_SPEC v1.4.0)
            features[i * 4 + 2] = 0.0
        else:
            z_norm = (float(rz) - cz) * inv_d
            features[i * 4 + 2] = max(-POSE_Z_CLIP_ABS, min(POSE_Z_CLIP_ABS, z_norm))
        features[i * 4 + 3] = max(0.0, min(1.0, float(rv)))

    assigned_left, assigned_right, _ = assign_hands_to_anatomical_slots(raw_frame, pose, D)

    if assigned_left is not None:
        lf = _hand_to_features(assigned_left, D, cx, cy)
        if lf is None:
            return None, False, "ERR_NON_FINITE_LANDMARKS"
        features[52:115] = lf
    else:
        features[52:115] = 0.0

    if assigned_right is not None:
        rf = _hand_to_features(assigned_right, D, cx, cy)
        if rf is None:
            return None, False, "ERR_NON_FINITE_LANDMARKS"
        features[115:178] = rf
    else:
        features[115:178] = 0.0

    return features.astype(np.float32), True, None


def _clone_hand_pts(hand: list[dict]) -> list[dict]:
    return [
        {"x": float(pt.get("x", 0.0)), "y": float(pt.get("y", 0.0)), "z": float(pt.get("z", 0.0))}
        for pt in hand
    ]


def resample_sequence_blocks(
    blocks: list[dict],
    target_timestamps: list[float],
) -> list[dict]:
    """
    Pure block-wise linear resampling helper (independently verifiable on hand-calculated fixtures).
    Input blocks: [{timestamp_ms, pose, left_hand, right_hand}].
    """
    if not blocks or not target_timestamps:
        return []

    ts = np.array([float(b["timestamp_ms"]) for b in blocks], dtype=np.float64)
    n = len(blocks)
    out: list[dict] = []

    for t_target in target_timestamps:
        t_val = float(t_target)
        idx_hi = int(np.searchsorted(ts, t_val, side="left"))
        if idx_hi >= n:
            idx_hi = n - 1
            idx_lo = n - 1
        elif ts[idx_hi] == t_val or idx_hi == 0:
            idx_lo = idx_hi
        else:
            idx_lo = idx_hi - 1

        prev_f = blocks[idx_lo]
        next_f = blocks[idx_hi]
        t_prev = float(ts[idx_lo])
        t_next = float(ts[idx_hi])
        tau = 0.0 if t_prev == t_next else max(0.0, min(1.0, (t_val - t_prev) / (t_next - t_prev)))
        one_minus_tau = 1.0 - tau

        p_prev = prev_f["pose"]
        p_next = next_f["pose"]
        n_pose = min(len(p_prev), len(p_next))
        interp_pose = [
            {
                "x": one_minus_tau * float(p_prev[i].get("x", 0.0)) + tau * float(p_next[i].get("x", 0.0)),
                "y": one_minus_tau * float(p_prev[i].get("y", 0.0)) + tau * float(p_next[i].get("y", 0.0)),
                "z": one_minus_tau * float(p_prev[i].get("z", 0.0)) + tau * float(p_next[i].get("z", 0.0)),
                "visibility": one_minus_tau * float(p_prev[i].get("visibility", 1.0)) + tau * float(p_next[i].get("visibility", 1.0)),
            }
            for i in range(n_pose)
        ]

        def _interp_hand(h_p: Optional[list[dict]], h_n: Optional[list[dict]]) -> Optional[list[dict]]:
            if h_p is not None and h_n is not None:
                n_h = min(len(h_p), len(h_n))
                return [
                    {
                        "x": one_minus_tau * float(h_p[i].get("x", 0.0)) + tau * float(h_n[i].get("x", 0.0)),
                        "y": one_minus_tau * float(h_p[i].get("y", 0.0)) + tau * float(h_n[i].get("y", 0.0)),
                        "z": one_minus_tau * float(h_p[i].get("z", 0.0)) + tau * float(h_n[i].get("z", 0.0)),
                    }
                    for i in range(n_h)
                ]
            if tau < 0.5 and h_p is not None:
                return _clone_hand_pts(h_p)
            if tau >= 0.5 and h_n is not None:
                return _clone_hand_pts(h_n)
            return None

        out.append({
            "timestamp_ms": t_val,
            "pose": interp_pose,
            "left_hand": _interp_hand(prev_f.get("left_hand"), next_f.get("left_hand")),
            "right_hand": _interp_hand(prev_f.get("right_hand"), next_f.get("right_hand")),
        })

    return out


def apply_block_ema(blocks: list[dict], alpha: float = EMA_ALPHA) -> list[dict]:
    """
    Pure per-block temporal EMA filter with independent reset on hand reappearance.
    Visibility is preserved unsmoothed.
    """
    one_minus_a = 1.0 - alpha
    smoothed: list[dict] = []
    prev_pose: Optional[list[dict]] = None
    prev_lh: Optional[list[dict]] = None
    prev_rh: Optional[list[dict]] = None

    for k, fr in enumerate(blocks):
        curr_pose = fr["pose"]
        if k == 0 or prev_pose is None or len(prev_pose) != len(curr_pose):
            s_pose = [
                {
                    "x": float(pt.get("x", 0.0)),
                    "y": float(pt.get("y", 0.0)),
                    "z": float(pt.get("z", 0.0)),
                    "visibility": float(pt.get("visibility", 1.0)),
                }
                for pt in curr_pose
            ]
        else:
            s_pose = [
                {
                    "x": alpha * float(c.get("x", 0.0)) + one_minus_a * p["x"],
                    "y": alpha * float(c.get("y", 0.0)) + one_minus_a * p["y"],
                    "z": alpha * float(c.get("z", 0.0)) + one_minus_a * p["z"],
                    "visibility": float(c.get("visibility", 1.0)),
                }
                for c, p in zip(curr_pose, prev_pose)
            ]
        prev_pose = s_pose

        def _smooth_hand(curr_h: Optional[list[dict]], prev_h: Optional[list[dict]]) -> Optional[list[dict]]:
            if curr_h is None:
                return None
            if prev_h is None or len(prev_h) != len(curr_h):
                return _clone_hand_pts(curr_h)
            return [
                {
                    "x": alpha * float(c.get("x", 0.0)) + one_minus_a * p["x"],
                    "y": alpha * float(c.get("y", 0.0)) + one_minus_a * p["y"],
                    "z": alpha * float(c.get("z", 0.0)) + one_minus_a * p["z"],
                }
                for c, p in zip(curr_h, prev_h)
            ]

        s_lh = _smooth_hand(fr.get("left_hand"), prev_lh)
        prev_lh = s_lh
        s_rh = _smooth_hand(fr.get("right_hand"), prev_rh)
        prev_rh = s_rh

        smoothed.append({
            "timestamp_ms": fr["timestamp_ms"],
            "pose": s_pose,
            "left_hand": s_lh,
            "right_hand": s_rh,
        })

    return smoothed


def _validate_window_timestamps(
    ts: np.ndarray,
    duration_ms: float = 1000.0,
) -> tuple[Optional[np.ndarray], Optional[str]]:
    """
    Validate strict v1.4.0 temporal gates on sorted timestamps `ts`:
      1. Raw gap <= 100.0 ms (absolute)
      2. Zero tail extrapolation (ts[-1] + 1e-6 >= taus[-1])
      3. Window density: unique nearest real frames >= 12/15
      4. Wide-bridge interpolation: <= 3/14 transitions over intervals > 1.25 * dt_nominal
    Returns `(taus, None)` on success or `(None, error_code)` on rejection.
    """
    n_frames = int(ts.shape[0])
    if n_frames == 0:
        return None, "ERR_POSE_MISSING"

    dt_nominal = float(duration_ms) / SEQUENCE_LENGTH

    # 1. Strict raw temporal gap gate (absolute <= 100.0 ms, never subtracts dt_nominal)
    if n_frames > 1:
        diffs = np.diff(ts)
        if float(np.max(diffs)) > MAX_GAP_MS:
            return None, "ERR_INVALID_FRAME_GAP_TOO_LARGE"

    t_start = float(ts[0])
    taus = t_start + np.arange(SEQUENCE_LENGTH, dtype=np.float64) * dt_nominal

    # 2. Tail extrapolation gate (zero tail cloning allowed)
    if float(ts[-1]) + TAIL_EXTRAPOLATION_TOL_MS < float(taus[-1]):
        return None, "ERR_WINDOW_TAIL_EXTRAPOLATION"

    # 3. Window density gate: unique_real_frames >= 12/15
    nearest_idx = np.argmin(np.abs(ts[None, :] - taus[:, None]), axis=1)
    if int(np.unique(nearest_idx).size) < MIN_UNIQUE_REAL_FRAMES:
        return None, "ERR_WINDOW_LOW_UNIQUE_FRAMES"

    # 4. Wide-bridge interpolation gate: <= 3/14 transitions over raw intervals > 1.25 * dt_nominal
    if n_frames > 1:
        midpoints = 0.5 * (taus[:-1] + taus[1:])
        seg_idx = np.clip(np.searchsorted(ts, midpoints, side="right") - 1, 0, n_frames - 2)
        seg_dt = ts[seg_idx + 1] - ts[seg_idx]
        bridge_count = int(np.sum(seg_dt > (1.25 * dt_nominal)))
        if bridge_count > MAX_BRIDGE_COUNT:
            return None, "ERR_WINDOW_HIGH_INTERPOLATION"

    return taus, None


def extract_window_arrays(
    ts: np.ndarray,
    pose_upper: np.ndarray,
    lh_coords: np.ndarray,
    lh_present: np.ndarray,
    rh_coords: np.ndarray,
    rh_present: np.ndarray,
    duration_ms: float = 1000.0,
    _prevalidated_taus: Optional[np.ndarray] = None,
) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Vectorized NumPy core of `extract_window` (FEATURE_SPEC v1.4.0).
    Inputs must already be sorted by timestamp `ts` with valid finite shoulders.
      - ts:         (M,) float64
      - pose_upper: (M, 13, 4) float64 matching POSE_UPPER_INDICES (pos 1=P11, pos 2=P12)
      - lh_coords:  (M, 21, 3) float64
      - lh_present: (M,) bool
      - rh_coords:  (M, 21, 3) float64
      - rh_present: (M,) bool
    """
    n_frames = int(ts.shape[0])
    if n_frames == 0:
        return None, False, "ERR_POSE_MISSING"

    if _prevalidated_taus is not None:
        taus = _prevalidated_taus
    else:
        taus, ts_err = _validate_window_timestamps(ts, duration_ms=duration_ms)
        if ts_err is not None or taus is None:
            return None, False, ts_err

    # 5. Vectorized block-wise linear resampling to 15 equidistant slots
    raw_hi = np.searchsorted(ts, taus, side="left")
    at_or_past_end = raw_hi >= n_frames
    idx_hi = np.clip(raw_hi, 0, n_frames - 1)
    idx_lo = np.clip(idx_hi - 1, 0, n_frames - 1)
    exact_hit = at_or_past_end | (ts[idx_hi] == taus) | (idx_hi == 0)
    idx_lo = np.where(exact_hit, idx_hi, idx_lo)

    t_prev = ts[idx_lo]
    t_next = ts[idx_hi]
    denom = t_next - t_prev
    tau = np.where(denom == 0.0, 0.0, np.clip((taus - t_prev) / np.where(denom == 0.0, 1.0, denom), 0.0, 1.0))
    one_minus_tau = 1.0 - tau

    p_res = one_minus_tau[:, None, None] * pose_upper[idx_lo] + tau[:, None, None] * pose_upper[idx_hi]

    def _resample_hand(coords: np.ndarray, present: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        pres_lo = present[idx_lo]
        pres_hi = present[idx_hi]
        both = pres_lo & pres_hi
        use_lo = (~both) & (tau < 0.5) & pres_lo
        use_hi = (~both) & (tau >= 0.5) & pres_hi
        out_pres = both | use_lo | use_hi
        out_c = np.zeros((SEQUENCE_LENGTH, HAND_LANDMARKS, HAND_COORDS), dtype=np.float64)
        if np.any(both):
            out_c[both] = (
                one_minus_tau[both, None, None] * coords[idx_lo[both]]
                + tau[both, None, None] * coords[idx_hi[both]]
            )
        if np.any(use_lo):
            out_c[use_lo] = coords[idx_lo[use_lo]]
        if np.any(use_hi):
            out_c[use_hi] = coords[idx_hi[use_hi]]
        return out_c, out_pres

    lh_res, lh_pres_res = _resample_hand(lh_coords, lh_present)
    rh_res, rh_pres_res = _resample_hand(rh_coords, rh_present)

    # 6. Median window scale D_2D_iso (4:3) and shoulder center C (pos 1=P11, pos 2=P12)
    p11_res = p_res[:, 1, :]
    p12_res = p_res[:, 2, :]
    d_per_frame = np.hypot((p11_res[:, 0] - p12_res[:, 0]) * ASPECT_RATIO, p11_res[:, 1] - p12_res[:, 1]) / ASPECT_RATIO
    d_ventana = float(np.median(d_per_frame))
    cx_ventana = float(np.median((p11_res[:, 0] + p12_res[:, 0]) * 0.5))
    cy_ventana = float(np.median((p11_res[:, 1] + p12_res[:, 1]) * 0.5))
    cz_ventana = float(np.median((p11_res[:, 2] + p12_res[:, 2]) * 0.5))

    if d_ventana < SHOULDERS_D_MIN:
        return None, False, "ERR_SHOULDERS_TOO_SMALL"

    # 7. Per-block temporal EMA smoothing (alpha = 0.50; reset independently on hand reappearance)
    a = EMA_ALPHA
    b = 1.0 - a
    p_smooth = p_res.copy()
    for k in range(1, SEQUENCE_LENGTH):
        p_smooth[k, :, :3] = a * p_res[k, :, :3] + b * p_smooth[k - 1, :, :3]

    lh_smooth = lh_res.copy()
    for k in range(1, SEQUENCE_LENGTH):
        if lh_pres_res[k] and lh_pres_res[k - 1]:
            lh_smooth[k] = a * lh_res[k] + b * lh_smooth[k - 1]

    rh_smooth = rh_res.copy()
    for k in range(1, SEQUENCE_LENGTH):
        if rh_pres_res[k] and rh_pres_res[k - 1]:
            rh_smooth[k] = a * rh_res[k] + b * rh_smooth[k - 1]

    # 8. Normalize and assemble (1, 15, 178) float32 tensor
    inv_d = 1.0 / d_ventana
    tensor_f64 = np.zeros((SEQUENCE_LENGTH, TOTAL_FEATURES), dtype=np.float64)

    # Upper Pose [0..51]
    tensor_f64[:, 0:52:4] = (p_smooth[:, :, 0] - cx_ventana) * inv_d
    tensor_f64[:, 1:52:4] = (p_smooth[:, :, 1] - cy_ventana) * inv_d
    pose_z_norm = (p_smooth[:, :, 2] - cz_ventana) * inv_d
    pose_z_norm[:, 0:5] = np.clip(pose_z_norm[:, 0:5], -POSE_Z_CLIP_ABS, POSE_Z_CLIP_ABS)
    pose_z_norm[:, 5:13] = 0.0  # P15..P22 fixed to 0.0
    tensor_f64[:, 2:52:4] = pose_z_norm
    tensor_f64[:, 3:52:4] = np.clip(p_smooth[:, :, 3], 0.0, 1.0)

    # Left Hand [52..114]
    if np.any(lh_pres_res):
        lh_norm = np.empty_like(lh_smooth[lh_pres_res])
        lh_active = lh_smooth[lh_pres_res]
        lh_norm[:, :, 0] = (lh_active[:, :, 0] - cx_ventana) * inv_d
        lh_norm[:, :, 1] = (lh_active[:, :, 1] - cy_ventana) * inv_d
        lh_norm[:, :, 2] = (lh_active[:, :, 2] - lh_active[:, 0:1, 2]) * inv_d
        tensor_f64[lh_pres_res, 52:115] = lh_norm.reshape(-1, HAND_FEATURES_COUNT)

    # Right Hand [115..177]
    if np.any(rh_pres_res):
        rh_norm = np.empty_like(rh_smooth[rh_pres_res])
        rh_active = rh_smooth[rh_pres_res]
        rh_norm[:, :, 0] = (rh_active[:, :, 0] - cx_ventana) * inv_d
        rh_norm[:, :, 1] = (rh_active[:, :, 1] - cy_ventana) * inv_d
        rh_norm[:, :, 2] = (rh_active[:, :, 2] - rh_active[:, 0:1, 2]) * inv_d
        tensor_f64[rh_pres_res, 115:178] = rh_norm.reshape(-1, HAND_FEATURES_COUNT)

    return tensor_f64.astype(np.float32).reshape(1, SEQUENCE_LENGTH, TOTAL_FEATURES), True, None


def extract_window(
    frames_with_timestamps: list[dict],
    target_fps: int = 15,
    duration_ms: float = 1000.0,
) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Execute the canonical block-based window extraction pipeline (FEATURE_SPEC v1.4.0).
    Zero `copy.deepcopy`; vectorized NumPy backend.
    """
    _ = target_fps  # Retained for API compatibility; grid uses SEQUENCE_LENGTH & duration_ms
    if not frames_with_timestamps:
        return None, False, "ERR_POSE_MISSING"

    # 1. Filter frames with valid finite shoulders inside [0, 1]
    valid_raw_frames: list[tuple[float, dict]] = []
    for fr in frames_with_timestamps:
        if not isinstance(fr, dict):
            continue
        pose = fr.get("pose")
        if pose is None or len(pose) < 23:
            continue
        ts_raw = fr.get("t_ms", fr.get("timestamp_ms", 0.0))
        if not _is_finite_num(ts_raw):
            return None, False, "ERR_NON_FINITE_LANDMARKS"

        p11 = pose[11]
        p12 = pose[12]
        if not (
            _is_finite_num(p11.get("x", 0.0))
            and _is_finite_num(p11.get("y", 0.0))
            and _is_finite_num(p11.get("z", 0.0))
            and _is_finite_num(p11.get("visibility", 1.0))
            and _is_finite_num(p12.get("x", 0.0))
            and _is_finite_num(p12.get("y", 0.0))
            and _is_finite_num(p12.get("z", 0.0))
            and _is_finite_num(p12.get("visibility", 1.0))
        ):
            return None, False, "ERR_NON_FINITE_LANDMARKS"

        vis11 = float(p11.get("visibility", 1.0))
        vis12 = float(p12.get("visibility", 1.0))
        if vis11 < SHOULDER_VIS_THRESH or vis12 < SHOULDER_VIS_THRESH:
            continue

        x11, y11 = float(p11.get("x", 0.0)), float(p11.get("y", 0.0))
        x12, y12 = float(p12.get("x", 0.0)), float(p12.get("y", 0.0))
        if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
            continue

        valid_raw_frames.append((float(ts_raw), fr))

    if not valid_raw_frames:
        return None, False, "ERR_POSE_MISSING"

    valid_raw_frames.sort(key=lambda pair: pair[0])
    m = len(valid_raw_frames)

    # Fast temporal gates BEFORE landmark packing/hand assignment (matches JS precedence & avoids wasted work)
    ts_arr = np.fromiter((pair[0] for pair in valid_raw_frames), dtype=np.float64, count=m)
    taus, ts_err = _validate_window_timestamps(ts_arr, duration_ms=duration_ms)
    if ts_err is not None or taus is None:
        return None, False, ts_err

    pose_upper = np.empty((m, len(POSE_UPPER_INDICES), POSE_COORDS), dtype=np.float64)
    lh_coords = np.zeros((m, HAND_LANDMARKS, HAND_COORDS), dtype=np.float64)
    lh_present = np.zeros(m, dtype=bool)
    rh_coords = np.zeros((m, HAND_LANDMARKS, HAND_COORDS), dtype=np.float64)
    rh_present = np.zeros(m, dtype=bool)

    # 2. Assign anatomical hand slots per raw frame with wrist memory TTL = 200 ms
    prev_left_w: Optional[tuple[float, float]] = None
    prev_left_t: float = -1e18
    prev_right_w: Optional[tuple[float, float]] = None
    prev_right_t: float = -1e18

    for fi, (t_curr, fr) in enumerate(valid_raw_frames):
        pose = fr["pose"]

        for ui, p_idx in enumerate(POSE_UPPER_INDICES):
            lm = pose[p_idx]
            rx = lm.get("x", 0.0)
            ry = lm.get("y", 0.0)
            rz = lm.get("z", 0.0)
            rv = lm.get("visibility", 1.0)
            if not (_is_finite_num(rx) and _is_finite_num(ry) and _is_finite_num(rz) and _is_finite_num(rv)):
                return None, False, "ERR_NON_FINITE_LANDMARKS"
            pose_upper[fi, ui, 0] = float(rx)
            pose_upper[fi, ui, 1] = float(ry)
            pose_upper[fi, ui, 2] = float(rz)
            pose_upper[fi, ui, 3] = float(rv)

        # Expire stale wrist memory after > WRIST_MEMORY_TTL_MS without detection
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
            n_l = min(HAND_LANDMARKS, len(assigned_l))
            for i in range(n_l):
                lm = assigned_l[i]
                rx, ry, rz = lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)
                if not (_is_finite_num(rx) and _is_finite_num(ry) and _is_finite_num(rz)):
                    return None, False, "ERR_NON_FINITE_LANDMARKS"
                lh_coords[fi, i, 0] = float(rx)
                lh_coords[fi, i, 1] = float(ry)
                lh_coords[fi, i, 2] = float(rz)
            prev_left_w = (float(lh_coords[fi, 0, 0]), float(lh_coords[fi, 0, 1]))
            prev_left_t = t_curr

        if assigned_r is not None:
            rh_present[fi] = True
            n_r = min(HAND_LANDMARKS, len(assigned_r))
            for i in range(n_r):
                lm = assigned_r[i]
                rx, ry, rz = lm.get("x", 0.0), lm.get("y", 0.0), lm.get("z", 0.0)
                if not (_is_finite_num(rx) and _is_finite_num(ry) and _is_finite_num(rz)):
                    return None, False, "ERR_NON_FINITE_LANDMARKS"
                rh_coords[fi, i, 0] = float(rx)
                rh_coords[fi, i, 1] = float(ry)
                rh_coords[fi, i, 2] = float(rz)
            prev_right_w = (float(rh_coords[fi, 0, 0]), float(rh_coords[fi, 0, 1]))
            prev_right_t = t_curr

    return extract_window_arrays(
        ts_arr,
        pose_upper,
        lh_coords,
        lh_present,
        rh_coords,
        rh_present,
        duration_ms=duration_ms,
        _prevalidated_taus=taus,
    )


def _flip_category_label(cat: Any) -> Any:
    if cat == "Left":
        return "Right"
    if cat == "Right":
        return "Left"
    return cat


def _mirror_landmark_list(lms: list[dict]) -> list[dict]:
    out = []
    for lm in lms:
        d = dict(lm)
        if "x" in d and _is_finite_num(d["x"]):
            d["x"] = 1.0 - float(d["x"])
        out.append(d)
    return out


def mirror_raw_frame(raw_frame: dict) -> dict:
    """
    Apply horizontal mirror transformation (x -> 1 - x, bilateral pose swap,
    hand label flip, leftHand <-> rightHand swap) to raw [0, 1] landmarks without mutating input.
    Supports array hands, object-wrapped `{landmarks, categoryName, score}` hands, and `leftHand`/`rightHand`.
    """
    mirrored = dict(raw_frame)

    pose = raw_frame.get("pose")
    if isinstance(pose, list):
        m_pose = _mirror_landmark_list(pose)
        for idx_l, idx_r in POSE_BILATERAL_PAIRS:
            if idx_l < len(m_pose) and idx_r < len(m_pose):
                m_pose[idx_l], m_pose[idx_r] = m_pose[idx_r], m_pose[idx_l]
        mirrored["pose"] = m_pose

    if "hands" in raw_frame and isinstance(raw_frame["hands"], list):
        m_hands = []
        for h in raw_frame["hands"]:
            if isinstance(h, dict) and isinstance(h.get("landmarks"), list):
                h_copy = dict(h)
                h_copy["landmarks"] = _mirror_landmark_list(h["landmarks"])
                if "categoryName" in h_copy:
                    h_copy["categoryName"] = _flip_category_label(h_copy["categoryName"])
                if "label" in h_copy:
                    h_copy["label"] = _flip_category_label(h_copy["label"])
                m_hands.append(h_copy)
            elif isinstance(h, list):
                m_hands.append(_mirror_landmark_list(h))
            else:
                m_hands.append(h)
        mirrored["hands"] = m_hands

    # Mirror and swap explicit leftHand <-> rightHand slots
    has_lh = "leftHand" in raw_frame
    has_rh = "rightHand" in raw_frame
    if has_lh or has_rh:
        orig_lh = raw_frame.get("leftHand")
        orig_rh = raw_frame.get("rightHand")
        new_rh = _mirror_landmark_list(orig_lh) if isinstance(orig_lh, list) else orig_lh
        new_lh = _mirror_landmark_list(orig_rh) if isinstance(orig_rh, list) else orig_rh
        if has_lh or new_lh is not None:
            mirrored["leftHand"] = new_lh
        if has_rh or new_rh is not None:
            mirrored["rightHand"] = new_rh

    handedness = raw_frame.get("handedness")
    if isinstance(handedness, list):
        m_handedness = []
        for h_item in handedness:
            if isinstance(h_item, list):
                sub = []
                for entry in h_item:
                    if isinstance(entry, dict):
                        e_copy = dict(entry)
                        if "categoryName" in e_copy:
                            e_copy["categoryName"] = _flip_category_label(e_copy["categoryName"])
                        if "label" in e_copy:
                            e_copy["label"] = _flip_category_label(e_copy["label"])
                        sub.append(e_copy)
                    else:
                        sub.append(_flip_category_label(entry) if isinstance(entry, str) else entry)
                m_handedness.append(sub)
            elif isinstance(h_item, dict):
                e_copy = dict(h_item)
                if "categoryName" in e_copy:
                    e_copy["categoryName"] = _flip_category_label(e_copy["categoryName"])
                if "label" in e_copy:
                    e_copy["label"] = _flip_category_label(e_copy["label"])
                m_handedness.append(e_copy)
            else:
                m_handedness.append(_flip_category_label(h_item) if isinstance(h_item, str) else h_item)
        mirrored["handedness"] = m_handedness

    return mirrored


def mirror_features_178(features: np.ndarray) -> np.ndarray:
    """Apply analytical mirror transformation to a normalized 178D feature vector."""
    out = features.copy().astype(np.float64)

    out[0] = -out[0]
    for idx_l, idx_r in UPPER_BILATERAL_INDEX_PAIRS:
        start_l = idx_l * 4
        start_r = idx_r * 4
        block_l = out[start_l:start_l + 4].copy()
        block_r = out[start_r:start_r + 4].copy()
        block_l[0] = -block_l[0]
        block_r[0] = -block_r[0]
        out[start_l:start_l + 4] = block_r
        out[start_r:start_r + 4] = block_l

    left_hand = out[52:115].copy()
    right_hand = out[115:178].copy()
    left_hand[0::3] = -left_hand[0::3]
    right_hand[0::3] = -right_hand[0::3]

    out[52:115] = right_hand
    out[115:178] = left_hand

    return out.astype(np.float32)
