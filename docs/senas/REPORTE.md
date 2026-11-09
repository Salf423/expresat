# Reporte Final — Reconocimiento Geométrico de Números y Alfabeto LSM (`senas-numeros-alfabeto`)

## 1. Resumen Ejecutivo

Se extendió la capa [`expresat/frontend/src/recognition/`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/) para reconocer en el navegador, usando exclusivamente algoritmos geométricos y cinemáticos deterministas (sin modelo neuronal entrenado):

- **9 señas base existentes** (`Mano Abierta`, `Puño`, `Uno`, `Dos`, `OK / Pinza`, `Bien`, `Te Quiero`, `Lunes`, `Hola`), preservando el 100% de sus pruebas de regresión.
- **11 números básicos de LSM (`0` a `10`)**, incluyendo orientaciones frontales/dorsales/oblicuas y el giro dinámico de muñeca del `10`.
- **29 letras y dígrafos del alfabeto dactilológico de LSM (`A` a `Z`, `Ñ`, `LL`, `RR`)**:
  - **21 letras estáticas:** `A, B, C, D, E, F, G, H, I, L, M, N, O, P, R, S, T, U, V, W, Y`.
  - **8 letras y dígrafos dinámicos:** `J, K, LL, Ñ, Q, RR, X, Z`, evaluados con ventanas temporales en milisegundos (`450 ms – 850 ms`) y plantillas de trayectoria normalizadas por `palmScale`.
- **Total implementado:** **49 señas verificadas (`49 LISTA`, `0 PENDIENTE_FUENTE`)**.

---

## 2. Arquitectura e Invariantes Implementados

1. **Extracción Pre-Rotación de Orientación ([`extractHandOrientation`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L156-L220)):**
   - Calcula `palmAngleDeg` (`UP`, `DOWN`, `HORIZONTAL`, `OBLIQUE`) antes de rotar la mano al eje `+Y`, permitiendo distinguir `G`/`H` (`HORIZONTAL`) y `M`/`N`/`P`/`Q` (`DOWN`) de `U`/`V`/`W`/`1`/`2` (`UP`) sin perder invariancia rotacional en las señas libres (`ANY`).
   - Determina `palmFacing` (`FRONT`, `BACK`, `SIDE`) mediante el producto cruzado `(INDEX_MCP - WRIST) × (PINKY_MCP - WRIST)` corregido por la lateralidad (`Right` vs `Left`).
2. **Canonicalización Quiral Izquierda/Derecha ([`canonicalizeHand`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L222-L246)):**
   - Proyecta el eje `X` normalizado según el signo de `PINKY_MCP.x - INDEX_MCP.x` para que el borde radial (pulgar/índice) quede siempre en `-X` y el borde ulnar (meñique) en `+X`. Así, cada regla del catálogo funciona idénticamente con mano izquierda o derecha y con cámara espejada o sin espejar.
3. **Estados Tri-valuados y Métricas Inter-digitales ([`fingerStates`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L276-L426)):**
   - Cada dedo se clasifica en `EXTENDED | HOOKED | CURLED` más sub-bandera `tightlyCurled` (`PIP < 70°` o punta pegada a la base MCP), clave para separar `E` (`HOOKED` en garra) de `S`/`A`/`T` (`TIGHTLY_CURLED`).
   - Distancias con `z` atenuado (`zWeight = 0.25`) relativas a `palmScale`: contactos de pinza (`thumbIndexTipDist`, `thumbMiddleTipDist`, `thumbPinkyTipDist`), cruce índice-medio (`indexMiddleCrossDeltaX`), e inserción del pulgar (`thumbIndexPipDist`, `thumbMiddlePipDist`).
4. **Motor de Emparejamiento y Desempate ([`matcher.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/signs/matcher.js)):**
   - Evalúa declarativamente el catálogo [`SIGN_CATALOG`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/signs/index.js), aplica funciones `tieBreaker(features)` por `grupoConfundible` (`G1`–`G7`), promueve señas dinámicas sobre su contraparte estática (`staticCounterparts`) cuando la trayectoria está activa, y rechaza con `label: null, reason: 'LOW_CONFIDENCE'` cuando no se supera `minConfidence` o `minMargin`.
5. **Plantillas de Trayectoria en Milisegundos ([`trajectory.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/signs/trajectory.js)):**
   - Ventana temporal basada en `timestampMs` (`windowMs = 750 ms`), remuestreo equidistante a $M=16$ puntos normalizados por `palmScale`, e identificadores de forma cinemática (`WAVE`, `OSC_X`, `OSC_Y`, `ARC_J`, `HOOK_Q`, `DRAG_X`, `SLIDE_X`, `Z_PATH`, `ROTATE`).

