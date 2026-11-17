# Plan de Mejora y Experimentación — Recolección de Landmarks y Grabación 60 s (ExpresaT)

- **Documento:** `docs/dataset-generator/PLAN_MEJORA.md`
- **Fecha:** 2026-11-12
- **Estado actual:** **DETENIDO antes de ejecutar Fase 1** (en espera de confirmación del usuario: rotación de clave local `.env` + equipo normalizado).
- **Dependencias:** [AUDITORIA_CAPTURA.md](./AUDITORIA_CAPTURA.md), [DECISIONES.md](./DECISIONES.md) y [FEATURE_SPEC.md](./FEATURE_SPEC.md)
- **Políticas vigentes preservadas salvo aprobación:**
  1. Compuerta de brecha máxima entre frames **$\le 100.0\text{ ms}$ NO negociable**.
  2. Contrato de features 178D versionado; cualquier cambio que altere salidas o validaciones contractuales sube versión (`v1.4.0` en Fase 2) y conserva lectores retrocompatibles.
  3. C++ (`expresat-native/`) permanece `"NO_CONFORME"` y bloqueado. `reposo` es clase activa; catálogo conserva `PENDIENTE_FUENTE` salvo fuentes verificables públicas. `letra_a_derecha_2.json` sigue en cuarentena.
  4. **Prohibido** iniciar Fase 2 offline del generador (shards `.npy`, augmentation offline masivo) en este plan.
  5. Disciplina de experimento y reproducibilidad: 1 variable por commit, muestras reales $\ge 300$ frames en movimiento en build de producción (`vite preview`), reporte $p50/p95/p99/\max$, `git revert` inmediato ante regresión, JSON autodescriptivo con hash git + estado completo del entorno y **re-ejecución obligatoria** de scripts por el revisor independiente.

---

## 1. Compuertas y Umbrales Pre-Registrados (Aprobados con Cambios)

Todas las corridas de Fases 1–4 se contrastan contra estos umbrales explícitos. **Toda toma y el `manifest.json` deben persistir** `unique_real_frames`, `interpolated_bridge_fraction`, `p99_interval_ms` y `max_interval_ms`: la compuerta de captura aplica el **mínimo duro**, mientras la futura Etapa 2 offline podrá filtrar más estricto sin regrabar. Estos umbrales se validarán contra la primera línea base tomada ya con el equipo normalizado.

### 1.1 Definición de Población por Métrica y Criterios de Rechazo

