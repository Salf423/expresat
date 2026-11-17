# Registro de Decisiones de Arquitectura y Gobernanza — Dataset Generator

- **Documento:** `docs/dataset-generator/DECISIONES.md`
- **Última Actualización:** 2026-11-12
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
   - Factor de escala: distancia euclidiana inter-humeral 3D $D = \|P_{11} - P_{12}\|_2$. Rechazo estricto si $D < 0.08$ o $D < 10^{-4}$ con código `ERR_SHOULDERS_TOO_SMALL`. Prohibido truncar con `std::max`.
   - Coordenadas de manos relativas a hombros en $X, Y$: $x' = (x - C_x)/D, \; y' = (y - C_y)/D$.
   - Profundidad de manos relativa a su propia muñeca: $z' = (z_i - z_{\text{muñeca}})/D$.
   - Política de ausencia: 63 ceros exactos por mano ausente.
4. **Asignación Anatómica de Lateralidad (en unidades de $D$):**
   - Costo conjunto espacial + penalización de etiqueta MediaPipe ($+0.25 \cdot D$) + continuidad temporal ($+0.5 \cdot \text{dist2D}(H, H_{\text{prev}})$).
   - Mapeo vigente en `v1.3.0`/`v1.3.1` (sin modificar todavía): MediaPipe `'Left'` $\to$ Mano Derecha del firmante (`[115..177]`); MediaPipe `'Right'` $\to$ Mano Izquierda del firmante (`[52..114]`).
   - **[Auditoría Pre-Fase 1 sobre grabación real, 2026-11-12]:** En `recordings_local/grabacion_dev_18s_1794367978455.raw.json` (79 frames, 51 con manos, 66 detecciones), **66/66 (100%)** coinciden con convención directa `'Left'->leftHand`, `'Right'->rightHand` (`0/66` con la regla invertida `v1.3.0`). Al trazar el `extract_window` real sobre la grabación (`duration_ms=5000.0` porque a `1000.0 ms` rechaza con `ERR_INVALID_FRAME_GAP_TOO_LARGE`): difieren frente a la regla geométrica por pose (`d(muñeca,P15)<=d(muñeca,P16)`) **36/66** detecciones con `WEIGHT_LABEL_PENALTY=0.25` (incluidos **2/2** frames `AMBIG`: `#20` y `#78`), **36/66** igualmente con `WEIGHT_LABEL_PENALTY=0.0` (porque la rama de 1 mano aplica override directo ignorando la penalización, y en 2 manos la distancia espacial `~3D` supera `0.5D`), **14/66** sin etiquetas (`#37..52`, atascamiento por `prev_right_wrist` previo en rama de 1 mano; `0/2` en `AMBIG`), y **0/66** (`0/2` en `AMBIG`) al aplicar convención directa `'Left'->leftHand`, `'Right'->rightHand`. Se dejan tests `xfail` escritos primero en `tests/test_feature_spec.py` y `featureExtractor.test.js` sobre 15 frames reales (`real_recording_laterality_15f.json`, solo coordenadas) para el parche **`v1.4.0`** tras confirmar el PNG de la toma `v1.3.1` (sin afirmar todavía si existe espejo de cámara).
   - Descarte por desconexión ($> 1.75 \cdot D$) condicionado a visibilidad confiable de la muñeca de pose ($\text{vis} \ge 0.50$).
5. **Comportamiento en Cruce de Manos (Punto 6):**
   - Si las manos y las muñecas de pose se cruzan en el espacio ($x_{\text{der}} < x_{\text{izq}}$ en pantalla, $x_{\text{der}} > x_{\text{izq}}$ en sensor nativo), la identidad anatómica **se preserva** porque la proximidad espacial a sus respectivas muñecas de pose $P_{15}/P_{16}$ y la etiqueta MediaPipe coinciden.
   - **Caso de fallo demostrado empíricamente:** Si el detector de Pose intercambia erróneamente las etiquetas de las muñecas $P_{15}$ y $P_{16}$, la cercanía espacial a las muñecas invertidas vence a la penalización de etiqueta ($0.15 < 0.60$), provocando que la identidad **sí se intercambie**. Por tanto, **se elimina cualquier afirmación absoluta de que la identidad "nunca" se intercambia**.
