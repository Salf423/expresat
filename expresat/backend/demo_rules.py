"""
demo_rules.py — ExpresaT: Motor Demostrativo de Reconocimiento Basado en Reglas
=============================================================================
# [DEMO] MÓDULO TEMPORAL BASADO EN REGLAS GEOMÉTRICAS DETERMINISTAS.
# Sustituye temporalmente la etapa de IA (ONNX Runtime / GRU) para mostrar
# la funcionalidad de traducción en tiempo real de ExpresaT.
#
# Este módulo consume los datos crudos de MediaPipe (sin alterar la estructura
# existente) y analiza la geometría de las manos y el torso superior (ángulos,
# distancias euclidianas relativas y extensión de dedos).
#
# Cuando el modelo de IA esté entrenado y calibrado, este módulo será reemplazado
# por el InferenceEngine definitivo sin alterar los contratos de datos del sistema.
"""

import math
import time
from typing import Any, Dict, List, Optional, Tuple, Union


# =============================================================================
# [DEMO] LISTA DE GESTOS / SEÑAS SOPORTADAS EN MODO DEMO
# =============================================================================
DEMO_LABELS = [
    "Hola",            # Mano abierta levantada (saludo)
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
# [DEMO] FUNCIONES GEOMÉTRICAS AUXILIARES
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


# =============================================================================
# [DEMO] ANÁLISIS DE ESTADO DE DEDOS
# =============================================================================

def analyze_hand_fingers(hand_landmarks: List[Any]) -> Optional[Dict[str, Any]]:
    """
    Analiza una mano de 21 landmarks de MediaPipe y determina qué dedos
    están extendidos o doblados, calculando distancias normalizadas por la palma.

    Retorna un diccionario con el estado booleano de cada dedo y métricas clave,
    o None si la mano no contiene suficientes landmarks válidos.
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
    index_extended = (dist_index_tip > dist_index_pip * 1.12) and (dist_index_tip > dist_index_mcp * 1.25)
    index_folded = (dist_index_tip < dist_index_pip * 1.05) or (dist_index_tip < dist_index_mcp * 1.20)

    # 2. DEDO MEDIO
    dist_middle_tip = _distance_3d(wrist, hand_landmarks[MIDDLE_TIP])
    dist_middle_pip = _distance_3d(wrist, hand_landmarks[MIDDLE_PIP])
    dist_middle_mcp = _distance_3d(wrist, hand_landmarks[MIDDLE_MCP])
    middle_extended = (dist_middle_tip > dist_middle_pip * 1.12) and (dist_middle_tip > dist_middle_mcp * 1.25)
    middle_folded = (dist_middle_tip < dist_middle_pip * 1.05) or (dist_middle_tip < dist_middle_mcp * 1.20)

    # 3. DEDO ANULAR
    dist_ring_tip = _distance_3d(wrist, hand_landmarks[RING_TIP])
    dist_ring_pip = _distance_3d(wrist, hand_landmarks[RING_PIP])
    dist_ring_mcp = _distance_3d(wrist, hand_landmarks[RING_MCP])
    ring_extended = (dist_ring_tip > dist_ring_pip * 1.12) and (dist_ring_tip > dist_ring_mcp * 1.25)
    ring_folded = (dist_ring_tip < dist_ring_pip * 1.05) or (dist_ring_tip < dist_ring_mcp * 1.20)

    # 4. DEDO MEÑIQUE
    dist_pinky_tip = _distance_3d(wrist, hand_landmarks[PINKY_TIP])
    dist_pinky_pip = _distance_3d(wrist, hand_landmarks[PINKY_PIP])
    dist_pinky_mcp = _distance_3d(wrist, hand_landmarks[PINKY_MCP])
    pinky_extended = (dist_pinky_tip > dist_pinky_pip * 1.10) and (dist_pinky_tip > dist_pinky_mcp * 1.20)
    pinky_folded = (dist_pinky_tip < dist_pinky_pip * 1.05) or (dist_pinky_tip < dist_pinky_mcp * 1.20)

    # 5. DEDO PULGAR
    # El pulgar se extiende lateralmente; medimos distancia al meñique MCP y a la muñeca
    dist_thumb_pinky = _distance_3d(hand_landmarks[THUMB_TIP], hand_landmarks[PINKY_MCP])
    dist_thumb_middle_mcp = _distance_3d(hand_landmarks[THUMB_TIP], hand_landmarks[MIDDLE_MCP])
    dist_thumb_wrist = _distance_3d(hand_landmarks[THUMB_TIP], wrist)

    thumb_extended = (dist_thumb_pinky / palm_scale > 0.95) and (dist_thumb_wrist / palm_scale > 0.75)
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

    return {
        "palm_scale": palm_scale,
        "wrist": (wrist_x, wrist_y, wrist_z),
        "thumb_extended": thumb_extended,
        "thumb_folded": thumb_folded,
        "index_extended": index_extended,
        "index_folded": index_folded,
        "middle_extended": middle_extended,
        "middle_folded": middle_folded,
        "ring_extended": ring_extended,
        "ring_folded": ring_folded,
        "pinky_extended": pinky_extended,
        "pinky_folded": pinky_folded,
        "angle_thumb_index": angle_thumb_index,
        "dist_index_middle_tips": dist_index_middle_tips,
        "thumb_tip_y": thumb_y,
        "index_tip_y": index_y,
        "wrist_y": wrist_y,
    }


# =============================================================================
# [DEMO] REGLAS HEURÍSTICAS DE CLASIFICACIÓN POR FRAME
# =============================================================================

def classify_frame_by_rules(
    hand_state: Dict[str, Any],
    pose_landmarks: Optional[List[Any]] = None
) -> Tuple[str, float]:
    """
    [DEMO] Clasifica el gesto de la mano utilizando reglas deterministas.
    Retorna (label, confidence).
    """
    t_ext = hand_state["thumb_extended"]
    i_ext = hand_state["index_extended"]
    m_ext = hand_state["middle_extended"]
    r_ext = hand_state["ring_extended"]
    p_ext = hand_state["pinky_extended"]

    wrist_y = hand_state["wrist_y"]
    thumb_y = hand_state["thumb_tip_y"]
    index_y = hand_state["index_tip_y"]
    palm_scale = hand_state["palm_scale"]
    angle_ti = hand_state["angle_thumb_index"]
    dist_im = hand_state["dist_index_middle_tips"]

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

    # -------------------------------------------------------------------------
    # REGLA 1: "Bien" / Pulgar Arriba (Thumbs Up)
    # -------------------------------------------------------------------------
    # Solo el pulgar extendido y apuntando hacia arriba; los demás 4 dedos doblados.
    if t_ext and (not i_ext) and (not m_ext) and (not r_ext) and (not p_ext):
        # En coordenadas de imagen, y menor = más arriba
        if thumb_y < wrist_y - 0.15 * palm_scale:
            return "Bien", 0.95
        return "Bien", 0.88

    # -------------------------------------------------------------------------
    # REGLA 2: "Lunes" / Letra L (Pulgar e Índice en ángulo de ~90°)
    # -------------------------------------------------------------------------
    # Pulgar e índice extendidos, medio, anular y meñique doblados.
    if t_ext and i_ext and (not m_ext) and (not r_ext) and (not p_ext):
        if 45.0 <= angle_ti <= 140.0:
            return "Lunes", 0.96
        return "Lunes", 0.89

    # -------------------------------------------------------------------------
    # REGLA 3: "Te Quiero" / ILY (Pulgar, Índice y Meñique)
    # -------------------------------------------------------------------------
    # Pulgar, índice y meñique extendidos; medio y anular doblados en el centro.
    if t_ext and i_ext and p_ext and (not m_ext) and (not r_ext):
        return "Te Quiero", 0.96

    # -------------------------------------------------------------------------
    # REGLA 4: "Amor y Paz" / Letra V (Índice y Medio extendidos en 'V')
    # -------------------------------------------------------------------------
    # Índice y medio extendidos y separados; anular y meñique doblados.
    if i_ext and m_ext and (not r_ext) and (not p_ext):
        if dist_im > 0.22:
            return "Amor y Paz", 0.96
        return "Amor y Paz", 0.91

    # -------------------------------------------------------------------------
    # REGLA 5: "No" (Dedo Índice Levantado Negando)
    # -------------------------------------------------------------------------
    # Solo el dedo índice extendido apuntando arriba; medio, anular y meñique doblados.
    if i_ext and (not m_ext) and (not r_ext) and (not p_ext):
        if index_y < wrist_y:
            return "No", 0.95
        return "No", 0.89

    # -------------------------------------------------------------------------
    # REGLA 6: "Si" (Puño Cerrado / Afirmación / Letra S en LSM)
    # -------------------------------------------------------------------------
    # Todos los 4 dedos (índice, medio, anular, meñique) doblados en puño.
    if (not i_ext) and (not m_ext) and (not r_ext) and (not p_ext):
        # La mano debe estar a una altura de interacción (no colgada abajo)
        if shoulder_y is None or wrist_y < shoulder_y + 0.35:
            return "Si", 0.94
        return "Reposo", 0.85

    # -------------------------------------------------------------------------
    # REGLA 7: "Gracias" (Mano Plana Frente a la Barbilla / Pecho Central)
    # -------------------------------------------------------------------------
    # Los 4 dedos principales extendidos y juntos (mano plana).
    # Ubicada entre la barbilla/boca y el pecho superior, en la línea media facial.
    # Se excluyen explícitamente posiciones por encima de la barbilla/nariz (saludo).
    if i_ext and m_ext and r_ext and p_ext:
        wrist_x = hand_state["wrist"][0]
        is_central = True
        if nose_x is not None:
            is_central = abs(wrist_x - nose_x) < 0.16

        if dist_im < 0.32 and is_central:
            if nose_y is not None and shoulder_y is not None:
                # Estrictamente entre barbilla/boca (nose_y + 0.08) y pecho superior (shoulder_y + 0.05)
                if (nose_y + 0.08) <= wrist_y <= (shoulder_y + 0.05):
                    return "Gracias", 0.94
            elif 0.40 <= wrist_y <= 0.60:
                return "Gracias", 0.90

    # -------------------------------------------------------------------------
    # REGLA 8: "Hola" (Mano Abierta Levantada / Saludo)
    # -------------------------------------------------------------------------
    # Los 4 dedos extendidos (y posiblemente el pulgar), mano levantada o lateral.
    if i_ext and m_ext and r_ext and p_ext:
        # Mano arriba del hombro o en posición de saludo
        if shoulder_y is not None:
            if wrist_y < shoulder_y + 0.10:
                return "Hola", 0.95
        elif wrist_y < 0.70:
            return "Hola", 0.92

    # -------------------------------------------------------------------------
    # REGLA 9: "Reposo"
    # -------------------------------------------------------------------------
    return "Reposo", 0.80


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
          - "label": str — Seña reconocida ("Hola", "Gracias", "Si", etc.) o None si no hay mano visible
          - "confidence": float — Nivel de certeza de la regla (0.0 a 1.0)
          - "latency_ms": float — Tiempo de cálculo en milisegundos (< 2ms)
          - "all_probabilities": dict — Diccionario con probabilidades por etiqueta (simula softmax)
          - "is_demo": True — Bandera explícita indicando ejecución en modo demo
    """
    start_time = time.perf_counter()

    # Normalizar entrada: si es lista de frames, seleccionar el frame más reciente con manos
    target_frame: Optional[Dict[str, Any]] = None

    if isinstance(landmarks_input, list):
        if not landmarks_input:
            latency_ms = (time.perf_counter() - start_time) * 1000
            return _build_empty_result(latency_ms)

        # Buscar de atrás hacia adelante el último frame que tenga datos de mano
        for frame in reversed(landmarks_input):
            if isinstance(frame, dict) and (frame.get("rightHand") or frame.get("leftHand")):
                target_frame = frame
                break

        # Si ninguno tiene manos, tomar el último frame
        if target_frame is None and len(landmarks_input) > 0:
            target_frame = landmarks_input[-1]

    elif isinstance(landmarks_input, dict):
        target_frame = landmarks_input
    else:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms)

    if not target_frame:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms)

    # Extraer manos y pose
    right_hand = target_frame.get("rightHand") or target_frame.get("right_hand")
    left_hand = target_frame.get("leftHand") or target_frame.get("left_hand")
    pose = target_frame.get("pose")

    # Evaluar mano dominante (preferencia mano derecha, luego mano izquierda)
    active_hand = right_hand if (right_hand and len(right_hand) >= 21) else left_hand

    if not active_hand or len(active_hand) < 21:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms)

    # Analizar geometría de dedos
    hand_state = analyze_hand_fingers(active_hand)
    if not hand_state:
        latency_ms = (time.perf_counter() - start_time) * 1000
        return _build_empty_result(latency_ms)

    # Clasificar mediante reglas fijas
    label, confidence = classify_frame_by_rules(hand_state, pose)

    latency_ms = (time.perf_counter() - start_time) * 1000

    # Construir distribución de probabilidades simulada (compatible con UI top-5)
    all_probs = _generate_probabilities(label, confidence)

    return {
        "label": label,
        "confidence": round(confidence, 4),
        "latency_ms": round(latency_ms, 2),
        "all_probabilities": all_probs,
        "is_demo": True
    }


def _build_empty_result(latency_ms: float) -> Dict[str, Any]:
    """Construye una respuesta cuando no se detectan manos en el frame."""
    return {
        "label": None,
        "confidence": 0.0,
        "latency_ms": round(latency_ms, 2),
        "all_probabilities": {lbl: 0.0 for lbl in DEMO_LABELS},
        "is_demo": True
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
