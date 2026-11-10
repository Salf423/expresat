# Plan de Rediseño — Dataset Generator v2 (PLAN.md)

- **Documento:** Plan arquitectónico y hoja de ruta para la reestructuración de `expresat-dataset-generator/`.
- **Versión:** `2.2.1` (Parche consolidado con correcciones de especificación v1.2.1)
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
│   - Opción smoothLandmarks: false (emisión de landmarks crudos)        │
│       ↓                                                                │
│   Landmarks Crudos 3D a Tasa Nativa (SIN REMUESTREAR, SIN FILTRO EMA)  │
│   Buffer continuo: duración máxima 2.5 s por toma                      │
│       ↓                                                                │
│   Segmentación en Vivo & Detección de Ventana Canónica (1000 ms):      │
│   - Modo "estatica": Centrada en meseta de estabilidad cinemática      │
│   - Modo "dinamica": Centrada en pico de energía cinética              │
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
│   DataAugmenter en Python (SOBRE LANDMARKS CRUDOS A TASA NATIVA):      │
│   - Jitter gaussiano adaptativo a palmScale                            │
│   - Rotación rígida 2D con Aspect Ratio 4:3 corregido                  │
│   - Variación de velocidad temporal (remuestreo temporal 0.85×–1.15×)  │
│   - Desplazamientos temporales de inicio (±100 ms en ventana de 1000ms)│
│   - HAND_DROPOUT_FRAME (pérdida de 1 mano en 1 frame)                  │
│   - FULL_FRAME_DROPOUT (pérdida de frame completo ≤ 100 ms)            │
│   - Espejo horizontal controlado e intercambio de categoryName         │
│       ↓                                                                │
│   UN ÚNICO REMUESTREO TEMPORAL a 15 frames exactos (Δt = 66.67 ms)     │
│   (Presencia interpolada solo si existe en ambos lados; ceros si no;   │
│    valida hombros crudos antes de interpolar; brecha máx ≤ 100 ms)     │
│       ↓                                                                │
│   Algoritmo ExtractWindow (FEATURE_SPEC.md v1.2.1):                    │
│   1. Cálculo de C_ventana y D_ventana (mediana de la secuencia)        │
│   2. Rechazo estricto si D_ventana < 0.08 (ERR_SHOULDERS_TOO_SMALL)    │
│   3. Filtro EMA (α = 0.50, reinicio por ventana y por reaparición)     │
│   4. Asignación conjunta de manos por costo mínimo euclidiano a P15/P16│
│   5. Normalización 3D canónica (Z de mano relativo a muñeca: (z-z0)/D) │
│       ↓                                                                │
│   Escritura en Streaming por Shards Binarios Float32:                  │
│   dataset_vN/                                                          │
│   ├── train_shard_000.npy   (N, 15, 178) float32 contiguo              │
│   ├── val_shard_000.npy     (N, 15, 178) float32 contiguo              │
│   └── manifest.json         (feature_spec_version: 1.2.1, semilla,     │
│                              config_hash, mapeo muestra->toma base,    │
│                              generator: expresat-dataset-generator-v2) │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Especificación por Frentes de Rediseño

