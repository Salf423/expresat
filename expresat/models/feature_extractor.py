"""
feature_extractor.py — ExpresaT: Extractores Canónicos de Vectores 178D v1.2.2

Implementa estrictamente la especificación docs/dataset-generator/FEATURE_SPEC.md v1.2.2.
Topología por frame:
  - [0..51] Upper Pose (13 landmarks × 4 coords: x, y, z, visibility)
  - [52..114] Mano Izquierda (21 landmarks × 3 coords: x, y, z)
  - [115..177] Mano Derecha (21 landmarks × 3 coords: x, y, z)
Total: 178 features float32 por frame. Invariante de ventana: (1, 15, 178).

Secuencia estricta de ExtractWindow (Sección 5):
  1. Validar hombros crudos y brechas temporales (<= 100 ms)
  2. Asignar manos por frame crudo (costo conjunto + etiquetas + continuidad temporal)
  3. Remuestrear temporalmente por bloque a 15 frames equidistantes (Δt = 66.67 ms)
  4. Escala D y Centro C por ventana (mediana de 15 frames, D >= 0.08)
  5. Filtro EMA temporal por bloque (α = 0.50, reinicio por bloque independiente)
  6. Normalizar hombros y muñeca Z -> Tensor (1, 15, 178) float32
"""

from __future__ import annotations

import copy
import math
import statistics
from typing import Any, Optional

import numpy as np

# ---------------------------------------------------------------------------
# 1. Constantes canónicas v1.2.2
# ---------------------------------------------------------------------------

FEATURE_SPEC_VERSION: str = "1.2.2"
TOTAL_FEATURES: int = 178
SEQUENCE_LENGTH: int = 15

# Upper Pose indices (13 landmarks)
POSE_UPPER_INDICES: list[int] = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
POSE_COORDS: int = 4  # x, y, z, visibility
POSE_FEATURES_COUNT: int = len(POSE_UPPER_INDICES) * POSE_COORDS  # 52

# Hands
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

# Umbrales
SHOULDER_VIS_THRESH: float = 0.40
SHOULDERS_D_MIN: float = 0.08
HAND_DISCONNECTED_THRESH: float = 1.75
HAND_AMBIGUITY_THRESH: float = 0.15
POSE_WRIST_MIN_VIS: float = 0.50
MAX_GAP_MS: float = 100.0

# Pesos para asignación de manos
WEIGHT_LABEL_PENALTY: float = 0.30
WEIGHT_TEMPORAL_CONTINUITY: float = 0.20


# ---------------------------------------------------------------------------
# 2. Utilidades internas
# ---------------------------------------------------------------------------

