#!/usr/bin/env python3
"""
dataset_stats.py - Análisis estadístico agregado y balance de clases en datasets ExpresaT.
Genera reportes de distribución de muestras, ratios de desbalance y resumen de clases
sin necesidad de volcar datos masivos al contexto del agente.
"""

import argparse
import json
import sys
from pathlib import Path


def generate_bar(current: int, maximum: int, length: int = 15) -> str:
    if maximum == 0:
        return "░" * length
    filled = int(round((current / maximum) * length))
    filled = max(0, min(length, filled))
    return "█" * filled + "░" * (length - filled)


def compute_dataset_stats(dataset_dir: Path, as_json: bool = False):
    json_files = [
        f for f in sorted(dataset_dir.glob("*.json"))
        if f.name not in ["compile_commands.json", "model_metadata.json", "dataset.json"]
    ]

    if not json_files:
        if as_json:
            print(json.dumps({"error": f"No hay archivos JSON en {dataset_dir}"}))
        else:
            print(f"No se encontraron archivos en {dataset_dir}")
        return

    classes_stats = []
    total_samples = 0

    for f in json_files:
        try:
            with open(f, "r", encoding="utf-8") as file:
                content = json.load(file)
            label = content.get("label", f.stem)
            data = content.get("data", [])
            samples_count = len(data)
            classes_stats.append({
                "label": label,
                "file": f.name,
                "samples": samples_count
            })
            total_samples += samples_count
        except Exception as e:
            classes_stats.append({
                "label": f.stem,
                "file": f.name,
                "samples": 0,
                "error": str(e)
            })

    counts = [c["samples"] for c in classes_stats if "error" not in c]
    if not counts:
        print("No se pudieron leer muestras válidas.")
        return

    min_samples = min(counts)
    max_samples = max(counts)
    avg_samples = sum(counts) / len(counts)
    imbalance_ratio = (min_samples / max_samples) if max_samples > 0 else 0.0

    underrepresented = [c["label"] for c in classes_stats if c["samples"] < 0.7 * max_samples]

    report = {
        "total_classes": len(classes_stats),
        "total_samples": total_samples,
        "min_samples": min_samples,
        "max_samples": max_samples,
        "avg_samples": round(avg_samples, 1),
        "balance_ratio": round(imbalance_ratio, 2),
        "is_balanced": imbalance_ratio >= 0.8,
        "underrepresented_classes": underrepresented,
        "classes": classes_stats
    }

    if as_json:
        print(json.dumps(report, indent=2))
    else:
        print("=== Estadísticas del Dataset Agregado ===")
        print(f"  Total clases   : {report['total_classes']}")
        print(f"  Total muestras : {report['total_samples']}")
        print(f"  Promedio/clase : {report['avg_samples']}")
        bal_warn = "⚠️ DESBALANCEADO" if not report['is_balanced'] else "✅ BALANCEADO"
        print(f"  Balance mín/máx: {min_samples} / {max_samples} (ratio: {report['balance_ratio']} — {bal_warn})")
        print("\n  Distribución por clase:")

        for c in classes_stats:
            err = f" (Error: {c['error']})" if "error" in c else ""
            bar = generate_bar(c["samples"], max_samples)
            pct = round((c["samples"] / max_samples * 100), 1) if max_samples > 0 else 0
            warn = " ⚠️" if c["label"] in underrepresented else ""
            print(f"    {c['label']:<16} {c['samples']:>5}  {bar} {pct:>5.1f}%{warn}{err}")

        if underrepresented:
            print(f"\n  ⚠️ Clases con bajo volumen (<70% del máx): {underrepresented}")
        else:
            print("\n  ✅ Todas las clases mantienen una representación equilibrada.")


def main():
    parser = argparse.ArgumentParser(description="Estadísticas de clases y balance de dataset ExpresaT")
    parser.add_argument("--dir", type=str, default="expresat-dataset-generator/dataset", help="Directorio del dataset")
    parser.add_argument("--json-output", action="store_true", help="Salida en formato JSON estructurado")

    args = parser.parse_args()
    p = Path(args.dir)

    if not p.exists():
        print(f"El directorio especificado no existe: {p}")
        sys.exit(1)

    compute_dataset_stats(p, as_json=args.json_output)


if __name__ == "__main__":
    main()
