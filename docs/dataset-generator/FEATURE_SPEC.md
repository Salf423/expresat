# Especificación Canónica del Vector de 178 Características — ExpresaT

- **Versión de la especificación (`feature_spec_version`):** `1.3.0`
- **Estado:** Contrato técnico estricto para modelos reentrenados y generador v2.
- **Ámbito:** Unificación matemática de extracción, filtrado, normalización y asignación anatómica en Python (`backend/`, `models/`) y JavaScript (`frontend/`).
- **Estado de C++ (`expresat-native/`):** **NO CONFORME CON FEATURE_SPEC v1.3.0**. El pipeline nativo C++ no implementa `ExtractWindow`. Por política de seguridad y fidelidad, `InferenceThread` y `normalize_to_shoulders` **rechazan activamente** cualquier intento de procesamiento retornando códigos de error explícitos (`ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0` y `ERR_SHOULDERS_TOO_SMALL`), en lugar de caer en silent zero-filling o truncamientos silenciosos.
- **Invariante del modelo:** Tensor tridimensional de entrada `(1, 15, 178)` en `float32`.

---

## 1. Evidencia Histórica de `letra_a_derecha_2.json` y Aislamiento en Cuarentena

### 1.1 Evidencia del Origen del Archivo Legacy
La inspección de git y del código fuente confirma que `expresat-dataset-generator/dataset/letra_a_derecha_2.json` fue generado de forma puramente sintética:
- **Generador:** `expresat-dataset-generator/src/mediapipe_extractor.cpp` (líneas 78–110, compilado con `EXPRESAT_STUB_EXTRACTOR=1`).
- **Algoritmo productor:** Ondas senoidales sintéticas sobre 33 puntos de pose ($0.5 + 0.15 \cos(t + 0.3i)$) y manos artificiales.
- **Augmentation distorsionador:** `expresat-dataset-generator/src/data_augmenter.cpp` (líneas 103–131, `applyScale` multiplicó uniformemente todos los canales por $[0.90, 1.10]$, provocando que la visibilidad desbordara hasta $1.0201$).
- **Commit:** `3bae2f14365509f9daa1db11b49751e1fb7cdac8` ("Demo"), 5 de noviembre de 2026.
- **Discrepancia geométrica:** Los hombros en ese dataset están en $\approx (\pm 0.0177, 0, 0)$ con distancia inter-humeral $D \approx 0.0459$ (omitió la división por $D$). En un espacio normalizado por hombros, los hombros frontales deben situarse en $(\pm 0.5000, 0, 0)$ con $D = 1.0$.

### 1.2 Declaración de Contrato Nuevo y Aislamiento
1. **Puesta en Cuarentena:** El archivo `letra_a_derecha_2.json` queda aislado en `dataset/quarantine/` y **no debe utilizarse para entrenar nuevos modelos**.
2. **Contrato Nuevo `1.3.0`:** La especificación v1.3.0 rige como contrato obligatorio.
3. **Verificación de Versión en Inferencia:** `InferenceEngine` (`inference_engine.py`) y el pipeline de entrenamiento (`train_and_export.py`) comprueban compatibilidad de versión por `major.minor` (`1.3` compatible con `1.3.0`). Adicionalmente, guardan y verifican el hash criptográfico SHA256 (`config_hash`), el cual incluye la configuración dimensional y el hash SHA256 íntegro de `tests/fixtures/feature_spec_cases.json`. Si no coincide, abortan con `IncompatibleFeatureSpecError`.

---

## 2. Resolución, Aspecto Fijo (640×480, 4:3), Rotación y Augmentation

1. **Resolución y Relación de Aspecto Fijas:**
   - La captura web opera estrictamente a **$640 \times 480$** (relación de aspecto $A = 640/480 = 4/3 \approx 1.333333$).
   - En tiempo de ejecución se comprueba que `videoWidth` y `videoHeight` cumplan $|(W/H) - (4/3)| \le 0.05$. De lo contrario, se rechaza la captura con `ERR_INVALID_ASPECT_RATIO`.
   - Las dimensiones reales de cámara se registran en los metadatos de la toma cruda.