6. **Compuerta Temporal y de Tasa de Captura (Punto 4):**
   - La regla canónica de brecha temporal máxima es estricta: $\Delta t \le 100\text{ ms}$ (rechazo no negociable `ERR_INVALID_FRAME_GAP_TOO_LARGE`). *(Nota de auditoría 2026-11-12: la implementación actual en `feature_extractor.py:478` / `featureExtractor.js:402` resta `dt_nominal` y permite `166.67 ms`; se corregirá a $\Delta t \le 100.0\text{ ms}$ estricto como bug de conformidad en Fase 2 elevando spec a `1.4.0`.)*
   - El grabador dev mide la tasa real en vivo y **rechaza automáticamente** cualquier toma si:
     - Tasa promedio $< 15.0\text{ FPS}$ (`ERR_CAPTURE_FPS_TOO_LOW`).
     - Intervalo máximo $\max(\Delta t_i) > 100.0\text{ ms}$ (`ERR_CAPTURE_GAP_TOO_LARGE`).
   - El grabador reporta en tiempo real y persiste en el archivo `.raw.json`: $p50$, $p95$ y $\max$ de los intervalos entre frames.
7. **Política de Delegado Oficial y Sello en `config_hash` (Punto 1):**
   - El motor y el grabador implementan selector de delegado (CPU/GPU) configurable por query param `?delegate=GPU|CPU` con fallback automático.
   - `"delegate"` se registra en la raíz de cada `.raw.json`, en el `manifest.json` y en el cálculo canónico de `config_hash`.
   - **Política de Ruido (`[REVISIÓN DE EVIDENCIA 2026-11-12]`):**
     - Valor citado previamente en CPU: $1.5 \times 10^{-3}$ *(en `GATE_1B_WASM_NOISE_REPORT.json` raíz commit `f0c1439` se midió `maxLandmarkNoise = 9.77e-4` sobre `test_hand.png` estático, y `0` en `6fc6c1f` por reutilización de instancia — ver Libro de Evidencia §6)*.
     - Divergencia CPU vs GPU citada previamente en Firefox: **`4.68e-3` `[INVALIDADA]`** *(se conserva el registro histórico sin borrarlo; no existe artefacto JSON ni log versionado en el repositorio que respalde esa cifra)*.
     - Divergencia CPU vs GPU en `DELEGATE_DIVERGENCE.json`: **`0.002367` (`2.37e-3`, solo mano) `[INVALIDADA para criterio general]`** *(1 frame estático sobre `test_hand.png` en Chrome 158 headless; `poses_detected_cpu = 0`, `poses_detected_gpu = 1`, `linf_pose_landmarks = 0` sobre `test_person.png` que es un recorte de mano `'I'`)*.
     - La tolerancia provisional $L_\infty \le 5.0 \times 10^{-3}$ queda **pendiente de recalibración** en Fase 1/2 con $\ge 100$ frames reales en movimiento (2 manos + pose).
8. **Contrato de Entrada de Detector y Espejo:**
   - `detectForVideo(video, timestamp)` recibe directamente el elemento `<video>` en orientación nativa de sensor (sin flip).
   - El flip horizontal (modo espejo / selfie) se realiza **exclusivamente en el canvas de dibujo** (`renderCanvasFrame`) para confort visual del usuario.

---

## 2. Diagnóstico Exhaustivo de Hardware y Rendimiento (Puntos 1, 2, 3 y 7)