| Métrica | Población / Denominador | Compuerta Hard (Captura: rechazo automático) | Objetivo Saludable (Etapa 2 estricto opcional) | Persistido en |
|---|---|---|---|---|
| **`avg_fps`** | Por **toma (`<= 2.5 s`)**: $(N-1)/((t_{\text{últ}}-t_0)/1000)$; y agregado por **sesión (`60 s`)** sobre tramos útiles no invalidados | `< 15.0` FPS en la toma (o promedio útil de sesión `< 15.0`) | $\ge 20.0$ FPS | Cada toma + `manifest.json` |
| **`max_interval_ms`** / `gaps_over_100ms_count` | Todos los pares consecutivos $\Delta t_i = t_{i+1}-t_i$ dentro de cada **ventana (`1 s`)**, cada **toma (`<= 2.5 s`)** y la **sesión (`60 s`)** | **`> 100.0 ms`** (o `gaps_over_100ms_count > 0`) | $\le 75.0\text{ ms}$ | Cada toma + `manifest.json` |
| **`p50` / `p95` / `p99_interval_ms`** | Cuantiles de $\Delta t_i$ sobre todos los intervalos consecutivos de cada **toma (`<= 2.5 s`)** y resumen de **sesión (`60 s`)** | `p99_interval_ms > 90.0 ms` en la toma | `p95 <= 70.0 ms`, `p99 <= 85.0 ms` | Cada toma + `manifest.json` |
| **`unique_real_frames`** | Por **ventana deslizante de 1 s (`1000 ms`, `15` target slots $\tau_k = t_0 + k \cdot 66.6667\text{ ms}$, $k=0\dots 14$)** donde $t_{\text{last}} \ge t_0 + 933.3333\text{ ms}$: cardinalidad de $\{\arg\min_i |t_i - \tau_k|\}$ (reportado como mínimo entre ventanas válidas de la toma) | **`< 12`** (`< 12/15`, < 80% slots con frame real propio) | $\ge 14/15$ | Mínimo por toma + `manifest.json` (y vector por ventana) |
| **`interpolated_bridge_fraction`** | Por **ventana de 1 s (`14` transiciones $(\tau_k, \tau_{k+1})$, $k=0\dots 13$)**: fracción de transiciones cuyo punto medio $\frac{\tau_k+\tau_{k+1}}{2}$ cae dentro de un intervalo crudo ancho $\Delta t_{\text{crudo}} > 1.25 \cdot 66.6667 = 83.3333\text{ ms}$ (máximo entre ventanas de la toma) | **`> 3/14`** (`> 0.2143`, > 3 tramos de puente ancho) | $\le 1/14$ (`<= 0.0714`) | Máximo por toma + `manifest.json` |
| **`tail_extrapolation_ms`** | Por **ventana de 1 s**: $\max(0.0, (t_0 + 933.3333\text{ ms}) - t_{\text{last\_in\_window}})$ | **`> 0.0 ms`** (prohibido rellenar cola por repetición) | `0.0 ms` | Por ventana / validación toma |
| **`dropped_frames` y `duplicate_frames`** | Por **toma** y por **sesión (`60 s`)**, más serie `per_second_metrics` | Conteo ausente o re-inferencia silenciosa de `currentTime` repetido | `dropped_rate < 5%`, `duplicate_reinfers == 0` | Metadatos de sesión + toma |
| **Relación de aspecto y pestaña oculta (`hidden_events`)** | Por **sesión / toma** | `abs(w/h - 4/3) > 0.05` (`ERR_INVALID_ASPECT_RATIO`) o `hidden_events > 0` en toma válida | Exacto `4:3`, `0` ocultamientos | Cabecera de sesión + evento por toma |

### 1.2 Justificación Numérica: De `15 FPS` Mínimo a $\ge 12$ Frames Únicos por Ventana

- A la tasa nominal contractual de **`15.0 FPS`** (`1` frame cada $\Delta t_{\text{nom}} = 1000/15 = 66.6667\text{ ms}$), una ventana de 1 s contiene exactamente **`15`** instantes equidistantes $\tau_k = t_0 + k \cdot 66.6667\text{ ms}$ ($k = 0\dots 14$, rango $[t_0, t_0 + 933.3333\text{ ms}]$), asignando idealmente 1 muestra cruda distinta a cada fila del tensor `(1, 15, 178)`.
- **Por qué `avg_fps >= 15.0` (toma) + `dt <= 100.0 ms` no bastan por sí solos:**
  - En una toma de `2.4 s`, un tramo final rápido (`22 FPS`, `dt = 45 ms`) compensa el promedio global (`avg_fps = 17.78 >= 15.0`) aunque el primer segundo haya caído localmente a `11.2 FPS` (`dt = 89 ms`). Ninguna brecha supera `100.0 ms` ni `p99 = 89.0 ms` supera `90.0 ms`, pero esa ventana de 1 s solo contiene **`11`** muestras reales únicas para los `15` slots de tiempo (`4` slots comparten muestras repetidas y `14/14` transiciones descansan sobre puentes $> 83.33\text{ ms}$).
- **Por qué el corte duro es `unique_real_frames >= 12` (`12/15 = 80%`) y `interpolated_bridge_fraction <= 3/14` (`21.4%`):**
  - El límite `12` frames en la ventana fija una densidad real local $\ge 12\text{ Hz}$ (**`80%`** de la grilla de 15 pasos): admite hasta `3` omisiones puntuales o jitters moderados ($\le 90\text{ ms}$) sin destruir tomas válidas en hardware real, pero rechaza automáticamente cualquier ventana que descienda por debajo de `12` frames propios (`11/15 = 73.3%`) o concentre `>= 4` pasos de interpolación larga (`> 83.33 ms`).
