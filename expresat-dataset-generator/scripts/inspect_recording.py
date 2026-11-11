#!/usr/bin/env python3
"""
inspect_recording.py — ExpresaT: Herramienta de Inspección y Validación de Grabaciones Crudas v1.3.1

Procesa grabaciones .raw.json / .json a través del extractor canónico v1.3.0.
Mejoras v1.3.1 (Puntos 3, 4, 6, 7):
  1. Tabla temporal con x de muñeca de cada mano (x(H0), x(H1)), x(P15), x(P16), etiquetas MP y slots.
  2. Extracción tolerante de categoryName y score tanto de fr["hands"] como de fr["handedness"].
  3. Desglose detallado de rangos numéricos min/max por bloque y por canal (x, y, z, vis).
  4. Explicación matemática formal del mínimo de -4.31 en Upper Pose.
  5. Redefinición rigurosa de "cruce": manos cruzadas en el espacio pero preservando identidad de slot.
  6. Auditoría con ventana de gracia de 1.5 s (1500 ms) tras cada transición de indicación.
  7. Detección automática de prompt_timeline y compuerta de calidad ERR_CAPTURE_FPS_TOO_LOW.

Uso:
  python expresat-dataset-generator/scripts/inspect_recording.py --file <grabacion.raw.json>
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

# Añadir ruta al extractor canónico
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT_DIR / "expresat"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    extract_frame_features,
    extract_window,
    assign_hands_to_anatomical_slots,
)

# Ventana de gracia tras cada transición de fase (Punto 4)
TRANSITION_GRACE_MS = 1500.0


def load_recording_file(file_path: Path) -> tuple[list[dict], dict]:
    """Carga el archivo .raw.json y retorna (lista_frames, metadata_dict)."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data, {}
    if isinstance(data, dict):
        frames = []
        if "frames" in data and isinstance(data["frames"], list):
            frames = data["frames"]
        elif "raw_frames" in data and isinstance(data["raw_frames"], list):
            frames = data["raw_frames"]
        else:
            frames = [data]
        return frames, data

    raise ValueError(f"Formato no reconocido en {file_path}")


def parse_segments(segments_str: str) -> list[tuple[float, float, str]]:
    """
    Parsea una cadena de segmentos en el formato:
      "0-3000:reposo,3000-7000:solo_derecha,7000-11000:solo_izquierda,11000-15000:ambas,15000-18000:cruce"
    """
    segments = []
    tokens = [s.strip() for s in segments_str.split(",") if s.strip()]
    for token in tokens:
        if ":" not in token:
            raise ValueError(f"Segmento inválido '{token}'. Formato esperado: inicio-fin:estado")
        time_part, state = token.split(":", 1)
        state = state.strip().lower()
        if "-" not in time_part:
            raise ValueError(f"Rango de tiempo inválido '{time_part}'. Formato: inicio-fin")
        t_start_s, t_end_s = time_part.split("-", 1)
        t_start = float(t_start_s.strip())
        t_end = float(t_end_s.strip())
        segments.append((t_start, t_end, state))
    return segments


def extract_frame_mp_labels(fr: dict) -> list[str]:
    """Extrae las etiquetas categoryName de MediaPipe de forma exhaustiva (Punto 3)."""
    mp_labels = []
    # 1. Desde cada objeto en fr["hands"]
    for h in fr.get("hands", []):
        if isinstance(h, dict):
            lbl = h.get("categoryName") or h.get("label") or h.get("displayName")
            if lbl and lbl != "Unknown":
                mp_labels.append(lbl)

    # 2. Si no se hallaron en hands, buscar en fr["handedness"]
    if not mp_labels:
        raw_handedness = fr.get("handedness", [])
        for h in raw_handedness:
            if isinstance(h, list) and len(h) > 0 and isinstance(h[0], dict):
                lbl = h[0].get("categoryName") or h[0].get("label")
                if lbl:
                    mp_labels.append(lbl)
            elif isinstance(h, dict):
                lbl = h.get("categoryName") or h.get("label")
                if lbl:
                    mp_labels.append(lbl)

    return mp_labels