### 2.1 Diagnóstico de CPU / WASM y Desglose de 4.4 FPS
- **Variante WASM en ejecución:** `vision_wasm_internal.wasm`. *(Nota: la sonda de `DELEGATE_DIVERGENCE.json:4` reportó `wasmSimdSupported: false` por bug leyendo byte `125`; pendiente re-verificación con sonda `v128.const` válida en Fase 1.)*
- **Aislamiento de Origen Cruzado (`crossOriginIsolated`):** `false` (`DELEGATE_DIVERGENCE.json:3` `[MEDIDO]` en Chromium headless; por verificar en Firefox real en Fase 1). Vite dev server opera sin cabeceras COOP/COEP.
- **Impacto de Hilos:** Sin `crossOriginIsolated`, `SharedArrayBuffer` está desactivado en navegadores, operando el runtime XNNPACK CPU en monohilo (1 thread).
- **Frecuencia y Gobernador de CPU (`[CORRECCIÓN 2026-11-12]`):** Hardware reportado en `BENCHMARK_NATIVE_PYTHON.json:5`: `AMD Ryzen 3 7320U with Radeon Graphics (4C/8T)`. La afirmación previa *"con gobernador `performance` corriendo a ~1.89 GHz constante"* queda **`[INVALIDADA / RETIRADA]`** al no existir captura ni log `cpufreq`/`governor` que la respalde (solo se reportó observación informal de ~1.89 GHz en carga). A partir de Fase 1 Paso 0, todo benchmark y grabación registrará `governor`, `EPP`, frecuencia por núcleo, temperatura y estado de batería/AC.
- **Estado de la explicación de 4.4 FPS (`grabacion_dev_18s_1794367978455.raw.json`) vs arnés (`6.1 FPS`):**
  - En la grabación real (`recordings_local/grabacion_dev_18s_1794367978455.raw.json` `[MEDIDO]` vía `inspect_recording.py`): **`79` frames en `17.78 s` = `4.4 FPS`** (`Δt`: `p50 = 215.0 ms`, `p95 = 299.0 ms`, `máx = 317.0 ms`, `78` intervalos `> 100 ms`).
  - La atribución aritmética previa (`~161 ms` inferencia + `~2 ms` EMA + `~18 ms` canvas + `~22 ms` React + `~18 ms` GC = `221–227 ms`) queda **`[INVALIDADA — no medida con performance.mark]`**; solo `~164 ms` (`163.96 ms`) proviene del arnés sintético CPU (`BENCHMARK_LATENCIAS_FIREFOX.json`). El desglose real por etapa se medirá con `performance.mark` en Fase 1 tras normalizar el equipo y corregir el bucle `rAF`/`currentTime`.
  - *Nota de Integridad:* Quedan eliminadas afirmaciones sin medición de `performance.mark` sobre aportes individuales de DOM, React o GC.

### 2.2 Benchmark de Cadencia de Pose en Firefox (`BENCHMARK_LATENCIAS_FIREFOX.json`) — **`[INVALIDADAS POR ENTORNO]`**
> [!WARNING]
> **`[INVALIDADAS POR ENTORNO — 2026-11-12]`:** Todas las cifras de **CPU, GPU y nativas** de §2.2 y §2.3 quedan invalidadas por entorno (ejecutadas con `acad_online=0` / `EPP=power` ~1.4 GHz bajo carga y sin normalización ni `sysmon.sh`, además del sesgo estático sobre `test_hand.png`) hasta repetirse tras normalizar el equipo.

Medición histórica sintética en Firefox headless (`gfx.webrender.software: true`, **25 frames estáticos sobre `test_hand.png` 253×295 con 1 mano**, EMA/clasificador/dibujo stubbed, sin registro de governor/MHz/temperatura):

| Configuración | Hand Detection (ms)<br>[mean / p50 / p95 / p99 / max] | Pose Detection (ms)<br>[mean / p50 / p95 / p99 / max] | Total Frame (ms)<br>[mean / p50 / p95 / p99 / max] | FPS Efectivos<br>[mean / p95] | Estado |
|---|---|---|---|---|---|
| **GPU — Pose 1:1** | 38.28 / 38 / 41 / 49 / 49 | 25.56 / 25 / 28 / 28 / 28 | **66.80 / 66 / 73 / 78 / 78** | **15.0 / 13.7** | **`INVALIDADA POR ENTORNO`** |
| **GPU — Pose 1:2** | 37.76 / 37 / 40 / 41 / 41 | 13.44 / 25 / 29 / 29 / 29 | **53.88 / 64 / 69 / 69 / 69** | **18.6 / 14.5** | **`INVALIDADA POR ENTORNO`** |
| **GPU — Pose 1:3** | 37.40 / 37 / 39 / 39 / 39 | 9.24 / 0 / 27 / 27 / 27 | **49.28 / 41 / 67 / 69 / 69** | **20.3 / 14.9** | **`INVALIDADA POR ENTORNO`** |
| **CPU — Pose 1:1** | 113.36 / 111 / 121 / 160 / 160 | 47.92 / 47 / 51 / 63 / 63 | **163.96 / 161 / 178 / 209 / 209** | **6.1 / 5.6** | **`INVALIDADA POR ENTORNO`** |
| **CPU — Solo Manos** | 110.68 / 110 / 113 / 115 / 115 | 0.00 / 0 / 0 / 0 / 0 | **113.40 / 113 / 116 / 118 / 118** | **8.8 / 8.6** | **`INVALIDADA POR ENTORNO`** |

*(Nota de trazabilidad sobre el JSON en disco: la tabla superior conserva las cifras de la corrida originalmente auditada el 2026-11-12; una ejecución posterior de `performance_benchmark.spec.js` sobrescribió [`BENCHMARK_LATENCIAS_FIREFOX.json`](./BENCHMARK_LATENCIAS_FIREFOX.json) en disco con totales `56.00 / 41.40 / 49.44 / 278.92 / 229.88 ms` (`17.9 / 24.2 / 20.2 / 3.6 / 4.4 FPS`), igualmente **`INVALIDADA POR ENTORNO`** bajo los mismos criterios.)*

