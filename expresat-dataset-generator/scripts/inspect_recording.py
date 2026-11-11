#!/usr/bin/env python3
"""
inspect_recording.py — ExpresaT: Herramienta de Inspección y Validación de Grabaciones Crudas

Procesa una grabación real de ~5 s (o cualquier archivo .raw.json / .json) a través del extractor canónico v1.2.2.
Responsabilidades:
  1. Tabla temporal frame a frame con timestamps, categoryName MediaPipe y bloque anatómico asignado.
  2. Verificación de la convención de lateralidad:
     - Mano DERECHA del firmante -> MediaPipe categoryName: 'Left' -> Bloque asignado: rightHand [115..177].
     - Mano IZQUIERDA del firmante -> MediaPipe categoryName: 'Right' -> Bloque asignado: leftHand [52..114].
  3. Detección exhaustiva de NaN, Inf y desglose de frames inválidos por código de error.
  4. Estadísticas y rangos numéricos min/max por bloque de características.

Uso:
  python expresat-dataset-generator/scripts/inspect_recording.py --file <ruta_grabacion.json>
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

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


def load_recording(file_path: Path) -> list[dict]:
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if "frames" in data and isinstance(data["frames"], list):
            return data["frames"]
        if "raw_frames" in data and isinstance(data["raw_frames"], list):
            return data["raw_frames"]
        # Posiblemente un único frame
        return [data]

    raise ValueError(f"Formato no reconocido en {file_path}")


def inspect_recording(frames: list[dict], verbose: bool = False):
    print("================================================================================")
    print(f"   EXPRESAT — REPORTE DE INSPECCIÓN DE GRABACIÓN REAL (FEATURE_SPEC v{FEATURE_SPEC_VERSION})")
    print("================================================================================")
    print(f"Total de frames leídos: {len(frames)}")

    if not frames:
        print("Error: la grabación no contiene frames.")
        return

    # Duración estimada
    t_start = float(frames[0].get("timestamp_ms", 0.0))
    t_end = float(frames[-1].get("timestamp_ms", 0.0))
    duration_s = (t_end - t_start) / 1000.0
    print(f"Rango temporal:        t_0 = {t_start:.1f} ms -> t_final = {t_end:.1f} ms ({duration_s:.2f} s)")

    # 1. Tabla de asignación temporal de lateralidad
    print("\n--------------------------------------------------------------------------------")
    print(" 1. TABLA TEMPORAL DE DETECCIÓN Y ASIGNACIÓN DE LATERALIDAD")
    print("--------------------------------------------------------------------------------")
    print(" Regla canónica:")
    print("   * Mano DERECHA física -> MediaPipe 'Left'  -> Bloque: rightHand [115..177]")
    print("   * Mano IZQUIERDA física -> MediaPipe 'Right' -> Bloque: leftHand [52..114]")
    print("--------------------------------------------------------------------------------")
    header = f"{'Frame':<6} | {'t (ms)':<9} | {'Hombros D':<10} | {'MP Label(s)':<16} | {'Bloque Izq [52..114]':<22} | {'Bloque Der [115..177]':<22} | {'Estado':<10}"
    print(header)
    print("-" * len(header))

    invalid_reasons: dict[str, int] = {}
    valid_frames_count = 0
    all_extracted_features = []
    has_nan_or_inf = False

    # Paso de muestreo para no saturar si son 150 frames
    step = 1 if len(frames) <= 30 or verbose else max(1, len(frames) // 25)

    for idx, fr in enumerate(frames):
        ts = float(fr.get("timestamp_ms", idx * 33.333))
        feats, valid, error = extract_frame_features(fr)

        if not valid:
            invalid_reasons[error] = invalid_reasons.get(error, 0) + 1
            if idx % step == 0:
                print(f"{idx:<6} | {ts:<9.1f} | {'N/A':<10} | {'N/A':<16} | {'None':<22} | {'None':<22} | {error:<10}")
            continue

        valid_frames_count += 1
        all_extracted_features.append(feats)

        # Chequeo de NaN/Inf
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

        # Formatear etiquetas MediaPipe
        raw_handedness = fr.get("handedness", [])
        mp_labels = []
        for h in raw_handedness:
            if isinstance(h, list) and len(h) > 0 and isinstance(h[0], dict):
                mp_labels.append(h[0].get("categoryName", "?"))
            elif isinstance(h, dict):
                mp_labels.append(h.get("categoryName", "?"))
        mp_str = ",".join(mp_labels) if mp_labels else "sin etiqueta"

        # Formatear slot asignado
        left_str = "Mano Izq (activa)" if assigned_l is not None else "--- (ausente)"
        right_str = "Mano Der (activa)" if assigned_r is not None else "--- (ausente)"
        if is_ambig:
            right_str += " [AMBIG]"

        if idx % step == 0 or idx == len(frames) - 1:
            print(f"{idx:<6} | {ts:<9.1f} | {d_val:<10.4f} | {mp_str:<16} | {left_str:<22} | {right_str:<22} | {'OK':<10}")

    # 2. Resumen de Validez y Detección de Anomalías
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

    # 3. Rangos y Estadísticas por Bloque de Características
    if all_extracted_features:
        stack = np.stack(all_extracted_features, axis=0)  # (N, 178)

        pose_slice = stack[:, 0:52]
        left_slice = stack[:, 52:115]
        right_slice = stack[:, 115:178]

        print("\n--------------------------------------------------------------------------------")
        print(" 3. RANGOS NUMÉRICOS POR BLOQUE (FEATURES NORMALIZADAS)")
        print("--------------------------------------------------------------------------------")
        print(f"Upper Pose [0..51]:     Min: {np.min(pose_slice):.4f} | Max: {np.max(pose_slice):.4f} | Media: {np.mean(pose_slice):.4f}")
        print(f"Mano Izquierda [52..114]: Min: {np.min(left_slice):.4f} | Max: {np.max(left_slice):.4f} | Media: {np.mean(left_slice):.4f}")
        print(f"Mano Derecha [115..177]:  Min: {np.min(right_slice):.4f} | Max: {np.max(right_slice):.4f} | Media: {np.mean(right_slice):.4f}")

    # 4. Prueba de Ventana Completa (ExtractWindow)
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

    print("================================================================================\n")


def main():
    parser = argparse.ArgumentParser(description="Inspección de grabaciones crudas de ExpresaT v1.2.2")
    parser.add_argument("--file", type=str, required=True, help="Ruta al archivo .json de la grabación")
    parser.add_argument("--verbose", action="store_true", help="Imprimir todos los frames sin submuestreo")
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: No se encontró el archivo {file_path}")
        sys.exit(1)

    frames = load_recording(file_path)
    inspect_recording(frames, verbose=args.verbose)


if __name__ == "__main__":
    main()
