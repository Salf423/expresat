# Auditoría Técnica y Línea Base — Dataset Generator (Paso 0)

- **Documento:** `docs/dataset-generator/AUDITORIA.md`
- **Fecha:** 2026-11-10
- **Estado:** **Histórico (Línea Base Paso 0)** — Anterior a la unificación en [FEATURE_SPEC.md](./FEATURE_SPEC.md) (`v1.3.0`) y [DECISIONES.md](./DECISIONES.md)
- **Rama origen:** `dataset-v2` (derivada de `rearquitectura-demo`)

> [!NOTE]
> Este documento conserva la auditoría inicial que motivó el aislamiento de `letra_a_derecha_2.json` en cuarentena y la creación del extractor canónico unificado (`expresat/models/feature_extractor.py` + `expresat/frontend/src/engine/featureExtractor.js`). Véase la nota técnica corregida en §2 sobre la fórmula 3D en `expresat-native/`.

---

## 1. Stack y Flujo Actual del Generador

El componente `expresat-dataset-generator/` es una aplicación de escritorio nativa en **C++17** construida con **CMake**:

### Componentes del Stack
- **Lenguaje:** C++17 (`std::vector`, `std::array`, `<thread>`, `<filesystem>`).
- **Sistema de compilación:** CMake 3.20+ con perfiles `Debug`, `Release` y `mediapipe` (vía `scripts/build.sh`).
- **Captura de video:** OpenCV (`cv::VideoCapture(0)`) en `CameraStream` ejecutándose en un hilo secundario independiente a ~30 FPS (640×480).
- **Interfaz gráfica:** Dear ImGui (v1.90 vendored) + GLFW 3.4 + OpenGL 3.3 Core Profile + GLAD. Renderiza un preview de la cámara con esqueleto superpuesto vía textura OpenGL (`camTexId_`).
- **Serialización:** `nlohmann/json` (v3.11.3 vendored/FetchContent).
- **Entorno de ejecución:** Linux x86_64, terminal fish del usuario, AMD Ryzen 3 7320U, ~7.0 GiB RAM (con swap en uso).

### Flujo de Datos Actual
```
Cámara OpenCV (cv::VideoCapture) 
    ↓ cv::Mat BGR (640x480)
MediapipeExtractor::process() 
    ↓ [MODO STUB: Genera ondas senoidales sintéticas; NO hay MediaPipe C++ enlazado]
FrameLandmarks (pose 33, leftHand 21, rightHand 21)
    ↓
MediapipeExtractor::extract() 
    ↓ Normalización por centro de hombros y distancia 3D inter-humeral
recordBuffer_ (Acumula 15 FeatureVectors de 178 floats contados por índice)
    ↓
DataAugmenter::generate() (Genera N muestras sintéticas: ruido, escala, rotación 2D, temporal warp)
    ↓ std::vector<Sequence> en memoria (Heap C++)
DatasetWriter::write() 
    ↓ Árbol nlohmann::json en RAM + root.dump(2)
Archivo en disco: ./dataset/<label>.json (JSON indentado con 2 espacios)
```

### Datasets Existentes
- Archivo analizado: `expresat-dataset-generator/dataset/letra_a_derecha_2.json`
- **Muestras:** 500 secuencias
- **Forma:** `(500, 15, 178)`
- **Tamaño en disco:** **37.24 MB** (38,471,452 bytes). Formato JSON indentado de texto plano con alta redundancia.
- **Rango de valores:** `[-0.2752, 0.4716]` (media $\mu = 0.1013$, $\sigma = 0.1567$).
- **Validación con `validate_dataset.py --strict`:** 1 clase (`letra_a_derecha_2`), 100% balanceada, 0% frames nulos.

---

## 2. Composición Exacta de las 178 Features y Constructores Duplicados

### Topología Canónica (178 Features por Frame)
El tensor de entrada del modelo `expresat_gru_int8.onnx` es estrictamente `(1, 15, 178)`:

| Segmento | Dimensión | Descripción | Landmarks MediaPipe | Coordenadas |
|---|---|---|---|---|
| `[0..51]` | **52D** | Upper Body Pose | 13 landmarks: `{0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22}` (Nariz, hombros, codos, muñecas, meñiques, índices, pulgares) | 4 por punto: $(x, y, z, \text{visibility})$ |
| `[52..114]` | **63D** | Mano Izquierda | 21 landmarks canónicos de mano | 3 por punto: $(x, y, z)$ |
| `[115..177]` | **63D** | Mano Derecha | 21 landmarks canónicos de mano | 3 por punto: $(x, y, z)$ |

### Normalización Canónica (Hombros 3D)
1. **Centro:** Punto medio entre hombros (landmarks 11 y 12 de MediaPipe Pose):
   $$C_x = \frac{L_x + R_x}{2}, \quad C_y = \frac{L_y + R_y}{2}, \quad C_z = \frac{L_z + R_z}{2}$$
2. **Escala:** Distancia euclidiana inter-humeral tridimensional:
   $$D_{\text{shoulders}} = \sqrt{(R_x - L_x)^2 + (R_y - L_y)^2 + (R_z - L_z)^2}$$
3. **Transformación:**
   $$\text{coord}_{\text{norm}} = \frac{\text{coord} - C}{D_{\text{shoulders}}}$$
   - Se aplica a $(x, y, z)$ de Pose y a todas las coordenadas $(x, y, z)$ de ambas manos.
   - La **visibilidad** (`visibility`) de la pose **no se traslada ni se escala** (se conserva cruda en $[0, 1]$).

### Mapa de Constructores del Vector y Discrepancias Encontradas

Existe una fragmentación crítica del constructor de features a lo largo del repositorio:

1. **`expresat/models/inference_engine.py` (Python):**
   - Implementa la normalización 3D canónica descrita arriba.
   - *Falla silenciosa:* Si no hay pose (`pose` es `None` o `< 13` landmarks), llena pose con ceros y deja las coordenadas de las manos **crudas en $[0, 1]$ de pantalla sin normalizar**, rompiendo la escala contra la que fue entrenado el modelo.
2. **`expresat-dataset-generator/src/mediapipe_extractor.cpp` (C++):**
   - Implementa la normalización 3D canónica en `normalizePose()`.
   - *Estado:* Ejecuta en modo **STUB**; no extrae landmarks de video real.
3. **`expresat-native/core/src/inference_thread.cpp` (C++ Motor Nativo):**
   - *Corrección técnica posterior:* `normalize_to_shoulders()` sí calcula la distancia **3D** ($\sqrt{dx^2 + dy^2 + dz^2}$), aunque carece del pipeline `ExtractWindow` (`v1.3.0`: asignación conjunta de manos, remuestreo por bloques a 15 frames y mediana por ventana). Por ello `expresat-native/` permanece bloqueado como `NO_CONFORME_FEATURE_SPEC_1_3_0` devolviendo `ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0`.
   - *(En la revisión inicial de Paso 0 se había registrado erróneamente que usaba distancia 2D XY; esa nota queda corregida arriba tras verificar `inference_thread.cpp`.)*
4. **`expresat/models/inference.py` (Python Legacy):**
   - **Discrepancia crítica:** Concatena coordenadas crudas $[0, 1]$. **No normaliza a los hombros en absoluto.**
5. **`expresat/frontend/src/recognition/geometry.js` (Demo React en Navegador):**
   - **Discrepancia de concepto:** No construye el vector 178D. Su función `normalizeHand()` traslada el origen a la muñeca (landmark 0), escala por `palmScale` (distancia muñeca $\to$ nudillo medio 9) y alinea el eje XY hacia $-Y$. Es una normalización puramente local para gestos estáticos de una sola mano.

---

## 3. Matriz Comparativa: Rastreo del Generador vs. Rastreo de la Demo