- **Validación contra línea base:** Después de correr la línea base en hardware normalizado (Fase 1), se verificará la tasa real de falsos rechazos y márgenes de seguridad de estos umbrales antes de fijarlos en `DECISIONES.md`.

### 1.3 Ejemplos Trabajados de Unidad (Pasa, Falla, Borde) — Especificación Directa para Tests

Los siguientes arreglos `t_ms` (sobre tomas de ~2.4 s evaluadas tanto a nivel de toma como en **todas** las ventanas deslizantes de 1 s válidas) son exactos y pasan directamente a casos de prueba deterministas en Python y JS:

1. **Caso 1 — `PASA` (Flujo 16 FPS estable, `39` frames, `dur = 2375 ms`):**
   - `t_ms`: `[0, 60, 125, 185, 250, ..., 2375]` alternando `dt = 60 ms` y `dt = 65 ms` ($38$ intervalos).
   - **Métricas de toma:** `avg_fps = 16.00 >= 15.0`, `max_interval_ms = 65.0 <= 100.0`, `p95 = 65.00`, `p99 = 65.00 <= 90.0`.
   - **Ventanas 1 s (todas):** `min_unique_real_frames = 15/15 (>= 12)`, `max_interpolated_bridge_fraction = 0/14 (0.000 <= 0.214)`, `tail_extrapolation_ms = 0.00`.
   - **Veredicto:** **`PASA`**.

2. **Caso 2 — `BORDE` (En el límite exacto de 3 compuertas simultáneas, `42` frames, `dur = 2392 ms`):**
   - `t_ms`: `[0, 90, 180, 262, 344, 426, 508, 590, 672, 754, 836, 918, 1000]` seguido de `[1048, 1096, ..., 2392]` (paso `48 ms`, 29 intervalos posteriores).
   - **Métricas de toma:** `avg_fps = 17.14 >= 15.0`, `max_interval_ms = 90.0 <= 100.0`, `p95 = 82.00`, **`p99 = 90.00 <= 90.0`** (en el borde exacto).
   - **Ventana `[0..1000]` y mínimo en ventanas deslizantes 1 s:** **`min_unique_real_frames = 12/15`** (borde exacto `>= 12`), **`max_interpolated_bridge_fraction = 3/14 (0.214)`** (borde exacto `<= 3/14`), `tail_extrapolation_ms = 0.00`.
   - **Veredicto:** **`PASA EN EL BORDE EXACTO`**. *(Si una sola muestra cae a 91 ms o se pierde 1 frame en la primera ventana, falla.)*

3. **Caso 3 — `FALLA` (Brecha de ventana camuflada por promedio y `dt <= 100`, `44` frames, `dur = 2419 ms`):**
   - `t_ms`: `[0, 89, 178, 267, 356, 445, 534, 623, 712, 801, 890, 979]` seguido de `[1024, 1069, ..., 2419]` (paso `45 ms`, 32 intervalos posteriores).
   - **Métricas globales engañosas (todas "pasan" sin compuerta de ventana):** `avg_fps = 17.78 >= 15.0`, `max_interval_ms = 89.0 <= 100.0`, `p95 = 89.00`, `p99 = 89.00 <= 90.0`.
   - **Ventana `[0..1000]` (`win0`):** **`unique_real_frames = 11/15 < 12`**, **`interpolated_bridge_fraction = 14/14 (1.000 > 3/14)`**, `tail_extrapolation_ms = 0.00`.
   - **Veredicto:** **`RECHAZADA` (`ERR_WINDOW_LOW_UNIQUE_FRAMES` / `ERR_WINDOW_HIGH_INTERPOLATION`)**.

### 1.4 Umbrales Térmicos, Cross-Delegate y Tamaño (Sesión 60 s)