**Definición de Efecto en Features y Limitación del Arnés:**
- Como el arnés solo probó 25 frames estáticos de 1 mano sin cámara ni 2 manos móviles y sin entorno normalizado, NO demuestra cumplimiento ni rendimiento real actual.
- La paridad numérica se mantiene en `v1.3.1` hasta que Fase 2 corrija el bug de brecha `dt <= 100 ms` y convención de lateralidad (`v1.4.0`).
- Si en algún modo futuro se usara cadencia `1:2` o `1:3`: requiere versión nueva del contrato y LERP explícito en Etapa 2 offline (prohibido Zero-Order Hold silencioso en `ExtractWindow`).

### 2.3 Spike Nativo Python (`scripts/bench_native.py`) (Punto 7) — **`[INVALIDADAS POR ENTORNO]`**
Medición histórica sintética (`venv_native/`, Python 3.14.9 + MediaPipe 1.2.2 CPU nativo, 200 frames `640x480` redimensionando `test_hand.png`, sin registro `sysmon` y en entorno no normalizado — **`INVALIDADA POR ENTORNO`** hasta repetirse tras normalización):
- **HandLandmarker:** Media 49.15 ms | p50: 49.64 ms | p95: 51.55 ms | p99: 52.57 ms | Máx: 70.89 ms
- **PoseLandmarker:** Media 23.77 ms | p50: 22.32 ms | p95: 24.46 ms | p99: 52.15 ms | Máx: 52.32 ms
- **Total Frame:** Media 72.93 ms | p50: 72.10 ms | p95: 76.50 ms | p99: 93.50 ms | Máx: 101.24 ms
- **Tasa Efectiva:** **13.71 FPS** (p50: 13.87 FPS, p95: 13.07 FPS) **`[INVALIDADA POR ENTORNO]`**.
- **Uso de CPU:** **101.2%** (`user 15.02 s`, `sys 0.12 s`, `wall 14.96 s`).
- **Conclusión Técnica:** Refuta la estimación teórica previa de "30-45 FPS", pero la cifra exacta queda **invalidada por entorno** hasta re-ejecutarse con equipo normalizado + clip real.

---

## 3. Análisis Matemático de Coordenadas Extremas y Mínimo -4.31 en Pose (Punto 5)