---

## 3. Estado Final del Catálogo (49 Implementadas / 0 Pendientes)

| Categoría | Total | Estado `LISTA` | Estado `PENDIENTE_FUENTE` | Fuentes Verificadas |
| :--- | :---: | :---: | :---: | :--- |
| **Señas Base** | 9 | 9 | 0 | Catálogo base ExpresaT (`Mano Abierta`, `Puño`, `Uno`, `Dos`, `OK / Pinza`, `Bien`, `Te Quiero`, `Lunes`, `Hola`) |
| **Números LSM (`0–10`)** | 11 | 11 | 0 | *Manos con Voz: Diccionario de LSM* (CONAPRED/SEP) + láminas `o.png`, `l.png`, `v.png`, `w.png`, `f.png` |
| **Alfabeto Estático** | 21 | 21 | 0 | Láminas oficiales `frontend-legacy/assets/señas/imagenes_abecedario/{a..y}.png` + *Manos con Voz* |
| **Alfabeto Dinámico** | 8 | 8 | 0 | Láminas oficiales `j.png`, `k.png`, `ñ.png`, `q.png`, `x.png`, `z.png` + *Manos con Voz* (`LL`, `RR`) |
| **TOTAL** | **49** | **49** | **0** | 100% con cita de fuente en `SIGN_CATALOG` |

---

## 4. Resultados de la Matriz de Confusión

### 4.1 Resumen Global (`phaseF_regression_matrix.test.js`)

