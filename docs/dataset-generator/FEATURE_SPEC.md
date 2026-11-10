# Especificación Canónica del Vector de 178 Características — ExpresaT

- **Versión de la especificación (`feature_spec_version`):** `1.2.1`
- **Estado:** Contrato técnico estricto para modelos reentrenados y generador v2
- **Ámbito:** Unificación matemática de extracción, filtrado, normalización y asignación anatómica en Python (`backend/`), C++ (`expresat-native/`) y JavaScript (`frontend/`).
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
2. **Contrato Nuevo `1.2.1`:** La especificación v1.2.1 rige como contrato obligatorio.
3. **Verificación de Versión en Inferencia:** `InferenceEngine` (`inference_engine.py`) y el pipeline de entrenamiento (`train_and_export.py`) comprueban compatibilidad de versión por `major.minor` (`1.2` compatible con `1.2.1`, incompatible con `1.3` o `2.0`). Adicionalmente, guardan y verifican el hash SHA256 de la configuración (`config_hash`) en `model_metadata.json` y `manifest.json`. Si no coincide, abortan con `IncompatibleFeatureSpecError`.

---

## 2. Resolución, Aspecto Fijo (640×480, 4:3) y Rotación Isótropa

1. **Resolución y Relación de Aspecto Fijas:**
   - La captura web opera estrictamente a **$640 \times 480$** (relación de aspecto $A = 640/480 = 4/3 \approx 1.333333$).
   - En tiempo de ejecución se comprueba que `videoWidth` y `videoHeight` cumplan $|(W/H) - (4/3)| \le 0.05$. De lo contrario, se rechaza la captura con `ERR_INVALID_ASPECT_RATIO`.
   - Las dimensiones reales de cámara se registran en los metadatos de la toma cruda.
2. **Rotación Rígida 2D con Aspect Ratio Corregido:**
   - Como las coordenadas normalizadas de MediaPipe $[0, 1]$ cubren $640 \text{ px}$ en $X$ y $480 \text{ px}$ en $Y$, rotar directamente sobre $(x, y)$ distorsiona las proporciones anatómicas (efecto elíptico).
   - Para aplicar una rotación física euclidiana en el plano de la imagen por un ángulo $\theta$:
     $$x_{\text{iso}} = x \times A, \quad y_{\text{iso}} = y$$
     $$x_{\text{rot}} = x_{\text{iso}} \cos\theta - y_{\text{iso}} \sin\theta, \quad y_{\text{rot}} = x_{\text{iso}} \sin\theta + y_{\text{iso}} \cos\theta$$
     $$x' = x_{\text{rot}} / A, \quad y' = y_{\text{rot}}$$

---

## 3. Manifiesto del Detector de Visión

Los detectores MediaPipe Tasks Vision (en CPU) deben inicializarse con los siguientes artefactos y umbrales unificados:

