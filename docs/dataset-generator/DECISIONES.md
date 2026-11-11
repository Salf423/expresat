# Registro de Decisiones de Arquitectura y Gobernanza — Dataset Generator

- **Documento:** `docs/dataset-generator/DECISIONES.md`
- **Última Actualización:** 2026-11-10
- **Rama:** `dataset-v2`
- **Versión de Especificación Vigente:** `FEATURE_SPEC v1.3.1`
- **Versión del Plan Vigente:** `PLAN v2.3.1`
- **Orquestador / Arquitecto:** Antigravity

---

## 1. Contrato Técnico y Topología Canónica

1. **Invariante de Tensor:** El tensor final de inferencia y dataset es estrictamente tridimensional `(1, 15, 178)` con `dtype=float32`.
2. **Estructura 178D:**
   - `[0..51]` Upper Pose (13 puntos anatómicos $\times$ 4 coordenadas: $x, y, z, \text{visibility}$).
   - `[52..114]` Mano Izquierda (21 landmarks $\times$ 3 coordenadas: $x, y, z$).
   - `[115..177]` Mano Derecha (21 landmarks $\times$ 3 coordenadas: $x, y, z$).
3. **Normalización:**
   - Origen en punto medio de hombros: $C = \frac{P_{11} + P_{12}}{2}$.
   - Factor de escala: distancia euclidiana inter-humeral $D = \|P_{11} - P_{12}\|_2$. Rechazo estricto si $D < 0.08$ o $D < 10^{-4}$ con código `ERR_SHOULDERS_TOO_SMALL`. Prohibido truncar con `std::max`.
   - Coordenadas de manos relativas a hombros en $X, Y$: $x' = (x - C_x)/D, \; y' = (y - C_y)/D$.
   - Profundidad de manos relativa a su propia muñeca: $z' = (z_i - z_{\text{muñeca}})/D$.
   - Política de ausencia: 63 ceros exactos por mano ausente.
4. **Asignación Anatómica de Lateralidad (en unidades de $D$):**
   - Costo conjunto espacial + penalización de etiqueta MediaPipe ($+0.25 \cdot D$) + continuidad temporal ($+0.5 \cdot \text{dist2D}(H, H_{\text{prev}})$).
   - Mapeo en frame no espejado: MediaPipe `'Left'` $\to$ Mano Derecha del firmante (`[115..177]`); MediaPipe `'Right'` $\to$ Mano Izquierda del firmante (`[52..114]`).
   - Descarte por desconexión ($> 1.75 \cdot D$) condicionado a visibilidad confiable de la muñeca de pose ($\text{vis} \ge 0.50$).
5. **Redefinición Rigurosa de "Cruce" (Punto 7):**
   - En gestos de cruce, las manos traspasan el plano sagital medio ($x_{\text{der}} < x_{\text{izq}}$ en pantalla, $x_{\text{der}} > x_{\text{izq}}$ en sensor nativo).
   - **La identidad anatómica NO se intercambia:** La penalización por discontinuidad temporal ($+0.50 \cdot \text{dist2D}(H, H_{\text{prev}})$) y el término de etiqueta MediaPipe ($+0.25 \cdot D$) dominan sobre la proximidad instantánea a las muñecas de pose, manteniendo cada mano en su slot anatómico correspondiente (`leftHand` [52..114] y `rightHand` [115..177]).
6. **Compuerta Temporal y de Tasa de Captura (Punto 2):**
   - La regla canónica de brecha temporal máxima es estricta: $\Delta t \le 100\text{ ms}$ (rechazo no negociable `ERR_INVALID_FRAME_GAP_TOO_LARGE`).
   - El grabador dev mide la tasa real en vivo y **rechaza automáticamente** cualquier toma con tasa media $< 15.0\text{ FPS}$ asignando `valid: false` y el código `ERR_CAPTURE_FPS_TOO_LOW`.
7. **Explicación Matemática de Mínimo -4.31 en Pose (Punto 6):**
   - Las coordenadas de pose están normalizadas como $z' = (z - C_z)/D$. MediaPipe Pose estima $z$ con un rango métrico torso-relativo de $[-0.42, +0.40]$. En encuadres donde el firmante tiene $D \approx 0.095$ (distancia moderada a la cámara), $z' = -0.410 / 0.095 = -4.315$. Este valor es matemáticamente consistente y esperado bajo la formulación por hombros, NO representa desbordamiento ni corrupción.
