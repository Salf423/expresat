# Política de Consolidación de Ramas y Aislamiento de `expresat-native/` (`FEATURE_SPEC v1.4.0`)

- **Estado:** VIGENTE
- **Rama Fuente de Verdad:** `dataset-v2` (pipeline JS ↔ Python `FEATURE_SPEC v1.4.0`)
- **Código de Bloqueo Nativo:** `ERR_CPP_NOT_CONFORMANT`

---

## 1. Consolidación de Ramas (Única Fuente de Verdad)
1. **`dataset-v2`** es la única fuente de verdad para extracción de características (`featureExtractor.js` ↔ `feature_extractor.py`, paridad verificada $L_\infty = 0.000 \le 10^{-6}$), captura dev (`DevRecorder.jsx`), validación (`validate_recording.py`), empaquetado de shards (`build_dataset_v140.py`), entrenamiento/ablación (`train_and_export.py`) e inferencia ONNX (`inference_engine.py`).
2. Todo artefacto legacy de entrenamiento en `/exported_model/` (raíz huérfana) y pesos stub `v1.0.0` (`.onnx.data` incluido) ha sido retirado; la única ruta canónica de despliegue es `expresat/models/exported_model/`.

## 2. Retiro del Generador C++ Legacy (`expresat-dataset-generator`)
El antiguo generador de escritorio C++ (Dear ImGui / OpenCV / stub senoidal en `expresat-dataset-generator/src/`) queda **retirado permanentemente**:
- No implementa `FEATURE_SPEC v1.4.0` (carece de $D_{\text{2D\_iso}}$ 4:3, política `z' = 0.0` en `P15..P22`, lateralidad directa, compuerta $\Delta t \le 100\text{ ms}$ y `config_hash`).
- En su lugar, la captura real ocurre exclusivamente en el navegador vía `DevRecorder.jsx` (exportando `.raw.json` v1.4.0 validado) y el procesamiento offline ocurre vía `expresat-dataset-generator/scripts/build_dataset_v140.py`.

## 3. Bloqueo Explícito de `expresat-native/` (`ERR_CPP_NOT_CONFORMANT`)
El árbol nativo `expresat-native/` (conservado históricamente en la rama `main` para escritorio/Android NDK) queda **explícitamente aislado y bloqueado fuera del pipeline activo** (`ERR_CPP_NOT_CONFORMANT`) hasta que cumpla **todos** los siguientes requisitos de conformidad:
1. Portar `ExtractWindow` completo conforme a **`FEATURE_SPEC v1.4.0`**:
   - $D_{\text{2D\_iso}}$ 4:3 con `SHOULDERS_D_MIN = 0.08`,
   - `z' = 0.0` en `P15..P22` y clip `[-2.0, 2.0]` en `P00, P11..P14`,
   - asignación anatómica de lateralidad directa (`'Left' -> leftHand`, `'Right' -> rightHand`) con costo unificado 2D isotrópico y caducidad de memoria de muñeca `200 ms`,
   - compuerta estricta de brecha $\Delta t \le 100.0\text{ ms}$, densidad mínima $\ge 12$ frames y cero extrapolación de cola.
2. Superar la suite compartida `tests/fixtures/feature_spec_cases.json` con $L_\infty \le 10^{-6}$ frente a Python/JS.
3. Validar `feature_spec_version == "1.4.0"`, `config_hash` SHA-256, rechazo de `is_smoke_test=true`, `temperature` scaling y política de rechazo de 3 compuertas antes de ejecutar inferencia ONNX (`DS-TCN 1D`).

Mientras no se acredite esa paridad con tests automatizados, **queda prohibido**:
- Conectar `expresat-native/` al backend/CI o desplegar modelos `v1.4.0` en binarios C++ sin `ExtractWindow v1.4.0`.
- Reintroducir archivos `.cpp` o `CMakeLists.txt` legacy dentro de `expresat-dataset-generator/`.