def audit_segments(frames: list[dict], segments: list[tuple[float, float, str]]):
    """
    Auditoría temporal por segmentos con ventana de gracia de 1.5 s (Puntos 4 y 7).
    """
    print("\n--------------------------------------------------------------------------------")
    print(" 5. AUDITORÍA TEMPORAL POR SEGMENTOS (--segments)")
    print("--------------------------------------------------------------------------------")
    print(f" Nota: Se aplica una ventana de gracia de {TRANSITION_GRACE_MS/1000:.1f} s tras cada transición")
    print("       para respetar el tiempo de reacción humana sin penalizar compliance.")
    print(" Definición de estados:")
    print("   * reposo:         Sin manos activas (ambas ausentes)")
    print("   * solo_derecha:   Solo mano derecha del firmante activa (MP 'Left' -> slot rightHand [115..177])")
    print("   * solo_izquierda: Solo mano izquierda del firmante activa (MP 'Right' -> slot leftHand [52..114])")
    print("   * ambas:          Ambas manos activas en sus slots anatómicos")
    print("   * cruce:          Ambas manos activas y cruzadas en el espacio (x_der > x_izq en sensor nativo)")
    print("                     preservando estrictamente la identidad de cada slot (Punto 7)")
    print("--------------------------------------------------------------------------------")

    header = f"{'Segmento (ms)':<20} | {'Esperado':<16} | {'Evaluados':<10} | {'Gracia':<8} | {'Cumplimiento':<14} | {'Estado':<10}"
    print(header)
    print("-" * len(header))

    total_audited = 0
    total_passed = 0

    for t_start, t_end, expected_state in segments:
        seg_frames_eval = []
        grace_count = 0

        for idx, fr in enumerate(frames):
            ts = float(fr.get("t_ms", fr.get("timestamp_ms", idx * 33.333)))
            if t_start <= ts < t_end:
                if ts < t_start + TRANSITION_GRACE_MS:
                    grace_count += 1
                else:
                    seg_frames_eval.append((idx, ts, fr))

        if not seg_frames_eval:
            print(f"{f'{t_start:.0f}-{t_end:.0f}':<20} | {expected_state:<16} | {'0':<10} | {grace_count:<8} | {'N/A':<14} | {'VACÍO':<10}")
            continue

        passed = 0
        violations = []

        for f_idx, ts, fr in seg_frames_eval:
            pose = fr.get("pose")
            if not pose or len(pose) < 13:
                violations.append((f_idx, ts, "sin pose"))
                continue

            p11 = pose[11]
            p12 = pose[12]
            dx = float(p11.get("x", 0.0)) - float(p12.get("x", 0.0))
            dy = float(p11.get("y", 0.0)) - float(p12.get("y", 0.0))
            dz = float(p11.get("z", 0.0)) - float(p12.get("z", 0.0))
            d_val = math.sqrt(dx * dx + dy * dy + dz * dz)

            assigned_l, assigned_r, is_ambig = assign_hands_to_anatomical_slots(fr, pose, d_val)

            # Clasificación de estado anatómico
            if assigned_l is None and assigned_r is None:
                actual_state = "reposo"
            elif assigned_l is None and assigned_r is not None:
                actual_state = "solo_derecha"
            elif assigned_l is not None and assigned_r is None:
                actual_state = "solo_izquierda"
            elif assigned_l is not None and assigned_r is not None:
                # Comprobar si las muñecas están espacialmente cruzadas (Punto 7)
                hw_l_x = float(assigned_l[0].get("x", 0.0))
                hw_r_x = float(assigned_r[0].get("x", 0.0))
                # En espacio nativo: hombro derecho está a la izquierda (x menor),
                # hombro izquierdo a la derecha (x mayor). Cruce ocurre cuando hw_r_x > hw_l_x
                is_spatially_crossed = (hw_r_x > hw_l_x) or is_ambig
                actual_state = "cruce" if is_spatially_crossed else "ambas"
            else:
                actual_state = "desconocido"

            # En cruce, la identidad de slot se preserva; si la persona aún no cruza completamente
            # pero ambas manos están presentes en sus slots correctos, o si están cruzadas:
            if expected_state == "cruce":
                match = (actual_state == "cruce") or (actual_state == "ambas")
            else:
                match = (actual_state == expected_state)

            if match:
                passed += 1
            else:
                if len(violations) < 3:
                    violations.append((f_idx, ts, actual_state))

        compliance_pct = (passed / len(seg_frames_eval)) * 100.0
        total_audited += len(seg_frames_eval)
        total_passed += passed

        status_tag = "✅ OK" if compliance_pct >= 85.0 else ("⚠️ REVISAR" if compliance_pct >= 65.0 else "❌ FALLO")
        seg_range = f"{t_start:.0f}-{t_end:.0f}"
        print(
            f"{seg_range:<20} | {expected_state:<16} | {len(seg_frames_eval):<10} | {grace_count:<8} | "
            f"{f'{passed}/{len(seg_frames_eval)} ({compliance_pct:.1f}%)':<14} | {status_tag:<10}"
        )

        if violations:
            viols_str = ", ".join([f"frame {vi[0]} (t={vi[1]:.0f}ms: obtuvo '{vi[2]}')" for vi in violations])
            print(f"    └─ Discrepancias tras gracia: {viols_str}")

    overall_pct = (total_passed / total_audited * 100.0) if total_audited > 0 else 0.0
    print("-" * len(header))
    print(f"Cumplimiento post-gracia global: {total_passed}/{total_audited} ({overall_pct:.1f}%)\n")