8. **Contrato de Entrada de Detector y Espejo (Punto 5):**
   - `detectForVideo(video, timestamp)` recibe directamente el elemento `<video>` en orientación nativa de sensor (sin flip).
   - El flip horizontal (modo espejo / selfie) se realiza **exclusivamente en el canvas de dibujo** (`renderCanvasFrame`) para confort visual del usuario.

---

## 2. Estado de Compuertas (Gates)

| Compuerta | Estado | Evidencia Demostrada |
|---|---|---|
| **Gate 1A (Paridad Analítica)** | ✅ **SUPERADO** | Conformidad matemática elemento a elemento ($L_\infty \le 10^{-6}$) en Python (`tests/test_feature_spec.py`, 9/9 tests) y JavaScript (`featureExtractor.test.js`, 19/19 tests) sobre todos los casos de prueba compartidos. |
| **Gate 1B (Arnés Determinista WASM y Ruido)** | ✅ **SUPERADO (Chromium y Firefox)** | Evaluado en Playwright a 30 FPS con timestamps fijos ($t_i = i \times 33.333\text{ ms}$). Detección 30/30 en manos (630 puntos) y 30/30 en pose (990 puntos) en ambos motores. Ruido máximo medido $L_\infty = 0.0000$, 0 discrepancias de categoría. |
| **Gate 1B (Rendimiento por Etapa)** | ✅ **MEDIDO EN NAVEGADOR REAL (Firefox)** | Medición automatizada frame a frame con `performance.now()`. Delegado CPU: Total 162.5 ms (Hand: 111.7 ms, Pose: 47.9 ms, EMA: 0.0 ms, Classifier: 0.0 ms, Draw: 2.8 ms) $\to$ 6.2 FPS. Delegado GPU: Total 65.4 ms (Hand: 37.3 ms, Pose: 25.5 ms) $\to$ **15.3 FPS** (cumple compuerta $\ge 15$). |
| **Gate 1C (Calibración con Toma Real de 18s)** | ⏳ **EN CURSO — ESPERANDO TOMA FÍSICA DEL USUARIO** | Grabador dev actualizado con compuerta de 15 FPS en vivo, audio beeps, cuenta regresiva, banner de indicaciones, persistencia de `prompt_timeline`, captura PNG a los 5s y ventana de gracia de 1.5s en `inspect_recording.py`. |

---

## 3. Resumen del Benchmark de Rendimiento (Punto 1)

Medición en Firefox sobre el hardware objetivo (AMD Ryzen 3 7320U, ~7 GiB RAM compartida):

| Configuración Evaluada | Hand (ms) | Pose (ms) | EMA (ms) | Classifier (ms) | Draw Canvas (ms) | Total Frame (ms) | FPS Efectivo | ¿Cumple $\ge 15$ FPS? |
|---|---|---|---|---|---|---|---|---|
| **1. CPU — Manos + Pose (1:1 cadencia)** | 111.72 | 47.92 | 0.00 | 0.00 | 2.80 | **162.48** (p95: 166) | **~6.2 FPS** | ❌ No (explica los 4.4 FPS en dev) |
| **2. GPU — Manos + Pose (1:1 cadencia)** | **37.28** | **25.52** | 0.04 | 0.00 | 2.56 | **65.40** (p95: 69) | **~15.3 FPS** | ✅ **SÍ (Cumple compuerta)** |
| **3. CPU — Solo Manos (sin pose)** | 112.84 | 0.00 | 0.00 | 0.00 | 2.80 | **115.64** (p95: 121) | **~8.6 FPS** | ❌ No |
| **4. CPU — Manos + Pose cada 2 frames (1:2)** | 116.04 | 26.04 | 0.04 | 0.00 | 2.84 | **144.96** (p95: 183) | **~6.9 FPS** | ❌ No |
| **5. CPU — Manos + Pose cada 3 frames (1:3)** | 112.36 | 17.92 | 0.00 | 0.04 | 2.56 | **132.88** (p95: 165) | **~7.5 FPS** | ❌ No |

