"""
feature_extractor.py — ExpresaT: Extractores Canónicos de Vectores 178D v1.2.1

Implementa estrictamente la especificación docs/dataset-generator/FEATURE_SPEC.md v1.2.1.
Topología por frame:
  - [0..51] Upper Pose (13 landmarks × 4 coords: x, y, z, visibility)
  - [52..114] Mano Izquierda (21 landmarks × 3 coords: x, y, z)
  - [115..177] Mano Derecha (21 landmarks × 3 coords: x, y, z)
Total: 178 features float32 por frame. Invariante de ventana: (1, 15, 178).

Constantes canónicas:
  - FEATURE_SPEC_VERSION = '1.2.1'
  - TOTAL_FEATURES = 178
  - POSE_UPPER_INDICES = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
  - SEQUENCE_LENGTH = 15
  - SHOULDER_VIS_THRESH = 0.40
  - SHOULDERS_D_MIN = 0.08
  - HAND_DISCONNECTED_THRESH = 1.75
  - HAND_AMBIGUITY_THRESH = 0.15
  - MAX_GAP_MS = 100.0
"""

from __future__ import annotations

import copy
import math
import statistics
from typing import Any, Optional, Union

import numpy as np

# ---------------------------------------------------------------------------
# 1. Constantes canónicas
# ---------------------------------------------------------------------------

FEATURE_SPEC_VERSION: str = "1.2.1"
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

# Landmark pairing for mirroring bilateral pose points
# MediaPipe Pose bilateral pairs: (11,12), (13,14), (15,16), (17,18), (19,20), (21,22)
POSE_BILATERAL_PAIRS: list[tuple[int, int]] = [
    (11, 12),  # Shoulders
    (13, 14),  # Elbows
    (15, 16),  # Wrists
    (17, 18),  # Pinkies
    (19, 20),  # Indexes
    (21, 22),  # Thumbs
]

# Indices in POSE_UPPER_INDICES (0-based positions in the 13-landmark list):
# 0 -> 0 (Nose)
# 1 -> 11, 2 -> 12
# 3 -> 13, 4 -> 14
# 5 -> 15, 6 -> 16
# 7 -> 17, 8 -> 18
# 9 -> 19, 10 -> 20
# 11 -> 21, 12 -> 22
UPPER_BILATERAL_INDEX_PAIRS: list[tuple[int, int]] = [
    (1, 2),
    (3, 4),
    (5, 6),
    (7, 8),
    (9, 10),
    (11, 12),
]

# Umbrales provisionales (Sección 8 del spec)
SHOULDER_VIS_THRESH: float = 0.40
SHOULDERS_D_MIN: float = 0.08
HAND_DISCONNECTED_THRESH: float = 1.75
HAND_AMBIGUITY_THRESH: float = 0.15
MAX_GAP_MS: float = 100.0


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
    Soporta formato con 'hands' + 'handedness' o claves legacy 'leftHand' / 'rightHand'.
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

    # Fallback a claves separadas leftHand / rightHand
    # NOTA: En la convención de MediaPipe no espejada:
    # La mano derecha del usuario (visible en la izquierda) recibe categoryName 'Left'.
    # La mano izquierda del usuario (visible en la derecha) recibe categoryName 'Right'.
    if "leftHand" in raw_frame and raw_frame["leftHand"]:
        hands.append(raw_frame["leftHand"])
        labels.append("Right")  # Left hand of signer corresponds to MediaPipe 'Right'
    if "rightHand" in raw_frame and raw_frame["rightHand"]:
        hands.append(raw_frame["rightHand"])
        labels.append("Left")   # Right hand of signer corresponds to MediaPipe 'Left'

    return hands, labels


def _hand_to_features(
    raw_hand: list[dict],
    D: float,
    Cx: float,
    Cy: float,
) -> np.ndarray:
    """
    Normaliza los 21 landmarks de una mano a un vector de 63 float64:
      x' = (x - Cx) / D
      y' = (y - Cy) / D
      z' = (z - z_wrist) / D  (donde z_wrist = z del landmark 0)
    """
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
# 3. Función canónica: extract_frame_features (1 frame individual)
# ---------------------------------------------------------------------------