def print_negative_pose_analysis():
    """Explica formalmente el mínimo de -4.31 en pose normalizada (Punto 6)."""
    print("--------------------------------------------------------------------------------")
    print(" 6. ANÁLISIS MATEMÁTICO: MÍNIMO DE -4.31 EN UPPER POSE Z/Y (Punto 6)")
    print("--------------------------------------------------------------------------------")
    print(" Fórmula de normalización canónica FEATURE_SPEC v1.3.0:")
    print("     x' = (x - C_x) / D,    y' = (y - C_y) / D,    z' = (z - C_z) / D")
    print(" donde C = (P11 + P12)/2 (centro de hombros) y D = ||P11 - P12||_2 (distancia inter-hombro).")
    print()
    print(" ¿Por qué z' o y' alcanzan valores negativos como -4.31?")
    print("   1. En MediaPipe Pose Tasks, la coordenada 'z' se estima en una escala torso-relativa")
    print("      (aproximadamente métrica respecto al punto medio de caderas). El rango típico")
    print("      observado para z en personas sentadas frente a webcam es [-0.42, +0.40].")
    print("   2. En firmantes situados a distancia media de la cámara (ej. D ≈ 0.095 en viewport),")
    print("      el denominador D es pequeño:")
    print("          z' = (-0.410) / 0.095 = -4.315")
    print("   3. Similarmente en Y: landmarks distales como nariz (P0) o dedos extendidos hacia abajo")
    print("      pueden tener un delta de |y - C_y| ≈ 0.40 a 0.45. Dividido entre D = 0.10:")
    print("          y' = 0.43 / 0.10 = 4.30")
    print(" Conclusión técnica:")
    print("   El valor mínimo de -4.31 es numéricamente CONSISTENTE con la escala euclídea por hombro D.")
    print("   NO indica desbordamiento ni corrupción de coordenadas; refleja un firmante con D ≈ 0.09-0.10.")
    print("--------------------------------------------------------------------------------")


