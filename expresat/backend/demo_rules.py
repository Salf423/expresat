"""
demo_rules.py — ExpresaT: Motor Demostrativo de Reconocimiento Basado en Reglas
===========================================================================
# [DEMO] MÓDULO TEMPORAL BASADO EN REGLAS GEOMÉTRICAS DETERMINISTAS.
# Sustituye temporalmente la etapa de IA (ONNX Runtime / GRU) para mostrar
# la funcionalidad de traducción en tiempo real de ExpresaT.
#
# Este módulo consume los datos crudos de MediaPipe (sin alterar la estructura
# existente) y analiza la geometría de las manos y el torso superior (ángulos,
# distancias euclidianas relativas, extensión de dedos, orientación de palma
# y movimiento oscilatorio temporal para señas dinámicas como "Hola").
#
# Cuando el modelo de IA esté entrenado y calibrado, este módulo será reemplazado
# por el InferenceEngine definitivo sin alterar los contratos de datos del sistema.
"""

import math
import time
import warnings
from collections import deque
from typing import Any, Dict, List, Optional, Tuple, Union


# =============================================================================
# [DEMO] LISTA DE GESTOS / SEÑAS SOPORTADAS EN MODO DEMO
# =============================================================================
DEMO_LABELS = [
    "Hola",            # Mano abierta levantada con movimiento oscilante (saludo)
    "Gracias",         # Mano plana saliendo de la barbilla hacia el frente
    "Si",              # Puño cerrado (afirmación / letra S en LSM)
    "No",              # Dedo índice extendido hacia arriba (negación)
    "Bien",            # Pulgar arriba (aprobación)
    "Amor y Paz",      # Dedos índice y medio en 'V' (letra V en LSM)
    "Te Quiero",       # Pulgar, índice y meñique extendidos (ILY en LSM)
    "Lunes",           # Pulgar e índice a 90° (letra L en LSM)
    "Reposo"           # Manos en reposo / caídas
]


# =============================================================================
# [DEMO] ÍNDICES OFICIALES DE MEDIAPIPE
# =============================================================================
# Índices de Mano (21 puntos):
WRIST = 0
THUMB_CMC = 1
THUMB_MCP = 2
THUMB_IP = 3
THUMB_TIP = 4

INDEX_MCP = 5
INDEX_PIP = 6
INDEX_DIP = 7
INDEX_TIP = 8

MIDDLE_MCP = 9
MIDDLE_PIP = 10
MIDDLE_DIP = 11
MIDDLE_TIP = 12

RING_MCP = 13
RING_PIP = 14
RING_DIP = 15
RING_TIP = 16

PINKY_MCP = 17
PINKY_PIP = 18
PINKY_DIP = 19
PINKY_TIP = 20

# Índices de Pose Torso Superior (33 puntos):
POSE_NOSE = 0
POSE_LEFT_SHOULDER = 11
POSE_RIGHT_SHOULDER = 12


# =============================================================================
# [DEMO] SEGUIMIENTO TEMPORAL DE MOVIMIENTO Y DEBOUNCE
# =============================================================================

