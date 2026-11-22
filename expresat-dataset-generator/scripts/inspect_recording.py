#!/usr/bin/env python3
"""
inspect_recording.py - Raw recording inspection and validation CLI tool (FEATURE_SPEC v1.3.1).

Processes `.raw.json` / `.json` recordings through the canonical feature extractor:
  1. Timeline table with per-hand wrist X coordinates, pose wrists P15/P16, MP labels, and assigned slots.
  2. Extraction of categoryName and score from `hands` and parallel `handedness` entries.
  3. Detailed numeric min/max breakdowns per feature block and channel (x, y, z, vis).
  4. Upper Pose extreme coordinate breakdown.
  5. Crossed-hands check preserving strict anatomical slot identity.
  6. Segment compliance audit with a 1.5 s (1500 ms) grace window after transitions.
  7. Auto-detection of `prompt_timeline` and ERR_CAPTURE_FPS_TOO_LOW quality gate check.

Usage:
  python expresat-dataset-generator/scripts/inspect_recording.py --file <recording.raw.json>
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

# Add canonical feature extractor module path
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT_DIR / "expresat"))

from models.feature_extractor import (
    FEATURE_SPEC_VERSION,
    extract_frame_features,
    extract_window,
    assign_hands_to_anatomical_slots,
)

# Transition grace window applied after phase boundaries
TRANSITION_GRACE_MS = 1500.0


def load_recording_file(file_path: Path) -> tuple[list[dict], dict]:
    """Loads a .raw.json recording file and returns (frames_list, metadata_dict)."""
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


def _extract_hand_label_and_score(
    hand_item: Any,
    handedness_item: Any = None,
) -> tuple[Optional[str], Optional[float]]:
    """Extracts (categoryName, score) from a hand object or its parallel handedness entry."""
    lbl: Optional[str] = None
    score: Optional[float] = None

    if isinstance(hand_item, dict):
        raw_lbl = hand_item.get("categoryName") or hand_item.get("label") or hand_item.get("displayName")
        if raw_lbl is not None and str(raw_lbl).strip() != "":
            lbl = str(raw_lbl).strip()
        if hand_item.get("score") is not None:
            try:
                score = float(hand_item["score"])
            except (TypeError, ValueError):
                score = None

    if (lbl is None or lbl == "Unknown") and handedness_item is not None:
        entry = handedness_item[0] if isinstance(handedness_item, list) and len(handedness_item) > 0 else handedness_item
        if isinstance(entry, dict):
            raw_lbl = entry.get("categoryName") or entry.get("label") or entry.get("displayName")
            if raw_lbl is not None and str(raw_lbl).strip() != "":
                lbl = str(raw_lbl).strip()
            if score is None and entry.get("score") is not None:
                try:
                    score = float(entry["score"])
                except (TypeError, ValueError):
                    score = None

    return lbl, score


def extract_frame_mp_labels(fr: dict) -> list[str]:
    """Extracts MediaPipe categoryName labels aligned with each detected hand."""
    hands_raw = fr.get("hands", [])
    raw_handedness = fr.get("handedness", [])
    mp_labels: list[str] = []

    if isinstance(hands_raw, list) and len(hands_raw) > 0:
        for idx, h in enumerate(hands_raw):
            h_entry = raw_handedness[idx] if isinstance(raw_handedness, list) and idx < len(raw_handedness) else None
            lbl, _ = _extract_hand_label_and_score(h, h_entry)
            if not lbl:
                mp_labels.append("sin etiqueta")
            else:
                mp_labels.append(lbl)
        return mp_labels

    # Fallback when hands list is missing but handedness is present
    if isinstance(raw_handedness, list):
        for h_entry in raw_handedness:
            lbl, _ = _extract_hand_label_and_score(None, h_entry)
            if lbl:
                mp_labels.append(lbl)

    return mp_labels


def collect_hand_detection_rows(frames: list[dict]) -> list[dict[str, Any]]:
    """
    Builds per-detection rows comparing spatial proximity to pose wrists (P15=leftHand,
    P16=rightHand) against MediaPipe handedness under FEATURE_SPEC v1.3.0.
    """
    rows: list[dict[str, Any]] = []
    for f_idx, fr in enumerate(frames):
        ts = float(fr.get("t_ms", fr.get("timestamp_ms", f_idx * 33.333)))
        pose = fr.get("pose")
        hands = fr.get("hands") or []
        handedness = fr.get("handedness") or []
        if not pose or len(pose) < 17 or not hands:
            continue

        p15 = pose[15]
        p16 = pose[16]
        p15_x = float(p15.get("x", 0.0))
        p15_y = float(p15.get("y", 0.0))
        p16_x = float(p16.get("x", 0.0))
        p16_y = float(p16.get("y", 0.0))

        for h_idx, h in enumerate(hands):
            lms = h.get("landmarks") if isinstance(h, dict) else (h if isinstance(h, list) else None)
            if not lms:
                continue
            h_entry = handedness[h_idx] if isinstance(handedness, list) and h_idx < len(handedness) else None
            cat, score = _extract_hand_label_and_score(h, h_entry)
            wx = float(lms[0].get("x", 0.0))
            wy = float(lms[0].get("y", 0.0))

            d15 = math.hypot(wx - p15_x, wy - p15_y)
            d16 = math.hypot(wx - p16_x, wy - p16_y)
            pose_block = "leftHand" if d15 <= d16 else "rightHand"

            if cat == "Left":
                label_block_spec = "rightHand"
                label_block_direct = "leftHand"
            elif cat == "Right":
                label_block_spec = "leftHand"
                label_block_direct = "rightHand"
            else:
                label_block_spec = "sin_etiqueta"
                label_block_direct = "sin_etiqueta"

            rows.append({
                "det_idx": len(rows) + 1,
                "frame_idx": f_idx,
                "t_ms": ts,
                "hand_idx": h_idx,
                "categoryName": cat or "sin etiqueta",
                "score": score,
                "wrist_x": wx,
                "p15_x": p15_x,
                "p16_x": p16_x,
                "pose_block": pose_block,
                "label_block_spec": label_block_spec,
                "match_spec": (pose_block == label_block_spec) if label_block_spec != "sin_etiqueta" else None,
                "match_direct": (pose_block == label_block_direct) if label_block_direct != "sin_etiqueta" else None,
            })
    return rows


def print_detections_table(frames: list[dict]) -> None:
    """Prints per-hand detection table comparing Pose wrist proximity against MediaPipe handedness."""
    rows = collect_hand_detection_rows(frames)
    print("\n--------------------------------------------------------------------------------")
    print(" 1B. TABLA POR DETECCIÓN DE MANO: POSE (P15/P16) vs ETIQUETA (categoryName)")
    print("--------------------------------------------------------------------------------")
    if not rows:
        print("No se encontraron detecciones de mano con pose válida (P15/P16).")
        return

    print(" Regla evaluada:")
    print("   * Bloque según Pose:      d(muñeca, P15) <= d(muñeca, P16) -> leftHand | > -> rightHand")
    print("   * Bloque según Etiqueta:  spec v1.3.0 ('Left'->rightHand, 'Right'->leftHand)")
    print("--------------------------------------------------------------------------------")
    header = (
        f"{'Det':<4} | {'Fr':<3} | {'t (ms)':<7} | {'H':<2} | {'categoryName':<12} | {'score':<6} | "
        f"{'x(mano)':<7} | {'x(P15)':<7} | {'x(P16)':<7} | {'Bloque Pose':<11} | {'Bloque Etiq':<11} | {'¿Coincide?':<10}"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        score_s = f"{r['score']:.4f}" if r["score"] is not None else "-"
        coinc_s = "SÍ" if r["match_spec"] is True else ("NO" if r["match_spec"] is False else "N/A")
        print(
            f"{r['det_idx']:<4} | {r['frame_idx']:<3} | {r['t_ms']:<7.0f} | H{r['hand_idx']:<1} | "
            f"{r['categoryName']:<12} | {score_s:<6} | {r['wrist_x']:<7.4f} | {r['p15_x']:<7.4f} | "
            f"{r['p16_x']:<7.4f} | {r['pose_block']:<11} | {r['label_block_spec']:<11} | {coinc_s:<10}"
        )

    total = len(rows)
    labeled = [r for r in rows if r["match_spec"] is not None]
    matches_spec = sum(1 for r in labeled if r["match_spec"])
    matches_direct = sum(1 for r in labeled if r["match_direct"])
    left_cnt = sum(1 for r in rows if r["categoryName"] == "Left")
    right_cnt = sum(1 for r in rows if r["categoryName"] == "Right")
    first = rows[0]

    print("-" * len(header))
    print(f"Resumen de coincidencia (total detecciones: {total}, etiquetadas Left/Right: {len(labeled)}):")
    print(f"  - Conteo etiquetas: 'Left'={left_cnt}, 'Right'={right_cnt}, otras={total - left_cnt - right_cnt}")
    if labeled:
        print(
            f"  - Coincidencia Pose vs Etiqueta (regla spec v1.3.0 'Left'->rightHand, 'Right'->leftHand): "
            f"{matches_spec}/{len(labeled)} ({matches_spec / len(labeled) * 100:.1f}%)"
        )
        print(
            f"  - Coincidencia Pose vs Etiqueta (convención directa 'Left'->leftHand, 'Right'->rightHand): "
            f"{matches_direct}/{len(labeled)} ({matches_direct / len(labeled) * 100:.1f}%)"
        )
    x_side = "< 0.5" if first["wrist_x"] < 0.5 else ("> 0.5" if first["wrist_x"] > 0.5 else "= 0.5")
    print(
        f"  - Primera detección: frame #{first['frame_idx']} (t={first['t_ms']:.0f} ms), "
        f"x(muñeca)={first['wrist_x']:.4f} ({x_side}), x(P15)={first['p15_x']:.4f}, "
        f"x(P16)={first['p16_x']:.4f}, categoryName='{first['categoryName']}'"
    )


def audit_segments(frames: list[dict], segments: list[tuple[float, float, str]]):
    """Temporal segment compliance check with a 1.5 s transition grace window."""
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

            # Classify anatomical hand state
            if assigned_l is None and assigned_r is None:
                actual_state = "reposo"
            elif assigned_l is None and assigned_r is not None:
                actual_state = "solo_derecha"
            elif assigned_l is not None and assigned_r is None:
                actual_state = "solo_izquierda"
            elif assigned_l is not None and assigned_r is not None:
                # Check if wrists are spatially crossed
                hw_l_x = float(assigned_l[0].get("x", 0.0))
                hw_r_x = float(assigned_r[0].get("x", 0.0))
                # In raw unmirrored camera space, right shoulder has smaller x and
                # left shoulder has larger x, so crossed wrists satisfy hw_r_x > hw_l_x
                is_spatially_crossed = (hw_r_x > hw_l_x) or is_ambig
                actual_state = "cruce" if is_spatially_crossed else "ambas"
            else:
                actual_state = "desconocido"

            # During cross-over segments, slot identity is preserved before and after crossing
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

        status_tag = "[OK]" if compliance_pct >= 85.0 else ("[WARN] REVISAR" if compliance_pct >= 65.0 else "[FAIL] FALLO")
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


POSE_LANDMARK_NAMES: dict[int, str] = {
    0: "Nariz (P0)",
    11: "Hombro Izquierdo (P11)",
    12: "Hombro Derecho (P12)",
    13: "Codo Izquierdo (P13)",
    14: "Codo Derecho (P14)",
    15: "Muñeca Izquierda (P15)",
    16: "Muñeca Derecha (P16)",
    17: "Meñique Izquierdo (P17)",
    18: "Meñique Derecho (P18)",
    19: "Índice Izquierdo (P19)",
    20: "Índice Derecho (P20)",
    21: "Pulgar Izquierdo (P21)",
    22: "Pulgar Derecho (P22)",
}


def print_negative_pose_analysis(min_z_detail: Optional[dict] = None):
    """Prints the mathematical relationship of extreme z/y Upper Pose coordinates."""
    print("--------------------------------------------------------------------------------")
    print(" 6. ANÁLISIS MATEMÁTICO: COORDENADAS EXTREMAS EN UPPER POSE (Punto 5)")
    print("--------------------------------------------------------------------------------")
    print(" Fórmula de normalización canónica FEATURE_SPEC v1.3.0:")
    print("     x' = (x - C_x) / D,    y' = (y - C_y) / D,    z' = (z - C_z) / D")
    print(" donde C = (P11 + P12)/2 (centro de hombros) y D = ||P11 - P12||_2 (distancia 3D).")
    print()
    if min_z_detail:
        print(" Detalle del valor mínimo empírico de Z observado en esta toma:")
        print(f"   * Landmark:       {min_z_detail.get('landmark_name')} (índice P{min_z_detail.get('landmark_idx')})")
        print(f"   * Frame:          #{min_z_detail.get('frame_idx')} (t = {min_z_detail.get('t_ms'):.1f} ms)")
        print(f"   * z cruda:        {min_z_detail.get('z_raw'):.4f}")
        print(f"   * C_z hombros:    {min_z_detail.get('cz'):.4f}")
        print(f"   * Delta z:        (z - C_z) = {min_z_detail.get('delta_z'):.4f}")
        print(f"   * D de ese frame: {min_z_detail.get('D'):.4f}")
        print(f"   * z' normalizado: {min_z_detail.get('z_norm'):.4f}")
        if min_z_detail.get("visibility") is not None:
            print(f"   * Visibilidad:    {min_z_detail.get('visibility'):.4f}")
        print()
    print(" Relación matemática en encuadres reales (D ∈ [0.28, 0.45]):")
    print("   1. Para D = 0.35 (distancia real habitual del firmante a webcam):")
    print("      Un valor normalizado z' = -4.31 exige matemáticamente (z - C_z) = -4.31 * 0.35 = -1.5085.")
    print("   2. En MediaPipe Pose Tasks, la z de landmarks (NormalizedLandmark.z)")
    print("      expresa profundidad relativa al punto medio de caderas en unidades de imagen")
    print("      (misma escala aproximada que x; NO metros — solo poseWorldLandmarks usa metros).")
    print("      Si el cuerpo está cortado por la cintura, la predicción de z puede sufrir sesgo")
    print("      cuando las caderas quedan ocluidas.")
    print("   3. Para auditoría, el inspector reporta frame, landmark y z cruda exactos sin conjeturas.")
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

    # Delegate metadata
    delegate_info = metadata.get("delegate", "No especificado en metadata")
    print(f"Delegado de ejecución: {delegate_info}")

    # Capture quality gate metadata
    if "valid" in metadata:
        is_valid = metadata.get("valid", True)
        avg_fps = metadata.get("avg_fps", 0.0)
        err = metadata.get("error")
        int_metrics = metadata.get("interval_metrics", {})
        if not is_valid:
            print(f"[WARN] ALERTA COMPUERTA DE CAPTURA: Grabación RECHAZADA por '{err}'")
            if avg_fps < 15.0:
                print(f"     └─ Tasa media: {avg_fps} FPS < 15.0 FPS requerido")
            if int_metrics:
                print(f"     └─ Intervalos: p50={int_metrics.get('p50_ms')} ms, p95={int_metrics.get('p95_ms')} ms, máx={int_metrics.get('max_ms')} ms (> 100 ms límite)")
        else:
            print(f"[OK] COMPUERTA DE CAPTURA SUPERADA: {avg_fps} FPS promedio (≥ 15.0 FPS requerido)")
            if int_metrics:
                print(f"     └─ Intervalos: p50={int_metrics.get('p50_ms')} ms, p95={int_metrics.get('p95_ms')} ms, máx={int_metrics.get('max_ms')} ms (≤ 100 ms OK)")

    if not frames:
        print("Error: la grabación no contiene frames.")
        return

    # Estimated duration and frame interval metrics
    t_start = float(frames[0].get("t_ms", frames[0].get("timestamp_ms", 0.0)))
    t_end = float(frames[-1].get("t_ms", frames[-1].get("timestamp_ms", 0.0)))
    duration_s = (t_end - t_start) / 1000.0
    calc_fps = (len(frames) / duration_s) if duration_s > 0 else 0.0

    gaps = []
    for i in range(1, len(frames)):
        t_prev = float(frames[i - 1].get("t_ms", frames[i - 1].get("timestamp_ms", (i - 1) * 33.333)))
        t_curr = float(frames[i].get("t_ms", frames[i].get("timestamp_ms", i * 33.333)))
        dt = t_curr - t_prev
        if dt >= 0:
            gaps.append(dt)

    gaps.sort()
    gap_p50 = gaps[len(gaps) // 2] if gaps else 0.0
    gap_p95 = gaps[int(len(gaps) * 0.95)] if gaps else 0.0
    gap_max = gaps[-1] if gaps else 0.0
    gaps_over_100 = sum(1 for g in gaps if g > 100.0)

    print(f"Rango temporal:        t_0 = {t_start:.1f} ms -> t_final = {t_end:.1f} ms ({duration_s:.2f} s)")
    print(f"Tasa de captura real:  {calc_fps:.1f} FPS")
    print(f"Intervalos (Δt):       p50 = {gap_p50:.1f} ms | p95 = {gap_p95:.1f} ms | Máx = {gap_max:.1f} ms")
    if gap_max > 100.0:
        print(f"[WARN] ALERTA CALIDAD: {gaps_over_100} intervalo(s) superan 100 ms (máx: {gap_max:.1f} ms > 100 ms). ExtractWindow rechazará la toma.")
    else:
        print(f"[OK] CALIDAD TEMPORAL: Todos los intervalos ≤ 100.0 ms (máx: {gap_max:.1f} ms)")

    # Wrist X-coordinate timeline table
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
    min_z_detail: Optional[dict] = None
    min_z_val = float("inf")

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
        cz_val = (float(p11.get("z", 0.0)) + float(p12.get("z", 0.0))) / 2.0

        # Track minimum normalized z in Upper Pose
        from models.feature_extractor import POSE_UPPER_INDICES
        for p_idx in POSE_UPPER_INDICES:
            if p_idx < len(pose):
                lm = pose[p_idx]
                z_raw = float(lm.get("z", 0.0))
                z_norm = (z_raw - cz_val) / d_val
                if z_norm < min_z_val:
                    min_z_val = z_norm
                    min_z_detail = {
                        "landmark_idx": p_idx,
                        "landmark_name": POSE_LANDMARK_NAMES.get(p_idx, f"P{p_idx}"),
                        "frame_idx": idx,
                        "t_ms": ts,
                        "z_raw": z_raw,
                        "cz": cz_val,
                        "delta_z": z_raw - cz_val,
                        "D": d_val,
                        "z_norm": z_norm,
                        "visibility": float(lm.get("visibility", 1.0)),
                    }

        assigned_l, assigned_r, is_ambig = assign_hands_to_anatomical_slots(fr, pose, d_val)

        # Wrist X coordinates
        p15_x = float(pose[15].get("x", 0.0))
        p16_x = float(pose[16].get("x", 0.0))

        detected_hands = fr.get("hands", [])
        h0_x_str = f"{float(detected_hands[0]['landmarks'][0]['x']):.3f}" if (len(detected_hands) > 0 and isinstance(detected_hands[0], dict) and 'landmarks' in detected_hands[0]) else (f"{float(detected_hands[0][0]['x']):.3f}" if (len(detected_hands) > 0 and isinstance(detected_hands[0], list)) else "-")
        h1_x_str = f"{float(detected_hands[1]['landmarks'][0]['x']):.3f}" if (len(detected_hands) > 1 and isinstance(detected_hands[1], dict) and 'landmarks' in detected_hands[1]) else (f"{float(detected_hands[1][0]['x']):.3f}" if (len(detected_hands) > 1 and isinstance(detected_hands[1], list)) else "-")

        # Distinguish "no hands" from "unlabeled"
        mp_labels = extract_frame_mp_labels(fr)
        if not detected_hands and not mp_labels:
            mp_str = "sin manos"
        else:
            mp_str = ",".join(mp_labels) if mp_labels else "sin etiqueta"

        # Assigned anatomical slots
        left_str = "Activa" if assigned_l is not None else "---"
        right_str = "Activa" if assigned_r is not None else "---"
        if is_ambig:
            right_str += " [AMBIG]"

        if idx % step == 0 or idx == len(frames) - 1:
            print(
                f"{idx:<6} | {ts:<8.0f} | {d_val:<7.3f} | {h0_x_str:<6} | {h1_x_str:<6} | "
                f"{p15_x:<6.3f} | {p16_x:<6.3f} | {mp_str:<14} | {left_str:<14} | {right_str:<14} | {'OK':<8}"
            )

    print_detections_table(frames)

    # Validity summary
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

    print(f"Valores NaN / Inf detectados: {'[WARN] SÍ (FALLO CRÍTICO)' if has_nan_or_inf else '[OK] NINGUNO (100% LIMPIO)'}")

    # Numeric ranges per feature block and channel
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

        # Left Hand [52..114]: 21 landmarks x 3 coords (x, y, z)
        l_x = left_slice[:, 0::3]
        l_y = left_slice[:, 1::3]
        l_z = left_slice[:, 2::3]
        print("• Mano Izquierda [52..114] (21 landmarks x 3 coords):")
        print(f"    - Canal X:           Min: {np.min(l_x):.4f} | Max: {np.max(l_x):.4f} | Media: {np.mean(l_x):.4f}")
        print(f"    - Canal Y:           Min: {np.min(l_y):.4f} | Max: {np.max(l_y):.4f} | Media: {np.mean(l_y):.4f}")
        print(f"    - Canal Z (z-z_w):   Min: {np.min(l_z):.4f} | Max: {np.max(l_z):.4f} | Media: {np.mean(l_z):.4f}")

        # Right Hand [115..177]: 21 landmarks x 3 coords (x, y, z)
        r_x = right_slice[:, 0::3]
        r_y = right_slice[:, 1::3]
        r_z = right_slice[:, 2::3]
        print("• Mano Derecha [115..177] (21 landmarks x 3 coords):")
        print(f"    - Canal X:           Min: {np.min(r_x):.4f} | Max: {np.max(r_x):.4f} | Media: {np.mean(r_x):.4f}")
        print(f"    - Canal Y:           Min: {np.min(r_y):.4f} | Max: {np.max(r_y):.4f} | Media: {np.mean(r_y):.4f}")
        print(f"    - Canal Z (z-z_w):   Min: {np.min(r_z):.4f} | Max: {np.max(r_z):.4f} | Media: {np.mean(r_z):.4f}")

    # ExtractWindow check
    print("\n--------------------------------------------------------------------------------")
    print(" 4. EVALUACIÓN DE EXTRACT_WINDOW (TENSOR INVARIANTE (1, 15, 178))")
    print("--------------------------------------------------------------------------------")
    tensor, w_valid, w_error = extract_window(frames, target_fps=15, duration_ms=1000.0)
    if w_valid:
        print(f"[OK] ExtractWindow exitoso. Forma del tensor: {tensor.shape}, dtype: {tensor.dtype}")
        print(f"   Norma L_inf del tensor: {float(np.max(np.abs(tensor))):.4f}")
        print(f"   Detección de NaN/Inf en tensor: {'[WARN] SÍ' if np.isnan(tensor).any() else '[OK] Limpio'}")
    else:
        print(f"[FAIL] ExtractWindow rechazó la toma: {w_error}")

    # Segment audit (from CLI or embedded prompt timeline)
    if segments:
        audit_segments(frames, segments)
    elif "prompt_timeline" in metadata and isinstance(metadata["prompt_timeline"], list):
        # Auto-audit against saved timeline
        auto_segs = []
        for p in metadata["prompt_timeline"]:
            auto_segs.append((float(p["start_ms"]), float(p["end_ms"]), str(p["label"])))
        print("\n[Auto-detectada línea de tiempo de indicaciones en archivo JSON]")
        audit_segments(frames, auto_segs)

    # Extreme z/y coordinate math breakdown
    print_negative_pose_analysis(min_z_detail)

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
