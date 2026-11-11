# Registro de Decisiones de Arquitectura y Gobernanza — Dataset Generator

- **Documento:** `docs/dataset-generator/DECISIONES.md`
- **Última Actualización:** 2026-11-10
- **Rama:** `dataset-v2`
- **Versión de Especificación Vigente:** `FEATURE_SPEC v1.3.0`
- **Versión del Plan Vigente:** `PLAN v2.3.0`
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
5. **Sello Criptográfico (`config_hash`):**
   - Incorpora de forma determinista el digest SHA256 íntegro de `tests/fixtures/feature_spec_cases.json` y los hiperparámetros dimensionales y temporales.
   - Cualquier alteración en las salidas esperadas obliga a incrementar la versión `minor` (ej. de 1.2 a 1.3).

---

## 2. Estado de Compuertas (Gates)

| Compuerta | Estado | Evidencia Demostrada |
|---|---|---|
| **Gate 1A (Paridad Analítica)** | ✅ **SUPERADO** | Conformidad matemática elemento a elemento ($L_\infty \le 10^{-6}$) en Python (`tests/test_feature_spec.py`) y JavaScript (`featureExtractor.test.js`) sobre 13/13 casos de prueba compartidos. |
| **Gate 1B (Arnés Determinista WASM)** | ✅ **SUPERADO (Chromium y Firefox)** | Evaluado en Playwright a 30 FPS con timestamps fijos ($t_i = i \times 33.333\text{ ms}$). Detección 30/30 en manos (630 puntos) y 30/30 en pose (990 puntos) en ambos motores. Ruido máximo medido acotado por $\epsilon \le 1.5 \times 10^{-3}$, 0 discrepancias de categoría. |
| **Gate 1C (Calibración con Toma Real de 18s)** | ⏳ **PENDIENTE DEL USUARIO** | Grabador de desarrollo operativo en la UI tras `import.meta.env.DEV`. Esperando grabación física del usuario para auditar con `inspect_recording.py --segments`. |

---

## 3. Bloqueos Activos y Reglas de No-Avance

> [!CAUTION]
> **REGLA DE GOBERNANZA ABSOLUTA:**
> **NO AVANZAR A LA FASE 2 (SHARDING Y DATA AUGMENTATION OFFLINE) SIN APROBACIÓN EXPLÍCITA Y FORMAL DEL USUARIO.**
> Ningún componente de la Fase 2 debe ser implementado antes de que el usuario grabe su toma física real de 18 segundos, se ejecute la auditoría de segmentos y otorgue su visto bueno final al Gate 1.

1. **Fase 2 Bloqueada:** El script de procesamiento masivo en streaming y sharding permanece bloqueado hasta el visto bueno del usuario.
2. **C++ Bloqueado:** `expresat-native/core/` se declara formalmente como `NO_CONFORME_FEATURE_SPEC_1_3_0`. `InferenceThread::run` y `normalize_to_shoulders` **rechazan activamente** cualquier intento de procesamiento retornando un código de error explícito (`ERR_CPP_NOT_CONFORMANT_FEATURE_SPEC_1_3_0` y `ERR_SHOULDERS_TOO_SMALL`), publicando `valid: false` en `ResultBus` y abortando la ejecución. No se permite procesamiento nativo hasta reimplementar `ExtractWindow` canónico.
3. **Datos Legacy en Cuarentena:** `letra_a_derecha_2.json` es un stub sintético generado artificialmente en noviembre de 2026. Aislado en `dataset/quarantine/`.
4. **Fixture Sintético:** `tests/fixtures/sample_recording_5s.json` es una toma sintética de prueba generada matemáticamente para validar arneses; no constituye una captura de cámara física.
5. **Catálogo Oficial:** 16 clases registradas en `catalog/signs_catalog.json` (15 marcadas como `PENDIENTE_FUENTE` y 1 clase `reposo` capturada físicamente en descanso neutro). Ninguna URL externa se declara verificada sin acceso a red.

---

## 4. Herramientas de Desarrollo Operativas

1. **Grabador Mínimo de Desarrollo (18 s):**
   - Componente React `src/components/DevRecorder.jsx` montado en `Translator.jsx`.
   - Activo exclusivamente cuando `import.meta.env.DEV` es verdadero.
   - Graba 18 s a tasa nativa con `t_ms`, `hands` (con `categoryName` y `score`), `pose` (con `visibility`) y `videoWidth/Height`.
   - Descarga un Blob `.raw.json` para ingesta directa.
2. **Script de Inspección y Segmentos:**
   - `python expresat-dataset-generator/scripts/inspect_recording.py --file <archivo.raw.json> --segments "0-3000:reposo,3000-7000:solo_derecha,7000-11000:solo_izquierda,11000-15000:ambas,15000-18000:cruce"`
   - Audita frame a frame la asignación anatómica, verifica 0 NaNs/Infs y evalúa `ExtractWindow`.
