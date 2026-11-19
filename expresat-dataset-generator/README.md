# `expresat-dataset-generator` — Pipeline Offline de Datasets LSM (`FEATURE_SPEC v1.4.0`)

> [!IMPORTANT]
> **Retiro del generador C++ legacy (`ERR_CPP_NOT_CONFORMANT`):** La antigua herramienta C++/ImGui con modo stub fue retirada. La única fuente de verdad activa en la rama `dataset-v2` es el pipeline **JS ↔ Python `FEATURE_SPEC v1.4.0`** con paridad verificada ($L_\infty \le 10^{-6}$). Consulta [`docs/NATIVE_ISOLATION_POLICY.md`](../docs/NATIVE_ISOLATION_POLICY.md) para la política de aislamiento de `expresat-native/`.

---

## Arquitectura del Pipeline en 2 Etapas

```text
Etapa 1 (Navegador — DevRecorder.jsx)
  Cámara 4:3 real -> MediaPipe Tasks (Hand + Pose, GPU/CPU, pose_cadence=1)
  -> Exporta *.raw.json v1.4.0 (landmarks crudos + t_ms + config_hash + SHA-256 .task)
        │
        ▼
Etapa 2 (Python Offline — expresat-dataset-generator/scripts/)
  1. validate_recording.py  -> Verifica esquema v1.4.0, FPS >= 15, max_gap <= 100 ms,
                               aspect 4:3, presencia activa de manos y config_hash.
  2. build_dataset_v140.py  -> Segmenta ventanas (reposo / estatica / dinamica),
                               divide con StratifiedGroupKFold por (subject_id, session_id, take_id),
                               aplica data augmentation isotrópico 4:3 SOLO en train,
                               extrae tensores (N, 15, 178) float32 vectorizados
                               y sella shards X_{train,val,test}.npy + y_*.npy + manifest.json.
        │
        ▼
Etapa 3 (Entrenamiento y Export — expresat/models/train_and_export.py)
  Consume shards .npy (mmap_mode='r') + manifest.json validado
  -> Ablación A/B justa: DS-TCN 1D vs BiGRU (Macro-F1 Early Stopping)
  -> Calibración post-hoc Temperature Scaling (ECE < 0.03)
  -> Export ONNX autocontenido FP32 + INT8 (cero .onnx.data)
  -> Destino canónico: expresat/models/exported_model/
```

---

## Estructura de Scripts Activos

```text
expresat-dataset-generator/
├── README.md
└── scripts/
    ├── validate_recording.py   # Validador estricto de tomas *.raw.json v1.4.0
    ├── build_dataset_v140.py   # Pipeline Stage-2 vectorizado -> shards .npy + manifest.json
    ├── validate_dataset.py     # Auditor anti-stub y contrato 178D v1.4.0
    └── inspect_recording.py    # Inspector forense de tomas crudas y rangos z'
```

---

## Topología Canónica del Tensor `(1, 15, 178)` (`float32`)

| Bloque | Landmarks | Coordenadas | Dimensión | Regla `v1.4.0` |
|---|---|---|---|---|
| Upper Pose | 13 pts (`0, 11–22`) | `x', y', z', visibility` | **52** (`0:52`) | Escala $D_{\text{2D\_iso}}$ 4:3 (`>= 0.08`), `z' = 0.0` en `P15..P22`, clip `[-2.0, 2.0]` en `P00, P11..P14` |
| Mano Izquierda | 21 pts (`0–20`) | `x', y', z'` | **63** (`52:115`) | Lateralidad directa `'Left' -> leftHand`, `z'` relativa a muñeca; `63` ceros si ausente |
| Mano Derecha | 21 pts (`0–20`) | `x', y', z'` | **63** (`115:178`) | Lateralidad directa `'Right' -> rightHand`, `z'` relativa a muñeca; `63` ceros si ausente |
| **Total** | | | **178** | Ventana `1000 ms` remuestreada a `15` frames, brecha cruda estricta `<= 100 ms` |

---

## Uso Rápido

```bash
# 1. Validar una grabación cruda exportada desde DevRecorder
./expresat/venv/bin/python expresat-dataset-generator/scripts/validate_recording.py \
  --input recordings_local/mi_toma.raw.json \
  --catalog catalog/signs_catalog.json

# 2. Construir shards .npy + manifest.json sin fuga de sesión (StratifiedGroupKFold)
./expresat/venv/bin/python expresat-dataset-generator/scripts/build_dataset_v140.py \
  --raw-dir recordings_local/ \
  --output-dir /tmp/expresat_shards_v140 \
  --catalog catalog/signs_catalog.json

# 3. Entrenar ablación A/B (DS-TCN 1D vs BiGRU) y exportar a expresat/models/exported_model
./expresat/venv/bin/python expresat/models/train_and_export.py \
  --manifest /tmp/expresat_shards_v140/manifest.json \
  --ablation \
  --output expresat/models/exported_model
```

> **Smoke-test de CI (nunca para producción):**
> ```bash
> ./expresat/venv/bin/python expresat/models/train_and_export.py \
>   --allow-synthetic-smoke-test --ablation --epochs 18 --output /tmp/expresat_smoke
> ```
> Los artefactos de smoke-test quedan sellados con `is_smoke_test: true` y `production_ready: false` y son bloqueados por `InferenceEngine` en producción.