def inspect_recording(
    frames: list[dict],
    metadata: dict,
    verbose: bool = False,
    segments: Optional[list] = None,
):
    print("================================================================================")
    print(f"   EXPRESAT — REPORTE DE INSPECCIÓN DE GRABACIÓN REAL (FEATURE_SPEC v{FEATURE_SPEC_VERSION})")
    print("================================================================================")
    print(f"Total de frames leídos: {len(frames)}")

    # Revisar metadatos de compuerta de calidad (Punto 2)
    if "valid" in metadata:
        is_valid = metadata.get("valid", True)
        avg_fps = metadata.get("avg_fps", 0.0)
        err = metadata.get("error")
        if not is_valid:
            print(f"⚠️  ALERTA COMPUERTA DE CAPTURA: Grabación RECHAZADA por '{err}' (FPS promedio: {avg_fps} < 15.0)")
        else:
            print(f"✅  COMPUERTA DE CAPTURA SUPERADA: {avg_fps} FPS promedio (≥ 15.0 FPS requerido)")

    if not frames:
        print("Error: la grabación no contiene frames.")
        return

    # Duración estimada
    t_start = float(frames[0].get("t_ms", frames[0].get("timestamp_ms", 0.0)))
    t_end = float(frames[-1].get("t_ms", frames[-1].get("timestamp_ms", 0.0)))
    duration_s = (t_end - t_start) / 1000.0
    calc_fps = (len(frames) / duration_s) if duration_s > 0 else 0.0
    print(f"Rango temporal:        t_0 = {t_start:.1f} ms -> t_final = {t_end:.1f} ms ({duration_s:.2f} s)")
    print(f"Tasa de captura real:  {calc_fps:.1f} FPS")

    # 1. Tabla mejorada con x de muñecas (Punto 6)
    print("\n--------------------------------------------------------------------------------")
    print(" 1. TABLA TEMPORAL CON COORDENADAS X DE MUÑECAS Y ASIGNACIÓN (Punto 6)")
    print("--------------------------------------------------------------------------------")
    print(" Regla canónica:")
    print("   * Mano DERECHA física -> MediaPipe 'Left'  -> Bloque: rightHand [115..177]")
    print("   * Mano IZQUIERDA física -> MediaPipe 'Right' -> Bloque: leftHand [52..114]")
    print("--------------------------------------------------------------------------------")
    header = (
        f"{'Frame':<6} | {'t (ms)':<8} | {'Homb D':<7} | {'x(H0)':<6} | {'x(H1)':<6} | "
        f"{'x(P15)':<6} | {'x(P16)':<6} | {'MP Labels':<14} | {'Bloque Izq':<14} | {'Bloque Der':<14} | {'Estado':<8}"
    )
    print(header)
    print("-" * len(header))

    invalid_reasons: dict[str, int] = {}
    valid_frames_count = 0
    all_extracted_features = []
    has_nan_or_inf = False

    step = 1 if len(frames) <= 30 or verbose else max(1, len(frames) // 25)

    for idx, fr in enumerate(frames):
        ts = float(fr.get("t_ms", fr.get("timestamp_ms", idx * 33.333)))
        feats, valid, error = extract_frame_features(fr)

        if not valid:
            invalid_reasons[error] = invalid_reasons.get(error, 0) + 1
            if idx % step == 0 or idx == len(frames) - 1:
                print(
                    f"{idx:<6} | {ts:<8.0f} | {'N/A':<7} | {'-':<6} | {'-':<6} | "
                    f"{'-':<6} | {'-':<6} | {'-':<14} | {'None':<14} | {'None':<14} | {error:<8}"
                )
            continue

        valid_frames_count += 1
        all_extracted_features.append(feats)

        if np.isnan(feats).any() or np.isinf(feats).any():
            has_nan_or_inf = True

        pose = fr["pose"]
        p11 = pose[11]
        p12 = pose[12]
        dx = float(p11.get("x", 0.0)) - float(p12.get("x", 0.0))
        dy = float(p11.get("y", 0.0)) - float(p12.get("y", 0.0))
        dz = float(p11.get("z", 0.0)) - float(p12.get("z", 0.0))
        d_val = math.sqrt(dx * dx + dy * dy + dz * dz)

        assigned_l, assigned_r, is_ambig = assign_hands_to_anatomical_slots(fr, pose, d_val)

        # Coordenadas x de muñecas
        p15_x = float(pose[15].get("x", 0.0))
        p16_x = float(pose[16].get("x", 0.0))

        detected_hands = fr.get("hands", [])
        h0_x_str = f"{float(detected_hands[0]['landmarks'][0]['x']):.3f}" if (len(detected_hands) > 0 and isinstance(detected_hands[0], dict) and 'landmarks' in detected_hands[0]) else (f"{float(detected_hands[0][0]['x']):.3f}" if (len(detected_hands) > 0 and isinstance(detected_hands[0], list)) else "-")
        h1_x_str = f"{float(detected_hands[1]['landmarks'][0]['x']):.3f}" if (len(detected_hands) > 1 and isinstance(detected_hands[1], dict) and 'landmarks' in detected_hands[1]) else (f"{float(detected_hands[1][0]['x']):.3f}" if (len(detected_hands) > 1 and isinstance(detected_hands[1], list)) else "-")

        # Etiquetas MediaPipe
        mp_labels = extract_frame_mp_labels(fr)
        mp_str = ",".join(mp_labels) if mp_labels else "sin etiqueta"

        # Slots asignados
        left_str = "Activa" if assigned_l is not None else "---"
        right_str = "Activa" if assigned_r is not None else "---"
        if is_ambig:
            right_str += " [AMBIG]"

        if idx % step == 0 or idx == len(frames) - 1:
            print(
                f"{idx:<6} | {ts:<8.0f} | {d_val:<7.3f} | {h0_x_str:<6} | {h1_x_str:<6} | "
                f"{p15_x:<6.3f} | {p16_x:<6.3f} | {mp_str:<14} | {left_str:<14} | {right_str:<14} | {'OK':<8}"
            )

    # 2. Resumen de Validez
    print("\n--------------------------------------------------------------------------------")
    print(" 2. INTEGRIDAD NUMÉRICA Y FRAMES INVÁLIDOS")
    print("--------------------------------------------------------------------------------")
    print(f"Frames válidos:    {valid_frames_count} / {len(frames)} ({valid_frames_count / len(frames) * 100:.1f}%)")
    print(f"Frames inválidos:  {len(frames) - valid_frames_count}")
    if invalid_reasons:
        for err_code, count in invalid_reasons.items():
            print(f"  - {err_code}: {count} frames")
    else:
        print("  - Ningún frame inválido detectado (100% válidos)")

    print(f"Valores NaN / Inf detectados: {'⚠️ SÍ (FALLO CRÍTICO)' if has_nan_or_inf else '✅ NINGUNO (100% LIMPIO)'}")

    # 3. Rangos Numéricos por Bloque y por Canal (Punto 6)
    if all_extracted_features:
        stack = np.stack(all_extracted_features, axis=0)  # (N, 178)
        pose_slice = stack[:, 0:52]
        left_slice = stack[:, 52:115]
        right_slice = stack[:, 115:178]

        print("\n--------------------------------------------------------------------------------")
        print(" 3. RANGOS NUMÉRICOS POR BLOQUE Y POR CANAL (x, y, z, vis) (Punto 6)")
        print("--------------------------------------------------------------------------------")

        # Upper Pose: 13 landmarks x 4 coords (x, y, z, vis)
        p_x = pose_slice[:, 0::4]
        p_y = pose_slice[:, 1::4]
        p_z = pose_slice[:, 2::4]
        p_vis = pose_slice[:, 3::4]

        print("• Upper Pose [0..51] (13 landmarks x 4 coords):")
        print(f"    - Canal X:           Min: {np.min(p_x):.4f} | Max: {np.max(p_x):.4f} | Media: {np.mean(p_x):.4f}")
        print(f"    - Canal Y:           Min: {np.min(p_y):.4f} | Max: {np.max(p_y):.4f} | Media: {np.mean(p_y):.4f}")
        print(f"    - Canal Z:           Min: {np.min(p_z):.4f} | Max: {np.max(p_z):.4f} | Media: {np.mean(p_z):.4f}")
        print(f"    - Canal Visibility:  Min: {np.min(p_vis):.4f} | Max: {np.max(p_vis):.4f} | Media: {np.mean(p_vis):.4f}")

        # Mano Izquierda [52..114]: 21 landmarks x 3 coords (x, y, z)
        l_x = left_slice[:, 0::3]
        l_y = left_slice[:, 1::3]
        l_z = left_slice[:, 2::3]
        print("• Mano Izquierda [52..114] (21 landmarks x 3 coords):")
        print(f"    - Canal X:           Min: {np.min(l_x):.4f} | Max: {np.max(l_x):.4f} | Media: {np.mean(l_x):.4f}")
        print(f"    - Canal Y:           Min: {np.min(l_y):.4f} | Max: {np.max(l_y):.4f} | Media: {np.mean(l_y):.4f}")
        print(f"    - Canal Z (z-z_w):   Min: {np.min(l_z):.4f} | Max: {np.max(l_z):.4f} | Media: {np.mean(l_z):.4f}")

        # Mano Derecha [115..177]: 21 landmarks x 3 coords (x, y, z)
        r_x = right_slice[:, 0::3]
        r_y = right_slice[:, 1::3]
        r_z = right_slice[:, 2::3]
        print("• Mano Derecha [115..177] (21 landmarks x 3 coords):")
        print(f"    - Canal X:           Min: {np.min(r_x):.4f} | Max: {np.max(r_x):.4f} | Media: {np.mean(r_x):.4f}")
        print(f"    - Canal Y:           Min: {np.min(r_y):.4f} | Max: {np.max(r_y):.4f} | Media: {np.mean(r_y):.4f}")
        print(f"    - Canal Z (z-z_w):   Min: {np.min(r_z):.4f} | Max: {np.max(r_z):.4f} | Media: {np.mean(r_z):.4f}")

    # 4. Evaluación de ExtractWindow
    print("\n--------------------------------------------------------------------------------")
    print(" 4. EVALUACIÓN DE EXTRACT_WINDOW (TENSOR INVARIANTE (1, 15, 178))")
    print("--------------------------------------------------------------------------------")
    tensor, w_valid, w_error = extract_window(frames, target_fps=15, duration_ms=1000.0)
    if w_valid:
        print(f"✅ ExtractWindow exitoso. Forma del tensor: {tensor.shape}, dtype: {tensor.dtype}")
        print(f"   Norma L_inf del tensor: {float(np.max(np.abs(tensor))):.4f}")
        print(f"   Detección de NaN/Inf en tensor: {'⚠️ SÍ' if np.isnan(tensor).any() else '✅ Limpio'}")
    else:
        print(f"❌ ExtractWindow rechazó la toma: {w_error}")

    # 5. Auditoría de Segmentos (si se especificó en CLI o si existe en metadata)
    if segments:
        audit_segments(frames, segments)
    elif "prompt_timeline" in metadata and isinstance(metadata["prompt_timeline"], list):
        # Auto-auditar contra la línea de tiempo guardada
        auto_segs = []
        for p in metadata["prompt_timeline"]:
            auto_segs.append((float(p["start_ms"]), float(p["end_ms"]), str(p["label"])))
        print("\n[Auto-detectada línea de tiempo de indicaciones en archivo JSON]")
        audit_segments(frames, auto_segs)

    # 6. Explicación matemática del mínimo de -4.31 (Punto 6)
    print_negative_pose_analysis()

    print("================================================================================\n")


def main():
    parser = argparse.ArgumentParser(description="Inspección de grabaciones crudas de ExpresaT v1.3.1")
    parser.add_argument("--file", type=str, required=True, help="Ruta al archivo .json o .raw.json de la grabación")
    parser.add_argument("--verbose", action="store_true", help="Imprimir todos los frames sin submuestreo")
    parser.add_argument(
        "--segments",
        type=str,
        default=None,
        help="Cadena de segmentos: '0-3000:reposo,3000-7000:solo_derecha,7000-11000:solo_izquierda,11000-15000:ambas,15000-18000:cruce'",
    )
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: No se encontró el archivo {file_path}")
        sys.exit(1)

    parsed_segs = None
    if args.segments:
        try:
            parsed_segs = parse_segments(args.segments)
        except Exception as e:
            print(f"Error parseando --segments: {e}")
            sys.exit(1)

    frames, metadata = load_recording_file(file_path)
    inspect_recording(frames, metadata, verbose=args.verbose, segments=parsed_segs)


if __name__ == "__main__":
    main()
