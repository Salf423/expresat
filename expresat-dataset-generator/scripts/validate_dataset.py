#!/usr/bin/env python3
"""
validate_dataset.py - Hardened invariant validator for ExpresaT v1.4.0 datasets.

Validates JSON class files (`{label, data}`) and sharded `.npy` + `manifest.json` datasets
against FEATURE_SPEC v1.4.0 invariants, actively rejecting:
  - Wrong shapes (must be (N, 15, 178)) or non-finite NaN/Inf values
  - Visibility channel overflow outside [0.0, 1.0] (catches legacy C++ augmenter corruption)
  - Unnormalized shoulders D_norm far from 1.0 (catches legacy sine stubs like letra_a_derecha_2.json)
  - Violations of v1.4.0 pose z' policy (P15..P22 z' != 0.0, P00/P11..P14 |z'| > 2.0)
  - All-zero empty frames and active signs (`label != 'reposo'`) missing hands
  - Frozen/cloned windows (zero temporal variance across the 15 slots)
  - Explicit synthetic/stub generator metadata markers
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT / "expresat") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "expresat"))

from models.feature_extractor import (  # noqa: E402
    ASPECT_RATIO,
    FEATURE_SPEC_VERSION,
    POSE_Z_CLIP_ABS,
    SEQUENCE_LENGTH,
    TOTAL_FEATURES,
    compute_config_hash,
)

# Upper-pose indices within the 178D vector:
#   pos 0 = P00, pos 1 = P11 (left shoulder), pos 2 = P12 (right shoulder),
#   pos 3 = P13, pos 4 = P14, pos 5..12 = P15..P22
_VIS_CHANNELS = np.arange(3, 52, 4)
_POSE_Z_CLIP_CHANNELS = np.array([0 * 4 + 2, 1 * 4 + 2, 2 * 4 + 2, 3 * 4 + 2, 4 * 4 + 2])
_POSE_Z_ZERO_CHANNELS = np.array([u * 4 + 2 for u in range(5, 13)])

_SHOULDER_DNORM_MIN = 0.70
_SHOULDER_DNORM_MAX = 1.35
_ACTIVE_SIGN_MIN_HAND_FRAME_FRAC = 0.60
_FROZEN_TEMPORAL_STD_EPS = 1e-6


def validate_array_samples(
    arr: np.ndarray,
    label: str,
    *,
    min_samples: int = 100,
    strict: bool = False,
    metadata: Optional[dict[str, Any]] = None,
    catalog_ids: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Validate an (N, 15, 178) float array against FEATURE_SPEC v1.4.0 invariants."""
    issues: list[str] = []
    warnings: list[str] = []

    if not label or not isinstance(label, str):
        issues.append("Campo 'label' ausente o inválido")
        label = "<unknown>"

    if catalog_ids is not None and label not in catalog_ids:
        issues.append(f"Etiqueta '{label}' no existe en catalog/signs_catalog.json")

    if isinstance(metadata, dict):
        meta_blob = json.dumps(metadata).lower()
        if any(tok in meta_blob for tok in ("stub", "expresat_stub_extractor")):
            issues.append("Metadatos indican origen sintético/stub prohibido")
        if metadata.get("synthetic") is True:
            issues.append("Dataset marcado como sintético (prohibido para entrenamiento productivo)")

    if arr.ndim != 3 or arr.shape[1] != SEQUENCE_LENGTH or arr.shape[2] != TOTAL_FEATURES:
        issues.append(f"Forma inválida {tuple(arr.shape)}; se esperaba (N, {SEQUENCE_LENGTH}, {TOTAL_FEATURES})")
        return {"label": label, "samples": int(arr.shape[0]) if arr.ndim >= 1 else 0, "status": "ERROR", "issues": issues, "warnings": warnings}

    num_samples = int(arr.shape[0])
    if num_samples == 0:
        issues.append("El dataset no contiene muestras (N == 0)")
        return {"label": label, "samples": 0, "status": "ERROR", "issues": issues, "warnings": warnings}

    if num_samples < min_samples:
        warnings.append(f"Muestras insuficientes: {num_samples} < {min_samples}")

    # 1. NaN / Inf check
    nan_count = int(np.isnan(arr).sum())
    inf_count = int(np.isinf(arr).sum())
    if nan_count > 0:
        issues.append(f"Se encontraron {nan_count} valores NaN")
    if inf_count > 0:
        issues.append(f"Se encontraron {inf_count} valores Inf/-Inf")
    if nan_count > 0 or inf_count > 0:
        return {"label": label, "samples": num_samples, "status": "ERROR", "issues": issues, "warnings": warnings}

    # 2. All-zero empty frames check
    frame_max_abs = np.max(np.abs(arr), axis=2)  # (N, 15)
    empty_frames = int(np.sum(frame_max_abs <= 1e-9))
    if empty_frames > 0:
        issues.append(f"Se detectaron {empty_frames} frames completamente vacíos (todo ceros)")

    # 3. Visibility bounds [0.0, 1.0] (catches legacy C++ augmenter overflow 1.0201)
    vis = arr[:, :, _VIS_CHANNELS]
    vis_bad = int(np.sum((vis < -1e-5) | (vis > 1.0 + 1e-5)))
    if vis_bad > 0:
        issues.append(
            f"{vis_bad} canales de visibilidad fuera de [0.0, 1.0] "
            f"(min={float(vis.min()):.4f}, max={float(vis.max()):.4f}; posible corrupción sintética/legacy)"
        )

    # 4. v1.4.0 pose.z' policy: P15..P22 must be 0.0, P00/P11..P14 clipped to [-2.0, 2.0]
    p15_22_z = arr[:, :, _POSE_Z_ZERO_CHANNELS]
    max_p15_22_z = float(np.max(np.abs(p15_22_z)))
    if max_p15_22_z > 1e-4:
        issues.append(
            f"Violación FEATURE_SPEC v1.4.0: P15..P22 z' debe ser 0.0 (max |z'|={max_p15_22_z:.4f})"
        )
    p0_14_z = arr[:, :, _POSE_Z_CLIP_CHANNELS]
    max_p0_14_z = float(np.max(np.abs(p0_14_z)))
    if max_p0_14_z > POSE_Z_CLIP_ABS + 1e-3:
        issues.append(
            f"Violación FEATURE_SPEC v1.4.0: P00/P11..P14 |z'| excede {POSE_Z_CLIP_ABS} (max={max_p0_14_z:.4f})"
        )

    # 5. Shoulder normalization invariant D_norm_2d_iso ~ 1.0 (catches unnormalized sine stubs D~0.046)
    p11_x = arr[:, :, 4]
    p11_y = arr[:, :, 5]
    p12_x = arr[:, :, 8]
    p12_y = arr[:, :, 9]
    d_norm = np.hypot((p11_x - p12_x) * ASPECT_RATIO, p11_y - p12_y) / ASPECT_RATIO  # (N, 15)
    median_d_per_sample = np.median(d_norm, axis=1)
    bad_norm_samples = int(
        np.sum((median_d_per_sample < _SHOULDER_DNORM_MIN) | (median_d_per_sample > _SHOULDER_DNORM_MAX))
    )
    if bad_norm_samples > 0:
        issues.append(
            f"{bad_norm_samples}/{num_samples} muestras violan invariante de hombros normalizados D_norm≈1.0 "
            f"(mediana global={float(np.median(median_d_per_sample)):.4f}; posible stub sin normalizar)"
        )

    # 6. Active sign hand presence gate (label != 'reposo')
    if label.lower() != "reposo":
        hands_block = arr[:, :, 52:178]
        frame_has_hand = np.any(np.abs(hands_block) > 1e-6, axis=2)  # (N, 15)
        sample_hand_frac = np.mean(frame_has_hand, axis=1)
        empty_hand_samples = int(np.sum(sample_hand_frac < _ACTIVE_SIGN_MIN_HAND_FRAME_FRAC))
        if empty_hand_samples > 0:
            issues.append(
                f"{empty_hand_samples}/{num_samples} muestras de seña activa '{label}' tienen manos ausentes "
                f"(< {int(_ACTIVE_SIGN_MIN_HAND_FRAME_FRAC * 100)}% de frames con manos)"
            )

    # 7. Anti-frozen / anti-cloned-frame check (temporal variance across the 15 timesteps)
    temporal_std_per_sample = np.max(np.std(arr, axis=1), axis=1)  # (N,)
    frozen_samples = int(np.sum(temporal_std_per_sample < _FROZEN_TEMPORAL_STD_EPS))
    if frozen_samples > 0 and (frozen_samples / num_samples) > 0.5:
        issues.append(
            f"{frozen_samples}/{num_samples} muestras están congeladas (desviación temporal < {_FROZEN_TEMPORAL_STD_EPS}; posible clonado k=1..14 o stub estático)"
        )

    # 8. Out-of-bounds warning on extreme normalized coordinates
    out_of_bounds = int(np.sum(np.abs(arr) > 10.0))
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
        "label": label,
        "samples": num_samples,
        "status": status,
        "issues": issues,
        "warnings": warnings,
    }