- **Estabilidad térmica (`5 min = 300 s`):** `avg_fps` en el minuto 5 (`[240s..300s]`) $\ge 15.0\text{ FPS}$, caída respecto al minuto 1 (`[0s..60s]`) $\le 10\%$, `gaps_over_100ms_count == 0` continuo.
- **Divergencia Cross-Delegate (`>= 100` frames reales, 2 manos + pose):** Recalibrar tolerancia con clip real torso + 2 manos (reportar `p50/p95/p99/max`; no mezclar delegados sin medir).
- **Tamaño y carga servidor local (`60 s`):** Sesión $\le 3.0\text{ MiB}$ a 30 FPS ($\le 1.5\text{ MiB}$ a 15 FPS), parse Python `< 50 ms`, límite por chunk HTTP $\le 2\text{ MiB}$, límite por sesión $\le 16\text{ MiB}$.

---

## 2. Estado de Higiene Pre-Fase 1 (Completado salvo Rotación Manual del Usuario)

1. **Aislamiento de secretos y artefactos locales (`[COMPLETADO — SIN LEER NI EDITAR .env]`):**
   - Creado `.gitignore` raíz ignorando `.env*` (con excepción `!.env.example`), `*.raw.json`, `*.raw.bin`, `*.raw.meta.json`, `*.webm`, `recordings_local/`, `raw_captures/`, `captures/`, capturas PNG (`*.png` excepto assets UI versionados), `venv*/`, `__pycache__/`, `node_modules/`, `dist/`.
   - Actualizado `expresat/frontend/.gitignore` (ignora `.env*` salvo `!.env.example`, `recordings_local/`, `*.raw.json`, `*.webm`, `*.png` salvo `src/assets/**` y `public/hero.png`) y creado `expresat/frontend/.dockerignore` (bloquea `.env*`, grabaciones y artefactos dev del contexto `COPY . .` en `Dockerfile:18`).
   - Verificado con `git log --all`: **nunca se commiteó ningún `.env` real** ni la clave `service_role` del `.env` local (únicamente `.env.example`). Sin embargo, **4 commits de historial** (`879fb355450a` en `expresat/frontend/js/auth_service.js`, `12255491d477` y `e7de4e60d46b` en `expresat/frontend/src/services/authService.js`, y `51936f7c6834` en `expresat/frontend-legacy/js/auth_service.js`, más el merge `bf61a325c3cd`) contienen un JWT de Supabase con `role=anon`, `ref=ecmeqjyuedwrrcoenpij` — el cual **sigue presente en HEAD** dentro de `expresat/frontend-legacy/js/auth_service.js`. Remoto configurado: `origin https://github.com/Salf423/expresat` (visibilidad sin asumir). Se versiona `.githooks/pre-commit` con regex ERE en una sola línea para activación explícita (`git config core.hooksPath .githooks`) sin instalar herramientas externas sin aviso.
   - Copiada `/home/adrian/Descargas/grabacion_dev_18s_1794367978455.raw.json` en `recordings_local/` (ignorada por Git): inspeccionada para `-4.31` (distribución `z'` en reposo vs brazos levantados y opciones D/E añadidas en `DECISIONES.md` §3 sin decidir nada ahora) y lateralidad sobre `extract_window` real (`66/66` en convención directa vs `0/66` spec `v1.3.0`, con tests `xfail` escritos primero sobre 15 frames reales en `real_recording_laterality_15f.json`; esperando toma PNG `v1.3.1` antes de afirmar espejo de cámara). Cifras previas de CPU/GPU/nativas marcadas como **`INVALIDADAS POR ENTORNO`**.
2. **Acción pendiente EXCLUSIVA del usuario antes de arrancar Fase 1:**
   - El usuario rota manualmente su clave en Supabase, limpia su `.env` local y confirma entorno normalizado (y si desea activar `.githooks/pre-commit` con `git config core.hooksPath .githooks` o instalar `gitleaks`). *(Nota: no usar `venv` y `venv_native` como "diversidad" de Python: ambos apuntan al mismo Python 3.14.9.)*

---

## 3. Fases Detalladas y Orden de Ejecución

### Fase 1: Normalización del Entorno, Corrección Pre-Medición `rAF`/`currentTime` y Línea Base Reproducible