class TemporalWaveTracker:
    """
    Rastrea la trayectoria temporal de la muñeca (landmark 0) en una ventana deslizante
    de 0.5 a 1.0 segundos (15 a 30 muestras) para detectar oscilación lateral (saludo).
    Incluye mecanismo de histéresis y debounce de 500 ms.
    """

    def __init__(self, max_history: int = 30, debounce_sec: float = 0.5):
        self.max_history = max_history
        self.debounce_sec = debounce_sec
        # Cada elemento: (timestamp, wrist_x, wrist_y, palm_scale)
        self.history: deque = deque(maxlen=max_history)
        self.last_hola_time: float = 0.0

    def reset(self):
        self.history.clear()
        self.last_hola_time = 0.0

    def add_point(self, timestamp: float, x: float, y: float, palm_scale: float):
        self.history.append((timestamp, x, y, palm_scale))

    def analyze_wave_from_points(self, xs: List[float], palm_scale: float) -> Dict[str, Any]:
        """
        Analiza una lista de coordenadas X consecutivas de la muñeca.
        Detecta cambios de dirección con amplitud relativa a palm_scale.
        """
        if len(xs) < 5 or palm_scale < 0.01:
            return {
                "is_waving": False,
                "direction_changes": 0,
                "max_amplitude": 0.0,
                "total_amplitude": 0.0
            }

        # Amplitud mínima requerida por semionda (10% del tamaño de la palma para ser tolerante)
        min_half_amp = 0.10 * palm_scale
        noise_threshold = 0.015 * palm_scale

        # Suavizado ligero de 3 puntos
        smoothed: List[float] = []
        for i in range(len(xs)):
            s = max(0, i - 1)
            e = min(len(xs), i + 2)
            smoothed.append(sum(xs[s:e]) / (e - s))

        # Detectar extremos locales (cambios de dirección de la velocidad en X)
        extremes: List[Tuple[int, float]] = []
        current_dir = 0  # 1: hacia la derecha, -1: hacia la izquierda

        for i in range(len(smoothed) - 1):
            diff = smoothed[i + 1] - smoothed[i]
            if abs(diff) < noise_threshold:
                continue
            new_dir = 1 if diff > 0 else -1
            if current_dir != 0 and new_dir != current_dir:
                extremes.append((i, smoothed[i]))
            current_dir = new_dir

        # Contar transiciones de vaivén con amplitud significativa
        valid_changes = 0
        total_amp = 0.0
        max_amp = 0.0

        if len(extremes) >= 2:
            last_val = extremes[0][1]
            for _, val in extremes[1:]:
                amp = abs(val - last_val)
                if amp >= min_half_amp:
                    valid_changes += 1
                    total_amp += amp
                    max_amp = max(max_amp, amp)
                    last_val = val

        # Se requieren al menos 2 cambios de dirección (ida y vuelta)
        is_waving = valid_changes >= 2

        return {
            "is_waving": is_waving,
            "direction_changes": valid_changes,
            "max_amplitude": round(max_amp, 4),
            "total_amplitude": round(total_amp, 4)
        }

    def check_wave(
        self,
        batch_wrist_xs: Optional[List[float]],
        current_x: float,
        current_y: float,
        palm_scale: float,
        now: float
    ) -> Dict[str, Any]:
        """
        Determina si hay movimiento de agitación activo considerando el lote o el historial.
        Aplica debounce de 500 ms si el gesto fue recientemente confirmado.
        """
        # Si se recibe una secuencia por lote de frames, usar directamente las coordenadas del lote
        if batch_wrist_xs and len(batch_wrist_xs) >= 5:
            xs_to_analyze = batch_wrist_xs
        else:
            # En modo stream frame a frame, registrar en el buffer temporal
            self.add_point(now, current_x, current_y, palm_scale)
            xs_to_analyze = [p[1] for p in self.history]

        wave_info = self.analyze_wave_from_points(xs_to_analyze, palm_scale)

        # Histéresis y Debounce: si ya se detectó la agitación, mantener activa por 500ms
        if wave_info["is_waving"]:
            self.last_hola_time = now
            wave_info["in_debounce"] = False
        elif (now - self.last_hola_time) <= self.debounce_sec and self.last_hola_time > 0:
            wave_info["is_waving"] = True
            wave_info["in_debounce"] = True
        else:
            wave_info["in_debounce"] = False

        return wave_info


# Instancia singleton del rastreador temporal
_wave_tracker = TemporalWaveTracker()


def get_wave_tracker() -> TemporalWaveTracker:
    return _wave_tracker


def check_landmarks_input_type(landmarks_input: Any) -> None:
    """
    Validate the type of landmarks_input at the start of predict_demo.
    If not None, list nor dict, raise TypeError.
    """
    if landmarks_input is not None and not isinstance(landmarks_input, (list, dict)):
        raise TypeError("landmarks_input debe ser un dict o lista de frames")


# =============================================================================
# [DEMO] CONTADOR DE CONFIRMACIÓN POR FRAMES CONSECUTIVOS (DEBOUNCE "HOLA")
# =============================================================================

class HolaConfirmation:
    """
    Requiere que la seña "Hola" se detecte en al menos MIN_FRAMES consecutivos
    antes de confirmarla, y la mantiene activa HOLD_SEC segundos tras la última
    detección (evita parpadeo y pérdidas momentáneas de la mano en el encuadre).
    """
    MIN_FRAMES: int = 4       # Frames consecutivos requeridos
    HOLD_SEC: float = 0.50    # Tiempo de retención tras la última detección

    def __init__(self):
        self._consecutive: int = 0
        self._confirmed: bool = False
        self._last_seen: float = 0.0

    def update(self, candidate: bool, now: float) -> bool:
        """Retorna True si "Hola" debe reportarse como activo."""
        if candidate:
            self._consecutive += 1
            self._last_seen = now
            if self._consecutive >= self.MIN_FRAMES:
                self._confirmed = True
        else:
            self._consecutive = 0
            # Mantener confirmado durante HOLD_SEC tras la última detección
            if self._confirmed and (now - self._last_seen) > self.HOLD_SEC:
                self._confirmed = False

        return self._confirmed

    def reset(self):
        self._consecutive = 0
        self._confirmed = False
        self._last_seen = 0.0


_hola_confirmation = HolaConfirmation()


def get_hola_confirmation() -> HolaConfirmation:
    return _hola_confirmation


# =============================================================================
# [DEMO] SEGUIMIENTO GEOMÉTRICO DE MANOS Y CARA
# =============================================================================