### Evaluación de Capturador Nativo (Python mediapipe + OpenCV)
- **Estimación de Mejora:** Un capturador nativo en Python (`cv2.VideoCapture` + `mediapipe.solutions.hands` / `holistic`) ejecuta los grafos C++ compilados nativamente sin el overhead de compilación JIT de WebAssembly ni el paso de memoria a través de la interfaz JS-WASM. En Ryzen 3 7320U, la tasa nativa esperada es de **30 a 45 FPS** estables.
- **Plan de Paridad:**
  1. Utilizar exactamente la misma topología 178D y la misma función canónica `extract_frame_features` de `expresat/models/feature_extractor.py`.
  2. Validar que los landmarks emitidos por el capturador nativo pasen los mismos fixtures de prueba de `tests/fixtures/feature_spec_cases.json`.
  3. Exportar las tomas en el mismo formato `.raw.json` para ingesta directa por el pipeline canónico.
- **Decisión:** Siguiendo la directiva explícita del usuario (*"Evalúa un capturador nativo solo como opción... no lo implementes"*), **NO se implementa**. El generador web permanece con opción de aceleración GPU WebGL que ya demostró alcanzar 15.3 FPS.

---

## 4. Bloqueos Activos y Reglas de No-Avance

> [!CAUTION]
> **REGLA DE GOBERNANZA ABSOLUTA:**
> **NO AVANZAR A LA FASE 2 (SHARDING Y DATA AUGMENTATION OFFLINE) SIN APROBACIÓN EXPLÍCITA Y FORMAL DEL USUARIO.**
> Ningún componente de la Fase 2 debe ser implementado antes de que el usuario grabe su toma física real de 18 segundos, se ejecute la auditoría de segmentos y otorgue su visto bueno final al Gate 1.

1. **Fase 2 Bloqueada:** El script de procesamiento masivo en streaming y sharding permanece bloqueado hasta el visto bueno del usuario.
2. **C++ Bloqueado:** `expresat-native/core/` se declara formalmente como `NO_CONFORME_FEATURE_SPEC_1_3_0`. `InferenceThread::run` y `normalize_to_shoulders` rechazan activamente la ejecución con códigos de error explícitos.
3. **Datos Legacy en Cuarentena:** `letra_a_derecha_2.json` es un stub sintético aislado en `dataset/quarantine/`.
4. **Fixture Sintético:** `tests/fixtures/sample_recording_5s.json` es una toma sintética generada matemáticamente para validar arneses; no constituye una captura de cámara física.
5. **Catálogo Oficial:** 16 clases registradas en `catalog/signs_catalog.json` (15 marcadas como `PENDIENTE_FUENTE` y 1 clase `reposo` capturada físicamente en descanso neutro). Ninguna URL externa se declara verificada sin acceso a red.

---

## 5. Herramientas de Desarrollo Operativas y Mejoradas

1. **Grabador Mínimo de Desarrollo (18 s) (`src/components/DevRecorder.jsx`):**
   - Compuerta en vivo: Muestra badge de FPS en tiempo real. Si la tasa promedio es $< 15.0\text{ FPS}$, marca la toma como inválida (`valid: false`, `error: "ERR_CAPTURE_FPS_TOO_LOW"`).
   - Indicaciones y Audio: Secuencia interactiva de 5 fases (reposo, solo derecha, solo izquierda, ambas, cruce) con tonos sonoros sintetizados vía Web Audio API y banner de texto grande con cuenta regresiva.
   - Diagnóstico y Snapshot: Captura automática a los 5.0 s de un archivo PNG del frame nativo no espejado que ve el detector.
   - Etiquetas garantizadas: `categoryName` ('Left'|'Right') y `score` persistidos fielmente en cada mano y a nivel de frame.
2. **Script de Inspección y Validación (`inspect_recording.py`):**
   - Columnas detalladas con coordenadas $x$ de muñecas ($x(H_0), x(H_1), x(P_{15}), x(P_{16})$).
   - Rangos numéricos desglosados por bloque y por canal ($x, y, z, \text{visibility}$).
   - Explicación matemática del mínimo de $-4.31$ en pose.
   - Auditoría con ventana de gracia de 1.5 s tras cada cambio de indicación para respetar el tiempo de reacción humana.