2. **Centro de Rotación Rígida 2D para Data Augmentation:**
   - Toda rotación sintética de augmentation se realiza alrededor del **centro de los hombros** $C = (C_x, C_y)$ del sujeto en el frame original. Esto preserva al firmante en el centro del cuadro y previene derivas espaciales excéntricas.
   - Fórmula con aspecto corregido para un punto $(x, y)$ rotado por un ángulo $\theta$:
     $$x_{\text{rel}} = (x - C_x) \times A, \quad y_{\text{rel}} = y - C_y$$
     $$x_{\text{rot}} = x_{\text{rel}} \cos\theta - y_{\text{rel}} \sin\theta, \quad y_{\text{rot}} = x_{\text{rel}} \sin\theta + y_{\text{rel}} \cos\theta$$
     $$x' = C_x + (x_{\text{rot}} / A), \quad y' = C_y + y_{\text{rot}}$$
3. **Validación de Calidad en Frames Originales:**
   - **Regla inmutable:** Las compuertas de calidad (visibilidad de hombros $\ge 0.40$, hombros dentro del cuadro $[0, 1]$, brechas temporales $\le 100\text{ ms}$) se evalúan **exclusivamente sobre los frames originales crudos**, nunca sobre los frames aumentados. El augmentation es una transformación derivada y no puede ser usado para enmascarar ni descartar tomas crudas.
4. **Espejo en Crudo vs en Features:**
   - En landmarks crudos: inversión horizontal $x \to 1.0 - x$, intercambio de landmarks bilaterales de pose, e inversión de `categoryName` (`'Left'` $\leftrightarrow$ `'Right'`).
   - En features normalizadas: $x' \to -x'$ e intercambio de los bloques izquierdo y derecho.
   - Garantía matemática: $\text{Extract}(\text{Mirror}(\text{raw})) == \text{MirrorFeatures}(\text{Extract}(\text{raw}))$ con error $L_\infty \le 10^{-6}$.

---

## 3. Manifiesto del Detector de Visión

Los detectores MediaPipe Tasks Vision (en CPU) deben inicializarse con los siguientes artefactos y umbrales unificados:

### Modelos y Checksums (SHA256)
- **Detector de Manos:** `public/models/hand_landmarker.task`
  - **SHA256:** `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (7,858,683 bytes)
- **Detector de Pose:** `public/models/pose_landmarker_lite.task`
  - **SHA256:** `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` (5,833,260 bytes)

### Umbrales de Confianza Unificados
- `minHandDetectionConfidence`: `0.50`
- `minHandPresenceConfidence`: `0.50`
- `minTrackingConfidence`: `0.50`
- `minPoseDetectionConfidence`: `0.50`
- `minPosePresenceConfidence`: `0.50`
- `numHands`: `2`, `numPoses`: `1`, `delegate`: `'CPU'`, `runningMode`: `'VIDEO'`.

---

## 4. Composición del Vector y Marcos de Referencia

El vector contiene 178 elementos `float32`:
- `[0..51]` (52D): Upper Pose (13 landmarks $\times$ 4: $x, y, z, \text{visibility}$).
- `[52..114]` (63D): Mano Izquierda (21 landmarks $\times$ 3: $x, y, z$).
- `[115..177]` (63D): Mano Derecha (21 landmarks $\times$ 3: $x, y, z$).

### Normalización Canónica:
1. **Centro de hombros:** $C_x = (P_{11,x} + P_{12,x}) / 2$, $C_y = (P_{11,y} + P_{12,y}) / 2$, $C_z = (P_{11,z} + P_{12,z}) / 2$.
2. **Escala de hombros:** Distancia euclidiana 3D inter-humeral $D = \sqrt{\Delta x^2 + \Delta y^2 + \Delta z^2}$.
3. **Upper Pose (`[0..51]`):**
   $$x' = \frac{x - C_x}{D}, \quad y' = \frac{y - C_y}{D}, \quad z' = \frac{z - C_z}{D}, \quad \text{vis}' = \text{clamp}(\text{vis}, 0.0, 1.0)$$
4. **Manos (`[52..114]` y `[115..177]`):**
   - En el plano $XY$: $x' = (x_{\text{hand}, i} - C_x) / D, \quad y' = (y_{\text{hand}, i} - C_y) / D$.
   - En el eje $Z$: $z' = (z_{\text{hand}, i} - z_{\text{hand}, \text{wrist}}) / D$, donde $z_{\text{wrist}} = z_0$ de esa mano.
   - Si una mano está ausente: **63 ceros exactos (`0.0f`)**.

---

## 5. Algoritmo Canónico `ExtractWindow`: Secuencia Corregida por Bloques

Para evitar distorsiones o cruces fantasmas cuando el detector cambia el orden de las manos entre frames, el orden de operaciones es **estricto, por bloques anatómicos e inmutable**:

```
[Frames crudos de entrada con timestamps t_ms]
                      ↓