### Modelos y Checksums (SHA256)
- **Detector de Manos:** `public/models/hand_landmarker.task`
  - **SHA256:** `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (7,858,683 bytes)
- **Detector de Pose:** `public/models/pose_landmarker_lite.task`
  - **SHA256:** `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` (5,833,260 bytes)

### Umbrales de Confianza Unificados (Justificación de 0.50)
Se elimina el valor arbitrario de $0.45$ y se fija **$0.50$** (estándar de Google Research) para equilibrar la sensibilidad sin introducir falsos positivos de manos en fondos complejos:
- `minHandDetectionConfidence`: `0.50`
- `minHandPresenceConfidence`: `0.50`
- `minTrackingConfidence`: `0.50`
- `minPoseDetectionConfidence`: `0.50`
- `minPosePresenceConfidence`: `0.50`
- `numHands`: `2`, `numPoses`: `1`, `delegate`: `'CPU'`, `runningMode`: `'VIDEO'`.

---

## 4. Composición del Vector y Marcos de Referencia Coherentes

El vector contiene 178 elementos `float32`:
- `[0..51]` (52D): Upper Pose (13 landmarks $\times$ 4: $x, y, z, \text{visibility}$).
- `[52..114]` (63D): Mano Izquierda (21 landmarks $\times$ 3: $x, y, z$).
- `[115..177]` (63D): Mano Derecha (21 landmarks $\times$ 3: $x, y, z$).

### 4.1 Desacoplamiento Fundamental del Eje Z: Invarianza a Traslación
- **Marco de Pose:** En MediaPipe Pose, $Z_{\text{pose}}$ tiene origen en el punto medio de las caderas y escala métrica de profundidad ligada al torso.
- **Marco de Manos:** En MediaPipe Hands, los landmarks $Z$ son relativos al recorte local de la mano. Para que la propiedad de invarianza a traslación se cumpla estrictamente ($\text{Extract}(P + \delta) == \text{Extract}(P)$):
  $$z'_i = \frac{z_i - z_{\text{muñeca}}}{D}$$
  donde $z_{\text{muñeca}}$ es la coordenada $z$ del Landmark 0 (muñeca) de esa mano.
- **Regla Canónica de Normalización:**
  1. **Centro de hombros:** $C_x = (P_{11,x} + P_{12,x}) / 2$, $C_y = (P_{11,y} + P_{12,y}) / 2$, $C_z = (P_{11,z} + P_{12,z}) / 2$.
  2. **Escala de hombros:** Distancia euclidiana 3D inter-humeral $D = \sqrt{\Delta x^2 + \Delta y^2 + \Delta z^2}$.
  3. **Upper Pose (`[0..51]`):**
     $$x' = \frac{x - C_x}{D}, \quad y' = \frac{y - C_y}{D}, \quad z' = \frac{z - C_z}{D}, \quad \text{vis}' = \text{clamp}(\text{vis}, 0.0, 1.0)$$
  4. **Manos (`[52..114]` y `[115..177]`):**
     - En el plano $XY$, las manos se ubican en el espacio corporal relativo al centro de hombros:
       $$x' = \frac{x_{\text{hand}, i} - C_x}{D}, \quad y' = \frac{y_{\text{hand}, i} - C_y}{D}$$
     - En el eje $Z$, se resta la propia muñeca de la mano y se escala por $D$:
       $$z' = \frac{z_{\text{hand}, i} - z_{\text{hand}, \text{wrist}}}{D}$$
     - **Garantía matemática:** Si el sujeto o la mano se trasladan en $(+\delta_x, +\delta_y, +\delta_z)$, $(z_i + \delta_z) - (z_{\text{wrist}} + \delta_z) = z_i - z_{\text{wrist}}$, preservando la invarianza exacta a traslación 3D.

---

## 5. Algoritmo `ExtractWindow`: Secuencia y Escala Robusta por Ventana

Para una ventana de inferencia o toma de 15 frames temporales, el orden de operaciones es **estricto e inmutable**:

```
[Frames crudos de entrada con timestamps t_ms]
                      ↓
1. Validación previa de hombros crudos (P11 y P12 presentes, vis ≥ 0.40)
                      ↓
2. Remuestreo temporal por milisegundos a 15 frames equidistantes (Δt = 66.67 ms, 1000 ms)
   - Presencia de mano: se interpola solo si está presente en ambos extremos;
     si no, se toma del frame más cercano; si no hay mano, 63 ceros.
   - Brecha inválida máxima: ≤ 100 ms (máx 1 frame aislado a 15 FPS, máx 3 a 30 FPS).
                      ↓
3. Cálculo de Escala y Centro por Ventana:
   - D_ventana = mediana(D_1, D_2, ..., D_15)
   - C_ventana = mediana(C_1, C_2, ..., C_15) para cada componente (x, y, z)
   - Validación: Si D_ventana < 0.08 (umbral provisional) → RECHAZAR con ERR_SHOULDERS_TOO_SMALL
                      ↓
4. Filtro EMA (α = 0.50):
   - Aplicado sobre las coordenadas remuestreadas.
   - Reinicio del filtro al inicio de la ventana.
   - Reinicio inmediato del estado de una mano cuando reaparece.
                      ↓
5. Asignación Anatómica de Manos (por distancia euclidiana 2D a P15/P16 con asignación conjunta)
                      ↓