def _get_coords(landmark: Union[Dict[str, float], List[float], Tuple[float, ...]]) -> Tuple[float, float, float]:
    """Extrae (x, y, z) de un punto de MediaPipe en formato dict, list o tuple."""
    if isinstance(landmark, dict):
        return (
            float(landmark.get("x", 0.0)),
            float(landmark.get("y", 0.0)),
            float(landmark.get("z", 0.0))
        )
    elif isinstance(landmark, (list, tuple)):
        x = float(landmark[0]) if len(landmark) > 0 else 0.0
        y = float(landmark[1]) if len(landmark) > 1 else 0.0
        z = float(landmark[2]) if len(landmark) > 2 else 0.0
        return (x, y, z)
    return (0.0, 0.0, 0.0)


def _distance_3d(
    p1: Union[Dict[str, float], List[float], Tuple[float, ...]],
    p2: Union[Dict[str, float], List[float], Tuple[float, ...]]
) -> float:
    """Calcula la distancia euclidiana 3D entre dos puntos."""
    x1, y1, z1 = _get_coords(p1)
    x2, y2, z2 = _get_coords(p2)
    return math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2)


def _vector_angle_deg(
    v1: Tuple[float, float, float],
    v2: Tuple[float, float, float]
) -> float:
    """Calcula el ángulo en grados entre dos vectores 3D."""
    dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
    norm1 = math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2)
    norm2 = math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2)
    if norm1 < 1e-6 or norm2 < 1e-6:
        return 0.0
    cosine = max(-1.0, min(1.0, dot / (norm1 * norm2)))
    return math.degrees(math.acos(cosine))


def _calculate_palm_normal(landmarks: List[Any]) -> Tuple[float, float, float]:
    """
    Calcula el vector normal unitario del plano de la palma usando:
    P0 (muñeca), P5 (nudillo índice MCP), P17 (nudillo meñique MCP).
    """
    p0 = landmarks[WRIST]
    p5 = landmarks[INDEX_MCP]
    p17 = landmarks[PINKY_MCP]

    x0, y0, z0 = _get_coords(p0)
    x5, y5, z5 = _get_coords(p5)
    x17, y17, z17 = _get_coords(p17)

    # Vector muñeca -> índice MCP
    v1 = (x5 - x0, y5 - y0, z5 - z0)
    # Vector muñeca -> meñique MCP
    v2 = (x17 - x0, y17 - y0, z17 - z0)

    # Producto cruz v1 x v2
    nx = v1[1] * v2[2] - v1[2] * v2[1]
    ny = v1[2] * v2[0] - v1[0] * v2[2]
    nz = v1[0] * v2[1] - v1[1] * v2[0]

    norm = math.sqrt(nx * nx + ny * ny + nz * nz)
    if norm > 1e-6:
        return (nx / norm, ny / norm, nz / norm)
    return (0.0, 0.0, 0.0)


# =============================================================================
# [DEMO] ANÁLISIS DE ESTADO DE DEDOS Y PALMA
# =============================================================================