1. **Paso 1.0 — Normalización física del equipo y A/B de entorno (obligatorio al iniciar):**
   - Condición base: laptop conectada a **corriente AC**, perfil de energía/gobernador **`performance`**, cámara controlada vía `v4l2-ctl` con **`exposure_dynamic_framerate=0`** y **`power_line_frequency=2` (60 Hz México)**.
   - **Instrumentación obligatoria del entorno en CADA JSON de benchmark y CADA grabación:** `git_commit`, `git_dirty`, `governor`, `epp` (`energy_performance_preference`), frecuencias CPU por núcleo (MHz), temperatura (°C), estado AC/batería (`online`), controles V4L2 activos, `userAgent` y `crossOriginIsolated`.
   - **A/B de normalización:** Medir explícitamente **`powersave` vs `performance`** y **`exposure_dynamic_framerate=0` vs `1`** antes de fijar la línea base oficial.
2. **Paso 1.1 — Corrección de `rAF` / `video.currentTime` ANTES de medir nada:**
   - En `expresat/frontend/src/engine/signEngine.js:712-729`, hoy `_tick` sigue entrando a `_runInferenceStep(video, nowMs)` aunque `video.currentTime === this._lastVideoTime`, re-infiriendo frames repetidos cuando la cámara entrega menos FPS que `rAF`.
   - **Regla estricta:** Corregir ese bucle **antes de tomar ninguna métrica de Fase 1** usando `requestVideoFrameCallback` (`rVFC`) si Firefox lo soporta (verificado en corrida) o descarte explícito cuando `video.currentTime === this._lastVideoTime`, contabilizando **`duplicate_frames`** (frames de cámara no avanzados saltados) y **`dropped_frames`** (frames de cámara descartados por `_busy` sin encolar).
3. **Paso 1.2 — Fixtures reales, `scripts/sysmon.sh`, telemetría `performance.mark`, Pregunta #1 y 5 min térmicos:**
   - **Fixtures reales (sin `test_hand.png` / `test_person.png`):** Grabar localmente un **clip real de video (torso visible + 1 y 2 manos en movimiento)** dentro de `recordings_local/` (ignorado por Git) para sustituir `test_hand.png` y `test_person.png` en los arneses sintéticos y A/B reproducibles.
   - **Regla de video WebM:** La grabación de `.webm` solo está permitida en **sesiones de medición dedicadas**; **prohibido** grabar `.webm` durante corridas de medición de tiempos/latencias.
   - Instrumentar `performance.mark`/`measure` por etapa + filas por segundo (`per_second_metrics`) + `scripts/sysmon.sh` (CPU MHz, governor, EPP, temp °C, RSS Firefox, swap) + sonda WASM SIMD `v128.const`.
   - Toma real del usuario con etiquetas `categoryName` (versión nueva del grabador, ya con equipo normalizado) para cerrar **Pregunta #1** (convención de lateralidad en frame no espejado).
   - Corrida continua de **5 minutos (`300 s`)** con `sysmon.sh` activo -> cierra **Pregunta #7**.
   - **Reproducibilidad obligatoria:** Todo script de benchmark emite JSON con hash git + estado del entorno; el revisor independiente **re-ejecuta** los scripts de verificación/benchmark en lugar de solo leer reportes.

---

### Fase 2: Bug de Conformidad `dt <= 100 ms` (`Spec 1.4.0`), `mirror`/`config_hash` y Experimentos A/B de Rendimiento

> [!IMPORTANT]
> Por decisión explícita del usuario, el bug de brecha `166.67 ms` vs `100.0 ms`, `mirror_raw_frame` y `config_hash` en entrenamiento/inferencia se ejecutan **ahora en Fase 2** (con test que falle primero antes de cada cambio) junto con los experimentos A/B de captura.