| Parámetro / Aspecto | Rastreo de la Demo (`frontend/src/engine/signEngine.js`) | Generador Actual (`expresat-dataset-generator/`) |
|---|---|---|
| **Tecnología / Runtime** | JavaScript / WebAssembly en navegador (`@mediapipe/tasks-vision` 1.0.1) | C++17 nativo con CMake y OpenCV |
| **Modelo MediaPipe** | `public/models/hand_landmarker.task` en CPU | `models/holistic_landmarker.task` (declarado, no enlazado; usa STUB senoidal) |
| **Detección de Pose** | **Desactivada por defecto** (`enablePose: false` en `config.js`). Pose opcional (`pose_landmarker_lite.task`). | Activa en teoría (Upper Pose 52D requerida), stub en la práctica |
| **Detección de Manos** | Hasta 2 manos (`numHands: 2`), umbrales confianza: 0.45 | 2 manos, umbrales confianza: 0.50 |
| **Filtro de Jitter** | **EMA Filter** (`LandmarkEMAFilter`, $\alpha = 0.5$) en hilo principal | **Ninguno** (frames crudos ruidosos) |
| **Handedness & Espejo** | Inversión automática para cámara frontal (selfie): categoría 'Left' mapea a mano derecha del usuario | Asignación fija sin lógica explícita de espejo selfie |
| **Modo de Ejecución** | `runningMode: 'VIDEO'` con timestamps monotónicos en ms | Modo STREAM OpenCV dependiente de la tasa de frames de la cámara |
| **Control Temporal** | Intervalo de inferencia desacoplado de la cámara (`1000 / targetFps`) | Conteo ciego por índice de frames de cámara |
| **Mano ausente** | Relleno con `null` en payload; localmente ignora frames vacíos | Relleno con ceros (`0.0f`) en el vector final |

---

## 4. Línea Base de Memoria RAM (Medición Empírica)

Se ejecutó un benchmark de medición de RSS (`/proc/self/statm`, páginas de 4096 bytes) aislando `DataAugmenter` y `DatasetWriter` bajo el stack C++ actual:

### Mediciones Empíricas

| Tomas / Muestras | Tiempo Generación + Write | Tamaño JSON Disco | RSS Inicial | RSS tras Augmenter | RSS tras Write JSON | Crecimiento Delta RSS |
|---|---|---|---|---|---|---|
| **10** | 16.7 ms | 0.73 MB | 4.28 MB | 4.66 MB | 5.32 MB | **+1.04 MB** |
| **100** | 132.5 ms | 7.34 MB | 5.38 MB | 5.81 MB | 10.10 MB | **+4.72 MB** |
| **500** | 589.5 ms | 36.69 MB | 10.10 MB | 10.10 MB | 31.07 MB | **+20.96 MB** |

> **Nota de Retención:** Tras liberar los objetos y eliminar el directorio temporal, el RSS del proceso permaneció en **31.11 MB**, evidenciando fragmentación en el heap de `glibc` generada por la creación masiva y destrucción de millones de nodos dinámicos `nlohmann::json`.

### Identificación de Cuellos de Botella y Fugas de Memoria
1. **Representación de datos en 3 niveles de indirección:**  
   `Sequence = std::vector<std::vector<float>>` y `std::vector<Sequence>`. Para 500 muestras de 15 frames, se crean $500 \times 15 = 7,500$ pequeñas asignaciones dinámicas en el heap solo para los vectores internos.
2. **Serialización JSON en memoria:**  
   `DatasetWriter::write()` instancia un objeto `nlohmann::json root` donde cada número float se envuelve en un nodo `json` (16–24 bytes). Para 500 tomas $\times 15$ frames $\times 178$ floats $= 1,335,000$ nodos JSON en el heap ($> 40 \text{ MB}$).
3. **Materialización de String gigante:**  
   `root.dump(2)` crea en RAM una cadena de texto de casi 37 MB antes de escribirla al archivo `std::ofstream`.
4. **Fuga en GUI (`GuiManager`):**  
   El miembro `generatedSamples_` almacena la copia completa de todas las muestras generadas y nunca se limpia (`.clear()`), acumulándose en RAM entre grabaciones sucesivas.
5. **Colapso en `writeCombined()`:**  
   Lee y parsea todos los `.json` del directorio simultáneamente en un array JSON gigante. Con 10 clases de 500 muestras, consumiría $> 400 \text{ MB}$ de RAM, un riesgo crítico en una máquina de 7 GiB con swap activo.

---

## 5. Línea Base de Precisión y Captura

- **Tasa de mano perdida en generador C++:** 0% (debido a que opera en STUB senoidal donde la mano sintética siempre está presente).
- **Tasa de mano perdida en demo real (web):** Depende de oclusión y bordes. En cámara de 640×480 a 20 FPS, las pérdidas ocurren típicamente en transiciones rápidas o bordes de pantalla ($\sim 4\text{--}8\%$ de frames en uso normal).
- **Jitter medido:**
  - Sin filtro EMA: fluctuaciones de coordenadas de $\pm 0.004\text{--}0.009$ en reposo.
  - Con EMA ($\alpha = 0.5$): jitter reducido a $< 0.0018$ en reposo sin pérdida perceptible de responsividad dinámica.