def analyze_hand_fingers(
    hand_landmarks: List[Any],
    hand_label: str = "Right"
) -> Optional[Dict[str, Any]]:
    """
    Analiza una mano de 21 landmarks de MediaPipe y determina qué dedos
    están extendidos o doblados, la orientación de la palma y métricas clave.
    """
    if not hand_landmarks or len(hand_landmarks) < 21:
        return None

    wrist = hand_landmarks[WRIST]
    middle_mcp = hand_landmarks[MIDDLE_MCP]

    # Escala de la palma (invariancia de distancia a la cámara)
    palm_scale = _distance_3d(wrist, middle_mcp)
    if palm_scale < 0.02:
        return None  # Mano no detectada o coordenadas degeneradas

    # 1. DEDO ÍNDICE
    dist_index_tip = _distance_3d(wrist, hand_landmarks[INDEX_TIP])
    dist_index_pip = _distance_3d(wrist, hand_landmarks[INDEX_PIP])
    dist_index_mcp = _distance_3d(wrist, hand_landmarks[INDEX_MCP])
    index_extended = (dist_index_tip > dist_index_pip * 1.08) and (dist_index_tip > dist_index_mcp * 1.20)
    index_extended_tolerant = (dist_index_tip > dist_index_pip * 1.03) and (dist_index_tip > dist_index_mcp * 1.12)
    index_folded = (dist_index_tip < dist_index_pip * 1.05) or (dist_index_tip < dist_index_mcp * 1.20)

    # 2. DEDO MEDIO
    dist_middle_tip = _distance_3d(wrist, hand_landmarks[MIDDLE_TIP])
    dist_middle_pip = _distance_3d(wrist, hand_landmarks[MIDDLE_PIP])
    dist_middle_mcp = _distance_3d(wrist, hand_landmarks[MIDDLE_MCP])
    middle_extended = (dist_middle_tip > dist_middle_pip * 1.08) and (dist_middle_tip > dist_middle_mcp * 1.20)
    middle_extended_tolerant = (dist_middle_tip > dist_middle_pip * 1.03) and (dist_middle_tip > dist_middle_mcp * 1.12)
    middle_folded = (dist_middle_tip < dist_middle_pip * 1.05) or (dist_middle_tip < dist_middle_mcp * 1.20)

    # 3. DEDO ANULAR
    dist_ring_tip = _distance_3d(wrist, hand_landmarks[RING_TIP])
    dist_ring_pip = _distance_3d(wrist, hand_landmarks[RING_PIP])
    dist_ring_mcp = _distance_3d(wrist, hand_landmarks[RING_MCP])
    ring_extended = (dist_ring_tip > dist_ring_pip * 1.08) and (dist_ring_tip > dist_ring_mcp * 1.20)
    ring_extended_tolerant = (dist_ring_tip > dist_ring_pip * 1.03) and (dist_ring_tip > dist_ring_mcp * 1.12)
    ring_folded = (dist_ring_tip < dist_ring_pip * 1.05) or (dist_ring_tip < dist_ring_mcp * 1.20)

    # 4. DEDO MEÑIQUE
    dist_pinky_tip = _distance_3d(wrist, hand_landmarks[PINKY_TIP])
    dist_pinky_pip = _distance_3d(wrist, hand_landmarks[PINKY_PIP])
    dist_pinky_mcp = _distance_3d(wrist, hand_landmarks[PINKY_MCP])
    pinky_extended = (dist_pinky_tip > dist_pinky_pip * 1.06) and (dist_pinky_tip > dist_pinky_mcp * 1.15)
    pinky_extended_tolerant = (dist_pinky_tip > dist_pinky_pip * 1.03) and (dist_pinky_tip > dist_pinky_mcp * 1.12)
    pinky_folded = (dist_pinky_tip < dist_pinky_pip * 1.05) or (dist_pinky_tip < dist_pinky_mcp * 1.20)

    # 5. DEDO PULGAR
    dist_thumb_pinky = _distance_3d(hand_landmarks[THUMB_TIP], hand_landmarks[PINKY_MCP])
    dist_thumb_middle_mcp = _distance_3d(hand_landmarks[THUMB_TIP], hand_landmarks[MIDDLE_MCP])
    dist_thumb_wrist = _distance_3d(hand_landmarks[THUMB_TIP], wrist)

    thumb_extended = (dist_thumb_pinky / palm_scale > 0.90) and (dist_thumb_wrist / palm_scale > 0.72)
    thumb_folded = (dist_thumb_pinky / palm_scale < 0.85) or (dist_thumb_middle_mcp / palm_scale < 0.65)

    # Coordenadas clave
    wrist_x, wrist_y, wrist_z = _get_coords(wrist)
    thumb_x, thumb_y, thumb_z = _get_coords(hand_landmarks[THUMB_TIP])
    index_x, index_y, index_z = _get_coords(hand_landmarks[INDEX_TIP])
    middle_x, middle_y, middle_z = _get_coords(hand_landmarks[MIDDLE_TIP])

    # Vector pulgar y vector índice desde la muñeca
    vec_thumb = (thumb_x - wrist_x, thumb_y - wrist_y, thumb_z - wrist_z)
    vec_index = (index_x - wrist_x, index_y - wrist_y, index_z - wrist_z)
    angle_thumb_index = _vector_angle_deg(vec_thumb, vec_index)

    # Separación entre puntas de índice y medio
    dist_index_middle_tips = _distance_3d(hand_landmarks[INDEX_TIP], hand_landmarks[MIDDLE_TIP]) / palm_scale

    # Orientación de la palma hacia la cámara
    palm_norm = _calculate_palm_normal(hand_landmarks)
    norm_z = palm_norm[2]

    # En MediaPipe con cámara frontal (espejo):
    # El frontend (buildPayload) ya intercambia cámara-izquierda → user-derecha.
    # Así que `hand_label` aquí refleja la mano del USUARIO (no de la cámara).
    #
    # Mano derecha del usuario (cámara la ve como izquierda/espejo):
    #   - Palma hacia cámara: normal apunta hacia cámara → norm_z < 0 (típicamente < -0.3)
    #   - Umbral holgado: norm_z < 0.3 cubre orientaciones oblicuas (~±45°)
    #
    # Mano izquierda del usuario (cámara la ve como derecha/espejo):
    #   - Palma hacia cámara: normal apunta hacia cámara → norm_z > 0 (típicamente > 0.3)
    #   - Umbral holgado: norm_z > -0.3 cubre orientaciones oblicuas (~±45°)
    #
    # Margen amplio (±0.3) para tolerar inclinaciones de saludo y variación de personas.
    if hand_label == "Left":
        palm_facing_camera = norm_z <= 0.30
    else:
        palm_facing_camera = norm_z >= -0.30

    # Verificación adicional por posición del pulgar
    thumb_is_open = (not thumb_folded) or thumb_extended

    # Condición de 4 dedos extendidos tolerante (para saludo en movimiento)
    all_four_extended_tolerant = (
        index_extended_tolerant and
        middle_extended_tolerant and
        ring_extended_tolerant and
        pinky_extended_tolerant
    )

    return {
        "palm_scale": palm_scale,
        "wrist": (wrist_x, wrist_y, wrist_z),
        "hand_label": hand_label,
        "thumb_extended": thumb_extended,
        "thumb_folded": thumb_folded,
        "thumb_is_open": thumb_is_open,
        "index_extended": index_extended,
        "index_folded": index_folded,
        "middle_extended": middle_extended,
        "middle_folded": middle_folded,
        "ring_extended": ring_extended,
        "ring_folded": ring_folded,
        "pinky_extended": pinky_extended,
        "pinky_folded": pinky_folded,
        "all_four_extended_tolerant": all_four_extended_tolerant,
        "angle_thumb_index": angle_thumb_index,
        "dist_index_middle_tips": dist_index_middle_tips,
        "thumb_tip_y": thumb_y,
        "index_tip_y": index_y,
        "wrist_y": wrist_y,
        "wrist_x": wrist_x,
        "palm_normal": palm_norm,
        "palm_facing_camera": palm_facing_camera,
    }