def _get_category_label(h_item: Any) -> Optional[str]:
    """Extrae de forma tolerante el categoryName de MediaPipe."""
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
    Normaliza el frame de entrada para extraer una lista de manos detectadas
    y sus etiquetas categoryName correspondientes.
    """
    hands: list[list[dict]] = []
    labels: list[Optional[str]] = []

    if "hands" in raw_frame and isinstance(raw_frame["hands"], list):
        hands_raw = raw_frame["hands"]
        handedness_raw = raw_frame.get("handedness", [])
        for i, h in enumerate(hands_raw):
            if h and len(h) > 0:
                hands.append(h)
                lbl = None
                if i < len(handedness_raw):
                    lbl = _get_category_label(handedness_raw[i])
                labels.append(lbl)
        return hands, labels

    if "leftHand" in raw_frame and raw_frame["leftHand"]:
        hands.append(raw_frame["leftHand"])
        labels.append("Right")
    if "rightHand" in raw_frame and raw_frame["rightHand"]:
        hands.append(raw_frame["rightHand"])
        labels.append("Left")

    return hands, labels


def _hand_to_features(
    raw_hand: list[dict],
    D: float,
    Cx: float,
    Cy: float,
) -> np.ndarray:
    """Normaliza los 21 landmarks de una mano a un vector de 63 float64."""
    out = np.zeros(HAND_FEATURES_COUNT, dtype=np.float64)
    if not raw_hand:
        return out

    z_wrist = float(raw_hand[0].get("z", 0.0))
    for i in range(min(HAND_LANDMARKS, len(raw_hand))):
        lm = raw_hand[i]
        x = float(lm.get("x", 0.0))
        y = float(lm.get("y", 0.0))
        z = float(lm.get("z", 0.0))
        out[i * 3 + 0] = (x - Cx) / D
        out[i * 3 + 1] = (y - Cy) / D
        out[i * 3 + 2] = (z - z_wrist) / D

    return out


# ---------------------------------------------------------------------------
# 3. Asignación anatómica de manos con término de etiqueta y continuidad
# ---------------------------------------------------------------------------

def assign_hands_to_anatomical_slots(
    raw_frame: dict,
    pose: list[dict],
    D: float,
    prev_left_wrist: Optional[tuple[float, float]] = None,
    prev_right_wrist: Optional[tuple[float, float]] = None,
) -> tuple[Optional[list[dict]], Optional[list[dict]], bool]:
    """
    Asigna las manos detectadas en un frame a (assigned_left_hand, assigned_right_hand).
    Retorna (left_hand, right_hand, is_ambiguous).

    Reglas:
      1. Descarte por desconexión: min(d_left, d_right) > 1.75 * D SOLO si vis(P_wrist) >= 0.50.
      2. Si 2 manos: costo conjunto considerando distancias a P15/P16, penalización de etiqueta
         y continuidad temporal respecto al frame anterior.
      3. Ambigüedad: registrada cuando |costo_A - costo_B| < 0.15 * D (en 2 manos) o |d_left - d_right| < 0.15*D.
    """
    detected_hands, detected_labels = _get_detected_hands_and_labels(raw_frame)

    pw15_x = float(pose[15].get("x", 0.0))
    pw15_y = float(pose[15].get("y", 0.0))
    pw15_vis = float(pose[15].get("visibility", 1.0))

    pw16_x = float(pose[16].get("x", 0.0))
    pw16_y = float(pose[16].get("y", 0.0))
    pw16_vis = float(pose[16].get("visibility", 1.0))

    # Filtrar manos desconectadas respetando la visibilidad de la muñeca de pose
    valid_hands: list[tuple[list[dict], Optional[str], float, float]] = []
    for h, lbl in zip(detected_hands, detected_labels):
        hw_x = float(h[0].get("x", 0.0))
        hw_y = float(h[0].get("y", 0.0))
        d_left = math.hypot(hw_x - pw15_x, hw_y - pw15_y)
        d_right = math.hypot(hw_x - pw16_x, hw_y - pw16_y)

        # Determinar si la muñeca más cercana tiene visibilidad suficiente para descartar
        closer_wrist_vis = pw15_vis if d_left <= d_right else pw16_vis
        is_disconnected = (min(d_left, d_right) > HAND_DISCONNECTED_THRESH * D) and (closer_wrist_vis >= POSE_WRIST_MIN_VIS)

        if not is_disconnected:
            valid_hands.append((h, lbl, d_left, d_right))

    assigned_left: Optional[list[dict]] = None
    assigned_right: Optional[list[dict]] = None
    is_ambiguous: bool = False

    if len(valid_hands) >= 2:
        h0, lbl0, d0_l, d0_r = valid_hands[0]
        h1, lbl1, d1_l, d1_r = valid_hands[1]

        hw0_x, hw0_y = float(h0[0].get("x", 0.0)), float(h0[0].get("y", 0.0))
        hw1_x, hw1_y = float(h1[0].get("x", 0.0)), float(h1[0].get("y", 0.0))

        # Costo base espacial
        cost_A = d0_l + d1_r  # H0 -> Left, H1 -> Right
        cost_B = d1_l + d0_r  # H1 -> Left, H0 -> Right

        # Término de penalización por etiqueta MediaPipe:
        # MediaPipe 'Left' -> mano derecha del usuario
        # MediaPipe 'Right' -> mano izquierda del usuario
        penalty_A = 0.0
        penalty_B = 0.0

        if lbl0 == "Left":  # H0 prefiere slot derecho
            penalty_A += WEIGHT_LABEL_PENALTY * D
        elif lbl0 == "Right":  # H0 prefiere slot izquierdo
            penalty_B += WEIGHT_LABEL_PENALTY * D

        if lbl1 == "Left":  # H1 prefiere slot derecho
            penalty_B += WEIGHT_LABEL_PENALTY * D
        elif lbl1 == "Right":  # H1 prefiere slot izquierdo
            penalty_A += WEIGHT_LABEL_PENALTY * D

        # Término de continuidad temporal respecto al frame previo
        if prev_left_wrist is not None and prev_right_wrist is not None:
            c_temp_A = (
                math.hypot(hw0_x - prev_left_wrist[0], hw0_y - prev_left_wrist[1])
                + math.hypot(hw1_x - prev_right_wrist[0], hw1_y - prev_right_wrist[1])
            )
            c_temp_B = (
                math.hypot(hw1_x - prev_left_wrist[0], hw1_y - prev_left_wrist[1])
                + math.hypot(hw0_x - prev_right_wrist[0], hw0_y - prev_right_wrist[1])
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
        h0, lbl0, d0_l, d0_r = valid_hands[0]
        hw0_x, hw0_y = float(h0[0].get("x", 0.0)), float(h0[0].get("y", 0.0))

        ambiguity_cond = (
            abs(d0_l - d0_r) < HAND_AMBIGUITY_THRESH * D
            or pw15_vis < POSE_WRIST_MIN_VIS
            or pw16_vis < POSE_WRIST_MIN_VIS
        )
        if ambiguity_cond:
            is_ambiguous = True

        # Desempate por etiqueta o continuidad temporal
        if lbl0 in ("Left", "Right"):
            if lbl0 == "Left":
                assigned_right = h0
            else:
                assigned_left = h0
        elif prev_left_wrist is not None or prev_right_wrist is not None:
            # Evaluar cercanía a la última posición conocida
            dist_prev_l = math.hypot(hw0_x - prev_left_wrist[0], hw0_y - prev_left_wrist[1]) if prev_left_wrist else float("inf")
            dist_prev_r = math.hypot(hw0_x - prev_right_wrist[0], hw0_y - prev_right_wrist[1]) if prev_right_wrist else float("inf")
            if dist_prev_l <= dist_prev_r:
                assigned_left = h0
            else:
                assigned_right = h0
        else:
            if d0_l <= d0_r:
                assigned_left = h0
            else:
                assigned_right = h0

    return assigned_left, assigned_right, is_ambiguous


# ---------------------------------------------------------------------------
# 4. Función canónica: extract_frame_features (1 frame individual)
# ---------------------------------------------------------------------------

def extract_frame_features(raw_frame: dict) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Extrae y normaliza un frame individual a 178 características float32
    siguiendo estrictamente docs/dataset-generator/FEATURE_SPEC.md v1.2.2.
    """
    pose = raw_frame.get("pose")
    if pose is None or len(pose) < 23:
        return None, False, "ERR_POSE_MISSING"

    p11 = pose[11]
    p12 = pose[12]
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
    cx = (x11 + x12) / 2.0
    cy = (y11 + y12) / 2.0
    cz = (z11 + z12) / 2.0

    dx = x11 - x12
    dy = y11 - y12
    dz = z11 - z12
    D = math.sqrt(dx * dx + dy * dy + dz * dz)

    if D < SHOULDERS_D_MIN:
        return None, False, "ERR_SHOULDERS_TOO_SMALL"

    features = np.zeros(TOTAL_FEATURES, dtype=np.float64)

    # Upper Pose [0..51] (13 landmarks x 4)
    for i, p_idx in enumerate(POSE_UPPER_INDICES):
        lm = pose[p_idx]
        px = float(lm.get("x", 0.0))
        py = float(lm.get("y", 0.0))
        pz = float(lm.get("z", 0.0))
        pvis = float(lm.get("visibility", 1.0))

        features[i * 4 + 0] = (px - cx) / D
        features[i * 4 + 1] = (py - cy) / D
        features[i * 4 + 2] = (pz - cz) / D
        features[i * 4 + 3] = max(0.0, min(1.0, pvis))

    # Asignación de manos anatómicas
    assigned_left, assigned_right, _ = assign_hands_to_anatomical_slots(raw_frame, pose, D)

    if assigned_left is not None:
        features[52:115] = _hand_to_features(assigned_left, D, cx, cy)
    else:
        features[52:115] = 0.0

    if assigned_right is not None:
        features[115:178] = _hand_to_features(assigned_right, D, cx, cy)
    else:
        features[115:178] = 0.0

    return features.astype(np.float32), True, None