1. **Bloque 2.A — Bugs de Conformidad Contractual (`FEATURE_SPEC v1.4.0`, TDD fallo primero):**
   - **Brecha estricta `dt <= 100.0 ms`:** Escribir tests que fallen primero en `tests/test_feature_spec.py` y `expresat/frontend/src/engine/__tests__/featureExtractor.test.js` sobre casos con brecha cruda en `(100.0, 166.67] ms` y sobre los 3 ejemplos trabajados (§1.3 `PASA` / `BORDE` / `FALLA`), así como `tail_extrapolation_ms > 0` y valores `NaN`/`Infinity` en JS (`Number.isFinite`). Luego corregir `(t_next - t_curr) - dt_nominal > 100.0` a **`(t_next - t_curr) > 100.0`** (`feature_extractor.py:478` y `featureExtractor.js:402`), implementar métricas de ventana §1.1 (`unique_real_frames >= 12`, `interpolated_bridge_fraction <= 3/14`, `tail_extrapolation_ms == 0`) y subir a **`FEATURE_SPEC v1.4.0`**.
   - **Corrección `mirror_raw_frame` / `mirrorRawFrame` para `{ landmarks, categoryName }`:** Escribir test que falle primero pasando `hands: [{ landmarks: [...], categoryName: "Left", score: 0.99 }]` en `feature_extractor.py:729-734` y `featureExtractor.js:684-694`; luego corregir ambos preservando retrocompatibilidad con arreglos planos, y probar involución `Mirror(Mirror(raw)) == raw` + equivariancia.
   - **Validación de `config_hash` desacoplado de fixtures de test (`v1.4.0`) y `feature_spec_version`:** Desacoplar `compute_config_hash` / `getCanonicalConfigObject` de `tests/fixtures/feature_spec_cases.json` (`get_fixtures_sha256` falla en contenedores Docker sin `tests/` y se invalida al añadir tests). Hashear en SHA-256 sobre JSON canónico ordenado: `feature_spec_version`, `handedness_convention`, topología (`total_features`, `pose_upper_indices`, `sequence_length`), parámetros/umbrales algorítmicos (`shoulders_d_min`, `shoulder_vis_thresh`, `max_gap_ms`, `min_unique_real_frames`, `max_interpolated_bridge_fraction`, `ema_alpha`, `weight_label_penalty`, `weight_temporal_continuity`, `hand_disconnected_thresh`, `hand_ambiguity_thresh`, `pose_wrist_min_vis`, `pose_z_policy`), digest SHA-256 de modelos `.task` (`hand_landmarker.task` `fbc2a300...`, `pose_landmarker_lite.task` `59929e1d...`) y runtime (`delegate`, `pose_cadence`, `num_hands`). Luego escribir tests antes de implementar `IncompatibleFeatureSpecError` en `InferenceEngine` (`inference_engine.py:71-114`) y escritura real en `model_metadata.json` (`train_and_export.py:570-585`).
   - **Lateralidad `v1.4.0` (tests `xfail` ya escritos sobre `real_recording_laterality_15f.json`):** Invertir la regla de `v1.3.0` tras validar el PNG `v1.3.1` en `feature_extractor.py`, `featureExtractor.js`, `signEngine.js`, `drawLandmarks.js`, `landmarkTracker.js`, `inspect_recording.py`, `generate_fixtures.py` (`TC_05B_*`), `translator.spec.js` y docs.