# =============================================================================
# [DEMO] REGLAS HEURÍSTICAS DE CLASIFICACIÓN POR FRAME
# =============================================================================

def classify_frame_by_rules(
    hand_state: Dict[str, Any],
    pose_landmarks: Optional[List[Any]] = None,
    wave_info: Optional[Dict[str, Any]] = None
) -> Tuple[Optional[str], float, str]:
    """
    [DEMO] Clasifica el gesto de la mano utilizando reglas deterministas.
    Retorna (label, confidence, rule_status_reason).
    """
    t_ext = hand_state["thumb_extended"]
    t_open = hand_state["thumb_is_open"]
    i_ext = hand_state["index_extended"]
    m_ext = hand_state["middle_extended"]
    r_ext = hand_state["ring_extended"]
    p_ext = hand_state["pinky_extended"]
    four_ext_tol = hand_state["all_four_extended_tolerant"]

    wrist_y = hand_state["wrist_y"]
    wrist_x = hand_state["wrist_x"]
    thumb_y = hand_state["thumb_tip_y"]
    index_y = hand_state["index_tip_y"]
    palm_scale = hand_state["palm_scale"]
    angle_ti = hand_state["angle_thumb_index"]
    dist_im = hand_state["dist_index_middle_tips"]
    palm_facing = hand_state["palm_facing_camera"]

    # Extraer referencias de pose si existen
    nose_y = None
    nose_x = None
    shoulder_y = None
    if pose_landmarks and len(pose_landmarks) > POSE_RIGHT_SHOULDER:
        nx, ny, _ = _get_coords(pose_landmarks[POSE_NOSE])
        lsx, lsy, _ = _get_coords(pose_landmarks[POSE_LEFT_SHOULDER])
        rsx, rsy, _ = _get_coords(pose_landmarks[POSE_RIGHT_SHOULDER])
        nose_x, nose_y = nx, ny
        shoulder_y = (lsy + rsy) / 2.0

    is_waving = wave_info.get("is_waving", False) if wave_info else False
    direction_changes = wave_info.get("direction_changes", 0) if wave_info else 0

    # -------------------------------------------------------------------------
    # REGLA 1: "Bien" / Pulgar Arriba (Thumbs Up)
    # -------------------------------------------------------------------------
    if t_ext and (not i_ext) and (not m_ext) and (not r_ext) and (not p_ext):
        if thumb_y < wrist_y - 0.15 * palm_scale:
            return "Bien", 0.95, "Pulgar arriba apuntando hacia el cielo"
        return "Bien", 0.88, "Pulgar extendido con 4 dedos doblados"

    # -------------------------------------------------------------------------
    # REGLA 2: "Lunes" / Letra L (Pulgar e Índice en ángulo de ~90°)
    # -------------------------------------------------------------------------
    if t_ext and i_ext and (not m_ext) and (not r_ext) and (not p_ext):
        if 45.0 <= angle_ti <= 140.0:
            return "Lunes", 0.96, "Pulgar e índice en forma de L (~90°)"
        return "Lunes", 0.89, "Pulgar e índice extendidos"

    # -------------------------------------------------------------------------
    # REGLA 3: "Te Quiero" / ILY (Pulgar, Índice y Meñique)
    # -------------------------------------------------------------------------
    if t_ext and i_ext and p_ext and (not m_ext) and (not r_ext):
        return "Te Quiero", 0.96, "Seña ILY: pulgar, índice y meñique extendidos"

    # -------------------------------------------------------------------------
    # REGLA 4: "Amor y Paz" / Letra V (Índice y Medio extendidos en 'V')
    # -------------------------------------------------------------------------
    if i_ext and m_ext and (not r_ext) and (not p_ext):
        if dist_im > 0.22:
            return "Amor y Paz", 0.96, "Índice y medio separados en V"
        return "Amor y Paz", 0.91, "Índice y medio extendidos"

    # -------------------------------------------------------------------------
    # REGLA 5: "No" (Dedo Índice Levantado Negando)
    # -------------------------------------------------------------------------
    if i_ext and (not m_ext) and (not r_ext) and (not p_ext):
        if index_y < wrist_y:
            return "No", 0.95, "Dedo índice vertical apuntando hacia arriba"
        return "No", 0.89, "Dedo índice extendido solo"

    # -------------------------------------------------------------------------
    # REGLA 6: "Si" (Puño Cerrado / Afirmación / Letra S en LSM)
    # -------------------------------------------------------------------------
    if (not i_ext) and (not m_ext) and (not r_ext) and (not p_ext):
        if shoulder_y is None or wrist_y < shoulder_y + 0.35:
            return "Si", 0.94, "Puño cerrado a nivel de interacción"
        return "Reposo", 0.85, "Mano en reposo abajo del torso"

    # -------------------------------------------------------------------------
    # REGLA 7: "Gracias" (Mano Plana Frente a la Barbilla / Pecho Central)
    # -------------------------------------------------------------------------
    # Se diferencia de "Hola" porque:
    #   - Los dedos están juntos (mano plana, dist_im < 0.32).
    #   - Está estrictamente a nivel de barbilla/boca/pecho CENTRAL (no lateral).
    #   - NO tiene movimiento de vaivén lateral (is_waving es False).
    #   - La muñeca está cerca del eje central de la nariz (abs(wrist_x-nose_x) < 0.16).
    # Si la mano está lateral O agitando, se omite esta regla para no interferir con "Hola".
    #
    # Refactored: "Gracias" solo aplica si:
    #   1. Los 4 dedos principales extendidos (o thumb+index+middle+ring+pinky)
    #   2. dist_im < 0.32 (mano plana)
    #   3. is_central (wrist cerca del eje central de la nariz)
    #   4. mano en reposo angular (no is_waving)
    #   5. posición vertical: nariz_y + 0.08 <= wrist_y <= hombro_y + 0.05
    if (i_ext and m_ext and r_ext and p_ext) and not is_waving:
        is_central = False
        if nose_x is not None:
            is_central = abs(wrist_x - nose_x) < 0.16
        else:
            # Sin pose, asumir central si wrist_x es central en coordenadas normalizadas [0,1]
            is_central = 0.30 <= wrist_x <= 0.70

        if dist_im < 0.32 and is_central:
            if nose_y is not None and shoulder_y is not None:
                if (nose_y + 0.08) <= wrist_y <= (shoulder_y + 0.05):
                    return "Gracias", 0.94, "Mano plana tocando o saliendo de la barbilla"
            elif 0.40 <= wrist_y <= 0.60:
                return "Gracias", 0.90, "Mano plana central a la altura del pecho"

    # -------------------------------------------------------------------------
    # REGLA 8: "Hola" (Mano Abierta Levantada con Movimiento de Saludo)
    # -------------------------------------------------------------------------
    # Requiere inequívocamente:
    #   1. Los 4 dedos principales extendidos (tolerante) y pulgar abierto.
    #   2. Palma orientada hacia la cámara.
    #   3. Movimiento lateral oscilante (agitar: >= 2 cambios de dirección en X).
    #   4. Confirmación durante MIN_FRAMES consecutivos (evita disparos espurios).
    #
    # Isolated: "Hola" requires unequivocal detection of oscillatory movement is_waving
    # and visible palm. If hand is open and facing but QUIET, do NOT classify as "Hola".
    #
    # Critical fix: "Gracias" must be checked BEFORE "Hola" to avoid interference.
    # The condition order ensures "Gracias" takes priority when dist_im < 0.32 and central,
    # even if hand is also open and facing.
    #
    # "Hola" ONLY applies when:
    #   - NOT "Gracias" conditions (dist_im >= 0.32 OR not central OR is_waving)
    #   - Hand is open, facing camera, and actively waving
    if (four_ext_tol or (i_ext and m_ext and r_ext and p_ext)) and t_open and palm_facing:
        if shoulder_y is None or wrist_y < shoulder_y + 0.20:
            if is_waving:
                in_deb = wave_info.get("in_debounce", False) if wave_info else False
                conf = 0.96 if not in_deb else 0.92
                return "Hola", conf, f"Saludo activo con oscilación lateral ({direction_changes} cambios de dirección)"
            else:
                # Mano abierta frente a la cámara pero quieta: no disparar "Hola"
                # Pero antes verificar si "Gracias" debería aplicar
                if dist_im < 0.32:
                    # "Gracias" takes priority over silent "Hola"
                    if nose_y is not None and shoulder_y is not None:
                        if (nose_y + 0.08) <= wrist_y <= (shoulder_y + 0.05):
                            return "Gracias", 0.94, "Mano plana tocando o saliendo de la barbilla"
                    elif 0.40 <= wrist_y <= 0.60:
                        return "Gracias", 0.90, "Mano plana central a la altura del pecho"
                return None, 0.0, f"Mano abierta detectada pero estática (cambios dir: {direction_changes}/2 requeridos)"

    # -------------------------------------------------------------------------
    # REGLA 9: "Reposo" / Sin coincidencia activa
    # -------------------------------------------------------------------------
    return "Reposo", 0.80, "Sin coincidencia con reglas activas"