- **Tiempo de captura por muestra:**
  - Generador actual: 15 frames ciegos a $\sim 30 \text{ FPS} \approx 500 \text{ ms}$ (sin validación de inicio/fin de gesto ni remuestreo).
  - Tiempo de generación sintética: $589 \text{ ms}$ para 500 variantes de una seña.

---

## 6. Reporte de Condiciones Bloqueantes (Paso 0)

De acuerdo con las instrucciones de la especificación, se evalúan las tres condiciones bloqueantes:

### [BLOQUEANTE (a)] — SE CUMPLE EN CONFIGURACIÓN DE PRODUCCIÓN
> *"Las 178 features requieren datos que el rastreo de la demo no produce (ej. pose, si la demo solo usa manos)."*

- **Evidencia técnica:**  
  1. El modelo existente `expresat_gru_int8.onnx` exige de forma invariable el tensor `(1, 15, 178)`.
  2. Las primeras 52 features provienen obligatoriamente de **MediaPipe Pose** (13 landmarks del torso superior).
  3. La normalización del tensor requiere las coordenadas de los hombros (landmarks 11 y 12 de Pose) para centrar y escalar tanto la pose como ambas manos.
  4. En la demo (`expresat/frontend/src/config.js`), **`enablePose` es `false` por defecto** en producción *(aunque `Translator.jsx` pasó a activarlo automáticamente en `import.meta.env.DEV` para captura/telemetría)*.
  5. En consecuencia, en su configuración estándar de producción la demo **NO genera datos de pose** (`pose = null`), por lo que no puede construir el vector 178D ni normalizar manos respecto a hombros.

### [BLOQUEANTE (b)] — SE CUMPLE
> *"El modelo `.task` o la versión del generador no son equivalentes y no hay forma de igualarlos."*

- **Evidencia técnica:**  
  1. La demo utiliza `@mediapipe/tasks-vision` versión 1.0.1 (WASM) con el modelo `public/models/hand_landmarker.task`.
  2. El generador `expresat-dataset-generator/` está programado en C++ pero **no tiene compilado ni enlazado MediaPipe C++** (está en `#if EXPRESAT_STUB_EXTRACTOR`).
  3. Vincular MediaPipe Tasks C++ nativo requeriría compilar el repositorio MediaPipe con Bazel, lo cual es inviable en el hardware de desarrollo (AMD Ryzen 3 7320U, ~7 GiB RAM con swap activo) y provocaría fallos de Out-Of-Memory (OOM).

### [BLOQUEANTE (c)] — SE CUMPLE EN PASO 0 (PARCIALMENTE RESUELTO POSTERIORMENTE PARA PYTHON/JS)
> *"El constructor de features está duplicado con resultados distintos."*

- **Evidencia técnica en Paso 0 (y estado posterior):**  
  1. `inference_engine.py` (Python): Normalización 3D respecto a hombros ($D_{3D} = \sqrt{dx^2 + dy^2 + dz^2}$), integrada posteriormente con `feature_extractor.py` (`v1.3.0`).
  2. `expresat-native/core/src/inference_thread.cpp` (C++): Aunque `normalize_to_shoulders()` sí calcula la distancia 3D ($\sqrt{dx^2 + dy^2 + dz^2}$), carece de `ExtractWindow` (`v1.3.0`) y permanece bloqueado retornando `ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0`.
  3. `inference.py` (Python legacy): Obsoleto desde `FEATURE_SPEC v1.2.2`; sin normalización a hombros.
  4. `geometry.js` (Frontend JS): Normalización por muñeca y `palmScale`, rotación en XY hacia $-Y$ (propósito distinto: reconocimiento geométrico local; posteriormente se añadió `expresat/frontend/src/engine/featureExtractor.js` unificado con Python bajo $L_\infty \le 10^{-6}$).
  5. Antes de [FEATURE_SPEC.md](./FEATURE_SPEC.md), ningún constructor compartía contrato unificado ni suite matemática común.