1. **Corrección de Hipótesis:** Queda descartada la hipótesis previa de $D \approx 0.095$. En la grabación real `grabacion_dev_18s_1794367978455.raw.json`, el frame extremo presentó $D = 0.3008$ (consistente con el rango real $D \in [0.28, 0.45]$).
2. **Medición Exacta en `recordings_local/grabacion_dev_18s_1794367978455.raw.json` (`inspect_recording.py` `[MEDIDO]`):**
   - **Frame:** `#78` (`t = 18185.0 ms`)
   - **Landmark:** `Meñique Izquierdo (P17)` (`índice P17`)
   - **$z$ cruda (`NormalizedLandmark.z`):** `-1.4395`
   - **$C_z$ hombros ($(z_{P11}+z_{P12})/2$):** `-0.1425`
   - **Delta $(z - C_z)$:** `-1.2970`
   - **Escala humeral $D$ del frame:** `0.3008`
   - **Valor normalizado $z'$:** **`-4.3126`** (`-1.2970 / 0.3008`)
   - *(Para referencia de escala, con $D = 0.35$, $z' = -4.31$ corresponde a $z - C_z = -1.5085$ unidades de imagen normalizadas, adimensional tras dividir entre $D$.)*
3. **Origen Físico en MediaPipe Pose Tasks (`[CORRECCIÓN DE UNIDAD 2026-11-12]`):**
   - En MediaPipe Pose Tasks, `NormalizedLandmark.z` expresa profundidad relativa al punto medio de las caderas ($P_{23}, P_{24}$) en **unidades de imagen normalizadas (misma escala aproximada que $x$; NO en metros)** — únicamente `poseWorldLandmarks` está expresado en metros. *(Queda `[INVALIDADA]` la descripción previa en metros `+0.8 m / -0.7 m / -1.5 m`.)*
   - En encuadres de plano medio / busto donde las caderas quedan fuera de pantalla o ocluidas, la extrapolación del regresor de Pose introduce sesgo en esa coordenada $z$ adimensional de imagen, produciendo valores relativos grandes cuando un punto frontal como $P_{17}$ se proyecta hacia cámara frente al plano medio de hombros $C_z$.
4. **Comprobación en Inspector y Distribución Sistemática de $z'$ (No es un Outlier Aislado):**
   - El script `inspect_recording.py` reporta número de frame, índice y nombre anatómico del landmark, $z$ cruda, $C_z$, delta $z - C_z$, $D$ y $z'$ normalizado sin conjeturas.
   - Al medir los 13 landmarks de `POSE_UPPER_INDICES` en `recordings_local/grabacion_dev_18s_1794367978455.raw.json` comparando **reposo estricto** (brazos abajo, `P15y,P16y > 0.85` y `0` manos, `Fr 0..17`, $n=18$; estable `Fr 2..17`, $n=16$) frente a **brazos levantados** (`>=1` mano detectada $n=51$, y criterio geométrico `Fr 18..78`, $n=61$ — excluyendo así los frames movidos con mano no detectada donde `Fr 43` alcanzó `P17=-4.001`), se confirma que `-4.3126` **no es un outlier aislado**, sino inflación sistemática de la escala $z$ del regresor (~`1.5x–3x` respecto a $D$):
     - **Cota antropométrica explícita (en unidades de $D$):** suponiendo escala isotrópica $(x,y,z)$ normalizada por ancho inter-humeral $D = \|P_{11}-P_{12}\|_2$, postura frontal sin rotación severa de torso (donde $C_z$ traslada junto con los hombros), segmentos 2D medidos en reposo estable (`Fr 2..17`): $L_{\text{brazo}} \approx 1.00\,D$ (`0.97–1.03 D`), $L_{\text{antebrazo}} \approx 0.78\,D$ (`0.76–0.80 D`), $L_{\text{muñeca-meñique}} \approx 0.38\,D$ (`0.37–0.39 D`), protracción escapular máxima $\le 0.25\,D$:
       - **Cota nariz (`P00`):** $|z'| \le 0.55\,D$ (medido `p50 |z'| = 1.72 D` tanto en reposo como activo $\implies$ sesgo ~`3x` constante).
       - **Cota codos (`P13–P14`):** $|z'| \le 1.25\,D$ (medido brazos levantados `p50 |z'| = 0.99–1.35 D`, `p95 |z'| = 1.44–1.93 D`).
       - **Cota muñecas (`P15–P16`):** $|z'| \le 2.00\,D$ (`1.00 + 0.78 + 0.22`) (medido reposo estricto `p50 |z'| = 0.75 / 0.11 D`, `p95 = 0.85 / 0.57 D`; brazos levantados `n=51`: `p50 |z'| = 2.64 / 2.98 D`, `p95 = 3.30 / 3.52 D`, `máx = 3.84 D` $\implies$ excede la cota física en **~1.5x–1.9x**).
       - **Cota nudillos/dedos pose (`P17–P22`):** $|z'| \le 2.40\,D$ (`2.00 + 0.39`) (medido en `P17/P18` con brazos levantados `n=51`: `p50 |z'| = 2.97 / 3.33 D`, `p95 = 3.75 / 3.93 D`, `máx = 4.313 D` $\implies$ excede la cota física ya en `p50`).
   - **Opciones registradas para evaluación posterior (*nada se decide ahora*):**
     - **Opción A:** Recorte (clipping) acotado en $z'$ de pose (p. ej. $[-2.5, 2.5]\,D$).
     - **Opción B:** Reescalado empírico del eje $z$ de pose o uso de `poseWorldLandmarks` renormalizados por $D_{3\text{D}}$.
     - **Opción C:** Eliminar $z$ de pose modificando dimensionalidad ($< 178\text{D}$, rompe compatibilidad).
     - **Opción D *(añadida, sin decidir)*:** Fijar $z'$ de `P15–P22` a `0.0` (o excluir solo esa $z$ poniéndola en `0.0`), manteniendo intacto el vector **178D** y la compatibilidad C++/ONNX.
     - **Opción E *(añadida, sin decidir)*:** Sin cambios en extracción (`z'` intacto), evaluando su impacto mediante **ablación al entrenar** (con vs. sin `z` de `P15–P22`) sobre el dataset ya normalizado.

---

## 4. Estado de Compuertas (Gates)

| Compuerta | Estado | Evidencia Demostrada |
|---|---|---|
| **Gate 1A (Paridad Analítica)** | **SUPERADO (`v1.3.0` intacto; `4 xfail` `v1.4.0` añadidos)** | Conformidad matemática elemento a elemento ($L_\infty \le 10^{-6}$) en Python (`tests/test_feature_spec.py` en `venv_native/`, con `venv` y `venv_native` apuntando al mismo `/usr/bin/python3.14` 3.14.9 — **no constituyen diversidad de intérpretes**) y frontend (`vitest`). Los tests de espejo con objetos `{landmarks, categoryName}` y lateralidad directa en 15 frames reales quedan como `expectedFailure`/`it.fails` previos a Fase 2 (`v1.4.0`). |
| **Gate 1B (Arnés Determinista y Rendimiento)** | **`INVALIDADA POR ENTORNO` — RE-EJECUCIÓN PENDIENTE** | **Registros históricos preservados (`INVALIDADAS POR ENTORNO`):** [`GATE_1B_WASM_NOISE_REPORT.json`](./GATE_1B_WASM_NOISE_REPORT.json) raíz (`9.77e-4` en `test_hand.png`, `f0c1439`), [`GATE_1B_WASM_NOISE_REPORT_FIREFOX.json`](./GATE_1B_WASM_NOISE_REPORT_FIREFOX.json) / [`CHROMIUM.json`](./GATE_1B_WASM_NOISE_REPORT_CHROMIUM.json) (`30/30 pose` / `0` `[INVALIDADA]` por `test_person.png`=`i.png` + reutilización WASM), [`BENCHMARK_LATENCIAS_FIREFOX.json`](./BENCHMARK_LATENCIAS_FIREFOX.json) (corrida auditada `15.0 / 6.1 / 8.8 FPS`, sobrescrita luego en disco con `17.9 / 3.6 / 4.4 FPS`, ambas **`INVALIDADAS POR ENTORNO`**), [`BENCHMARK_NATIVE_PYTHON.json`](./BENCHMARK_NATIVE_PYTHON.json) (`13.71 FPS`, **`INVALIDADA POR ENTORNO`**), y divergencias CPU vs GPU (`4.68e-3` sin JSON y `2.37e-3` pose CPU=0). Se re-evaluarán tras normalización física del equipo con clip real torso + 2 manos. |
| **Gate 1C (Calibración Real Normalizada)** | **EN ESPERA DE NORMALIZACIÓN Y TOMA GUIADA** | La toma previa `grabacion_dev_18s_1794367978455.raw.json` (`version: "1.3.0"`, `categoryName` presente en `66/66` detecciones de manos en `frames[*].hands[*]`, pero sin `prompt_timeline`, `delegate`, `handedness` ni `interval_metrics`, y capturada a `4.4 FPS`) cerró únicamente el `-4.3126`. La Pregunta #1 (lateralidad física vs etiqueta) y línea base real esperan normalización del equipo, corrección `rAF`/`currentTime` y toma nueva con `prompt_timeline`. |

---

## 5. Bloqueos Activos y Reglas de No-Avance (Punto 8)

> [!CAUTION]
> **DETENCIÓN OBLIGATORIA:**
> - **PROHIBIDO iniciar captura/medición de Fase 1** hasta que el usuario confirme rotación de clave `.env` y normalización física del equipo (`AC` + perfil `performance` + controles de cámara V4L2).
> - **PROHIBIDO avanzar a la Fase 2 del generador offline (sharding y data augmentation masivo)** sin grabación válida verificada y aprobación explícita del usuario.

---

## 6. Libro de Evidencia y Regla de Reproducibilidad

Toda afirmación numérica publicada en este documento y en los JSON de `docs/dataset-generator/` queda clasificada aquí sin borrar registros históricos invalidados.

### 6.1 Regla Obligatoria para Benchmarks Futuros
Todo script de benchmark o captura debe emitir un JSON autodescriptivo con:
- Identificación de código: `git_commit`, `git_dirty`, nombre/ruta del script, comando exacto.
- Estado del entorno: `governor`, `energy_performance_preference` (EPP), frecuencias CPU por núcleo (MHz), temperatura (°C), estado AC/batería, controles de cámara `v4l2-ctl` (si hay webcam), `userAgent`, `crossOriginIsolated`.
- **Regla de revisión:** El revisor independiente **debe RE-EJECUTAR** los scripts de benchmark/test sobre el workspace y verificar el JSON resultante; está prohibido aprobar cambios leyendo únicamente reportes en Markdown.

### 6.2 Catálogo Completo de Cifras (Actuales e Históricas)

| Cifra / Afirmación | Estado | Artefacto | Commit / Origen | Comando / Método y Observaciones de Entorno |
|---|---|---|---|---|
| **Paridad Python (`19` tests, `15 OK` + `4 expected failures`)** | **`MEDIDO`** | `tests/test_feature_spec.py` | Commit `3f40f40` + **modificado en working tree (`M`)** | `venv_native/bin/python -m unittest tests/test_feature_spec.py -v` (`Python 3.14.9`; `2` `xfail` espejo objetos + `2` `xfail` lateralidad directa `v1.4.0` en 15 frames reales). *(Nota: `venv` y `venv_native` comparten `/usr/bin/python3.14`, no constituyen diversidad.)* |
| **Paridad Frontend (`51` tests: `47 passed \| 4 expected fail`)** | **`MEDIDO`** | `expresat/frontend/src/engine/__tests__/featureExtractor.test.js` (y suites Vitest) | Actualizado en working tree | `npm --prefix expresat/frontend test -- --run` (`featureExtractor` + suites base, Vitest 4.1.12). |
| **Grabación dev 18 s: `79` frames, `17.78 s`, `4.4 FPS`, `Δt p50=215.0 / p95=299.0 / max=317.0 ms`, `78` brechas `>100 ms`, `z'=-4.3126` (`P17` Fr `#78`), lateralidad `66/66` directa vs `0/66` spec `v1.3.0`** | **`MEDIDO`** | `recordings_local/grabacion_dev_18s_1794367978455.raw.json` (gitignored, copiada de Descargas) | Toma del usuario pre-normalización (`version: "1.3.0"`; `66/66` entradas en `frames[*].hands[*]` con `categoryName`, sin `prompt_timeline`/`handedness`/`delegate`/`interval_metrics`) | Inspeccionada con `inspect_recording.py` y traza real de `extract_window` (`duration_ms=5000.0`). Cerró `-4.3126` + distribución `z'` (§3) y lateralidad por pose `36/66` discrepantes en `v1.3.0`; confirmación visual de espejo queda pendiente del PNG de la toma `v1.3.1`. |
| **`crossOriginIsolated: false`, `hardwareConcurrency: 8`** (Chromium) | **`MEDIDO`** | [`DELEGATE_DIVERGENCE.json`](./DELEGATE_DIVERGENCE.json) | `expresat/frontend/benchmarks/performance_benchmark.spec.js` (`--project=chromium`) | UA Chrome 158.0.8127.18 headless Linux (string Windows en Playwright). Por confirmar en Firefox real en Fase 1. |
| **Parámetros contractuales `v1.3.1`** (`(1,15,178)`, `52+63+63`, `D>=0.08`, `+0.25·D`, `+0.5·dist2D`, `1.75·D`, `vis>=0.50`, `0.15<0.60`, `dt<=100 ms`) | **`ESPECIFICACIÓN / PARCIALMENTE IMPLEMENTADA`** | [`FEATURE_SPEC.md`](./FEATURE_SPEC.md), `tests/fixtures/feature_spec_cases.json` | Commit `6fc6c1f` (+ **`M`** en `FEATURE_SPEC.md`) | Verificado en Python/JS salvo `dt<=100 ms` (`extract_window` hoy permite `166.67 ms`; se corrige en Fase 2 -> `v1.4.0`). Estimación previa `"30-45 FPS"` refutada por `BENCHMARK_NATIVE_PYTHON.json`. |
| **Spike Python Nativo histórica: `200` frames `640×480`; `72.93 ms`, `13.71 FPS` (`p50 13.87`, `p95 13.07`); CPU `101.2%`** | **`INVALIDADA POR ENTORNO`** | [`BENCHMARK_NATIVE_PYTHON.json`](./BENCHMARK_NATIVE_PYTHON.json) | `scripts/bench_native.py` | **`INVALIDADA POR ENTORNO`** (sin log de `governor`/MHz/batería, con `test_hand.png` estática y previo a normalización AC/`EPP=performance`). Conservada solo como referencia histórica refutatoria del "30-45 FPS". |
| **Latencias Firefox históricas (`BENCHMARK_LATENCIAS_FIREFOX.json`): corrida auditada `66.8 / 163.96 / 113.4 ms` (`15.0 / 6.1 / 8.8 FPS`); archivo en disco sobrescrito posteriormente (`56.0 / 41.4 / 49.44 / 278.92 / 229.88 ms`)** | **`INVALIDADA POR ENTORNO`** | [`BENCHMARK_LATENCIAS_FIREFOX.json`](./BENCHMARK_LATENCIAS_FIREFOX.json) | `expresat/frontend/benchmarks/performance_benchmark.spec.js` (`--project=firefox`) | **`INVALIDADA POR ENTORNO`** (corrida previa sin normalización AC/`EPP=power` ~1.4 GHz, headless, `test_hand.png` 1 mano, stubs EMA/clasif./canvas, `N=25`). Repetir en entorno normalizado con clip real. |
| **Ruido WASM raíz: `30` frames, `630` pts, `max=0.00097665` (`9.77e-4`), `mean=0.00010862`, `std=0.00011140`, `labelMismatches=0`** | **`MEDIDO (CON SESGO DE ARNÉS)`** | [`GATE_1B_WASM_NOISE_REPORT.json`](./GATE_1B_WASM_NOISE_REPORT.json) | Commit `f0c1439` / `6fc6c1f` (`determinism.spec.js`) | `npx playwright test` (imagen estática `test_hand.png` 1 mano; cifra `1.5e-3` en prosa de §1.7 fue techo nominal aproximado). |
| **Gate 1B `30/30 pose` (`framesDetectedPose: 30`, `totalPosePointsEvaluated: 990`) y ruido exacto `0` (`maxLandmarkNoise: 0`, `maxPoseNoise: 0`) en Firefox y Chromium** | **`INVALIDADA`** | [`GATE_1B_WASM_NOISE_REPORT_FIREFOX.json`](./GATE_1B_WASM_NOISE_REPORT_FIREFOX.json), [`GATE_1B_WASM_NOISE_REPORT_CHROMIUM.json`](./GATE_1B_WASM_NOISE_REPORT_CHROMIUM.json) y nodos homónimos en [`GATE_1B_WASM_NOISE_REPORT.json`](./GATE_1B_WASM_NOISE_REPORT.json) | Commit `6fc6c1f` (`determinism.spec.js`) | `test_person.png` resultó ser la seña `'I'` recorta­da (`frontend-legacy/assets/señas/imagenes_abecedario/i.png`), no una persona real; además el detector compartió instancia WASM entre corridas dando varianza `0` artificial. Se conserva registro histórico sin borrar. |
| **Divergencia Firefox CPU vs GPU `4.68e-3`** | **`INVALIDADA`** | Prosa histórica en §1.7 y §4 de este documento | `3f40f40` / `6fc6c1f` | Sin archivo JSON, comando ni artefacto verificable en el repositorio. Se conserva registro histórico sin borrar. |
| **Divergencia Chromium CPU vs GPU `2.37e-3` (`linf_hand_landmarks: 0.002367`, `poses_detected_cpu: 0`, `poses_detected_gpu: 1`, `linf_pose_landmarks: 0`)** | **`INVALIDADA`** | [`DELEGATE_DIVERGENCE.json`](./DELEGATE_DIVERGENCE.json) | `expresat/frontend/benchmarks/performance_benchmark.spec.js` (`--project=chromium`) | Solo 1 frame estático por detector; pose falló en CPU (`0` poses) sobre `test_person.png` (`i.png`) reportando falsamente `linf_pose_landmarks: 0`. |
| **`wasmSimdSupported: false`** | **`INVALIDADA`** | [`DELEGATE_DIVERGENCE.json`](./DELEGATE_DIVERGENCE.json) | `expresat/frontend/benchmarks/performance_benchmark.spec.js` | Sonda errónea leyendo byte `125` de binario WASM mínimo; pendiente sonda `v128.const` en Fase 1. |
| **CPU con gobernador `performance` a `~1.89 GHz` constante** | **`INVALIDADA / RETIRADA`** | Prosa previa en §2.1 de este documento | Commit `3f40f40` | Sin archivo `sysmon` ni lectura guardada de `scaling_governor` / `scaling_cur_freq`. Reemplazada por Paso 0 de Fase 1. |
| **Desglose 4.4 FPS (`18 ms` canvas + `22 ms` React + `18 ms` GC = `221–227 ms`)** | **`INVALIDADA`** | Prosa previa en §2.1 de este documento | Commit `3f40f40` | No medido con `performance.mark`; conjetura por resta respecto a los ~164 ms CPU de arnés sintético. Se medirá en Fase 1. |
| **Pose `z` en "metros" (`+0.8 m / -0.7 m / -1.5 m`)** | **`INVALIDADA (CORREGIDA)`** | Prosa previa en §3 de este documento e `inspect_recording.py` | Commit `3f40f40` | `NormalizedLandmark.z` usa **unidades de imagen normalizadas** (~escala `x`), NO metros (`poseWorldLandmarks` usa metros). Corregido en ambos archivos. |