2. **Bloque 2.B — Experimentos A/B Controlados de Captura (1 variable = 1 commit en `vite preview`):**
   - **Exp A/B-1 (Refinamiento bucle cámara + contratos de entrada):** Comparar `rVFC` vs `rAF+skip currentTime`, fijar 3er arg `{ rotationDegrees: 0 }`, `visibilitychange` (invalidar tramo al ocultarse), `ERR_INVALID_ASPECT_RATIO`, snapshot de `track.getSettings()/getCapabilities()`.
   - **Exp A/B-2 (Página dedicada `/capture` en `vite preview`):** Sin depender de `import.meta.env.DEV` ni `StrictMode`; cero `setState` por frame (UI a $\le 4\text{ Hz}$ vía refs); sin `BackgroundParticles` ni `LandmarkTracker`; espejo CSS `scaleX(-1)`; `AudioContext` único; cero clones JSON por frame.
   - **Exp A/B-3 (Evaluación de riesgo Dedicated Worker + `OffscreenCanvas`):** Evaluar en commit aislado aislando `self.ModuleFactory` fuera de `window` y transfiriendo frames; si WebGL2 falla en `OffscreenCanvas`, filtra objetos o empeora `p95/p99`, **`git revert` inmediato**.
   - **Exp A/B-4 (Matriz de parámetros — Preguntas #3 y #6):** Medir sobre el clip real torso+manos ($\ge 300$ frames): 1 vs 2 manos físicas con `numHands=2`; `numHands=1` vs `numHands=2`; resoluciones 4:3 (`640×480` vs `480×360` vs `320×240`); cadencias pose (`1:1`, `1:2`, `1:3`); y divergencia cross-delegate CPU vs GPU ($\ge 100$ frames reales 2 manos + pose, reportando `p50/p95/p99/max`). Cualquier cambio de resolución/cadencia/numHands sube versión si altera contrato, documentado explícitamente.

- **Gate Fase 2:** Alcanzar $\ge 15.0\text{ FPS}$ durante 60 s con 1 y 2 manos, `max_interval <= 100.0 ms`, `p99 <= 90.0 ms`, `unique_real_frames >= 12/15`, `interpolated_bridge_fraction <= 3/14` — o presentar límites físicos medidos del Ryzen 3 7320U sin maquillar para decisión del usuario.

---

### Fase 3: Formato Compacto 60 s (`raw_schema_version: "2.0.0"`), Servidor Local y Grabador Guiado

1. **Formato Binario Empaquetado `v2.0.0` (`.raw.meta.json` + `.raw.f32.bin`, alineado a 8 bytes):**
   - Por frame (`1,072 B/frame`): `Float64` tiempos (`16 B`: `[t_monotonic_ms, t_media_ms]`) + `Float32` geometría (`264 floats = 1,056 B`: pose `33×4=132` + 2 manos `2×(3 cabecera + 63 coords)=132`).
   - Peso exacto 60 s: **`964.8 KB` (~0.92 MiB)** @ 15 FPS (`900` frames); **`1,929.6 KB` (~1.84 MiB)** @ 30 FPS (`1,800` frames), lectura `np.frombuffer < 2 ms` (vs `~15.30 MB` JSON pretty). Opcional compresión gzip chunked (`~405–1,080 KB`).
   - Retrocompatibilidad en `inspect_recording.py` para `v1` (`.raw.json`) y `v2.0.0`, validando `sha256_bin`, `frame_count` y guardando `unique_real_frames`, `interpolated_bridge_fraction`, `p99_interval_ms`, `max_interval_ms`, `per_second_metrics` y entorno completo en cada toma/manifest.
2. **Grabador Guiado 60 s y Servidor Local Seguro (`127.0.0.1:8001`):**
   - Guion JSON configurable (tomas $\le 2.5\text{ s}$ + `reposo`), cuenta regresiva, texto grande ($\ge 48\text{ px}$), audio, tecla `"M"`/`"Espacio"` ("Me equivoqué") marcando `invalidated_segments`, subida por trozos cada `5 s` (`80.4–160.8 KB/chunk` << límite `2 MiB/chunk` y `16 MiB/sesión`), respaldo IndexedDB/OPFS ante cierre, token CSPRNG + `hmac.compare_digest` + `Origin` estricto + regex `session_id` + escritura atómica.

---

### Fase 4: Validadores, Fixtures, Cierre C++ y Regresión Completa

1. **Mini-fixtures calculados a mano (independientes del código):** Remuestreo lineal 3D de exactamente **3 frames** y filtro EMA ($\alpha=0.50$) de **4 valores** con reinicio tras ausencia, verificados ($L_\infty \le 10^{-6}$) en Python y JS.
2. **`validate_dataset.py` y reconciliación de modelos:** Detectar/rechazar archivos en cuarentena, stubs senoidales (`D_norm` anómalo vs `1.0`) o `visibility > 1.0`, y reconciliar `exported_model/` raíz vs `expresat/models/exported_model/`.
3. **Separación Benchmark vs Test Suite, Sonda SIMD y Re-medición WASM:** *(Separación completada en [`expresat/frontend/benchmarks/`](../../expresat/frontend/benchmarks/) + [`playwright.benchmark.config.js`](../../expresat/frontend/playwright.benchmark.config.js) fuera de `npm run test:e2e`; queda pendiente corregir sonda WASM SIMD `v128.const` y re-medir ruido WASM instanciando detectores nuevos por corrida sobre el clip real torso+2 manos $\ge 100$ frames.)*
4. **Cierre formal C++ y Subconjunto Verificable de Señas:** Declarar formalmente estado no compilable/bloqueado de `expresat-native/` sin ONNX Runtime ni modificar comportamiento bloqueado (consultar si se autoriza corregir el UB latente `NUM_CLASSES < 5` en `inference_thread.cpp:153,181`), y documentar subconjunto acotado de señas con URLs verificables en `catalog/signs_catalog.json`.
5. **Verificación completa con re-ejecución obligatoria:** `unittest`, `vitest`, `oxlint`, `eslint`, tests del servidor local `/save`, `inspect_recording.py` v1/v2 y **re-ejecución** por el revisor independiente de los scripts de benchmark con su JSON verificable.

---

### Fase 5: Reporte Final y Entrega

- `docs/dataset-generator/REPORTE_CAPTURA.md` (pendiente al concluir Fases 1–4: antes/después medido con entorno normalizado, commits aceptados/revertidos, riesgos residuales).
- `docs/dataset-generator/README_CAPTURA_FISH.md` (pendiente al concluir Fase 3: comandos en sintaxis **fish**).
- JSONs finales reproducibles y actualización final de [DECISIONES.md](./DECISIONES.md).

---

## 4. Registro de Riesgos y Criterios de Reversión (`git revert`)

| Riesgo identificado | Probabilidad / Impacto | Mitigación y protocolo de reversión |
|---|---|---|
| **WebGL2 en `OffscreenCanvas` inestable en Firefox/Radeon (Exp A/B-3)** | Media / Alta | Commit aislado con watchdog de 5 s; `git revert` inmediato si falla o empeora `p95/p99`. |
| **Ryzen 3 7320U (incluso normalizado `performance` + `dynamic_framerate=0`) no sostiene $\ge 15$ FPS @ 640×480 con 2 manos + pose 1:1** | Media / Alta | Medir A/B sin maquillar tras Paso 1.0; documentar tabla exacta (`480×360`, `poseCadence=2`, etc.) y pedir autorización explícita si se sube versión de contrato. |
| **Throttling térmico sostenido tras 2–4 min de grabación continua** | Media / Media | Medido por `scripts/sysmon.sh` en 300 s; diseñar pausas de enfriamiento entre sesiones de 60 s si hay caída > 10% o `< 15 FPS`. |
| **Fuga de `.env` o capturas faciales en Git / Docker** | Controlada (`P0`) | `.gitignore` raíz/frontend y `.dockerignore` activos y verificados; rotación manual de clave en curso por el usuario. |
| **Ciclos de error repetidos** | Baja / Control | Parada dura si el mismo error ocurre 2 veces seguidas o tras 5 ciclos en un frente. |

---

## 5. Punto de Detención Obligatorio (Esperando Confirmación del Usuario)

Siguiendo las instrucciones del plan, la ejecución se detiene antes de **Fase 1 Paso 1.0** (`scripts/sysmon.sh` ya versionado y listo en el repositorio junto con la normalización y la corrección `rAF`/`currentTime`) hasta confirmar dos puntos:
1. Rotación manual de la clave en Supabase y limpieza del `.env` local.
2. Equipo físicamente normalizado (conectado a corriente, perfil `performance`, cámara lista para `v4l2-ctl --set-ctrl=exposure_dynamic_framerate=0,power_line_frequency=2`) para iniciar las mediciones del Paso 1.0.
