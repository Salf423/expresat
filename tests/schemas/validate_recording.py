"""Validate .raw.json recordings against tests/schemas/recording_raw.schema.json.

Uses only the Python standard library; if `jsonschema` is installed, it also runs
Draft202012Validator for a second check.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCHEMA_PATH = Path(__file__).resolve().parent / "recording_raw.schema.json"


def load_recording_schema(schema_path: Path = SCHEMA_PATH) -> Dict[str, Any]:
    """Load the canonical JSON Schema for raw ExpresaT recordings."""
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(float(value))
        )
    return True


def _resolve_ref(ref: str, root_schema: Dict[str, Any]) -> Dict[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"Referencia JSON Schema no soportada: {ref}")
    node: Any = root_schema
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def _validate_node(
    value: Any,
    schema: Dict[str, Any],
    root_schema: Dict[str, Any],
    path: str,
    errors: List[str],
    max_errors: int = 20,
) -> None:
    if len(errors) >= max_errors:
        return

    if "$ref" in schema:
        schema = _resolve_ref(schema["$ref"], root_schema)

    if "anyOf" in schema:
        branch_errors: List[List[str]] = []
        for sub in schema["anyOf"]:
            sub_err: List[str] = []
            _validate_node(value, sub, root_schema, path, sub_err, max_errors=5)
            if not sub_err:
                break
            branch_errors.append(sub_err)
        else:
            errors.append(f"{path}: no coincide con ninguna rama anyOf ({branch_errors[0][0]})")
            return

    if "type" in schema:
        allowed_types = schema["type"]
        if isinstance(allowed_types, str):
            allowed_types = [allowed_types]
        if not any(_matches_type(value, t) for t in allowed_types):
            errors.append(f"{path}: se esperaba tipo {allowed_types}, se recibió {type(value).__name__}")
            return

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: debe valer exactamente {schema['const']!r}, se recibió {value!r}")

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: valor {value!r} fuera de enum {schema['enum']!r}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: longitud {len(value)} < minLength {schema['minLength']}")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            errors.append(f"{path}: no coincide con patrón {schema['pattern']!r}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < minimum {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: {value} > maximum {schema['maximum']}")

    if isinstance(value, dict):
        props = schema.get("properties", {})
        for req_key in schema.get("required", []):
            if req_key not in value:
                errors.append(f"{path}: falta propiedad requerida {req_key!r}")
        if schema.get("additionalProperties") is False:
            extra = [k for k in value.keys() if k not in props]
            if extra:
                errors.append(f"{path}: propiedades adicionales no permitidas {extra!r}")
        for k, sub_schema in props.items():
            if k in value and len(errors) < max_errors:
                _validate_node(value[k], sub_schema, root_schema, f"{path}.{k}", errors, max_errors)

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: len={len(value)} < minItems {schema['minItems']}")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: len={len(value)} > maxItems {schema['maxItems']}")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for idx, elem in enumerate(value):
                if len(errors) >= max_errors:
                    break
                _validate_node(elem, item_schema, root_schema, f"{path}[{idx}]", errors, max_errors)


def validate_recording(payload: Any, schema: Optional[Dict[str, Any]] = None) -> List[str]:
    """Return a list of schema validation errors (empty when valid)."""
    if schema is None:
        schema = load_recording_schema()

    errors: List[str] = []
    _validate_node(payload, schema, schema, "$", errors)

    if not errors and isinstance(payload, dict):
        if len(payload.get("frames", [])) != payload.get("total_frames"):
            errors.append(
                f"$.total_frames ({payload.get('total_frames')}) != len($.frames) ({len(payload.get('frames', []))})"
            )

    try:
        import jsonschema  # type: ignore

        validator = jsonschema.Draft202012Validator(schema)
        for err in validator.iter_errors(payload):
            errors.append(f"jsonschema({'.'.join(str(p) for p in err.path) or '$'}): {err.message}")
    except ImportError:
        pass

    return errors


def main(argv: List[str]) -> int:
    if not argv:
        print("Uso: python tests/schemas/validate_recording.py <archivo.raw.json> [...]", file=sys.stderr)
        return 2

    schema = load_recording_schema()
    exit_code = 0
    for arg in argv:
        path = Path(arg)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            print(f"[FAIL] {path}: error leyendo JSON ({exc})")
            exit_code = 1
            continue

        errs = validate_recording(data, schema)
        if errs:
            print(f"[FAIL] {path}: {len(errs)} error(es)")
            for e in errs[:10]:
                print(f"   - {e}")
            exit_code = 1
        else:
            n_frames = len(data.get("frames", [])) if isinstance(data, dict) else 0
            print(f"[OK]   {path} (version={data.get('version')}, frames={n_frames})")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