# ---------------------------------------------------------------------------
# 5. Función de ventana: extract_window (Orden canónico por bloques v1.2.2)
# ---------------------------------------------------------------------------

def extract_window(
    frames_with_timestamps: list[dict],
    target_fps: int = 15,
    duration_ms: float = 1000.0,
) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Implementa la secuencia estricta por bloques de ExtractWindow v1.2.2:
      1. Validar hombros crudos y brechas continuas (gap <= 100 ms)
      2. Asignar manos por frame crudo -> raw_left_hand y raw_right_hand por separado
      3. Remuestrear temporalmente por bloque anatómico a 15 frames (Δt = 66.67 ms)
      4. Calcular D_ventana y C_ventana (mediana de 15 frames, D >= 0.08)
      5. Filtro EMA temporal por bloque (α = 0.50, reinicio al reaparecer cada mano)
      6. Normalizar y ensamblar tensor (1, 15, 178) float32
    """
    if not frames_with_timestamps:
        return None, False, "ERR_POSE_MISSING"

    dt_nominal = duration_ms / SEQUENCE_LENGTH

    # --- Paso 1: Validar hombros crudos y filtrar frames válidos ---
    valid_raw_frames: list[dict] = []
    for fr in frames_with_timestamps:
        if fr is None:
            continue
        pose = fr.get("pose")
        if pose is None or len(pose) < 23:
            continue
        p11 = pose[11]
        p12 = pose[12]
        vis11 = float(p11.get("visibility", 1.0))
        vis12 = float(p12.get("visibility", 1.0))
        if vis11 < SHOULDER_VIS_THRESH or vis12 < SHOULDER_VIS_THRESH:
            continue
        x11, y11 = float(p11.get("x", 0.0)), float(p11.get("y", 0.0))
        x12, y12 = float(p12.get("x", 0.0)), float(p12.get("y", 0.0))
        if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
            continue
        valid_raw_frames.append(fr)

    if not valid_raw_frames:
        return None, False, "ERR_POSE_MISSING"

    valid_raw_frames.sort(key=lambda f: float(f.get("timestamp_ms", 0.0)))

    # Validación de brechas temporales (gap <= 100 ms)
    for i in range(len(valid_raw_frames) - 1):
        t_curr = float(valid_raw_frames[i].get("timestamp_ms", 0.0))
        t_next = float(valid_raw_frames[i + 1].get("timestamp_ms", 0.0))
        gap = (t_next - t_curr) - dt_nominal
        if gap > MAX_GAP_MS:
            return None, False, "ERR_INVALID_FRAME_GAP_TOO_LARGE"

    # --- Paso 2: Asignar manos por frame crudo (bloques anatómicos desacoplados) ---
    frames_with_assigned_blocks: list[dict] = []
    prev_left_w: Optional[tuple[float, float]] = None
    prev_right_w: Optional[tuple[float, float]] = None

    for fr in valid_raw_frames:
        pose = fr["pose"]
        p11 = pose[11]
        p12 = pose[12]
        dx = float(p11.get("x", 0.0)) - float(p12.get("x", 0.0))
        dy = float(p11.get("y", 0.0)) - float(p12.get("y", 0.0))
        dz = float(p11.get("z", 0.0)) - float(p12.get("z", 0.0))
        d_frame = math.sqrt(dx * dx + dy * dy + dz * dz)

        assigned_l, assigned_r, _ = assign_hands_to_anatomical_slots(
            fr, pose, d_frame, prev_left_w, prev_right_w
        )

        if assigned_l is not None:
            prev_left_w = (float(assigned_l[0].get("x", 0.0)), float(assigned_l[0].get("y", 0.0)))
        if assigned_r is not None:
            prev_right_w = (float(assigned_r[0].get("x", 0.0)), float(assigned_r[0].get("y", 0.0)))

        frames_with_assigned_blocks.append({
            "pose": copy.deepcopy(pose),
            "left_hand": copy.deepcopy(assigned_l),
            "right_hand": copy.deepcopy(assigned_r),
            "timestamp_ms": float(fr.get("timestamp_ms", 0.0)),
        })

    t_start = frames_with_assigned_blocks[0]["timestamp_ms"]

    # --- Paso 3: Remuestreo temporal por bloque a SEQUENCE_LENGTH frames ---
    resampled_blocks: list[dict] = []

    for k in range(SEQUENCE_LENGTH):
        t_target = t_start + k * dt_nominal

        prev_f = frames_with_assigned_blocks[0]
        next_f = frames_with_assigned_blocks[-1]

        for f in frames_with_assigned_blocks:
            ts = f["timestamp_ms"]
            if ts <= t_target:
                prev_f = f
            if ts >= t_target:
                next_f = f
                break

        t_prev = prev_f["timestamp_ms"]
        t_next = next_f["timestamp_ms"]
        tau = 0.0 if t_prev == t_next else max(0.0, min(1.0, (t_target - t_prev) / (t_next - t_prev)))

        # Interpolar Pose linealmente
        interp_pose: list[dict] = []
        for p_i in range(min(len(prev_f["pose"]), len(next_f["pose"]))):
            lp = prev_f["pose"][p_i]
            ln = next_f["pose"][p_i]
            interp_pose.append({
                "x": (1.0 - tau) * float(lp.get("x", 0.0)) + tau * float(ln.get("x", 0.0)),
                "y": (1.0 - tau) * float(lp.get("y", 0.0)) + tau * float(ln.get("y", 0.0)),
                "z": (1.0 - tau) * float(lp.get("z", 0.0)) + tau * float(ln.get("z", 0.0)),
                "visibility": (1.0 - tau) * float(lp.get("visibility", 1.0)) + tau * float(ln.get("visibility", 1.0)),
            })

        # Interpolar Bloque Mano Izquierda
        lh_p = prev_f["left_hand"]
        lh_n = next_f["left_hand"]
        interp_left_hand: Optional[list[dict]] = None
        if lh_p is not None and lh_n is not None:
            interp_left_hand = []
            for pt_i in range(min(len(lh_p), len(lh_n))):
                interp_left_hand.append({
                    "x": (1.0 - tau) * float(lh_p[pt_i].get("x", 0.0)) + tau * float(lh_n[pt_i].get("x", 0.0)),
                    "y": (1.0 - tau) * float(lh_p[pt_i].get("y", 0.0)) + tau * float(lh_n[pt_i].get("y", 0.0)),
                    "z": (1.0 - tau) * float(lh_p[pt_i].get("z", 0.0)) + tau * float(lh_n[pt_i].get("z", 0.0)),
                })
        elif tau < 0.5 and lh_p is not None:
            interp_left_hand = copy.deepcopy(lh_p)
        elif tau >= 0.5 and lh_n is not None:
            interp_left_hand = copy.deepcopy(lh_n)

        # Interpolar Bloque Mano Derecha
        rh_p = prev_f["right_hand"]
        rh_n = next_f["right_hand"]
        interp_right_hand: Optional[list[dict]] = None
        if rh_p is not None and rh_n is not None:
            interp_right_hand = []
            for pt_i in range(min(len(rh_p), len(rh_n))):
                interp_right_hand.append({
                    "x": (1.0 - tau) * float(rh_p[pt_i].get("x", 0.0)) + tau * float(rh_n[pt_i].get("x", 0.0)),
                    "y": (1.0 - tau) * float(rh_p[pt_i].get("y", 0.0)) + tau * float(rh_n[pt_i].get("y", 0.0)),
                    "z": (1.0 - tau) * float(rh_p[pt_i].get("z", 0.0)) + tau * float(rh_n[pt_i].get("z", 0.0)),
                })
        elif tau < 0.5 and rh_p is not None:
            interp_right_hand = copy.deepcopy(rh_p)
        elif tau >= 0.5 and rh_n is not None:
            interp_right_hand = copy.deepcopy(rh_n)

        resampled_blocks.append({
            "pose": interp_pose,
            "left_hand": interp_left_hand,
            "right_hand": interp_right_hand,
            "timestamp_ms": t_target,
        })

    # --- Paso 4: Escala D y Centro C por ventana (Mediana) ---
    D_per_frame: list[float] = []
    Cx_per_frame: list[float] = []
    Cy_per_frame: list[float] = []
    Cz_per_frame: list[float] = []

    for fr in resampled_blocks:
        p11 = fr["pose"][11]
        p12 = fr["pose"][12]
        x11, y11, z11 = float(p11.get("x", 0.0)), float(p11.get("y", 0.0)), float(p11.get("z", 0.0))
        x12, y12, z12 = float(p12.get("x", 0.0)), float(p12.get("y", 0.0)), float(p12.get("z", 0.0))
        dx, dy, dz = x11 - x12, y11 - y12, z11 - z12
        D_per_frame.append(math.sqrt(dx * dx + dy * dy + dz * dz))
        Cx_per_frame.append((x11 + x12) / 2.0)
        Cy_per_frame.append((y11 + y12) / 2.0)
        Cz_per_frame.append((z11 + z12) / 2.0)

    D_ventana = float(statistics.median(D_per_frame))
    Cx_ventana = float(statistics.median(Cx_per_frame))
    Cy_ventana = float(statistics.median(Cy_per_frame))
    Cz_ventana = float(statistics.median(Cz_per_frame))

    if D_ventana < SHOULDERS_D_MIN:
        return None, False, "ERR_SHOULDERS_TOO_SMALL"

    # --- Paso 5: Filtro EMA temporal por bloque (α = 0.50) ---
    alpha = 0.50
    smoothed_blocks: list[dict] = []
    prev_pose: Optional[list[dict]] = None
    prev_left_h: Optional[list[dict]] = None
    prev_right_h: Optional[list[dict]] = None

    for k, fr in enumerate(resampled_blocks):
        # 1. Pose
        curr_pose = fr["pose"]
        smooth_pose: list[dict] = []
        if k == 0 or prev_pose is None:
            smooth_pose = copy.deepcopy(curr_pose)
        else:
            for pt_idx in range(len(curr_pose)):
                c_pt = curr_pose[pt_idx]
                p_pt = prev_pose[pt_idx]
                smooth_pose.append({
                    "x": alpha * float(c_pt.get("x", 0.0)) + (1.0 - alpha) * float(p_pt.get("x", 0.0)),
                    "y": alpha * float(c_pt.get("y", 0.0)) + (1.0 - alpha) * float(p_pt.get("y", 0.0)),
                    "z": alpha * float(c_pt.get("z", 0.0)) + (1.0 - alpha) * float(p_pt.get("z", 0.0)),
                    "visibility": float(c_pt.get("visibility", 1.0)),
                })
        prev_pose = smooth_pose

        # 2. Bloque Mano Izquierda
        curr_lh = fr["left_hand"]
        smooth_lh: Optional[list[dict]] = None
        if curr_lh is not None:
            if prev_left_h is None or len(prev_left_h) != len(curr_lh):
                smooth_lh = copy.deepcopy(curr_lh)  # Reinicio al reaparecer
            else:
                smooth_lh = []
                for pt_idx in range(len(curr_lh)):
                    smooth_lh.append({
                        "x": alpha * float(curr_lh[pt_idx].get("x", 0.0)) + (1.0 - alpha) * float(prev_left_h[pt_idx].get("x", 0.0)),
                        "y": alpha * float(curr_lh[pt_idx].get("y", 0.0)) + (1.0 - alpha) * float(prev_left_h[pt_idx].get("y", 0.0)),
                        "z": alpha * float(curr_lh[pt_idx].get("z", 0.0)) + (1.0 - alpha) * float(prev_left_h[pt_idx].get("z", 0.0)),
                    })
        prev_left_h = smooth_lh

        # 3. Bloque Mano Derecha
        curr_rh = fr["right_hand"]
        smooth_rh: Optional[list[dict]] = None
        if curr_rh is not None:
            if prev_right_h is None or len(prev_right_h) != len(curr_rh):
                smooth_rh = copy.deepcopy(curr_rh)  # Reinicio al reaparecer
            else:
                smooth_rh = []
                for pt_idx in range(len(curr_rh)):
                    smooth_rh.append({
                        "x": alpha * float(curr_rh[pt_idx].get("x", 0.0)) + (1.0 - alpha) * float(prev_right_h[pt_idx].get("x", 0.0)),
                        "y": alpha * float(curr_rh[pt_idx].get("y", 0.0)) + (1.0 - alpha) * float(prev_right_h[pt_idx].get("y", 0.0)),
                        "z": alpha * float(curr_rh[pt_idx].get("z", 0.0)) + (1.0 - alpha) * float(prev_right_h[pt_idx].get("z", 0.0)),
                    })
        prev_right_h = smooth_rh

        smoothed_blocks.append({
            "pose": smooth_pose,
            "left_hand": smooth_lh,
            "right_hand": smooth_rh,
            "timestamp_ms": fr["timestamp_ms"],
        })

    # --- Paso 6: Normalización y Ensamble del Tensor (1, 15, 178) ---
    tensor_data = np.zeros((SEQUENCE_LENGTH, TOTAL_FEATURES), dtype=np.float64)

    for k, fr in enumerate(smoothed_blocks):
        pose = fr["pose"]

        # Upper pose [0..51]
        for i, p_idx in enumerate(POSE_UPPER_INDICES):
            lm = pose[p_idx]
            tensor_data[k, i * 4 + 0] = (float(lm.get("x", 0.0)) - Cx_ventana) / D_ventana
            tensor_data[k, i * 4 + 1] = (float(lm.get("y", 0.0)) - Cy_ventana) / D_ventana
            tensor_data[k, i * 4 + 2] = (float(lm.get("z", 0.0)) - Cz_ventana) / D_ventana
            tensor_data[k, i * 4 + 3] = max(0.0, min(1.0, float(lm.get("visibility", 1.0))))

        # Mano Izquierda [52..114]
        if fr["left_hand"] is not None:
            tensor_data[k, 52:115] = _hand_to_features(fr["left_hand"], D_ventana, Cx_ventana, Cy_ventana)
        else:
            tensor_data[k, 52:115] = 0.0

        # Mano Derecha [115..177]
        if fr["right_hand"] is not None:
            tensor_data[k, 115:178] = _hand_to_features(fr["right_hand"], D_ventana, Cx_ventana, Cy_ventana)
        else:
            tensor_data[k, 115:178] = 0.0

    result_tensor = tensor_data.astype(np.float32).reshape(1, SEQUENCE_LENGTH, TOTAL_FEATURES)
    return result_tensor, True, None


# ---------------------------------------------------------------------------
# 6. Funciones de simetría y espejo
# ---------------------------------------------------------------------------

def mirror_raw_frame(raw_frame: dict) -> dict:
    """Aplica la transformación de espejo sobre landmarks crudos (en espacio [0, 1])."""
    mirrored = copy.deepcopy(raw_frame)

    # 1. Pose
    pose = mirrored.get("pose")
    if pose:
        for lm in pose:
            if "x" in lm:
                lm["x"] = 1.0 - float(lm["x"])

        for idx_l, idx_r in POSE_BILATERAL_PAIRS:
            if idx_l < len(pose) and idx_r < len(pose):
                temp = pose[idx_l]
                pose[idx_l] = pose[idx_r]
                pose[idx_r] = temp

    # 2. Manos
    if "hands" in mirrored and isinstance(mirrored["hands"], list):
        for h in mirrored["hands"]:
            if h:
                for lm in h:
                    if "x" in lm:
                        lm["x"] = 1.0 - float(lm["x"])
    for k in ("leftHand", "rightHand"):
        if k in mirrored and mirrored[k]:
            for lm in mirrored[k]:
                if "x" in lm:
                    lm["x"] = 1.0 - float(lm["x"])

    # 3. Handedness
    handedness = mirrored.get("handedness")
    if handedness and isinstance(handedness, list):
        for h_item in handedness:
            if isinstance(h_item, list):
                for entry in h_item:
                    if isinstance(entry, dict) and "categoryName" in entry:
                        cat = entry["categoryName"]
                        entry["categoryName"] = "Right" if cat == "Left" else ("Left" if cat == "Right" else cat)
            elif isinstance(h_item, dict) and "categoryName" in h_item:
                cat = h_item["categoryName"]
                h_item["categoryName"] = "Right" if cat == "Left" else ("Left" if cat == "Right" else cat)

    return mirrored


def mirror_features_178(features: np.ndarray) -> np.ndarray:
    """Aplica la transformación de espejo analítica sobre el vector de 178 features."""
    out = features.copy().astype(np.float64)

    # Upper Pose
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

    # Manos
    left_hand = out[52:115].copy()
    right_hand = out[115:178].copy()
    for i in range(HAND_LANDMARKS):
        left_hand[i * 3 + 0] = -left_hand[i * 3 + 0]
        right_hand[i * 3 + 0] = -right_hand[i * 3 + 0]

    out[52:115] = right_hand
    out[115:178] = left_hand

    return out.astype(np.float32)
