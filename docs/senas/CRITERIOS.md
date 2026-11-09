# Auditoría de Criterios Geométricos y Diseño de Extensión para LSM (`docs/senas/CRITERIOS.md`)

## 1. Propósito y Alcance
Este documento constituye el entregable de auditoría técnica (**Paso 0 / Fase A**) en la rama `senas-numeros-alfabeto`. Documenta:
1. Los criterios geométricos, matemáticos y temporales que ya utiliza `expresat/frontend/src/recognition/` para las 9 señas base de la demo (`Mano Abierta`, `Puño`, `Uno`, `Dos`, `OK / Pinza`, `Bien`, `Te Quiero`, `Lunes`, `Hola`).
2. Las limitaciones de dichos criterios cuando se escala el vocabulario a los **números básicos (0–10)** y al **alfabeto dactilológico completo de la Lengua de Señas Mexicana (LSM)**.
3. El diseño matemático exacto para resolver las 6 limitaciones arquitectónicas sin romper la compatibilidad ni las pruebas de regresión de las señas existentes.

---

## 2. Auditoría de Criterios Existentes (`src/recognition/`)

### 2.1 Rechazo de ruido y validación anatómica (`isValidHandLandmarks`)
Ubicación: [`src/recognition/geometry.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L49-L80)

Antes de cualquier cálculo trigonométrico, el clasificador descarta entradas degeneradas o ruidosas mediante cuatro compuertas secuenciales:
1. **Cardinalidad y finitud (`isValidPoint`):** El arreglo debe contener al menos 21 puntos y cada coordenada $(x_i, y_i, z_i)$ para $i \in [0, 20]$ debe cumplir `Number.isFinite(...)`.
2. **Escala de palma válida (`palmScale`):** La distancia euclidiana 3D entre `WRIST (0)` y `MIDDLE_MCP (9)`:
   $$S_{\text{palm}} = \|\mathbf{p}_9 - \mathbf{p}_0\|_3$$
   debe encontrarse en el rango $[0.015, 5.0]$ (cubre el criterio de rechazo $S_{\text{palm}} < 0.02$ con margen para manos lejanas válidas hasta $0.4\times$).
3. **Coherencia radial respecto a la muñeca:** Ningún landmark $i \in [1, 20]$ puede colapsar sobre la muñeca ni dispararse fuera de la anatomía humana:
   $$0.05 \le \frac{\|\mathbf{p}_i - \mathbf{p}_0\|_3}{S_{\text{palm}}} \le 4.2$$
4. **Progresión de nudillos metacarpofalángicos (MCP):** Las distancias entre nudillos adyacentes $(5 \leftrightarrow 9, 9 \leftrightarrow 13, 13 \leftrightarrow 17)$ normalizadas por $S_{\text{palm}}$ no pueden exceder $1.2 \cdot S_{\text{palm}}$.

### 2.2 Normalización espacial (`normalizeHand`)
Ubicación: [`src/recognition/geometry.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L145-L172)

Transforma los 21 puntos crudos $\mathbf{p}_i = (x_i, y_i, z_i)$ al sistema local de la palma $\hat{\mathbf{p}}_i$:
1. **Traslación al origen:** $\mathbf{p}'_i = \mathbf{p}_i - \mathbf{p}_0$, dejando `WRIST (0)` en $(0, 0, 0)$.
2. **Invariancia a escala:** $\mathbf{p}''_i = \mathbf{p}'_i / S_{\text{palm}}$, de modo que $\|\mathbf{p}''_9\| = 1.0$ independientemente de la distancia de la mano a la cámara.
3. **Alineación rotacional en el plano XY:** Calcula el ángulo del eje de la palma $\theta = \text{atan2}(y''_9, x''_9)$ y rota todos los puntos un ángulo $\Delta\theta = -\frac{\pi}{2} - \theta$ en el plano XY para que el vector `WRIST (0) -> MIDDLE_MCP (9)` apunte siempre hacia $(0, -1)$ (arriba en coordenadas de pantalla).