| Benchmark | Clases Evaluadas | Aciertos (`correct`) | Rechazos (`LOW_CONFIDENCE`) | Confusiones (`confused`) | Exactitud (`accuracy`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Sintético Canónico (`buildFullSyntheticBenchmark`)** | 49 (9 base + 11 núm. + 29 letras) | 49 | 0 | 0 | **100.0% (1.0000)** |
| **Fixtures con Ruido de Cámara (`fixtures/real/sample_fixtures.json`, $\sigma = 0.0016$, multi-frame)** | 40 (11 núm. + 29 letras) | 40 | 0 | 0 | **100.0% (1.0000)** |
| **Invariancia Izquierda/Derecha + Escala `[0.5x, 2.5x]` con jitter ($\sigma = 0.0018$)** | 52 combinaciones G1–G7 | 52 | 0 | 0 | **100.0% (1.0000)** |

### 4.2 Desempeño y Desempate por Grupo Confundible (`G1`–`G7`)

| Grupo | Señas en el Grupo | Criterio Geométrico de Desempate (`tieBreaker`) | Exactitud Sintética / Noisy |
| :--- | :--- | :--- | :---: |
| **G1 (Puños Cerrados)** | `A`, `S`, `T`, `E`, `Puño` | `E` exige `HOOKED` (garra alta sin cierre total); `A` exige pulgar lateral (`thumbIndexMcpDist >= 0.36`); `S` exige pulgar cruzado sobre nudillos (`thumbMiddlePipDist <= 0.38`); `T` exige pulgar insertado entre índice y medio (`thumbIndexPipDist <= 0.30`). | 100% |
| **G2 (Curvas / Cierre Circular)** | `C`, `O`, `0` | `C` mantiene apertura `thumbIndexTipDist ∈ [0.34, 0.90]` con falanges `HOOKED`; `O` y `0` cierran pinza (`thumbIndexTipDist <= 0.32`). | 100% |
| **G3 (Índice Dominante / Pinza)** | `D`, `1`, `F`, `9`, `L`, `6`, `G`, `Q`, `X` | `F`/`9` extienden medio+anular+meñique; `L` extiende pulgar ortogonal (`thumbIndexSpread >= 0.65`); `6` extiende solo pulgar (`BACK`); `G` apunta horizontal (`HORIZONTAL`); `D` toca pulgar-medio con índice vertical (`UP`). | 100% |
| **G4 (Bipedales / Tripedales Verticales)** | `U`, `V`, `R`, `2`, `H`, `K`, `P`, `W`, `3`, `7`, `8` | `H` apunta horizontal; `P`/`K` apuntan hacia abajo (`DOWN`); `R` cruza índice y medio (`indexMiddleCrossDeltaX > 0.015`); `V` separa índice y medio (`indexMiddleSpread >= 0.25`); `U` los mantiene juntos (`<= 0.23`); `3` une `WRIST+INDEX+MIDDLE+THUMB`; `7` inclina a `OBLIQUE`; `8` une pulgar-medio-índice. | 100% |
| **G5 (Mano Plana / Conteo Alto)** | `B`, `4`, `5`, `Mano Abierta` | `B` junta los 4 dedos (`indexMiddleSpread <= 0.22`) con pulgar doblado; `4` separa los 4 dedos con pulgar doblado; `5` / `Mano Abierta` extiende los 5 dedos. | 100% |
| **G6 (Dedos Descendentes)** | `M`, `N`, `Ñ` | `palmDirection = DOWN`; `M` desciende 3 dedos (`index`, `middle`, `ring` extendidos, `pinky` doblado); `N` desciende 2 dedos (`index`, `middle` extendidos, `ring` y `pinky` doblados); `Ñ` añade oscilación horizontal `OSC_X`. | 100% |
| **G7 (Extremos pulgar/meñique)** | `I`, `J`, `Y`, `Te Quiero`, `10` | `I` extiende solo meñique (`UP`); `J` traza arco `ARC_J` con meñique; `Y` extiende pulgar+meñique con mano vertical/lateral; `10` rota muñeca con pulgar; `Te Quiero` añade el índice extendido. | 100% |

---

## 5. Limitaciones Geométricas Conocidas (`LIMITACION_CONOCIDA`) y Requisitos para el Futuro Modelo Entrenado (`ModelClassifier`)

Aunque el clasificador geométrico resuelve las 49 señas sin entrenamiento cuando los landmarks de MediaPipe son visibles, existen limitaciones físicas inherentes a la estimación monocular 2D/2.5D de un solo cuadro o ventana corta:

1. **Auto-oclusión de dedos cruzados o superpuestos (`R` vs `U`, `T` vs `S`):**
   - *Limitación (`LIMITACION_CONOCIDA`):* Cuando la mano no está exactamente de frente a la cámara, MediaPipe Hands suele interpolar el dedo medio detrás del índice en `R`, reduciendo `indexMiddleCrossDeltaX` cerca de cero (pareciéndose a `U`), o proyecta la punta del pulgar de `T` sobre el mismo plano que `S`.
   - *Cómo lo resolverá `ModelClassifier`:* Un clasificador neuronal (MLP/GRU sobre el vector de 63D/178D con normalización z-score y contexto temporal de entrada a la postura) aprende las correlaciones sutiles de rotación de muñeca y ángulos MCP/PIP previos a la oclusión.
2. **Oclusión dorsal en `M` vs `N` y en el número `9`:**
   - *Limitación (`LIMITACION_CONOCIDA`):* En `M` y `N` (mano apuntando hacia abajo con el dorso al frente), el pulgar queda oculto bajo los dedos índice/medio/anular. En el número `9` de LSM (dorso al frente, cuatro dedos flexionados abrazando el pulgar), el pulgar queda oculto detrás de la palma; por ello en el catálogo se admite tanto la variante dorsal como el homomorfo `F` con alias.
   - *Cómo lo resolverá `ModelClassifier`:* El modelo secuencial (`SignLanguageGRU` / ONNX) aprovecha la secuencia de transición de los 15–30 frames previos donde el pulgar aún es visible antes de cerrarse.
3. **Homomorfismos inter-categoría (`0`/`O`, `1`/`D`, `2`/`V`, `5`/`Mano Abierta`, `6`/`Bien`, `L`/`Lunes`):**
   - *Limitación (`LIMITACION_CONOCIDA`):* Algunas configuraciones anatómicas son geométricamente idénticas o casi idénticas entre números, letras y señas base. En modo `Todo` (`mode: 'all'`), el motor expone `details.aliases` y en la UI permite filtrar explícitamente por modo (`Todo | Alfabeto | Números | Básicas`).
   - *Cómo lo resolverá `ModelClassifier`:* Integración de contexto léxico/gramatical aguas arriba (n-gramas o decodificador CTC/Seq2Seq en el backend FastAPI).

### Punto de Enchufe Listo (`Classifier` Interface)
La interfaz [`Classifier`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/classifier.js#L18-L32) (`predict(frames) -> { label, confidence, category, details }`) ya está desacoplada de React y de MediaPipe. Para conectar el futuro `ModelClassifier` (ONNX Runtime Web o WebSocket):
1. Implementar `class ModelClassifier extends Classifier` en `src/recognition/modelClassifier.js`.
2. Recibir la misma ventana temporal de frames (`windowMs`) que entrega `useSignEngine`.
3. Retornar `{ label, confidence, category, details }` sin tocar una sola línea de `engine/` ni de `Translator.jsx`.
