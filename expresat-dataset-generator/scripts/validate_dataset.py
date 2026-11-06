#!/usr/bin/env python3
"""
validate_dataset.py - Validación exhaustiva de invariantes del dataset ExpresaT.
Comprueba dimensiones (15 frames, 178 features), rangos de normalización,
detección de NaNs/Infs y completitud de datos sin gastar tokens de contexto.
"""

import argparse
import json
import math
import sys
from pathlib import Path


def validate_file(file_path: Path, strict: bool = False, min_samples: int = 100):
    issues = []
    warnings = []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = json.load(f)
    except Exception as e:
        return {
            "file": file_path.name,
            "status": "ERROR",
            "issues": [f"Error al decodificar JSON: {str(e)}"],
            "warnings": []
        }

    label = content.get("label")
    if not label or not isinstance(label, str):
        issues.append("Campo 'label' ausente o inválido")

    data = content.get("data")
    if not isinstance(data, list):
        issues.append("Campo 'data' no es una lista")
        return {"file": file_path.name, "status": "ERROR", "issues": issues, "warnings": []}

    num_samples = len(data)
    if num_samples == 0:
        issues.append("El dataset no contiene muestras (data está vacío)")
        return {"file": file_path.name, "status": "ERROR", "issues": issues, "warnings": []}

    if num_samples < min_samples:
        warnings.append(f"Muestras insuficientes: {num_samples} < {min_samples}")

    nan_count = 0
    inf_count = 0
    invalid_frames = 0
    invalid_feats = 0
    out_of_bounds = 0

    # Validar dimensiones e invariantes
    for sample_idx, sample in enumerate(data):
        if not isinstance(sample, list) or len(sample) != 15:
            invalid_frames += 1
            continue

        for frame_idx, frame in enumerate(sample):
            if not isinstance(frame, list) or len(frame) != 178:
                invalid_feats += 1
                continue

            for val in frame:
                if math.isnan(val):
                    nan_count += 1
                elif math.isinf(val):
                    inf_count += 1
                elif abs(val) > 10.0:
                    out_of_bounds += 1

    if invalid_frames > 0:
        issues.append(f"{invalid_frames} muestras no tienen exactamente 15 frames")
    if invalid_feats > 0:
        issues.append(f"{invalid_feats} frames no tienen exactamente 178 características")
    if nan_count > 0:
        issues.append(f"Se encontraron {nan_count} valores NaN")
    if inf_count > 0:
        issues.append(f"Se encontraron {inf_count} valores Inf/-Inf")
    if out_of_bounds > 0:
        warnings.append(f"{out_of_bounds} valores con |val| > 10.0 (posible fallo de normalización)")

    status = "OK"
    if issues:
        status = "ERROR"
    elif warnings:
        status = "WARNING" if not strict else "ERROR"
        if strict:
            issues.extend(warnings)
            warnings = []

    return {
        "file": file_path.name,
        "label": label,
        "samples": num_samples,
        "status": status,
        "issues": issues,
        "warnings": warnings
    }


def main():
    parser = argparse.ArgumentParser(description="Validador de invariantes de datasets ExpresaT")
    parser.add_argument("--file", type=str, help="Archivo JSON a validar")
    parser.add_argument("--dir", type=str, help="Directorio con archivos JSON a validar")
    parser.add_argument("--strict", action="store_true", help="Tratar advertencias como errores")
    parser.add_argument("--min-samples", type=int, default=300, help="Mínimo número de muestras sugerido (def: 300)")
    parser.add_argument("--json-output", action="store_true", help="Salida JSON")

    args = parser.parse_args()

    files_to_check = []
    if args.file:
        files_to_check.append(Path(args.file))
    elif args.dir:
        d = Path(args.dir)
        if not d.exists():
            print(f"Directorio no existe: {d}")
            sys.exit(1)
        files_to_check = [
            f for f in sorted(d.glob("*.json"))
            if f.name not in ["compile_commands.json", "model_metadata.json", "dataset.json"]
        ]
    else:
        parser.print_help()
        sys.exit(1)

    if not files_to_check:
        print("No se encontraron archivos para validar.")
        sys.exit(0)

    results = []
    ok_count = 0
    warn_count = 0
    err_count = 0

    for f in files_to_check:
        res = validate_file(f, strict=args.strict, min_samples=args.min_samples)
        results.append(res)
        if res["status"] == "OK":
            ok_count += 1
        elif res["status"] == "WARNING":
            warn_count += 1
        else:
            err_count += 1

    if args.json_output:
        print(json.dumps({
            "summary": {"ok": ok_count, "warning": warn_count, "error": err_count, "total": len(results)},
            "details": results
        }, indent=2))
    else:
        print(f"Validando {len(results)} archivos...")
        for r in results:
            icon = "✅" if r["status"] == "OK" else ("⚠️ " if r["status"] == "WARNING" else "❌")
            print(f"  {icon} {r['file']:<20} ({r.get('samples', 0)} muestras)")
            for issue in r["issues"]:
                print(f"     ❌ {issue}")
            for warn in r["warnings"]:
                print(f"     ⚠️  {warn}")

        print(f"\nRESUMEN: {ok_count} OK | {warn_count} WARNING | {err_count} ERROR")

    if err_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