1. Validación previa de hombros crudos (P11 y P12 presentes, vis ≥ 0.40, en [0, 1])
   - Verificación de brechas continuas: si gap > 100 ms → ERR_INVALID_FRAME_GAP_TOO_LARGE.
                      ↓
2. Asignación anatómica de manos por frame crudo:
   - Para cada frame crudo se asignan las detecciones a slots anatómicos fijos:
     raw_left_hand (o null) y raw_right_hand (o null), usando costo conjunto con
     término espacial, término de etiqueta y continuidad temporal.
                      ↓
3. Remuestreo temporal por bloque a 15 frames equidistantes (Δt = 66.67 ms):
   - Upper Pose: interpolación lineal 3D de cada landmark.
   - Bloque Mano Izquierda: se interpola si está presente en ambos extremos; si solo en uno,
     se toma del extremo más cercano; si en ninguno, queda ausente (null).
   - Bloque Mano Derecha: remuestreo idéntico e independiente del bloque izquierdo.
                      ↓
4. Cálculo de Escala y Centro por Ventana:
   - D_k = dist3D(P11, P12) para cada frame remuestreado k = 0..14.
   - D_ventana = mediana(D_0..D_14), C_ventana = mediana(C_0..C_14).
   - Validación: Si D_ventana < 0.08 → RECHAZAR con ERR_SHOULDERS_TOO_SMALL.
                      ↓
5. Filtro EMA temporal por bloque (α = 0.50):
   - Upper Pose: suavizado temporal continuo reiniciado en k=0.
   - Bloque Mano Izquierda: si reaparece tras estar ausente, reinicia estado al frame actual;
     mientras permanezca presente, se suaviza con EMA.
   - Bloque Mano Derecha: filtro EMA independiente con idéntica regla de reinicio.
                      ↓
6. Normalización final y Ensamble del Tensor (1, 15, 178) float32:
   - Normalización de Pose y Manos usando C_ventana y D_ventana.
   - Bloques ausentes rellenados con 63 ceros exactos.