### 2.3 Estado de cada dedo y métricas inter-digitales (`fingerStates`)
Ubicación: [`src/recognition/geometry.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/geometry.js#L180-L351)

1. **Dedos índice, medio, anular y meñique (`evaluateFinger`):**
   - Calcula los ángulos articulares internos en grados:
     - $\theta_{\text{PIP}} = \angle(\text{MCP}, \text{PIP}, \text{DIP})$
     - $\theta_{\text{DIP}} = \angle(\text{PIP}, \text{DIP}, \text{TIP})$
   - Calcula las distancias radiales a la muñeca normalizadas por $S_{\text{palm}}$: $d_{\text{MCP}}, d_{\text{PIP}}, d_{\text{TIP}}$.
   - **Criterio de extensión (`extended`):**
     $$\theta_{\text{PIP}} \ge 135^\circ \;\land\; \theta_{\text{DIP}} \ge 130^\circ \;\land\; d_{\text{TIP}} > 1.08 \cdot d_{\text{PIP}} \;\land\; d_{\text{TIP}} > 1.25 \cdot d_{\text{MCP}}$$
   - **Criterio de flexión (`curled`):**
     $$\theta_{\text{PIP}} < 120^\circ \;\lor\; d_{\text{TIP}} < 1.02 \cdot d_{\text{PIP}}$$
2. **Dedo pulgar (`thumb`):**
   - Evalúa $\theta_{\text{MCP}} = \angle(1, 2, 3) \ge 125^\circ$ y $\theta_{\text{IP}} = \angle(2, 3, 4) \ge 130^\circ$.
   - Exige separación mínima de la punta del pulgar (`4`) respecto a la palma:
     $$d(4, 17) > 0.88, \quad d(4, 9) > 0.62, \quad d(4, 5) > 0.45, \quad d(4, 0) > 0.75$$
   - Excluye el estado de pinza (`!isPinching`).
3. **Relaciones inter-digitales relativas a `palmScale`:**
   - `thumbIndexTipDist`: $d(4, 8)$ en espacio normalizado; activa `isPinching` cuando $d(4, 8) < 0.36$.
   - `thumbIndexAngleDeg`: ángulo 3D entre $\vec{v}_{\text{thumb}} = \hat{\mathbf{p}}_4 - \hat{\mathbf{p}}_1$ y $\vec{v}_{\text{index}} = \hat{\mathbf{p}}_8 - \hat{\mathbf{p}}_5$.
   - `indexMiddleSpread`: distancia normalizada $d(8, 12)$ entre las puntas del índice y el medio.

### 2.4 Suavizado temporal y gestos dinámicos actuales
Ubicación: [`src/recognition/classifier.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/classifier.js#L199-L324)

- **Suavizado por votación (`SmoothingVoter`):** Ventana deslizante de $N = 5$ frames con umbral de consenso `minVotes = 3` ($\lceil 5/2 \rceil$). Devuelve la etiqueta mayoritaria y el promedio de confianza de los frames que votaron por ella.
- **Detección de saludo dinámico (`detectWaveMotion`):** Analiza una ventana de hasta 15 frames buscando $\ge 2$ cambios de dirección en `WRIST.x` cuya semi-amplitud supere $0.12 \cdot \bar{S}_{\text{palm}}$, filtrando fluctuaciones menores a $0.015 \cdot \bar{S}_{\text{palm}}$.

### 2.5 Pruebas sintéticas e invariancia (`syntheticHand.js` y `recognition.test.js`)
Ubicación: [`src/recognition/syntheticHand.js`](file:///home/adrian/Proyectos/expresat/expresat/frontend/src/recognition/syntheticHand.js#L1-L204)

- Generador determinista `buildSyntheticHand` con presets para las 8 posturas estáticas base.
- Verificación unitaria de invariancia bajo escalas $0.4\times \text{ a } 3.0\times$, rotaciones en el plano XY de $-90^\circ \text{ a } 180^\circ$, secuencias dinámicas para `Hola` y rechazo de ruido aleatorio, `NaN` o manos colapsadas.

---

## 3. Limitaciones Detectadas para el Alfabeto y Números de LSM y su Solución

Al contrastar los criterios de la Sección 2 con el alfabeto dactilológico de LSM (`expresat/frontend-legacy/assets/señas/imagenes_abecedario/*.png`) y los números de LSM (*Manos con Voz: Diccionario de Lengua de Señas Mexicana*, CONAPRED/SEP), aparecen **6 limitaciones estructurales** que resolvemos explícitamente en la capa `src/recognition/`:

### Limitación 1: Pérdida de la orientación 2D al normalizar la rotación en el plano XY
- **Problema:** `normalizeHand` alinea siempre `WRIST (0) -> MIDDLE_MCP (9)` con el eje $-Y$ $(-90^\circ)$. Esto es ideal para señas invariantes a la rotación, pero colapsa señas de LSM que tienen **la misma configuración interna de dedos** y solo se distinguen por la orientación de la mano en cámara:
  - `L` (mano apuntando hacia arriba, índice vertical) vs. `G` (mano apuntando horizontalmente de lado, índice horizontal) vs. `7` (inclinada diagonalmente).
  - `U` (índice y medio juntos apuntando hacia arriba) vs. `H` (índice y medio juntos apuntando horizontalmente de lado) vs. `N` (índice y medio juntos apuntando hacia abajo).
  - `W` / `3` (índice, medio y anular apuntando hacia arriba) vs. `M` (índice, medio y anular apuntando hacia abajo).
- **Solución:**
  Antes de aplicar la rotación XY en `normalizeHand`, calculamos y conservamos la orientación original del eje de la palma en el plano de la imagen:
  $$\theta_{\text{palm}} = \text{atan2}(y_9 - y_0,\; x_9 - x_0) \cdot \frac{180}{\pi} \in (-180^\circ, 180^\circ]$$
  (En coordenadas de imagen donde $+Y$ apunta hacia abajo: mano hacia arriba $\approx -90^\circ$, mano hacia abajo $\approx +90^\circ$, mano horizontal hacia la izquierda $\approx \pm 180^\circ$, mano horizontal hacia la derecha $\approx 0^\circ$).
  Definimos la dirección cardinal invariante a mano izquierda/derecha:
  - `UP`: $\theta_{\text{palm}} \in [-135^\circ, -45^\circ]$
  - `DOWN`: $\theta_{\text{palm}} \in [45^\circ, 135^\circ]$
  - `HORIZONTAL`: $|\theta_{\text{palm}}| < 45^\circ \;\lor\; |\theta_{\text{palm}}| > 135^\circ$
  - **Regla de no regresión:** Las señas cuyo significado no depende de la orientación declaran `orientation: 'ANY'` (peso 0 en orientación), preservando el 100% de su invariancia rotacional de $-90^\circ \text{ a } 180^\circ$. Solo las señas que fonológicamente exigen orientación en LSM (`G`, `H`, `M`, `N`, `Ñ`, `P`, `Q`, `Y`, `7`) evalúan $\theta_{\text{palm}}$.

### Limitación 2: Palma al frente vs. dorso al frente (`palmFacing`)
- **Problema:** En LSM varias señas comparten silueta 2D pero difieren en si muestran la palma o el dorso hacia la cámara:
  - `A` / `Bien` (palma al frente/lado) vs. `6` en LSM (puño con pulgar arriba mostrando el dorso al frente / palma hacia el señante).
  - `B` / `4` (palma al frente) vs. `9` en LSM (palma hacia el señante / dorso al frente).
  - `U` / `L` (palma al frente) vs. `H` / `G` / `M` / `N` (dorso al frente).
- **Solución:**
  Calculamos los dos vectores coplanares de la palma desde la muñeca en coordenadas escaladas (sin rotar o rotadas en XY, ya que la componente $Z$ del producto cruzado es invariante a rotaciones 2D en el plano XY):
  $$\vec{u} = \mathbf{p}_5 - \mathbf{p}_0 \quad (\text{WRIST} \to \text{INDEX\_MCP}), \qquad \vec{v} = \mathbf{p}_{17} - \mathbf{p}_0 \quad (\text{WRIST} \to \text{PINKY\_MCP})$$
  La componente longitudinal del producto cruzado es:
  $$c_z = u_x v_y - u_y v_x$$
  En las coordenadas normalizadas por `normalizeHand` (donde el eje palma apunta a $-Y$), el orden relativo de `INDEX_MCP (5)` y `PINKY_MCP (17)` sobre el eje $X$ depende únicamente de si la vista corresponde a una palma derecha/izquierda de frente o de dorso:
  - Si se conoce `handedness` (`'Right'` o `'Left'` habiendo descontado el espejo), el signo de $c_z$ determina directamente `FRONT` (palma a cámara) vs. `BACK` (dorso a cámara).
  - Cuando no se recibe `handedness` explícito (p. ej. cuando se invoca `classify(landmarks)` con solo los 21 puntos), se combina la relación geométrica del pulgar ($\hat{x}_1, \hat{x}_4$ respecto a $\hat{x}_5, \hat{x}_{17}$) con la inclinación de los nudillos para estimar `palmFacing: 'FRONT' | 'BACK' | 'SIDE'`.

### Limitación 3: Simetría mano izquierda / derecha y video espejado
- **Problema:** La etiqueta `handedness` de MediaPipe se invierte cuando el video se procesa espejado, y además un usuario zurdo o diestro debe poder ejecutar cualquier seña con cualquiera de las dos manos. En `normalizeHand`, una mano cuya muñeca-medio apunta a $-Y$ tendrá `INDEX_MCP.x < 0` y `PINKY_MCP.x > 0` en una configuración (p. ej. palma derecha vista en espejo), pero tendrá los signos de $X$ invertidos (`INDEX_MCP.x > 0` y `PINKY_MCP.x < 0`) con la otra mano o al mostrar el dorso.
- **Solución (Sistema Canónico Quiral):**
  En `extractFeatures(landmarks)`, definimos el signo anatómico radial-ulnar:
  $$s_{\text{chirality}} = \text{sign}(\hat{x}_{17} - \hat{x}_5) \in \{-1, +1\}$$
  y proyectamos todas las coordenadas laterales normalizadas como:
  $$\tilde{x}_i = s_{\text{chirality}} \cdot \hat{x}_i$$
  En este sistema canónico $(\tilde{x}_i, \hat{y}_i, \hat{z}_i)$:
  - El lado radial (índice, landmark 5) **siempre** tiene $\tilde{x}_5 < 0$.
  - El lado ulnar (meñique, landmark 17) **siempre** tiene $\tilde{x}_{17} > 0$.
  - Todas las reglas de posición del pulgar (al costado en `A`, cruzado en `S`, entre índice y medio en `T`, cruzado en palma en `B`) y de cruce de dedos (`R`) son **100% idénticas para mano izquierda y mano derecha**, con o sin espejo de cámara.

### Limitación 4: Estados intermedios de flexión y contactos inter-digitales
- **Problema:** Con solo booleanos `extended` y `curled`, letras como `C` (dedos arqueados), `E` (dedos en garra alta), `O` / `0` (todos los dedos cerrando en círculo con el pulgar), `D` (índice arriba + medio tocando pulgar), `F` (índice tocando pulgar + 3 dedos juntos arriba), `R` (índice y medio cruzados), `A`/`S`/`T` (variantes de puño según posición del pulgar) y `P`/`K` (medio semi-extendido/inclinado con pulgar entre índice y medio) no pueden separarse.
- **Solución:**
  Extendemos `fingerStates` con descriptores continuos normalizados por `palmScale`:
  1. **Estado tri-valuado y continuo por dedo (`state: 'EXTENDED' | 'HOOKED' | 'CURLED'`):**
     - `EXTENDED`: $\theta_{\text{PIP}} \ge 135^\circ \land \theta_{\text{DIP}} \ge 130^\circ \land d_{\text{TIP}} > 1.08 d_{\text{PIP}}$.
     - `HOOKED` (arqueado/garra, clave para `C`, `E`, `O`, `Q`, `X`): $75^\circ \le \theta_{\text{PIP}} < 145^\circ$ y la punta no está hundida contra la base de la palma ($d_{\text{TIP}} \ge 0.85 \cdot d_{\text{MCP}}$).
     - `CURLED` (cerrado en puño): $\theta_{\text{PIP}} < 115^\circ$ y $d_{\text{TIP}} < 1.02 \cdot d_{\text{PIP}}$.
  2. **Distancias de contacto pulgar-dedos (en unidades de `palmScale`):**
     - $d_{4,8} = \|\hat{\mathbf{p}}_4 - \hat{\mathbf{p}}_8\|$ (contacto pulgar-índice: `F`, `O`, `0`, `OK`)
     - $d_{4,12} = \|\hat{\mathbf{p}}_4 - \hat{\mathbf{p}}_{12}\|$ (contacto pulgar-medio: `D`, `O`, `0`, `P`, `K`)
     - $d_{4,16} = \|\hat{\mathbf{p}}_4 - \hat{\mathbf{p}}_{16}\|$ (contacto pulgar-anular: `O`, `0`)
     - $d_{4,20} = \|\hat{\mathbf{p}}_4 - \hat{\mathbf{p}}_{20}\|$ (contacto pulgar-meñique)
  3. **Geometría fina del pulgar en puños (`A`, `S`, `T`, `E`) y en `P`/`K`:**
     - $\tilde{x}_4$: posición lateral canónica de la punta del pulgar respecto a `INDEX_MCP` ($\tilde{x}_5 \approx -0.32$), `MIDDLE_MCP` ($\tilde{x}_9 = 0$) y `RING_MCP` ($\tilde{x}_{13} \approx +0.30$).
       - En `A`: el pulgar está extendido/recto al costado radial ($\tilde{x}_4 < \tilde{x}_5 - 0.03$, $\hat{y}_4 < -0.75$).
       - En `S`: el pulgar se dobla cruzando frente a los dedos cerrados ($\tilde{x}_4 \in [\tilde{x}_5, \tilde{x}_{13}]$, $\theta_{\text{IP}} < 135^\circ$, $\hat{y}_4 \in [-0.85, -0.45]$).
       - En `T`: la punta del pulgar se inserta entre las falanges proximales del índice y el medio ($\tilde{x}_4 \in [\tilde{x}_5 + 0.04, \tilde{x}_9 + 0.04]$ y distancia pequeña al punto medio entre `INDEX_PIP (6)` y `MIDDLE_PIP (10)`).
  4. **Separación y cruce entre dedos largos (`U` vs. `V` vs. `R`, `B` vs. `4`, `F` vs. `OK`):**
     - `indexMiddleSpread` $= \|\hat{\mathbf{p}}_8 - \hat{\mathbf{p}}_{12}\|_{2D}$.
     - `indexMiddleCrossDeltaX` $= \tilde{x}_8 - \tilde{x}_{12}$:
       - En posición anatómica normal (`V`), el índice está en el lado radial ($\tilde{x}_8 < \tilde{x}_{12}$, por lo que $\Delta\tilde{x} < -0.18$).
       - En `U` (dedos paralelos y juntos), $|\Delta\tilde{x}| \in [0.06, 0.17]$ y `indexMiddleSpread` $< 0.20$.
       - En `R` (dedos índice y medio cruzados/superpuestos), las puntas convergen o invierten su orden lateral ($\Delta\tilde{x} > -0.05$ o distancia entre segmentos `6->8` y `10->12` $< 0.09$).
     - `fourFingersSpread` $= d_{2D}(8, 12) + d_{2D}(12, 16) + d_{2D}(16, 20)$: separa `B` (dedos juntos/aducidos, suma $< 0.52$) de `4` (dedos abiertos en abanico, suma $\ge 0.52$).

### Limitación 5: Ventanas temporales en milisegundos para FPS variable (15–30 FPS)
- **Problema:** El clasificador actual guarda `bufferSize = 15` frames sin timestamp. A 15 FPS eso equivale a $1000\text{ ms}$, mientras que a 30 FPS equivale a $500\text{ ms}$, alterando la velocidad aparente de gestos dinámicos (`J`, `Z`, `Ñ`, `Q`, `X`, `K`, `LL`, `RR`, `10`, `Hola`).
- **Solución:**
  1. Cada entrada del buffer temporal almacena `{ landmarks, timestampMs }`. Si el llamador no proporciona `timestampMs` (p. ej. en pruebas por lotes `predict([f0, f1, ...])`), se asigna un paso sintético uniforme $\Delta t = 1000 / \text{assumedFps}$ (por defecto $33.3\text{ ms} \equiv 30\text{ FPS}$, configurable).
  2. La ventana activa de evaluación dinámica se recorta por tiempo: últimos `windowMs = 750 ms` (configurable por seña entre `450 ms` y `1000 ms`), exigiendo un mínimo de 5 muestras válidas dentro de la ventana.
  3. **Normalización y comparación de trayectorias:**
     - Se extrae la serie temporal del landmark clave de la seña (p. ej. `INDEX_TIP (8)` para `Z` y `X`, `PINKY_TIP (20)` para `J`, `WRIST (0)` o `INDEX_TIP (8)` para `Ñ`, `Q`, `Hola`), dividida por el promedio $\bar{S}_{\text{palm}}$ de la ventana.
     - Se remuestrea linealmente en el tiempo a $M = 16$ puntos equidistantes $\{\mathbf{q}_0, \dots, \mathbf{q}_{15}\}$.
     - Para gestos de **trazo geométrico** (`J`, `Z`), la trayectoria centrada y escalada por su longitud de arco total ($L_{\text{path}} \ge L_{\min}$ en unidades de `palmScale`) se compara punto a punto contra la plantilla canónica $\{\mathbf{t}_0, \dots, \mathbf{t}_{15}\}$ (y su versión espejada en $X$), obteniendo una puntuación continua $s_{\text{traj}} = \max(0, 1 - \text{RMSE} / \tau)$.
     - Para gestos **oscilatorios o de desplazamiento** (`Ñ`, `Q`, `X`, `K`, `LL`, `RR`, `10`, `Hola`), se evalúan amplitud acumulada normalizada por `palmScale`, eje dominante ($\Delta X$, $\Delta Y$ o cambio de orientación/normal de palma en `10`) y número de cambios de dirección dentro de `windowMs`.

### Limitación 6: Ruido de la coordenada `z` en MediaPipe monocular
- **Problema:** En `HandLandmarker` sobre webcam 2D, la coordenada `z` (profundidad relativa a la muñeca) presenta un error ~3–4 veces mayor que $(x, y)$.
- **Solución:**
  - Todas las distancias de contacto y separación entre dedos se evalúan con métrica 2D amortiguada en $Z$:
    $$d_{\text{rob}}(\mathbf{a}, \mathbf{b}) = \sqrt{(a_x - b_x)^2 + (a_y - b_y)^2 + (\alpha_z (a_z - b_z))^2}, \qquad \alpha_z = 0.35$$
  - En el matcher declarativo, ninguna característica basada exclusivamente en `z` puede tener un peso mayor a `0.15` del score total de la seña, y solo se emplea cuando la seña lo requiere (p. ej. inclinación hacia adelante del dedo medio en `P`/`K` o desempate de profundidad).

---

## 4. Grupos Confundibles y Criterios Explícitos de Desempate

El matcher declarativo agrupa las señas en **7 grupos confundibles (`grupoConfundible`)**. Cuando dos o más candidatas del mismo grupo superan el umbral preliminar, se ejecuta la función de desempate específica del grupo:

| Grupo Confundible | Señas en el Grupo | Rasgo Compartido | Criterio Determinista de Desempate |
| :--- | :--- | :--- | :--- |
| **`G1_PUNO_CERRADO`** | `Puño`, `A`, `S`, `T`, `E`, `O`, `0` | Los 4 dedos largos no están completamente extendidos (`extendedCount <= 1`) | 1. **Círculo cerrado (`O` / `0`):** Dedos en estado `HOOKED` con puntas de índice y medio tocando la punta del pulgar ($d_{4,8} < 0.34 \land d_{4,12} < 0.38$).<br>2. **Garra alta (`E`):** 4 dedos en estado `HOOKED` ($\theta_{\text{PIP}} \in [75^\circ, 135^\circ]$) con puntas altas sobre la palma ($\hat{y}_{\text{TIP}} < -1.05$) y separadas del pulgar ($d_{4,8} \ge 0.35$, pulgar doblado abajo $\hat{y}_4 > -0.72$).<br>3. **Pulgar al costado (`A`):** 4 dedos `CURLED` ($\theta_{\text{PIP}} < 110^\circ$) y pulgar recto adyacente al costado radial del índice ($\tilde{x}_4 < \tilde{x}_5 - 0.02$, $\theta_{\text{IP}} \ge 130^\circ$, $\hat{y}_4 < -0.72$).<br>4. **Pulgar entre índice y medio (`T`):** 4 dedos `CURLED`, punta del pulgar ubicada entre los ejes del índice y el medio ($\tilde{x}_4 \in [\tilde{x}_5 + 0.04, \tilde{x}_9 + 0.05]$ y distancia al punto medio de `PIP_6` y `PIP_10` $< 0.25$).<br>5. **Pulgar cruzado frente al puño (`S`):** 4 dedos `CURLED`, pulgar flexionado ($\theta_{\text{IP}} < 130^\circ$) cruzando sobre las falanges medias ($\tilde{x}_4 \in [\tilde{x}_9 - 0.05, \tilde{x}_{13} + 0.08]$, $\hat{y}_4 \in [-0.85, -0.48]$). |
| **`G2_INDICE_SOLO`** | `Uno`, `1`, `D`, `X`, `Z` | Dedo índice protagonista; anular y meñique cerrados | 1. **Movimiento en Z (`Z`):** Índice extendido + trayectoria 2D de `INDEX_TIP` que ajusta a la plantilla en zig-zag `Z` ($L_{\text{path}} \ge 0.85 \cdot S_{\text{palm}}$).<br>2. **Gancho con vaivén (`X`):** Índice en estado `HOOKED` ($\theta_{\text{PIP}} \in [70^\circ, 130^\circ]$) con mano horizontal/oblicua y oscilación de tracción.<br>3. **Letra `D` vs. `1`/`Uno`:** En `D`, la punta del dedo medio (en flexión parcial) toca la punta del pulgar ($d_{4,12} < 0.32$) mientras el índice apunta recto arriba; en `1`/`Uno`, el dedo medio está completamente plegado en la palma junto con anular y meñique y el pulgar los cubre ($d_{4,12} \ge 0.34$). |
| **`G3_PULGAR_INDICE`** | `Lunes`, `L`, `LL`, `G`, `7`, `Q` | Pulgar e índice activos; medio, anular y meñique cerrados | 1. **Dinámicas (`LL`, `Q`):** `LL` exige postura `L` vertical (`UP`) con traslación/oscilación lateral; `Q` exige orientación hacia abajo (`DOWN`), índice y pulgar arqueados (`HOOKED`) y oscilación lateral de muñeca.<br>2. **Orientación espacial (`L` vs. `G` vs. `7`):** `L` (y `Lunes`) tiene orientación vertical `UP` ($\theta_{\text{palm}} \in [-135^\circ, -45^\circ]$) y palma `FRONT` con ángulo $\angle(\text{pulgar}, \text{índice}) \in [55^\circ, 130^\circ]$; `G` tiene orientación `HORIZONTAL` ($|\theta_{\text{palm}}| < 35^\circ \lor > 145^\circ$) y dorso `BACK`; `7` tiene orientación oblicua diagonal ($\theta_{\text{palm}} \in [-165^\circ, -125^\circ] \lor [-55^\circ, -15^\circ]$) con dorso `BACK` y pulgar-índice más paralelos ($\angle < 60^\circ$). |
| **`G4_DOS_DEDOS`** | `Dos`, `2`, `V`, `U`, `R`, `RR`, `H`, `N`, `Ñ`, `K`, `P` | Índice y medio activos; anular y meñique cerrados | 1. **Orientación hacia abajo (`N` vs. `Ñ`):** Si $\theta_{\text{palm}} \in \text{DOWN}$ ($[45^\circ, 135^\circ]$) y dorso `BACK`: sin oscilación lateral es `N`; con oscilación lateral es `Ñ`.<br>2. **Orientación horizontal (`H`):** Si $\theta_{\text{palm}} \in \text{HORIZONTAL}$ y dedos juntos (`indexMiddleSpread` $< 0.24$), es `H`.<br>3. **Orientación vertical (`U`, `V`/`2`, `R`/`RR`, `P`/`K`):**<br>   - **`P` vs. `K`:** El dedo índice está extendido ($\theta_{\text{PIP},8} \ge 145^\circ$), el dedo medio está semi-inclinado ($\theta_{\text{MCP/PIP},12}$ menor que el del índice en $\ge 15^\circ$) y la punta del pulgar se apoya entre la base del índice y del medio ($d(4, \text{mid}(6, 10)) < 0.28$). Si es estática es `P`; si presenta movimiento vertical ascendente ($\Delta Y$ en ventana) es `K`.<br>   - **`R` vs. `RR`:** Índice y medio cruzados ($\Delta\tilde{x}_{8,12} > -0.05$ o distancia entre falanges $< 0.09$). Estática es `R`; con desplazamiento lateral es `RR`.<br>   - **`U` vs. `V` / `2`:** En `U` los dedos están paralelos y unidos (`indexMiddleSpread` $< 0.21$); en `V` / `2` están abiertos en tijera (`indexMiddleSpread` $\ge 0.21$). |
| **`G5_TRES_DEDOS`** | `3`, `W`, `M`, `F`, `OK / Pinza`, `8` | Tres dedos extendidos | 1. **Pinza índice-pulgar con 3 dedos arriba (`F` vs. `OK / Pinza`):** En ambos $d_{4,8} < 0.36$ y medio, anular y meñique están extendidos. Se desempatan por la **adución de los 3 dedos extendidos**: en `F` (según `f.png`) medio, anular y meñique están **juntos y pegados** ($d_{2D}(12,16) + d_{2D}(16,20) < 0.38$); en `OK / Pinza` están abiertos en abanico ($\ge 0.38$).<br>2. **Orientación hacia abajo (`M`):** Índice, medio y anular extendidos apuntando hacia abajo (`DOWN`, $\theta_{\text{palm}} \in [45^\circ, 135^\circ]$) y juntos.<br>3. **Pulgar + índice + medio con dorso (`8`):** Pulgar, índice y medio extendidos y separados con dorso al frente (`BACK`), anular y meñique cerrados.<br>4. **Índice + medio + anular hacia arriba (`W` / `3`):** Orientación `UP`, índice, medio y anular extendidos en abanico, meñique y pulgar cerrados. |
| **`G6_CUATRO_CINCO`** | `4`, `B`, `9`, `5`, `Mano Abierta`, `C`, `Hola`, `10` | Cuatro o cinco dedos activos | 1. **Arco semicircular (`C`):** Los 4 dedos largos están en estado `HOOKED` ($\theta_{\text{PIP}} \in [90^\circ, 142^\circ]$) y alineados juntos, con el pulgar opuesto formando una abertura $d_{4,8} \in [0.38, 0.88]$.<br>2. **Cinco dedos extendidos (`5` / `Mano Abierta` vs. `Hola` vs. `10`):** Sin movimiento es `Mano Abierta` / `5`; con oscilación lateral de traslación XY es `Hola`; con rotación rápida de muñeca (cambio del vector normal de la palma $\Delta c_z$ o del ángulo axial sin gran traslación) es `10`.<br>3. **Cuatro dedos extendidos y pulgar doblado (`B` vs. `4` vs. `9`):** En `B` los 4 dedos están **juntos/aducidos** (`fourFingersSpread` $< 0.52$) y palma `FRONT`; en `4` los 4 dedos están **separados** (`fourFingersSpread` $\ge 0.52$) y palma `FRONT`; en `9` la palma mira hacia el señante (`BACK`) con los dedos curvándose/cerrando sobre el pulgar. |
| **`G7_MENIQUE_PULGAR`** | `I`, `J`, `Y`, `Bien`, `6`, `Te Quiero` | Extremos radial (pulgar) y/o ulnar (meñique) extendidos | 1. **`Te Quiero` (ILY):** Pulgar + índice + meñique extendidos simultáneamente.<br>2. **Solo meñique (`I` vs. `J`):** Solo el meñique extendido. Si está estático es `I`; si `PINKY_TIP (20)` describe la trayectoria curva descendente-lateral en forma de gancho es `J`.<br>3. **Pulgar + meñique (`Y`):** Pulgar y meñique extendidos, índice/medio/anular cerrados.<br>4. **Solo pulgar (`Bien` vs. `6`):** En `6` (LSM) el puño muestra el dorso a la cámara (`BACK`) con el pulgar apuntando verticalmente hacia arriba; en `Bien` el pulgar está extendido lateral/diagonalmente con palma/perfil. |

---

## 5. Política de Homomorfismos, Compatibilidad Retroactiva y Rechazo (`LOW_CONFIDENCE`)

1. **Compatibilidad 100% con las 9 señas existentes:**
   Algunas configuraciones manuales representan tanto una seña base/letra como un número en LSM (p. ej. `O` $\leftrightarrow$ `0`, `Uno` $\leftrightarrow$ `1`, `Dos` $\leftrightarrow$ `2` $\leftrightarrow$ `V`, `W` $\leftrightarrow$ `3`, `Mano Abierta` $\leftrightarrow$ `5`, `Lunes` $\leftrightarrow$ `L`).
   Para no romper las pruebas de regresión de `rearquitectura-demo` ni ocultar la nueva semántica de números y alfabeto:
   - `GeometricClassifier` acepta una opción `mode: 'all' | 'legacy' | 'alphabet' | 'numbers'` (por defecto `'all'`).
   - Cada resultado devuelto por `predict(frames)` e `index.js` incluye:
     ```js
     {
       label,           // Etiqueta principal ganadora
       category,        // 'letra' | 'numero' | 'basica' | null
       confidence,      // Puntuación en [0, 1]
       details: {
         id,
         category,      // 'letra' | 'numero' | 'basica'
         type,          // 'estatica' | 'dinamica'
         aliases,       // Otras etiquetas equivalentes de la misma configuración (p. ej. ['V', '2', 'Dos'])
         confusableGroup,
         margin,        // Diferencia de score respecto al segundo lugar fuera de sus aliases
         runnerUp,      // Segunda mejor candidata distinta
         reason,        // Explicación legible o 'LOW_CONFIDENCE'
         states,
       }
     }
     ```
2. **Umbral de rechazo estricto (`LOW_CONFIDENCE`):**
   - Si la mejor puntuación $s_1 < \tau_{\min}$ (por defecto $\tau_{\min} = 0.72$) o si el margen frente a la mejor candidata de otra configuración distinta $s_1 - s_2 < \Delta_{\min}$ (por defecto $\Delta_{\min} = 0.06$), el matcher rechaza la predicción y devuelve:
     ```js
     { label: null, category: null, confidence: s1, details: { reason: 'LOW_CONFIDENCE', candidate: bestId, margin: s1 - s2, ... } }
     ```
   - La interfaz `Translator.jsx` muestra explícitamente `"No reconocido"` cuando `label === null` y `reason === 'LOW_CONFIDENCE'`.