def validate_file(
    file_path: Path,
    strict: bool = False,
    min_samples: int = 100,
    catalog_ids: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Validate a single dataset JSON file (`{label, data}`)."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = json.load(f)
    except Exception as e:
        return {
            "file": file_path.name,
            "status": "ERROR",
            "issues": [f"Error al decodificar JSON: {str(e)}"],
            "warnings": [],
        }

    label = content.get("label")
    data = content.get("data")
    if not isinstance(data, list) or len(data) == 0:
        return {
            "file": file_path.name,
            "label": label,
            "samples": 0,
            "status": "ERROR",
            "issues": ["Campo 'data' ausente, inválido o vacío"],
            "warnings": [],
        }

    # Check ragged shapes before converting to numpy
    invalid_frames = 0
    invalid_feats = 0
    for sample in data:
        if not isinstance(sample, list) or len(sample) != SEQUENCE_LENGTH:
            invalid_frames += 1
            continue
        for frame in sample:
            if not isinstance(frame, list) or len(frame) != TOTAL_FEATURES:
                invalid_feats += 1
    if invalid_frames > 0 or invalid_feats > 0:
        issues = []
        if invalid_frames > 0:
            issues.append(f"{invalid_frames} muestras no tienen exactamente {SEQUENCE_LENGTH} frames")
        if invalid_feats > 0:
            issues.append(f"{invalid_feats} frames no tienen exactamente {TOTAL_FEATURES} características")
        return {
            "file": file_path.name,
            "label": label,
            "samples": len(data),
            "status": "ERROR",
            "issues": issues,
            "warnings": [],
        }

    arr = np.asarray(data, dtype=np.float32)
    meta = {k: v for k, v in content.items() if k != "data"}
    res = validate_array_samples(
        arr,
        label=label,
        min_samples=min_samples,
        strict=strict,
        metadata=meta,
        catalog_ids=catalog_ids,
    )
    res["file"] = file_path.name
    return res


def validate_manifest_dir(
    manifest_path: Path,
    strict: bool = False,
    min_samples: int = 1,
    catalog_ids: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Validate a Stage-2 `.npy` + `manifest.json` dataset directory."""
    issues: list[str] = []
    warnings: list[str] = []
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if manifest.get("feature_spec_version") != FEATURE_SPEC_VERSION:
        issues.append(
            f"feature_spec_version={manifest.get('feature_spec_version')} != {FEATURE_SPEC_VERSION}"
        )
    expected_hash = compute_config_hash(
        delegate=manifest.get("delegate", "GPU"),
        pose_cadence=int(manifest.get("pose_cadence", 1)),
    )
    if manifest.get("config_hash") != expected_hash:
        issues.append(
            f"config_hash de manifest ({manifest.get('config_hash')}) != esperado ({expected_hash})"
        )

    labels = manifest.get("labels", [])
    base_dir = manifest_path.parent
    split_details = {}
    for split_name, split_info in manifest.get("splits", {}).items():
        x_path = base_dir / split_info["X_file"]
        y_path = base_dir / split_info["y_file"]
        if not x_path.exists() or not y_path.exists():
            issues.append(f"Split '{split_name}' faltan shards {x_path.name}/{y_path.name}")
            continue
        X = np.load(x_path)
        y = np.load(y_path)
        if X.shape[0] != y.shape[0]:
            issues.append(f"Split '{split_name}': X.shape[0]={X.shape[0]} != y.shape[0]={y.shape[0]}")
            continue
        if X.shape[0] == 0:
            continue
        for cls_idx, cls_label in enumerate(labels):
            mask = y == cls_idx
            if not np.any(mask):
                continue
            r = validate_array_samples(
                X[mask],
                label=cls_label,
                min_samples=min_samples,
                strict=strict,
                catalog_ids=catalog_ids,
            )
            split_details[f"{split_name}:{cls_label}"] = r
            if r["status"] == "ERROR":
                issues.extend([f"[{split_name}:{cls_label}] {iss}" for iss in r["issues"]])
            warnings.extend([f"[{split_name}:{cls_label}] {w}" for w in r["warnings"]])

    status = "ERROR" if issues else ("WARNING" if warnings else "OK")
    return {
        "file": manifest_path.name,
        "status": status,
        "issues": issues,
        "warnings": warnings,
        "splits": split_details,
    }


def _load_catalog_ids(catalog_path: Optional[Path]) -> Optional[set[str]]:
    if catalog_path is None or not catalog_path.exists():
        return None
    with open(catalog_path, "r", encoding="utf-8") as f:
        cat = json.load(f)
    return {s["id"] for s in cat.get("signos", []) if isinstance(s, dict) and "id" in s}


def main():
    parser = argparse.ArgumentParser(description="Validador endurecido v1.4.0 de datasets ExpresaT")
    parser.add_argument("--file", type=str, help="Archivo JSON de clase a validar")
    parser.add_argument("--dir", type=str, help="Directorio con archivos JSON a validar")
    parser.add_argument("--manifest", type=str, help="Ruta a manifest.json de shards .npy (Etapa 2)")
    parser.add_argument("--catalog", type=str, default=None, help="Ruta opcional a catalog/signs_catalog.json")
    parser.add_argument("--strict", action="store_true", help="Tratar advertencias como errores")
    parser.add_argument("--min-samples", type=int, default=100, help="Mínimo número de muestras sugerido (def: 100)")
    parser.add_argument("--json-output", action="store_true", help="Salida JSON")

    args = parser.parse_args()
    catalog_ids = _load_catalog_ids(Path(args.catalog)) if args.catalog else None

    if args.manifest:
        res = validate_manifest_dir(
            Path(args.manifest),
            strict=args.strict,
            min_samples=args.min_samples,
            catalog_ids=catalog_ids,
        )
        if args.json_output:
            print(json.dumps(res, indent=2, ensure_ascii=False))
        else:
            icon = "[OK]" if res["status"] == "OK" else ("[WARN]" if res["status"] == "WARNING" else "[FAIL]")
            print(f"{icon} {res['file']} ({res['status']})")
            for iss in res["issues"]:
                print(f"   [FAIL] {iss}")
            for warn in res["warnings"]:
                print(f"   [WARN] {warn}")
        sys.exit(1 if res["status"] == "ERROR" else 0)

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
            if f.name not in ["compile_commands.json", "model_metadata.json", "dataset.json", "manifest.json"]
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
        res = validate_file(f, strict=args.strict, min_samples=args.min_samples, catalog_ids=catalog_ids)
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
        }, indent=2, ensure_ascii=False))
    else:
        print(f"Validando {len(results)} archivos...")
        for r in results:
            icon = "[OK]" if r["status"] == "OK" else ("[WARN]" if r["status"] == "WARNING" else "[FAIL]")
            print(f"  {icon} {r['file']:<24} ({r.get('samples', 0)} muestras)")
            for issue in r["issues"]:
                print(f"     [FAIL] {issue}")
            for warn in r["warnings"]:
                print(f"     [WARN] {warn}")
        print(f"\nRESUMEN: {ok_count} OK | {warn_count} WARNING | {err_count} ERROR")

    if err_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