### Frente A: Paridad Determinista y Unificación del Spec
1. **Unificación con [FEATURE_SPEC.md v1.2.1](file:///home/adrian/Proyectos/expresat/docs/dataset-generator/FEATURE_SPEC.md):**
   - Tolerancia formal: **$10^{-6}$** en norma $L_\infty$, calculando internamente en `float64` y casteando a `float32`.
   - Asignación conjunta de manos minimizando la suma de distancias euclidianas a $P_{15}$ y $P_{16}$. Desempate en casos ambiguos ($|d_{\text{izq}} - d_{\text{der}}| < 0.15 \cdot D$) con `categoryName` de MediaPipe.
   - Rechazo estricto si $D < 0.08$ (`ERR_SHOULDERS_TOO_SMALL`) o si la pose tiene menos de 23 landmarks (`ERR_POSE_MISSING`).
   - Normalización de $Z$ en manos invariante a traslación: $z'_i = (z_i - z_{\text{muñeca}})/D$.
2. **Importación Directa sin Copias:**
   - El generador web importa `SignEngine` como paquete compartido desde `frontend/src/engine/`.
   - Se actualiza `SignEngine` para soportar `{ smoothLandmarks: false }` y emitir landmarks crudos.
3. **Paridad Determinista:**
   - Medición de ruido WASM en video fixture de referencia de 30 frames y fijación de tolerancia de compuerta: $\text{Tol} = \max(10^{-5}, 3 \times E_{\text{WASM}})$.
4. **Compuerta A:** Aprobación de paridad de landmarks en fixture y verificación en verde de `TC-01` a `TC-05C` en Python, C++ y JS.

---

### Frente B: Captura Web a Tasa Nativa, Modos y Servidor Seguro
1. **Captura sin Remuestreo (Tasa Nativa):**
   - Duración máxima por toma: **$2.5 \text{ s}$** ($2500 \text{ ms}$).
   - Colocación de la ventana canónica de $1000 \text{ ms}$:
     - Señas estáticas: centrada en la meseta de estabilidad $[t_{\text{stable}} - 500 \text{ ms}, t_{\text{stable}} + 500 \text{ ms}]$.
     - Señas dinámicas: centrada en el pico de energía $[t_{\text{peak}} - 500 \text{ ms}, t_{\text{peak}} + 500 \text{ ms}]$.
   - Los `.raw.json` guardan los metadatos de segmentación (`t_start`, `t_end`, modo, varianza).
2. **Catálogo Oficial con Fuentes:**
   - Los modos se configuran en `catalog/signs_catalog.json` con fuente documental verificable (ej. Diccionario Oficial de LSM - CONADIS / CDMX). No se codifican a ciegas.
3. **Clase de Reposo REAL:**
   - La clase `reposo` se captura **físicamente con el sistema** (persona en encuadre sin gesticular, manos abajo o en descanso natural).
   - Se prohíbe inventar clases con ruido gaussiano.
4. **Calibración Piloto de Umbrales:**
   - Piloto de **30 a 50 tomas** distribuidas por modo para calibrar percentiles (P5, P50, P95).
   - Jitter articular evaluado como deformación interna en $\text{palmScale}/\text{s}$ ($< 4.0 \text{ palmScale}/\text{s}$).
5. **Microservidor de Captura Seguro (`scripts/capture_server.py`):**
   - Escucha en `127.0.0.1:8001`.
   - Exige cabecera `Content-Type: application/json`.
   - Valida cabecera `Origin` (`http://localhost:5173`, `http://127.0.0.1:5173`).
   - Límite de payload: $15 \text{ MB}$.
   - Longitud máxima de `session_id` ($\le 64$) y `sign` ($\le 32$) con regex `^[a-zA-Z0-9_-]+$`.
   - **Token de sesión:** Se genera un token aleatorio en consola al iniciar el servidor (`secrets.token_urlsafe(32)`); la UI web lo envía en la cabecera `X-Capture-Token`.
   - Escritura atómica a disco: `.raw.json.tmp` + `os.replace()`.

---

### Frente C: Variaciones (Augmentation) Offline en Python
1. **Lenguaje Elegido:** **Python 3.10+ / 3.14 (venv del proyecto)**:
   - El código legacy de `expresat-dataset-generator/src` (stub C++) se **congela y protege como histórico** (`DEPRECATED_LEGACY_CPP`).
2. **Augmentation Exclusivamente sobre Frames Crudos:**
   - Se aplican todas las transformaciones (jitter gaussiano, rotación 2D aspect-ratio, variaciones de velocidad $0.85\times\text{--}1.15\times$, desplazamientos de ventana $\pm 100 \text{ ms}$, dropouts) **sobre los frames crudos antes del remuestreo temporal a 15 frames**.
   - Oclusiones tipificadas: `HAND_DROPOUT_FRAME` y `FULL_FRAME_DROPOUT`.
   - Espejo horizontal intercambia coordenadas $x \to -x$ e intercambia `categoryName` (`'Left'` $\leftrightarrow$ `'Right'`).
3. **División sin Fugas Estratificada:**
   - Partición Train/Val/Test estratificada por clase antes de aumentar.
   - Si los datos provienen de un solo firmante, el `manifest.json` registrará: `"signer_split": "single_signer"`.
4. **Reproducibilidad y Manifiesto:**
   - Directorio nuevo `dataset_vN/`. Semilla PRNG fijada.
   - Campos obligatorios en `manifest.json`: `feature_spec_version: "1.2.1"`, `config_hash`, `generator: "expresat-dataset-generator-v2-web-python"`, mapeo muestra sintética $\to$ toma base original y balance por clase.

---

### Frente D: Sharding Binario NumPy y Medición de RAM
1. **Formato de Almacenamiento Final:**
   - **Shards Binarios NumPy (`.npy`):** Tensores contiguos `(N, 15, 178)` en `float32`.
   - JSON se reserva exclusivamente para las capturas crudas intermedias (`.raw.json`).
2. **Adaptación de `train_and_export.py`:**
   - Mantiene compatibilidad de lectura con `.json`.
   - Al cargar shards `.npy`, **comprueba que `feature_spec_version == "1.2.1"`** en el `manifest.json`. Si no coincide, falta el manifiesto o está marcado como stub, **aborta con error explícito**.
   - Aborta si hay menos de 2 clases reales en el dataset.
3. **Metodología de Medición de RAM Real:**
   - **En Captura Web (Firefox):** Medición con `about:memory`. Criterio: incremento de memoria plano tras Garbage Collection al pasar de 10 a 100 a 500 tomas ($< 15 \text{ MB}$ netos de retención).
   - **En Pipeline de Sharding Offline (Python):** Medición de RSS con `psutil`. Criterio: curva plana ($\Delta \text{RSS} < 5 \text{ MB}$) con techo $\le 100 \text{ MB}$.

---

## 3. Estimaciones de Rendimiento y Aislamiento de Legacy

### Estimaciones Preliminares de Hardware (AMD Ryzen 3 7320U, ~7 GiB RAM)
> ⚠️ **Aviso de Estimación:** Las siguientes cifras son **estimaciones preliminares** a ser validadas empíricamente en Firefox con cámara física:
- **Uso de CPU:** ~30% a 38% de 1 núcleo (4 núcleos / 8 hilos disponibles).
- **Framerate esperado:** 20 a 25 FPS estables con `HandLandmarker` + `PoseLandmarker Lite` en CPU.
- **Memoria base del navegador:** ~350 a 480 MB de RSS inicial en Firefox.

### Aislamiento de `letra_a_derecha_2.json`
- El dataset legacy `letra_a_derecha_2.json` queda aislado en `dataset/quarantine/`.
- Se eliminó el Drift Test contra datos sintéticos.

---

## 4. Cronograma de Fases y Compuertas

```
Fase 0: Aprobación de FEATURE_SPEC.md v1.2.1 y PLAN.md v2.2.1 (COMPLETADA)
                           ↓
Fase 1: Frente A — Pruebas de Paridad y Módulo Compartido
  • Gate 1A: Test de paridad numérica contra TC-01..TC-05C en Python, C++ y JS (Tol ≤ 10^-6)
  • Gate 1B: Medición de ruido WASM y test de paridad de landmarks en video fixture
                           ↓
Fase 2: Frente D — Sharding Binario .npy y Adaptación de train_and_export.py
  • Gate 2A: Verificación de lectura directa de .npy en train_and_export.py (spec 1.2.1)
  • Gate 2B: Medición de memoria plana en CLI offline en Python con 10, 100 y 500 muestras
                           ↓
Fase 3: Frente B — Captura Web en Firefox, Modos Estático/Dinámico y Microservidor Local
  • Gate 3A: Calibración piloto de umbrales (30-50 tomas) y persistencia segura de .raw.json
  • Gate 3B: Medición de memoria plana en Firefox vía about:memory
                           ↓
Fase 4: Frente C — Augmentation Offline en Python y Test de No-Fuga
  • Gate 4: Test de reproducibilidad (semilla idéntica), propiedades y test de no-fuga
                           ↓
Fase 5: Regresión Global y Generación de dataset_vN
  • Gate 5: Generación end-to-end de dataset_vN (shards .npy), verificación de shape (N, 15, 178) y REPORTE.md
```
