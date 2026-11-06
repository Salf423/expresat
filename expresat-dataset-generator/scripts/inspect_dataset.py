#!/usr/bin/env python3
"""
inspect_dataset.py - Vista rápida y eficiente de datasets de señas en JSON sin saturar contexto.
Diseñado para agentes de IA y desarrolladores de ExpresaT.
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path


def inspect_single_file(file_path: Path, sample_idx: int = None, as_json: bool = False):
    try:
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = json.load(f)

        entries = raw_content if isinstance(raw_content, list) else [raw_content]

        for entry_idx, content in enumerate(entries):
            label = content.get("label", f"entry_{entry_idx}")
            num_samples = content.get("num_samples", len(content.get("data", [])))
            seq_len = content.get("sequence_length", 15)
            feature_dim = content.get("feature_dim", 178)
            data = content.get("data", [])

            actual_samples = len(data)
            actual_seq_len = len(data[0]) if actual_samples > 0 else 0
            actual_feat_dim = len(data[0][0]) if actual_seq_len > 0 else 0

            # Muestreo estadístico rápido para no recorrer todo si es masivo
            max_samples_eval = min(actual_samples, 50)
            vals = []
            zero_frames = 0
            total_frames = 0
            low_conf_frames = 0

            for s_idx in range(max_samples_eval):
                sample = data[s_idx]
                for frame in sample:
                    total_frames += 1
                    if all(v == 0.0 for v in frame):
                        zero_frames += 1
                    # Revisar visibilidad de pose si hay al menos 52 features (13 landmarks * 4: x,y,z,vis)
                    if len(frame) >= 52:
                        vis_scores = [frame[i] for i in range(3, 52, 4)]
                        if any(v < 0.5 for v in vis_scores):
                            low_conf_frames += 1
                    vals.extend(frame[::10])  # Submuestreo para media/std

            if vals:
                min_v = min(vals)
                max_v = max(vals)
                mean_v = sum(vals) / len(vals)
                std_v = math.sqrt(sum((x - mean_v) ** 2 for x in vals) / len(vals))
            else:
                min_v = max_v = mean_v = std_v = 0.0

            zero_ratio = (zero_frames / total_frames * 100) if total_frames > 0 else 0.0
            low_conf_ratio = (low_conf_frames / total_frames * 100) if total_frames > 0 else 0.0

            is_valid_shape = (actual_seq_len == 15 and actual_feat_dim == 178)

            file_display = f"{file_path.name} [{label}]" if len(entries) > 1 else str(file_path.name)
            info = {
                "file": file_display,
                "label": label,
                "declared_samples": num_samples,
                "actual_samples": actual_samples,
                "sequence_length": actual_seq_len,
                "feature_dim": actual_feat_dim,
                "shape": f"({actual_samples}, {actual_seq_len}, {actual_feat_dim})",
                "file_size_mb": round(file_size_mb, 2),
                "val_min": round(min_v, 4),
                "val_max": round(max_v, 4),
                "mean": round(mean_v, 4),
                "std": round(std_v, 4),
                "zero_frames_pct": round(zero_ratio, 2),
                "low_conf_frames_pct": round(low_conf_ratio, 2),
                "status": "OK" if is_valid_shape else "INVALID_SHAPE"
            }

            if sample_idx is not None:
                if 0 <= sample_idx < actual_samples:
                    s = data[sample_idx]
                    info["sample_inspection"] = {
                        "index": sample_idx,
                        "frames_count": len(s),
                        "frame_0_summary": {
                            "pose_upper_norm_sample": s[0][:4],
                            "left_hand_wrist": s[0][52:55] if len(s[0]) > 55 else [],
                            "right_hand_wrist": s[0][115:118] if len(s[0]) > 118 else []
                        }
                    }
                else:
                    info["sample_error"] = f"Índice {sample_idx} fuera de rango (0-{actual_samples-1})"

            if as_json:
                print(json.dumps(info, indent=2))
            else:
                status_icon = "✅" if info["status"] == "OK" else "❌"
                print(f"=== {info['file']} {status_icon} ===")
                print(f"  label              : {info['label']}")
                print(f"  shape              : {info['shape']}")
                print(f"  file_size          : {info['file_size_mb']} MB")
                print(f"  val_range          : [{info['val_min']}, {info['val_max']}] (μ={info['mean']}, σ={info['std']})")
                print(f"  zero_frames        : {info['zero_frames_pct']}%")
                print(f"  low_conf_pose      : {info['low_conf_frames_pct']}%")
                if "sample_inspection" in info:
                    s_info = info["sample_inspection"]
                    print(f"  [Muestra {s_info['index']}]: {s_info['frames_count']} frames")
                    print(f"    pose[0..3]       : {s_info['frame_0_summary']['pose_upper_norm_sample']}")
                    print(f"    left_hand[0..2]  : {s_info['frame_0_summary']['left_hand_wrist']}")
                    print(f"    right_hand[0..2] : {s_info['frame_0_summary']['right_hand_wrist']}")
                print()
    except Exception as e:
        if as_json:
            print(json.dumps({"file": str(file_path.name), "error": str(e)}))
        else:
            print(f"❌ Error leyendo {file_path.name}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Inspección compacta de datasets ExpresaT")
    parser.add_argument("--file", type=str, help="Ruta al archivo .json específico")
    parser.add_argument("--dir", type=str, help="Directorio con archivos .json")
    parser.add_argument("--sample", type=int, default=None, help="Índice de muestra para ver detalles compactos")
    parser.add_argument("--json-output", action="store_true", help="Salida en formato JSON estructurado")

    args = parser.parse_args()

    if not args.file and not args.dir:
        parser.print_help()
        sys.exit(1)

    if args.file:
        p = Path(args.file)
        if not p.exists():
            print(f"Archivo no encontrado: {p}")
            sys.exit(1)
        inspect_single_file(p, sample_idx=args.sample, as_json=args.json_output)
    elif args.dir:
        d = Path(args.dir)
        if not d.exists() or not d.is_dir():
            print(f"Directorio no encontrado: {d}")
            sys.exit(1)
        json_files = sorted(list(d.glob("*.json")))
        if not json_files:
            print(f"No se encontraron archivos .json en {d}")
            sys.exit(0)
        for jf in json_files:
            if jf.name in ["compile_commands.json", "model_metadata.json", "dataset.json"]:
                continue
            inspect_single_file(jf, sample_idx=args.sample, as_json=args.json_output)


if __name__ == "__main__":
    main()