6. Normalización (usando C_ventana y D_ventana) y Ensamble del Tensor (1, 15, 178)
```

---

## 6. Handedness y Asignación Invariante a Muñecas de Pose

### 6.1 Convención del Frame
- El frame de la cámara entra **NO espejado** al pipeline de MediaPipe.

### 6.2 Algoritmo de Asignación Conjunta (Costo Mínimo)
1. Se calculan las distancias 2D en el plano $XY$ entre la muñeca de la mano detectada ($H_{i,0}$) y las muñecas de pose ($P_{15}$ izquierda, $P_{16}$ derecha):
   $$d_{\text{left}}(H_i) = \text{dist2D}(H_{i,0}, P_{15}), \quad d_{\text{right}}(H_i) = \text{dist2D}(H_{i,0}, P_{16})$$
2. **Rechazo por Desconexión:**
   Si para una mano $\min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D$ (umbral provisional de desconexión corporal), se descarta esa mano como artefacto espurio (`ERR_HAND_DISCONNECTED`).
3. **Asignación Conjunta cuando se Detectan 2 Manos:**
   Se evalúan las dos combinaciones posibles minimizando la distancia euclidiana total:
   $$\text{costo}_A = d_{\text{left}}(H_0) + d_{\text{right}}(H_1)$$
   $$\text{costo}_B = d_{\text{left}}(H_1) + d_{\text{right}}(H_0)$$
   Si $\text{costo}_A \le \text{costo}_B \implies H_0 \to \text{Mano Izquierda}, H_1 \to \text{Mano Derecha}$. De lo contrario, $H_1 \to \text{Mano Izquierda}, H_0 \to \text{Mano Derecha}$.
4. **Desempate por Etiqueta MediaPipe en Casos Ambiguos:**
   Si solo hay 1 mano detectada y $|d_{\text{left}} - d_{\text{right}}| < 0.15 \cdot D$ (manos en el centro del pecho) o si $\text{vis}(P_{15}) < 0.50 \lor \text{vis}(P_{16}) < 0.50$:
   - Se desempata con la etiqueta `categoryName` entregada por MediaPipe en el frame no espejado:
     - MediaPipe `'Left'` $\to$ **Mano Derecha** del firmante (`[115..177]`).
     - MediaPipe `'Right'` $\to$ **Mano Izquierda** del firmante (`[52..114]`).
   - Se incrementa el contador `ambiguous_handedness_count` en el `manifest.json`.

---

## 7. Definición Matemática de "Brecha" y Tolerancia Temporal

### 7.1 Fórmula Canónica de Brecha
Para una secuencia temporal de frames con timestamps $t_1, t_2, \dots, t_N$, la **Brecha Inválida** ($\text{Gap}$) ante una pérdida transitoria de hombros o tracking se define como el tiempo total continuo sin detección válida:
$$\text{Brecha} = t_{\text{siguiente\_válido}} - t_{\text{último\_válido}} - \Delta t_{\text{nominal}}$$
o de manera discreta:
$$\text{Brecha} = K_{\text{perdidos}} \times \Delta t_{\text{nominal}}$$
donde $K_{\text{perdidos}}$ es el número de frames consecutivos con hombros ausentes o inválidos, y $\Delta t_{\text{nominal}} = 1000 / \text{FPS}$.

### 7.2 Regla de Decisión y Ejemplos Numéricos (Tolerancia $\le 100 \text{ ms}$)
- **A 15 FPS ($\Delta t = 66.67 \text{ ms}$):**
  - $1 \text{ frame perdido} = 66.67 \text{ ms} \le 100 \text{ ms} \implies$ **Permitido** (se interpola linealmente).
  - $2 \text{ frames perdidos} = 133.33 \text{ ms} > 100 \text{ ms} \implies$ **Rechazado** (`ERR_INVALID_FRAME_GAP_TOO_LARGE`).
- **A 30 FPS ($\Delta t = 33.33 \text{ ms}$):**
  - $1 \text{ frame} = 33.33 \text{ ms}$, $2 \text{ frames} = 66.67 \text{ ms}$, $3 \text{ frames} = 100.00 \text{ ms} \le 100 \text{ ms} \implies$ **Permitido**.
  - $4 \text{ frames perdidos} = 133.33 \text{ ms} > 100 \text{ ms} \implies$ **Rechazado**.
- **A 60 FPS ($\Delta t = 16.67 \text{ ms}$):**
  - Hasta $6 \text{ frames perdidos} = 100.00 \text{ ms} \le 100 \text{ ms} \implies$ **Permitido**.
  - $7 \text{ frames perdidos} = 116.67 \text{ ms} > 100 \text{ ms} \implies$ **Rechazado**.

---

## 8. Modos Declarativos por Clase y Umbrales Provisionales

El modo no se infiere por categoría gramatical; se declara por clase en el catálogo oficial de LSM (`catalog/signs_catalog.json`):

| Modo | Definición | Criterio de Segmentación | Umbrales Provisionales (a calibrar con piloto) |
|---|---|---|---|
| `"estatica"` | Seña en pose fija sin trayectoria (ej. A, B, C... 1, 2, 3...) | Estabilidad temporal de la mano durante $N \text{ ms}$ ($\ge 600 \text{ ms}$) | Varianza posicional articular $< v_{\text{still}}$ (**Provisional: $0.35 \text{ palmScale}/\text{s}$**) |
| `"dinamica"` | Seña con movimiento o trayectoria (ej. J, Z, "hola", "gracias") | Curva de energía cinética: inicio $> v_{\text{start}}$, pico cinético y desaceleración | Desplazamiento articular acumulado $\ge d_{\text{motion}}$ (**Provisional: $0.15 \times D$**) |

### 8.1 Procedimiento de Calibración de Umbrales Provisionales
Todos los umbrales marcados como provisionales:
- $D_{\text{min}} = 0.08$
- $d_{\text{desconexión}} = 1.75 \cdot D$
- $d_{\text{ambigüedad}} = 0.15 \cdot D$
- $\text{max\_jitter} = 4.0 \text{ palmScale}/\text{s}$
- $\text{max\_gap} = 100 \text{ ms}$
- $v_{\text{still}} = 0.35 \text{ palmScale}/\text{s}$
se ajustarán formalmente ejecutando una **captura piloto de 30 a 50 tomas** con hablantes reales, fijando los umbrales a los percentiles P5 (límites inferiores) y P95 (límites superiores) de las distribuciones empíricas.

---

## 9. Tabla Única de Códigos de Error

| Código de Error | Condición Disparadora | Comportamiento Obligatorio |
|---|---|---|
| `ERR_POSE_MISSING` | `pose == null` o `len(pose) < 23` | **Rechazar frame.** Retornar `valid: false`. |
| `ERR_SHOULDER_VISIBILITY` | $\text{vis}(P_{11}) < 0.40 \lor \text{vis}(P_{12}) < 0.40$ | **Rechazar frame.** Retornar `valid: false`. |
| `ERR_SHOULDERS_TOO_SMALL` | $D_{\text{ventana}} < 0.08$ (provisional) | **Rechazar frame/ventana.** Prohibido recortar con `std::max`. |
| `ERR_OUT_OF_BOUNDS` | Hombros fuera del cuadro ($x, y \notin [0.0, 1.0]$) | **Rechazar frame.** |
| `ERR_HAND_DISCONNECTED` | $\min(d_{\text{left}}, d_{\text{right}}) > 1.75 \cdot D$ (provisional) | Descartar mano como falso positivo. |
| `ERR_MAX_JITTER_EXCEEDED` | Velocidad articular interna $> 4.0 \text{ palmScale}/\text{s}$ (provisional) | Rechazar toma por jitter patológico. |
| `ERR_INVALID_ASPECT_RATIO` | $|(W/H) - (4/3)| > 0.05$ | Rechazar captura de cámara. |
| `ERR_INVALID_FRAME_GAP_TOO_LARGE` | Brecha sin tracking $> 100 \text{ ms}$ (provisional) | Rechazar toma completa. |
| `OK_HAND_MISSING` | Mano izq o der ausente (hombros válidos) | **Válido.** Emitir 63 ceros exactos (`0.0f`). |

---

## 10. Suite de Conformidad y Vectores de Prueba (TC-01 a TC-05)

### Fixture Canónico (Valores exactos en `float64`, muñeca con $Z \ne 0.0$)
- $P_{11}$ (Hombro Izq): $(0.60, 0.40, 0.00, 0.90)$
- $P_{12}$ (Hombro Der): $(0.40, 0.40, 0.00, 0.90)$
- Origen: $C = (0.50, 0.40, 0.00)$, Escala: $D = 0.20$
- $P_0$ (Nariz): $(0.50, 0.20, -0.04, 0.99) \implies x'=0.00, y'=-1.00, z'=-0.20, \text{vis}'=0.99$
- $P_{15}$ (Muñeca Izq Pose): $(0.70, 0.70, 0.05, 0.85) \implies x'=1.00, y'=1.50, z'=0.25, \text{vis}'=0.85$
- $P_{16}$ (Muñeca Der Pose): $(0.30, 0.70, -0.05, 0.85) \implies x'=-1.00, y'=1.50, z'=-0.25, \text{vis}'=0.85$
- **Mano A (Muñeca $z_{\text{wrist}} = 0.05$, Landmark 1 $z_1 = 0.07$):**
  - Muñeca (0): $(0.70, 0.70, 0.05) \implies x'=1.00, y'=1.50, z'=(0.05 - 0.05)/0.20 = \mathbf{0.00}$
  - Landmark 1: $(0.71, 0.71, 0.07) \implies x'=1.05, y'=1.55, z'=(0.07 - 0.05)/0.20 = \mathbf{0.10}$
  - Asignada a Mano Izquierda por cercanía a $P_{15}$.
- **Mano B (Muñeca $z_{\text{wrist}} = -0.05$, Landmark 1 $z_1 = -0.03$):**
  - Muñeca (0): $(0.30, 0.70, -0.05) \implies x'=-1.00, y'=1.50, z'=(-0.05 - (-0.05))/0.20 = \mathbf{0.00}$
  - Landmark 1: $(0.29, 0.71, -0.03) \implies x'=-1.05, y'=1.55, z'=(-0.03 - (-0.05))/0.20 = \mathbf{0.10}$
  - Asignada a Mano Derecha por cercanía a $P_{16}$.

### Casos de Prueba Requeridos

| ID Caso | Condición | Salida Esperada | Tolerancia |
|---|---|---|---|
| **TC-01** | Pose completa + Ambas manos presentes | `[0..3]` = $[0.0, -1.0, -0.2, 0.99]$, `[4..7]` = $[0.5, 0.0, 0.0, 0.9]$, `[8..11]` = $[-0.5, 0.0, 0.0, 0.9]$, `[52..54]` = $[1.0, 1.5, 0.0]$, `[55..57]` = $[1.05, 1.55, 0.10]$, `[115..117]` = $[-1.0, 1.5, 0.0]$, `[118..120]` = $[-1.05, 1.55, 0.10]$ | $|\Delta| \le 10^{-6}$ |
| **TC-02** | Mano izquierda ausente | `[0..51]` pose normalizada. `[52..114]` **estrictamente ceros (63 $\times$ 0.0)**. `[115..177]` mano derecha normalizada | $|\Delta| \le 10^{-6}$ |
| **TC-03** | Pose incompleta (`len(pose) == 20 < 23`) | `valid: false`, `error: "ERR_POSE_MISSING"` | N/A |
| **TC-04** | Hombros demasiado pequeños ($D = 0.05 < 0.08$) | `valid: false`, `error: "ERR_SHOULDERS_TOO_SMALL"` | N/A |
| **TC-05A** | Asignación conjunta óptima de 2 manos | Minimiza costo total euclidiano a $P_{15}$ y $P_{16}$ asignando correctamente | $|\Delta| \le 10^{-6}$ |
| **TC-05B** | 1 mano centrada ($|d_{\text{izq}} - d_{\text{der}}| < 0.15 \cdot D$) | Desempata usando `categoryName` no espejada de MediaPipe | $|\Delta| \le 10^{-6}$ |
| **TC-05C** | Mano flotante desconectada ($d_{\text{min}} > 1.75 \cdot D$) | Se descarta la mano flotante con `ERR_HAND_DISCONNECTED` | N/A |

### Pruebas de Propiedades con Dominio Acotado
1. **Invarianza a Traslación:** Para todo $\delta \in [-0.10, 0.10]^3$ (acotado para evitar `ERR_OUT_OF_BOUNDS`), $\text{Extract}(P + \delta) == \text{Extract}(P)$ con error $\le 10^{-6}$.
2. **Invarianza a Escala:** Para todo factor $s \in [0.80, 1.25]$ (acotado para garantizar $s \cdot D \ge 0.08$), $\text{Extract}(s \cdot P) == \text{Extract}(P)$ con error $\le 10^{-6}$.
3. **Conmutatividad de Espejo:** El operador espejo intercambia landmarks de pose bilaterales, invierte $x \to -x$ e intercambia `categoryName` (`'Left'` $\leftrightarrow$ `'Right'`), cumpliendo:
   $$\text{Extract}(\text{Mirror}(\text{raw})) == \text{MirrorFeatures}(\text{Extract}(\text{raw})) \quad (\text{error} \le 10^{-6})$$
