# `expresat/models/exported_model/` — Ruta Canónica de Modelos ONNX (`FEATURE_SPEC v1.4.0`)

Este directorio es la **única ruta canónica** de exportación y carga de modelos para `InferenceEngine` y el backend FastAPI (`MODEL_DIR`).

## Política de Artefactos
- Los artefactos legacy `v1.0.0` (incluidos el directorio raíz huérfano `/exported_model/`, el modelo entrenado sobre el stub senoidal y los archivos externos `.onnx.data`) fueron retirados explícitamente al migrar al contrato **`FEATURE_SPEC v1.4.0`**.
- **Prohibido commitear pesos de smoke-test:** cualquier modelo generado con `--allow-synthetic-smoke-test` lleva `is_smoke_test: true` y `production_ready: false`, debe exportarse únicamente a un directorio temporal (`/tmp/...`) y es rechazado automáticamente por `InferenceEngine` en producción con `IncompatibleFeatureSpecError`.
- Todo modelo exportado aquí debe generarse exclusivamente a partir de shards `.npy` + `manifest.json` reales validados por:
  1. `expresat-dataset-generator/scripts/validate_recording.py` (`v1.4.0`)
  2. `expresat-dataset-generator/scripts/build_dataset_v140.py` (`StratifiedGroupKFold` sin fuga de sesión)
  3. `expresat/models/train_and_export.py --manifest <ruta/manifest.json> --output expresat/models/exported_model`
- Cada exportación debe producir archivos `.onnx` autocontenidos (cero archivos `.onnx.data`), con `model_metadata.json` sellado con `feature_spec_version: "1.4.0"`, `config_hash`, `temperature`, `calibration`, `rejection_policy` y métricas de ablación A/B (`DS-TCN 1D` vs `BiGRU`).