```

---

## 6. Algoritmo de Asignación Conjunta con Término de Etiqueta y Continuidad

### 6.1 Costo de Asignación Robusto
Para cada mano detectada $H_i$, se evalúa la asignación a las muñecas de pose $P_{15}$ (izquierda) y $P_{16}$ (derecha):
$$d_{\text{left}}(H_i) = \text{dist2D}(H_{i,0}, P_{15}), \quad d_{\text{right}}(H_i) = \text{dist2D}(H_{i,0}, P_{16})$$

#### Regla de Descarte por Desconexión:
Si $\min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D$, **SOLO se descarta la mano si la visibilidad de la muñeca de pose correspondiente es confiable**:
$$\text{descartar}(H_i) \iff \min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D \;\land\; \text{vis}(P_{\text{cercano}}) \ge 0.50$$
Si $\text{vis}(P_{15}) < 0.50$ o $\text{vis}(P_{16}) < 0.50$, la pose no tiene suficiente confianza para descartar manos por desconexión.

#### Función de Costo Conjunto para 2 Manos ($H_0, H_1$):
$$\text{costo}_A = d_{\text{left}}(H_0) + d_{\text{right}}(H_1) + \text{PenalizaciónEtiqueta}(H_0 \to \text{izq}, H_1 \to \text{der}) + \text{PenalizaciónTemporal}(H_0, H_1)$$
$$\text{costo}_B = d_{\text{left}}(H_1) + d_{\text{right}}(H_0) + \text{PenalizaciónEtiqueta}(H_1 \to \text{izq}, H_0 \to \text{der}) + \text{PenalizaciónTemporal}(H_1, H_0)$$

Donde todas las magnitudes están expresadas en unidades de $D$:
- MediaPipe en frame no espejado entrega:
  - `'Right'` $\to$ mano izquierda del firmante (penalización $+0.25 \cdot D$ si se asigna a mano derecha).
  - `'Left'` $\to$ mano derecha del firmante (penalización $+0.25 \cdot D$ si se asigna a mano izquierda).
- Término de continuidad temporal: penaliza la distancia euclidiana a la muñeca de la mano asignada en el frame previo ($+0.5 \cdot \text{dist2D}(H, H_{\text{prev}})$ en unidades de $D$).

$$\text{costo}_A = d_{\text{left}}(H_0) + d_{\text{right}}(H_1) + \text{PenalizaciónEtiqueta}(0.25 \cdot D) + 0.5 \cdot \text{dist2D}(H, H_{\text{prev}})$$
$$\text{costo}_B = d_{\text{left}}(H_1) + d_{\text{right}}(H_0) + \text{PenalizaciónEtiqueta}(0.25 \cdot D) + 0.5 \cdot \text{dist2D}(H, H_{\text{prev}})$$

#### Registro de Ambigüedad:
Si $|\text{costo}_A - \text{costo}_B| < 0.15 \cdot D$ (manos cruzadas o en el centro del pecho), se incrementa el contador `ambiguous_handedness_count` en el manifiesto de la toma, registrando ambos casos (1 mano y 2 manos).

---

## 7. Brechas Temporales y Tolerancia

- $\text{Brecha} = t_{\text{siguiente\_válido}} - t_{\text{último\_válido}} - \Delta t_{\text{nominal}}$.
- Umbral máximo: **$\le 100\text{ ms}$**.
  - A 15 FPS: 1 frame perdido ($66.7\text{ ms}$) $\implies$ Permitido. $\ge 2$ frames perdidos $\implies$ `ERR_INVALID_FRAME_GAP_TOO_LARGE`.
  - A 30 FPS: hasta 3 frames perdidos ($100\text{ ms}$) $\implies$ Permitido. $\ge 4$ frames perdidos $\implies$ Rechazado.

---

## 8. Modos Declarativos por Clase y Duraciones Unificadas

Todas las tomas del dataset tienen una duración temporal unificada:
- **Duración máxima de toma:** **$2.5\text{ s}$ ($2500\text{ ms}$)**.
- **Margen de captura cruda:** $1.5\text{ s}$ a $2.5\text{ s}$.

| Modo | Definición | Requisito de Segmentación | Criterio de Aceptación |
|---|---|---|---|
| `"estatica"` | Seña en pose fija sin trayectoria (ej. A, B, C... 1, 2, 3...) | El usuario debe **mantener la pose estable durante $\ge 1200\text{ ms}$**. | Varianza posicional articular $< 0.35 \text{ palmScale}/\text{s}$ durante la ventana central de 1000 ms. |
| `"dinamica"` | Seña con trayectoria cinemática (ej. J, Z, "hola", "gracias") | Movimiento con curva de aceleración y desaceleración. | Desplazamiento articular acumulado $\ge 0.15 \times D$ dentro de los 2500 ms. |

---

## 9. Tabla Única de Códigos de Error

| Código de Error | Condición Disparadora | Comportamiento |
|---|---|---|
| `ERR_POSE_MISSING` | `pose == null` o `len(pose) < 23` | Rechazar frame. |
| `ERR_SHOULDER_VISIBILITY` | $\text{vis}(P_{11}) < 0.40 \lor \text{vis}(P_{12}) < 0.40$ | Rechazar frame. |
| `ERR_SHOULDERS_TOO_SMALL` | $D_{\text{ventana}} < 0.08$ | Rechazar frame o ventana. Prohibido recortar con `std::max`. |
| `ERR_OUT_OF_BOUNDS` | Hombros fuera del cuadro ($x, y \notin [0.0, 1.0]$) | Rechazar frame. |
| `ERR_HAND_DISCONNECTED` | $\min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D \land \text{vis}(P_{\text{wrist}}) \ge 0.50$ | Descartar mano espuria. |
| `ERR_INVALID_FRAME_GAP_TOO_LARGE` | Brecha sin tracking $> 100 \text{ ms}$ | Rechazar toma completa. |
| `ERR_INVALID_ASPECT_RATIO` | $|(W/H) - (4/3)| > 0.05$ | Rechazar captura de cámara. |
| `ERR_CPP_NOT_CONFORMANT` | Invocación de inferencia nativa C++ en v1.3.0 | Rechazar ejecución con return de error explícito. |

---

## 10. Fixture Único Compartido, Tolerancia Elemento a Elemento ($L_\infty$) y `config_hash`

Las pruebas de conformidad en todos los lenguajes (Python y JavaScript) deben consumir **obligatoriamente el archivo canónico único**:
`tests/fixtures/feature_spec_cases.json`

### 10.1 Regla de Aceptación Numérica ($L_\infty$):
Para todo vector o tensor generado, la comparación con la salida esperada se evalúa **elemento a elemento** bajo la norma del supremo:
$$\|v_{\text{obtenido}} - v_{\text{esperado}}\|_\infty = \max_{i} |v_{\text{obtenido}, i} - v_{\text{esperado}, i}| \le 10^{-6}$$
Está prohibido evaluar únicamente la diferencia de normas escalares.

### 10.2 Cálculo Canónico de `config_hash`:
El hash de configuración criptográfica se calcula como el digest SHA256 del JSON canónico ordenado que contiene:
1. `feature_spec_version`: `"1.3.0"`
2. Parámetros dimensionales y temporales (`total_features: 178`, `sequence_length: 15`, `target_fps: 15`, `duration_ms: 1000.0`, `shoulders_d_min: 0.08`).
3. Pesos de asignación (`weight_label_penalty: 0.25`, `weight_temporal_continuity: 0.50`).
4. **`fixtures_sha256`:** El hash SHA256 íntegro de `tests/fixtures/feature_spec_cases.json`.

Cualquier cambio en las salidas esperadas o en la formulación matemática modifica `fixtures_sha256`, altera el `config_hash` y obliga a incrementar la versión `minor` (ej. de 1.2 a 1.3).

---

## 11. Esquema Canónico de Tomas Crudas (`.raw.json`) y Auditoría por Segmentos

### 11.1 Esquema de Toma Cruda Generada por el Grabador de Desarrollo:
```json
{
  "version": "1.3.0",
  "type": "expresat_dev_recording_raw",
  "recorded_at": "2026-11-10T20:50:00.000Z",
  "duration_ms": 18000,
  "total_frames": 540,
  "videoWidth": 640,
  "videoHeight": 480,
  "frames": [
    {
      "t_ms": 33.3,
      "videoWidth": 640,
      "videoHeight": 480,
      "hands": [
        {
          "landmarks": [{ "x": 0.45, "y": 0.60, "z": -0.02 }],
          "categoryName": "Left",
          "score": 0.98
        }
      ],
      "pose": [
        { "x": 0.51, "y": 0.35, "z": 0.10, "visibility": 0.99 }
      ]
    }
  ]
}
```

### 11.2 Segmentos Temporales con `--segments` en `inspect_recording.py`:
Permite verificar automáticamente una toma real de calibración dividida por ventanas temporales:
- `reposo`: Sin manos detectadas o manos inactivas.
- `solo_derecha`: Mano derecha física del firmante activa (MediaPipe `Left` -> slot right [115..177] activo, slot left inactivo).
- `solo_izquierda`: Mano izquierda física del firmante activa (MediaPipe `Right` -> slot left [52..114] activo, slot right inactivo).
- `ambas`: Ambas manos activas en sus respectivos slots anatómicos sin ambigüedad.
- `cruce`: Ambas manos cruzadas en el centro del pecho (`is_ambiguous == True`).