# =============================================================================
# [DEMO] FUNCIÓN DE ENTRADA PRINCIPAL — predict_demo
# =============================================================================

def predict_demo(
    landmarks_input: Union[List[Dict[str, Any]], Dict[str, Any], Any]
) -> Dict[str, Any]:
    """
    [DEMO] Punto de entrada principal para inferencia basada en reglas deterministas.

    Reemplaza temporalmente a InferenceEngine.predict() conservando exactamente
    el mismo formato de salida esperado por el servidor FastAPI y el frontend:

    Args:
        landmarks_input: Puede ser:
          - Una lista de 15 frames crudos: [ { "pose": [...], "leftHand": [...], "rightHand": [...] }, ... ]
          - Un solo frame dict: { "pose": [...], "leftHand": [...], "rightHand": [...] }

    Returns:
        Dict con:
          - "label": str — Seña reconocida ("Hola", "Gracias", "Si", etc.) o None si no hay mano visible o está estática
          - "confidence": float — Nivel de certeza de la regla (0.0 a 1.0)
          - "latency_ms": float — Tiempo de cálculo en milisegundos (< 2ms)
          - "all_probabilities": dict — Diccionario con probabilidades por etiqueta (simula softmax)
          - "is_demo": True — Bandera explícita indicando ejecución en modo demo
          - "debug": dict — Telemetría de diagnóstico para auditoría en tiempo real
    """
    # M9: Validate type of landmarks_input at the start
    check_landmarks_input_type(landmarks_input)
    start_time = time.perf_counter()
    now = time.time()

    target_frame: Optional[Dict[str, Any]] = None
    batch_wrist_xs: List[float] = []

    # Extraer frames y trayectoria de muñeca
    if isinstance(landmarks_input, list):
        if not landmarks_input:
            latency_ms = (time.perf_counter() - start_time) * 1000
            return _build_empty_result(latency_ms, reason="Lista de frames vacía")

        # Recorrer frames del lote para acumular la trayectoria en X de la muñeca
        for frame in landmarks_input:
            if isinstance(frame, dict):
                hand = frame.get("rightHand") or frame.get("leftHand")
                if hand and len(hand) > WRIST:
                    wx, _, _ = _get_coords(hand[WRIST])
                    batch_wrist_xs.append(wx)

        # Seleccionar el último frame con mano válida
        for frame in reversed(landmarks_input):
            if isinstance(frame, dict) and (frame.get("rightHand") or frame.get("leftHand")):
                target_frame = frame
                break

        if target_frame is None and len(landmarks_input) > 0:
            target_frame = landmarks_input[-1]

    elif isinstance(landmarks_input, dict):
        target_frame = landmarks_input
    else:
        # This should not happen after type validation, but safety check
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms, reason="Entrada no es lista ni dict")

    if not target_frame:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms, reason="Frame objetivo nulo")

    # Extraer manos y pose
    right_hand = target_frame.get("rightHand") or target_frame.get("right_hand")
    left_hand = target_frame.get("leftHand") or target_frame.get("left_hand")
    pose = target_frame.get("pose")

    # Seleccionar mano activa (preferencia derecha)
    active_hand = None
    hand_label = "Right"
    if right_hand and len(right_hand) >= 21:
        active_hand = right_hand
        hand_label = "Right"
    elif left_hand and len(left_hand) >= 21:
        active_hand = left_hand
        hand_label = "Left"

    if not active_hand or len(active_hand) < 21:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms, reason="Mano no detectada o con < 21 puntos")

    # Analizar geometría de dedos y orientación de la palma
    hand_state = analyze_hand_fingers(active_hand, hand_label=hand_label)
    if not hand_state:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms, reason="Fallo al calcular escala de la palma (< 0.02)")

    # Analizar movimiento oscilatorio de la muñeca (agitación / wave)
    wrist_x, wrist_y, wrist_z = hand_state["wrist"]
    palm_scale = hand_state["palm_scale"]
    tracker = get_wave_tracker()

    wave_info = tracker.check_wave(
        batch_wrist_xs=batch_wrist_xs,
        current_x=wrist_x,
        current_y=wrist_y,
        palm_scale=palm_scale,
        now=now
    )

    # Clasificar mediante reglas fijas con telemetría
    label, confidence, rule_reason = classify_frame_by_rules(hand_state, pose, wave_info)

    # M9: Additional type validation already done at function start

    # -------------------------------------------------------------------------
    # [DEMO] Confirmación por frames consecutivos para "Hola"
    # Evita que la seña se dispare en un único frame válido (evita parpadeo).
    # -------------------------------------------------------------------------
    hola_conf = get_hola_confirmation()
    hola_candidate = (label == "Hola")
    hola_confirmed = hola_conf.update(hola_candidate, now)

    if hola_candidate and not hola_confirmed:
        # Candidato válido pero aún no tiene suficientes frames consecutivos
        label = None
        confidence = 0.0
        rule_reason = f"Hola detectado — esperando confirmación ({hola_conf._consecutive}/{hola_conf.MIN_FRAMES} frames)"
    elif not hola_candidate and label is None and hola_confirmed:
        # Mano abierta quieta pero "Hola" sigue en ventana de retención
        label = "Hola"
        confidence = 0.90
        rule_reason = "Hola retenido (retención de confirmación activa)"

    latency_ms = (time.perf_counter() - start_time) * 1000

    # Construir distribución de probabilidades normalizada estrictamente a 1.0
    all_probs = _generate_probabilities(label if label else "Reposo", confidence)

    # Telemetría de diagnóstico para el frontend / panel oculto
    debug_telemetry = {
        "hand_detected": True,
        "hand_label": hand_label,
        "fingers": {
            "thumb": hand_state["thumb_extended"],
            "index": hand_state["index_extended"],
            "middle": hand_state["middle_extended"],
            "ring": hand_state["ring_extended"],
            "pinky": hand_state["pinky_extended"]
        },
        "all_four_extended_tolerant": hand_state["all_four_extended_tolerant"],
        "palm_facing_camera": hand_state["palm_facing_camera"],
        "palm_normal_z": round(hand_state["palm_normal"][2], 4),
        "wrist_position": [round(wrist_x, 4), round(wrist_y, 4), round(wrist_z, 4)],
        "is_waving": wave_info["is_waving"],
        "direction_changes": wave_info["direction_changes"],
        "wave_amplitude": wave_info["total_amplitude"],
        "hola_consecutive_frames": hola_conf._consecutive,
        "hola_confirmed": hola_confirmed,
        "evaluated_rule": label if label else "Ninguna (mano abierta quieta)",
        "rule_reason": rule_reason
    }

    return {
        "label": label,
        "confidence": round(confidence, 4) if label else 0.0,
        "latency_ms": round(latency_ms, 2),
        "all_probabilities": all_probs,
        "is_demo": True,
        "debug": debug_telemetry
    }