def extract_frame_features(raw_frame: dict) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Extrae y normaliza un frame individual a 178 características float32
    siguiendo estrictamente docs/dataset-generator/FEATURE_SPEC.md v1.2.1.

    Validaciones:
      1. pose == None o len(pose) < 23 -> ERR_POSE_MISSING
      2. vis(P11) < 0.40 o vis(P12) < 0.40 -> ERR_SHOULDER_VISIBILITY
      3. Hombros fuera de cuadro [0,1] -> ERR_OUT_OF_BOUNDS
      4. Distancia inter-humeral 3D D < 0.08 -> ERR_SHOULDERS_TOO_SMALL

    Normalización:
      - Upper Pose [0..51]: x'=(x-Cx)/D, y'=(y-Cy)/D, z'=(z-Cz)/D, vis'=clamp(vis, 0, 1)
      - Manos [52..114] y [115..177]:
        - Descarte si min(d_left, d_right) > 1.75 * D
        - Asignación conjunta de costo mínimo a muñecas de pose P15 / P16
        - Desempate por categoryName no espejado si |d_left - d_right| < 0.15*D o vis(muñeca) < 0.50
        - x'=(x-Cx)/D, y'=(y-Cy)/D, z'=(z-z_wrist)/D
        - Mano ausente: 63 ceros exactos (0.0f)
    """
    # 1. Validación de Pose
    pose = raw_frame.get("pose")
    if pose is None or len(pose) < 23:
        return None, False, "ERR_POSE_MISSING"

    # 2. Validación de visibilidad de hombros
    p11 = pose[11]
    p12 = pose[12]
    vis_11 = float(p11.get("visibility", 1.0))
    vis_12 = float(p12.get("visibility", 1.0))
    if vis_11 < SHOULDER_VIS_THRESH or vis_12 < SHOULDER_VIS_THRESH:
        return None, False, "ERR_SHOULDER_VISIBILITY"

    # 3. Validación out-of-bounds (hombros en [0.0, 1.0])
    x11 = float(p11.get("x", 0.0))
    y11 = float(p11.get("y", 0.0))
    x12 = float(p12.get("x", 0.0))
    y12 = float(p12.get("y", 0.0))
    if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
        return None, False, "ERR_OUT_OF_BOUNDS"

    # 4. Centro y distancia inter-humeral 3D
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

    # Construcción en float64
    features = np.zeros(TOTAL_FEATURES, dtype=np.float64)

    # 5. Upper Pose [0..51] (13 landmarks x 4)
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

    # 6. Extracción y asignación anatómica de manos
    detected_hands, detected_labels = _get_detected_hands_and_labels(raw_frame)

    # Muñecas de pose en espacio crudo 2D (P15 = izquierda, P16 = derecha)
    pw15_x = float(pose[15].get("x", 0.0))
    pw15_y = float(pose[15].get("y", 0.0))
    pw15_vis = float(pose[15].get("visibility", 1.0))

    pw16_x = float(pose[16].get("x", 0.0))
    pw16_y = float(pose[16].get("y", 0.0))
    pw16_vis = float(pose[16].get("visibility", 1.0))

    # Filtrar manos desconectadas (min(d_left, d_right) > 1.75 * D)
    valid_hands: list[tuple[list[dict], Optional[str], float, float]] = []
    for h, lbl in zip(detected_hands, detected_labels):
        hw_x = float(h[0].get("x", 0.0))
        hw_y = float(h[0].get("y", 0.0))
        d_left = math.hypot(hw_x - pw15_x, hw_y - pw15_y)
        d_right = math.hypot(hw_x - pw16_x, hw_y - pw16_y)

        if min(d_left, d_right) <= HAND_DISCONNECTED_THRESH * D:
            valid_hands.append((h, lbl, d_left, d_right))
        # Si está desconectada se descarta silenciosamente (la ranura quedará en 0.0f)

    # Variables para asignación final
    assigned_left_hand: Optional[list[dict]] = None
    assigned_right_hand: Optional[list[dict]] = None

    if len(valid_hands) >= 2:
        # Tomar las dos primeras manos válidas
        h0, lbl0, d0_left, d0_right = valid_hands[0]
        h1, lbl1, d1_left, d1_right = valid_hands[1]

        cost_A = d0_left + d1_right  # H0 -> Left, H1 -> Right
        cost_B = d1_left + d0_right  # H1 -> Left, H0 -> Right

        # Si el costo es muy cercano (|cost_A - cost_B| < 0.15*D) y hay etiquetas MediaPipe:
        if abs(cost_A - cost_B) < HAND_AMBIGUITY_THRESH * D and (lbl0 or lbl1):
            # MediaPipe 'Left' -> Mano Derecha del firmante
            # MediaPipe 'Right' -> Mano Izquierda del firmante
            if lbl0 == "Left" or lbl1 == "Right":
                # H0 a la derecha, H1 a la izquierda
                assigned_left_hand = h1
                assigned_right_hand = h0
            else:
                assigned_left_hand = h0
                assigned_right_hand = h1
        elif cost_A <= cost_B:
            assigned_left_hand = h0
            assigned_right_hand = h1
        else:
            assigned_left_hand = h1
            assigned_right_hand = h0

    elif len(valid_hands) == 1:
        h0, lbl0, d0_left, d0_right = valid_hands[0]

        # Criterio de ambigüedad para 1 mano (Sección 6.2 #4):
        # |d_left - d_right| < 0.15 * D  Ó  vis(P15) < 0.50  Ó  vis(P16) < 0.50
        is_ambiguous = (
            abs(d0_left - d0_right) < HAND_AMBIGUITY_THRESH * D
            or pw15_vis < 0.50
            or pw16_vis < 0.50
        )

        if is_ambiguous and lbl0 in ("Left", "Right"):
            if lbl0 == "Left":
                # MediaPipe 'Left' -> Mano Derecha del firmante
                assigned_right_hand = h0
            else:
                # MediaPipe 'Right' -> Mano Izquierda del firmante
                assigned_left_hand = h0
        else:
            if d0_left < d0_right:
                assigned_left_hand = h0
            else:
                assigned_right_hand = h0

    # Normalizar mano izquierda asignada (o 63 ceros)
    if assigned_left_hand is not None:
        features[52:115] = _hand_to_features(assigned_left_hand, D, cx, cy)
    else:
        features[52:115] = 0.0

    # Normalizar mano derecha asignada (o 63 ceros)
    if assigned_right_hand is not None:
        features[115:178] = _hand_to_features(assigned_right_hand, D, cx, cy)
    else:
        features[115:178] = 0.0

    return features.astype(np.float32), True, None


# ---------------------------------------------------------------------------
# 4. Función de ventana: extract_window (Secuencia canónica Sección 5)
# ---------------------------------------------------------------------------

def extract_window(
    frames_with_timestamps: list[dict],
    target_fps: int = 15,
    duration_ms: float = 1000.0,
) -> tuple[Optional[np.ndarray], bool, Optional[str]]:
    """
    Implementa la secuencia estricta e inmutable de ExtractWindow (Sección 5 del spec):
      1. Validación previa de hombros crudos (P11 y P12 presentes, vis >= 0.40, en [0,1])
      2. Validación de brecha temporal (Brecha > 100 ms -> ERR_INVALID_FRAME_GAP_TOO_LARGE)
      3. Remuestreo temporal por milisegundos a 15 frames equidistantes (Δt = 66.67 ms)
         - Manos: interpolar si presente en ambos extremos; frame más cercano si en uno solo; si no, ausente.
      4. Cálculo de Escala y Centro por Ventana:
         - D_ventana = mediana(D_1..D_15), C_ventana = mediana(C_1..C_15)
         - Si D_ventana < 0.08 -> ERR_SHOULDERS_TOO_SMALL
      5. Filtro EMA (α = 0.50):
         - Reinicio al inicio de la ventana y reinicio de mano cuando reaparece.
      6. Asignación Anatómica de Manos (costo mínimo a P15/P16 usando D_ventana)
      7. Normalización con C_ventana y D_ventana -> Tensor (1, 15, 178) float32.
    """
    if not frames_with_timestamps:
        return None, False, "ERR_POSE_MISSING"

    dt_nominal = duration_ms / SEQUENCE_LENGTH  # 1000 / 15 = 66.6666... ms

    # --- 1. Filtrar y validar frames con hombros válidos ---
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
        x11 = float(p11.get("x", 0.0))
        y11 = float(p11.get("y", 0.0))
        x12 = float(p12.get("x", 0.0))
        y12 = float(p12.get("y", 0.0))
        if not (0.0 <= x11 <= 1.0 and 0.0 <= y11 <= 1.0 and 0.0 <= x12 <= 1.0 and 0.0 <= y12 <= 1.0):
            continue
        valid_raw_frames.append(fr)

    if not valid_raw_frames:
        return None, False, "ERR_POSE_MISSING"

    # Ordenar por timestamp
    valid_raw_frames.sort(key=lambda f: float(f.get("timestamp_ms", 0.0)))

    # --- 2. Validación de brechas temporales (Sección 7) ---
    # Brecha = t_siguiente - t_anterior - dt_nominal
    for i in range(len(valid_raw_frames) - 1):
        t_curr = float(valid_raw_frames[i].get("timestamp_ms", 0.0))
        t_next = float(valid_raw_frames[i + 1].get("timestamp_ms", 0.0))
        gap = (t_next - t_curr) - dt_nominal
        if gap > MAX_GAP_MS:
            return None, False, "ERR_INVALID_FRAME_GAP_TOO_LARGE"

    t_start = float(valid_raw_frames[0].get("timestamp_ms", 0.0))

    # --- 3. Remuestreo temporal a SEQUENCE_LENGTH frames ---
    resampled_frames: list[dict] = []

    for k in range(SEQUENCE_LENGTH):
        t_target = t_start + k * dt_nominal

        # Encontrar frames anterior y posterior
        prev_f = valid_raw_frames[0]
        next_f = valid_raw_frames[-1]

        for f in valid_raw_frames:
            ts = float(f.get("timestamp_ms", 0.0))
            if ts <= t_target:
                prev_f = f
            if ts >= t_target:
                next_f = f
                break

        t_prev = float(prev_f.get("timestamp_ms", 0.0))
        t_next = float(next_f.get("timestamp_ms", 0.0))

        if t_prev == t_next:
            tau = 0.0
        else:
            tau = (t_target - t_prev) / (t_next - t_prev)
            tau = max(0.0, min(1.0, tau))

        # Interpolar Pose linealmente
        interp_pose: list[dict] = []
        pose_prev = prev_f["pose"]
        pose_next = next_f["pose"]
        n_pts = min(len(pose_prev), len(pose_next))
        for p_i in range(n_pts):
            lm_p = pose_prev[p_i]
            lm_n = pose_next[p_i]
            interp_pose.append({
                "x": (1.0 - tau) * float(lm_p.get("x", 0.0)) + tau * float(lm_n.get("x", 0.0)),
                "y": (1.0 - tau) * float(lm_p.get("y", 0.0)) + tau * float(lm_n.get("y", 0.0)),
                "z": (1.0 - tau) * float(lm_p.get("z", 0.0)) + tau * float(lm_n.get("z", 0.0)),
                "visibility": (1.0 - tau) * float(lm_p.get("visibility", 1.0)) + tau * float(lm_n.get("visibility", 1.0)),
            })

        # Interpolar Manos (Sección 5):
        # "se interpola solo si está presente en ambos extremos; si no, se toma del frame más cercano; si no hay mano, ausente"
        hands_prev, labels_prev = _get_detected_hands_and_labels(prev_f)
        hands_next, labels_next = _get_detected_hands_and_labels(next_f)

        interp_hands: list[list[dict]] = []
        interp_labels: list[Optional[str]] = []

        if len(hands_prev) == len(hands_next) and len(hands_prev) > 0:
            # Ambas presentes en ambos extremos
            for h_idx in range(len(hands_prev)):
                hp = hands_prev[h_idx]
                hn = hands_next[h_idx]
                h_interp: list[dict] = []
                for pt_i in range(min(len(hp), len(hn))):
                    h_interp.append({
                        "x": (1.0 - tau) * float(hp[pt_i].get("x", 0.0)) + tau * float(hn[pt_i].get("x", 0.0)),
                        "y": (1.0 - tau) * float(hp[pt_i].get("y", 0.0)) + tau * float(hn[pt_i].get("y", 0.0)),
                        "z": (1.0 - tau) * float(hp[pt_i].get("z", 0.0)) + tau * float(hn[pt_i].get("z", 0.0)),
                    })
                interp_hands.append(h_interp)
                interp_labels.append(labels_prev[h_idx] if tau < 0.5 else labels_next[h_idx])
        elif tau < 0.5 and len(hands_prev) > 0:
            interp_hands = copy.deepcopy(hands_prev)
            interp_labels = list(labels_prev)
        elif tau >= 0.5 and len(hands_next) > 0:
            interp_hands = copy.deepcopy(hands_next)
            interp_labels = list(labels_next)

        resampled_frames.append({
            "pose": interp_pose,
            "hands": interp_hands,
            "handedness": [{"categoryName": lbl} if lbl else {} for lbl in interp_labels],
            "timestamp_ms": t_target,
        })

    # --- 4. Escala y Centro por Ventana (Mediana) ---
    D_per_frame: list[float] = []
    Cx_per_frame: list[float] = []
    Cy_per_frame: list[float] = []
    Cz_per_frame: list[float] = []

    for fr in resampled_frames:
        p11 = fr["pose"][11]
        p12 = fr["pose"][12]
        x11, y11, z11 = float(p11.get("x", 0.0)), float(p11.get("y", 0.0)), float(p11.get("z", 0.0))
        x12, y12, z12 = float(p12.get("x", 0.0)), float(p12.get("y", 0.0)), float(p12.get("z", 0.0))
        dx, dy, dz = x11 - x12, y11 - y12, z11 - z12
        d_val = math.sqrt(dx * dx + dy * dy + dz * dz)
        D_per_frame.append(d_val)
        Cx_per_frame.append((x11 + x12) / 2.0)
        Cy_per_frame.append((y11 + y12) / 2.0)
        Cz_per_frame.append((z11 + z12) / 2.0)

    D_ventana = float(statistics.median(D_per_frame))
    Cx_ventana = float(statistics.median(Cx_per_frame))
    Cy_ventana = float(statistics.median(Cy_per_frame))
    Cz_ventana = float(statistics.median(Cz_per_frame))

    if D_ventana < SHOULDERS_D_MIN:
        return None, False, "ERR_SHOULDERS_TOO_SMALL"

    # --- 5. Filtro EMA temporal (α = 0.50) ---
    # Reinicio al inicio de la ventana (k=0) y al reaparecer una mano
    alpha = 0.50
    smoothed_frames: list[dict] = []
    prev_pose: Optional[list[dict]] = None
    prev_hands: dict[str, list[dict]] = {}  # tracked by side or index

    for k, fr in enumerate(resampled_frames):
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

        # Suavizado de manos
        curr_hands = fr["hands"]
        smooth_hands: list[list[dict]] = []
        for h_i, h in enumerate(curr_hands):
            prev_h = prev_hands.get(str(h_i))
            if prev_h is None or len(prev_h) != len(h):
                # Mano reaparece -> reinicio de estado
                h_smooth = copy.deepcopy(h)
            else:
                h_smooth = []
                for pt_idx in range(len(h)):
                    c_pt = h[pt_idx]
                    p_pt = prev_h[pt_idx]
                    h_smooth.append({
                        "x": alpha * float(c_pt.get("x", 0.0)) + (1.0 - alpha) * float(p_pt.get("x", 0.0)),
                        "y": alpha * float(c_pt.get("y", 0.0)) + (1.0 - alpha) * float(p_pt.get("y", 0.0)),
                        "z": alpha * float(c_pt.get("z", 0.0)) + (1.0 - alpha) * float(p_pt.get("z", 0.0)),
                    })
            smooth_hands.append(h_smooth)
            prev_hands[str(h_i)] = h_smooth

        # Limpiar manos que ya no existen para que reinicien estado si vuelven
        curr_indices = {str(i) for i in range(len(curr_hands))}
        for old_idx in list(prev_hands.keys()):
            if old_idx not in curr_indices:
                del prev_hands[old_idx]

        smoothed_frames.append({
            "pose": smooth_pose,
            "hands": smooth_hands,
            "handedness": fr["handedness"],
            "timestamp_ms": fr["timestamp_ms"],
        })

    # --- 6. Normalización y Ensamble del Tensor (1, 15, 178) usando C_ventana y D_ventana ---
    tensor_data = np.zeros((SEQUENCE_LENGTH, TOTAL_FEATURES), dtype=np.float64)

    for k, fr in enumerate(smoothed_frames):
        pose = fr["pose"]

        # Upper pose [0..51]
        for i, p_idx in enumerate(POSE_UPPER_INDICES):
            lm = pose[p_idx]
            tensor_data[k, i * 4 + 0] = (float(lm.get("x", 0.0)) - Cx_ventana) / D_ventana
            tensor_data[k, i * 4 + 1] = (float(lm.get("y", 0.0)) - Cy_ventana) / D_ventana
            tensor_data[k, i * 4 + 2] = (float(lm.get("z", 0.0)) - Cz_ventana) / D_ventana
            tensor_data[k, i * 4 + 3] = max(0.0, min(1.0, float(lm.get("visibility", 1.0))))

        # Manos [52..114] y [115..177]
        detected_hands, detected_labels = _get_detected_hands_and_labels(fr)
        pw15_x = float(pose[15].get("x", 0.0))
        pw15_y = float(pose[15].get("y", 0.0))
        pw15_vis = float(pose[15].get("visibility", 1.0))
        pw16_x = float(pose[16].get("x", 0.0))
        pw16_y = float(pose[16].get("y", 0.0))
        pw16_vis = float(pose[16].get("visibility", 1.0))

        valid_hands = []
        for h, lbl in zip(detected_hands, detected_labels):
            hw_x = float(h[0].get("x", 0.0))
            hw_y = float(h[0].get("y", 0.0))
            d_left = math.hypot(hw_x - pw15_x, hw_y - pw15_y)
            d_right = math.hypot(hw_x - pw16_x, hw_y - pw16_y)
            if min(d_left, d_right) <= HAND_DISCONNECTED_THRESH * D_ventana:
                valid_hands.append((h, lbl, d_left, d_right))

        assigned_left: Optional[list[dict]] = None
        assigned_right: Optional[list[dict]] = None

        if len(valid_hands) >= 2:
            h0, lbl0, d0_l, d0_r = valid_hands[0]
            h1, lbl1, d1_l, d1_r = valid_hands[1]
            cost_A = d0_l + d1_r
            cost_B = d1_l + d0_r
            if abs(cost_A - cost_B) < HAND_AMBIGUITY_THRESH * D_ventana and (lbl0 or lbl1):
                if lbl0 == "Left" or lbl1 == "Right":
                    assigned_left, assigned_right = h1, h0
                else:
                    assigned_left, assigned_right = h0, h1
            elif cost_A <= cost_B:
                assigned_left, assigned_right = h0, h1
            else:
                assigned_left, assigned_right = h1, h0
        elif len(valid_hands) == 1:
            h0, lbl0, d0_l, d0_r = valid_hands[0]
            is_amb = (
                abs(d0_l - d0_r) < HAND_AMBIGUITY_THRESH * D_ventana
                or pw15_vis < 0.50
                or pw16_vis < 0.50
            )
            if is_amb and lbl0 in ("Left", "Right"):
                if lbl0 == "Left":
                    assigned_right = h0
                else:
                    assigned_left = h0
            else:
                if d0_l < d0_r:
                    assigned_left = h0
                else:
                    assigned_right = h0

        if assigned_left is not None:
            tensor_data[k, 52:115] = _hand_to_features(assigned_left, D_ventana, Cx_ventana, Cy_ventana)
        else:
            tensor_data[k, 52:115] = 0.0

        if assigned_right is not None:
            tensor_data[k, 115:178] = _hand_to_features(assigned_right, D_ventana, Cx_ventana, Cy_ventana)
        else:
            tensor_data[k, 115:178] = 0.0

    result_tensor = tensor_data.astype(np.float32).reshape(1, SEQUENCE_LENGTH, TOTAL_FEATURES)
    return result_tensor, True, None


# ---------------------------------------------------------------------------
# 5. Funciones canónicas de simetría y espejo
# ---------------------------------------------------------------------------

def mirror_raw_frame(raw_frame: dict) -> dict:
    """
    Aplica la transformación de espejo sobre landmarks crudos (en espacio [0, 1]):
      1. Coordenadas x invertidas: x' = 1.0 - x
      2. Intercambio de landmarks bilaterales de pose:
         (11,12) hombros, (13,14) codos, (15,16) muñecas, (17,18) meñiques, (19,20) índices, (21,22) pulgares
      3. Intercambio de categoryName de manos: 'Left' <-> 'Right'
    """
    mirrored = copy.deepcopy(raw_frame)

    # 1. Pose
    pose = mirrored.get("pose")
    if pose:
        # Flip x en todos
        for lm in pose:
            if "x" in lm:
                lm["x"] = 1.0 - float(lm["x"])

        # Intercambiar bilateralmente
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
    """
    Aplica la transformación de espejo analítica sobre el vector de 178 features:
      1. Upper Pose [0..51]:
         - Landmark 0 (Nose, [0..3]): x' = -x
         - Pares bilaterales: se intercambian los bloques de 4 floats entre izquierda y derecha,
           invirtiendo x' = -x en ambos.
      2. Manos:
         - Se intercambia el bloque [52..114] con [115..177]
         - En ambas manos se invierte x' = -x (cada 3er elemento comenzando en 0)

    Garantía matemática (Sección 10):
      Extract(Mirror(raw)) == MirrorFeatures(Extract(raw)) con error <= 10^-6
    """
    out = features.copy().astype(np.float64)

    # 1. Upper Pose
    # Landmark 0: Nariz (índice 0 en pose upper)
    out[0] = -out[0]

    # Pares bilaterales de pose upper
    for idx_l, idx_r in UPPER_BILATERAL_INDEX_PAIRS:
        start_l = idx_l * 4
        start_r = idx_r * 4
        block_l = out[start_l:start_l + 4].copy()
        block_r = out[start_r:start_r + 4].copy()

        # Invertir x en ambos
        block_l[0] = -block_l[0]
        block_r[0] = -block_r[0]

        # Intercambiar
        out[start_l:start_l + 4] = block_r
        out[start_r:start_r + 4] = block_l

    # 2. Manos
    left_hand = out[52:115].copy()
    right_hand = out[115:178].copy()

    # Invertir x en cada uno de los 21 landmarks
    for i in range(HAND_LANDMARKS):
        left_hand[i * 3 + 0] = -left_hand[i * 3 + 0]
        right_hand[i * 3 + 0] = -right_hand[i * 3 + 0]

    # Intercambiar manos (Mano izquierda <-> Mano derecha)
    out[52:115] = right_hand
    out[115:178] = left_hand

    return out.astype(np.float32)
