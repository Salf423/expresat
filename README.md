# ExpresaT — Traductor de Lengua de Señas Mexicana (LSM) en Tiempo Real (`FEATURE_SPEC v1.4.0`)

**ExpresaT** es una plataforma de accesibilidad que traduce gestos de **Lengua de Señas Mexicana (LSM)** a texto y voz en tiempo real directamente desde el navegador, impulsada por visión geométrica **MediaPipe Tasks Vision** y redes neuronales temporales **`DS-TCN 1D` cuantizadas a INT8** (`89.8 KB`, latencia CPU `p50 = 0.319 ms / p99 = 0.625 ms`) sin requerir GPU dedicada.

> [!TIP] 📚 Documentación Completa y Motor de Contexto en Obsidian
> - **Índice Técnico del Repositorio:** [`docs/README.md`](./docs/README.md)
> - **Contrato Matemático 178D (`FEATURE_SPEC v1.4.0`):** [`docs/dataset-generator/FEATURE_SPEC.md`](./docs/dataset-generator/FEATURE_SPEC.md)
> - **Bóveda Obsidian y Hub para Agentes de IA:** [`Obsidian_exp/00_INDICE_MAESTRO.md`](./Obsidian_exp/00_INDICE_MAESTRO.md) y [`Obsidian_exp/Agentes/01_MAPA_CONTEXTO_RAPIDO.md`](./Obsidian_exp/Agentes/01_MAPA_CONTEXTO_RAPIDO.md)

---

## Arquitectura del Sistema (`dataset-v2` — `FEATURE_SPEC v1.4.0`)

1. **Frontend Web en 4 Capas (`expresat/frontend/src/`)**:
   - **`engine/` (`SignEngine`, `featureExtractor.js`)**: Captura 4:3 (`640×480`), MediaPipe Tasks Vision (`HandLandmarker` + `PoseLandmarker`, `poseCadence = 1`) en el hilo principal con deduplicación por `video.currentTime`, getter `raw` perezoso y extractor 178D `v1.4.0` en paridad exacta con Python ($L_\infty = 0.000 \le 10^{-6}$, `0.510 ms/ventana`).
   - **`services/` (`LandmarkEMAFilter`, `LandmarkTracker`)**: Filtrado EMA por slot anatómico (`pose`, `leftHand`, `rightHand`) con limpieza automática al desaparecer una mano.
   - **`recognition/` (`GeometricClassifier`, `SmoothingVoter`)**: Reconocimiento geométrico local 100% en navegador para modo demo/offline.
   - **`transport/` (`WSClient`) y `ui/` (`useSignEngine`, `DevRecorder.jsx`)**: Buffer WebSocket de frames crudos con `t_ms` monotónico real ($\ge 12$ frames, $\ge 933.3\text{ ms}$) y grabador guiado de calibración `.raw.json` `v1.4.0` sellado con `config_hash` SHA-256.
2. **Pipeline Offline Stage-2 de Datasets (`expresat-dataset-generator/scripts/`)**:
   - `validate_recording.py`: Verifica esquema `v1.4.0`, `config_hash`, aspecto 4:3, `FPS >= 15.0`, `max_gap <= 100.0 ms` y presencia activa de manos $\ge 60\%$.
   - `build_dataset_v140.py`: Segmenta ventanas según `catalog/signs_catalog.json` (set piloto de 9 clases verificadas), particiona sin fuga de sesión con `StratifiedGroupKFold` por `(subject_id, session_id, take_id)`, aplica aumentación isotrópica 4:3 **exclusivamente en `train`** y exporta shards `X_{train,val,test}.npy` + `y_*.npy` + `manifest.json`.
3. **Entrenamiento, Ablación A/B e Inferencia Calibrada (`expresat/models/` y `expresat/backend/`)**:
   - `train_and_export.py`: Consume shards `.npy` con `mmap_mode='r'`, ejecuta ablación A/B justa entre **`SignLanguageDSTCN` (`DS-TCN 1D`)** y **`SignLanguageBiGRU` (`BiGRU`)** con capa cinemática enmascarada `[x, Δx]` + `LayerNorm(356)`, calibra post-hoc con **Temperature Scaling** (`ECE < 0.03`) y exporta modelos ONNX INT8 autocontenidos (cero `.onnx.data`) hacia `expresat/models/exported_model/`.
   - `inference_engine.py` + `backend/main.py`: Inferencia ONNX Runtime CPU monohilo vía `asyncio.to_thread`, validación criptográfica `config_hash`, bloqueo de modelos smoke-test en producción y **política de rechazo de 3 compuertas** (`min_confidence >= 0.65`, `min_margin >= 0.20`, `max_normalized_entropy <= 0.55` $\to$ fallback seguro a `reposo`).

---

## Ejecución Rápida en Local

### 1. Frontend Web (React 19 + Vite)
```bash
cd /home/adrian/Proyectos/expresat/expresat/frontend
npm run dev
```

### 2. Backend FastAPI (`EXPRESAT_DEMO_MODE=true` o Modo Modelo ONNX)
```bash
cd /home/adrian/Proyectos/expresat
PYTHONPATH=expresat:expresat/backend ./expresat/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Pipeline Completo de Dataset y Entrenamiento (`v1.4.0`)
```bash
# 1) Validar toma cruda exportada desde DevRecorder
./expresat/venv/bin/python tests/schemas/validate_recording.py recordings_local/<toma>.raw.json

# 2) Generar shards .npy + manifest.json con StratifiedGroupKFold (fuga cero)
./expresat/venv/bin/python expresat-dataset-generator/scripts/build_dataset_v140.py \
  --raw-dir recordings_local/ --output-dir /tmp/expresat_shards_v140 --catalog catalog/signs_catalog.json

# 3) Entrenar ablación A/B (DS-TCN 1D vs BiGRU) y exportar a expresat/models/exported_model
./expresat/venv/bin/python expresat/models/train_and_export.py \
  --manifest /tmp/expresat_shards_v140/manifest.json --ablation --output expresat/models/exported_model
```

---

## Suites de Verificación, Linters y Build

```bash
# 1. Suite completa de contratos Python v1.4.0, Stage-2, entrenamiento A/B, calibración, inferencia y CI (54 tests)
./expresat/venv/bin/python -m unittest discover -s tests -p "test_*.py" -v

# 2. Pruebas unitarias y de integración del backend FastAPI (22 tests)
PYTHONPATH=expresat:expresat/backend ./expresat/venv/bin/python -m unittest \
  expresat/backend/test_api_integration.py expresat/backend/test_demo_rules.py -v

# 3. Pruebas unitarias Frontend (Vitest — 78 tests), Linters (ESLint + oxlint) y Build (Vite)
npm --prefix expresat/frontend test -- --run
npm --prefix expresat/frontend run lint
npx --prefix expresat/frontend oxlint expresat/frontend/src
npm --prefix expresat/frontend run build
```