def _build_empty_result(latency_ms: float, reason: str = "") -> Dict[str, Any]:
    """Construye una respuesta cuando no se detectan manos en el frame."""
    return {
        "label": None,
        "confidence": 0.0,
        "latency_ms": round(latency_ms, 2),
        "all_probabilities": {lbl: 0.0 for lbl in DEMO_LABELS},
        "is_demo": True,
        "debug": {
            "hand_detected": False,
            "rule_reason": reason or "No hay mano visible en el encuadre"
        }
    }


def _generate_probabilities(predicted_label: str, confidence: float) -> Dict[str, float]:
    """Genera un diccionario de probabilidades normalizadas cuya suma sea exactamente 1.0."""
    conf = round(float(confidence), 4)
    other_labels = [lbl for lbl in DEMO_LABELS if lbl != predicted_label]
    num_others = len(other_labels)

    if num_others == 0:
        return {predicted_label: 1.0}

    remaining_prob = max(0.0, 1.0 - conf)
    per_other = round(remaining_prob / num_others, 4)

    probs = {predicted_label: conf}
    accumulated_other = 0.0
    for lbl in other_labels[:-1]:
        probs[lbl] = per_other
        accumulated_other += per_other

    # El último absorbe cualquier residuo de redondeo para que la suma total sea exactamente 1.0
    last_other = other_labels[-1]
    probs[last_other] = round(max(0.0, 1.0 - conf - accumulated_other), 4)
    return probs