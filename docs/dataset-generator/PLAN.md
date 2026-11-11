# Plan de Rediseño — Dataset Generator v2 (PLAN.md)

- **Documento:** Plan arquitectónico y hoja de ruta para la reestructuración de `expresat-dataset-generator/`.
- **Versión:** `2.2.2` (Consolidado con correcciones de especificación v1.2.2 y fixtures compartidos)
- **Fecha:** 2026-11-10
- **Rama:** `dataset-v2`
- **Arquitecto y Orquestador:** Antigravity

---

## 1. Arquitectura en Dos Etapas Desacopladas

```
┌────────────────────────────────────────────────────────────────────────┐
│ ETAPA 1: CAPTURA WEB EN TIEMPO REAL (Firefox / Tasks Vision)          │
│                                                                        │
│   Webcam 640×480 @ tasa nativa (Aspect Ratio 4:3 verificado en vivo)   │
│       ↓                                                                │
│   SignEngine (@mediapipe/tasks-vision 1.0.1 CPU, runningMode: VIDEO)   │
│   [Importado como paquete compartido desde frontend/src/engine/]       │
│   - HandLandmarker (SHA256 fbc2a300..., minConfidence: 0.50)           │
│   - PoseLandmarker Lite (SHA256 59929e1d..., minConfidence: 0.50)      │
│   - Opción smoothLandmarks: false (emisión de landmarks crudos en raw) │
│       ↓                                                                │
│   Landmarks Crudos 3D a Tasa Nativa (SIN REMUESTREAR, SIN FILTRO EMA)  │
│   Buffer continuo: duración máxima 2.5 s (2500 ms) por toma            │
│       ↓                                                                │
│   Segmentación en Vivo & Detección de Ventana Canónica (1000 ms):      │
│   - Modo "estatica": Exige pose estable durante ≥ 1200 ms              │
│   - Modo "dinamica": Centrada en curva cinética (2500 ms máx)          │
│   - Validación suave: GeometricClassifier detecta FLAGGED_MISMATCH     │
│   - Cuenta regresiva 3-2-1 y repetición interactiva                    │
│       ↓                                                                │
│   Persistencia Segura (POST local http://127.0.0.1:8001/save)          │
│   raw_captures/<session_id>/<sign>_<timestamp>.raw.json                │
│   - Guarda landmarks crudos a tasa nativa                              │
│   - Guarda metadatos de segmentación (t_start, t_end, modo, varianza)  │
│   - Servidor con token de sesión, validación Origin y escritura atómica│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Completamente desacoplado)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ ETAPA 2: PIPELINE OFFLINE DE SHARDING Y AUGMENTATION EN PYTHON         │
│ (CLI Headless / Python 3.10+ en Streaming con NumPy)                   │
│                                                                        │
│   raw_captures/*.raw.json                                              │
│       ↓                                                                │
│   Partición Train / Val / Test Estratificada por Clase                 │
│   (Reporte explícito de firmante: "single_signer" si aplica)           │
│       ↓                                                                │
│   DataAugmenter en Python (SOBRE LANDMARKS CRUDOS ORIGINALES):         │
│   - Validación de calidad sobre frames originales, NUNCA sobre aumentados│
│   - Rotación rígida 2D centrada en el centro de hombros C=(Cx, Cy)     │
│   - Jitter gaussiano adaptativo a palmScale                            │
│   - Variación de velocidad temporal (remuestreo 0.85×–1.15×)           │
│   - Desplazamientos temporales de inicio (±100 ms en ventana 1000 ms)  │
│   - HAND_DROPOUT_FRAME (pérdida de 1 mano en 1 frame)                  │
│   - FULL_FRAME_DROPOUT (pérdida de frame completo ≤ 100 ms)            │
│   - Espejo horizontal (x -> 1-x en raw, x' -> -x' en features)         │
│       ↓                                                                │
│   SECUENCIA CANÓNICA ExtractWindow POR BLOQUES ANATÓMICOS:             │
│   1. Validar hombros crudos y brechas (gap <= 100 ms)                  │
│   2. Asignar manos por frame crudo (costo conjunto + etiquetas + cont) │
│   3. Remuestrear temporalmente por bloque a 15 frames (Δt = 66.67 ms)  │
│   4. D_ventana y C_ventana (mediana de 15 frames, D >= 0.08)           │
│   5. Filtro EMA temporal por bloque (α = 0.50, reinicio por bloque)    │
│   6. Normalizar hombros y muñeca Z -> Tensor (1, 15, 178) float32      │
│       ↓                                                                │
│   Escritor en Shards Binarios Float32:                                 │
│   dataset_vN/shards/train_shard_000.npy                                │
│   dataset_vN/shards/val_shard_000.npy                                  │
│   dataset_vN/manifest.json (SHA256, feature_spec_version: 1.2.2)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Invariantes del Sistema y Políticas Críticas

1. **Invariante de Tensor:** Forma estricta `(1, 15, 178)` en `float32`.
2. **Duración de Tomas:** Unificada en **$2.5\text{ s}$ ($2500\text{ ms}$)**.
3. **Señas Estáticas:** El usuario debe mantener la pose estable durante $\ge 1200\text{ ms}$.
4. **Catálogo Oficial:** Todas las señas se definen en `catalog/signs_catalog.json` con fuente verificable (URL pública accesible) o se declaran explícitamente como `PENDIENTE_FUENTE`.
5. **Fixtures Compartidos:** `tests/fixtures/feature_spec_cases.json` es la fuente única de verdad para pruebas de Python y JavaScript, con validación $L_\infty \le 10^{-6}$.
6. **Estado de C++:** Declarado como **NO CONFORME CON FEATURE_SPEC v1.2.2**. El pipeline nativo C++ queda bloqueado para modelos v1.2+.
7. **Memoria y Streaming:** En CLI offline, los shards `.npy` se generan por streaming, garantizando RSS plano e independiente del número de tomas.
