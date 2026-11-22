# Plan de Corrección de MediaPipe — ExpresaT

- **Fecha de creación:** 2026-11-08
- **Fase original:** 0 — Auditoría completada
- **Estado:** **Histórico / Reemplazado** — Plan inicial de la rama `fix-mediapipe`, posteriormente superado por la eliminación de Workers en `rearquitectura-demo`

> [!NOTE]
> Este plan refleja el análisis previo a la migración hacia el hilo principal. Los archivos `mediapipe-worker.js`, `useMediaPipe.js` y `mediapipeEngine.js` aquí evaluados fueron eliminados en la rearquitectura posterior. Para el diseño vigente, consulta [ARQUITECTURA.md](../ARQUITECTURA.md) y el [índice general](../README.md).

---

## Resumen General

Este plan consolidó los hallazgos iniciales de auditoría en 4 componentes (Frontend, Backend, Generador de Datasets y Escritorio/Nativo) para hacer funcionar el pipeline de MediaPipe de extremo a extremo.

El flujo objetivo evaluado en aquel momento era:

```text
Frontend (cámara + Worker MediaPipe) -> WebSocket /ws/translate -> Backend (inferencia) -> Traducción
                                              ^                                                |
                                       Vector de 178 features <------ consistente en todo el pipeline
```

---

## 1. Cola Priorizada de Correcciones (Histórico)

### Prioridad 1 — Crítica (bloqueaba funcionalidad básica)

| # | Componente | Problema | Causa Raíz | Corrección Propuesta | Criterio de Aceptación |
|---|---|---|---|---|---|
| 1 | Frontend (`Translator.jsx`) | `ReferenceError: isDemo is not defined` | El efecto de `/health` no inicializaba `isDemo` si faltaba `demo_mode`; `ErrorBoundary` capturaba el error en render. | Asegurar valor inicial definido (`false`) para `isDemo` y manejar ausencia de `demo_mode`. | `Translator` renderiza sin `ErrorBoundary`; `isDemo` siempre es booleano. |
| 2 | Backend (`main.py`) | Verificación de token comentada | `verify_supabase_token()` retornaba `None` para todo token en producción (bloque comentado). | Descomentar verificación en producción e inicializar cliente de Supabase. | `/ws/translate` acepta tokens válidos y rechaza inválidos con motivo claro. |
| 3 | Backend (`main.py`) | Error tipográfico en origen CORS | `CORS_ORIGINS_DEFAULT` contenía `"https://ecpresatt.netlify.app"` en lugar de `"https://expresat.netlify.app"`. | Corregir origen permitido en `CORS_ORIGINS_DEFAULT`. | Solicitudes desde el dominio correcto en Netlify son aceptadas. |
| 4 | Frontend (`useMediaPipe.js` + Worker) | `FPS = 0` — bucle de detección no iniciaba | El Worker fallaba al inicializar (WASM 404, fallo de CDN de modelos); el watchdog forzaba `FPS = 0` tras 2 s. | Alinear versiones WASM/CDN, agregar fallback y mostrar error visible si fallan los modelos. | El contador FPS muestra `> 0` con señal de cámara activa. |

### Prioridad 2 — Alta (degradaba severamente la experiencia)

| # | Componente | Problema | Causa Raíz | Corrección Propuesta | Criterio de Aceptación |
|---|---|---|---|---|---|
| 5 | Frontend (`apiService.js`) | WebSocket 403 / rechazo de token u origen | Combinación de CORS, ausencia de token válido en producción o rechazo total de tokens en backend. | Alinear flujo de auth: enviar token válido o permitir sesión demo pública cuando aplique. | WebSocket conecta mostrando `"Conectado"` en lugar de `"Desconectado"`. |
| 6 | Frontend (`mediapipeEngine.js`) | Sin respaldo visible si fallaba WASM/modelos | `initialize()` solo registraba el error en consola dejando la inferencia deshabilitada en silencio. | Mostrar aviso claro en UI y lógica de respaldo/degradación. | El usuario ve un mensaje claro si MediaPipe falla y conserva el video. |
| 7 | Dataset Generator (`mediapipe_extractor.cpp`) | MediaPipe real no enlazado; modo stub activo | Macros `EXPRESAT_USE_MEDIAPIPE` y `EXPRESAT_STUB_EXTRACTOR` no configuradas para modo real. | Configurar build con MediaPipe o documentar formalmente el modo stub. | Compila con MediaPipe real o documenta el estado stub vigente. |
| 8 | Nativo / Desktop (`inference_thread.cpp`) | `extract_landmarks()` es un stub | Comentario `TODO`; retorna `LandmarkFrame` vacío sin leer frames reales. | Integrar MediaPipe Tasks C++ o puente equivalente con frames reales. | ONNX recibe tensores 178D válidos desde cámara real. |

### Prioridad 3 — Media (robustez y compatibilidad)

| # | Componente | Problema | Causa Raíz | Corrección Propuesta | Criterio de Aceptación |
|---|---|---|---|---|---|
| 9 | Frontend (`useMediaPipe.js`) | Watchdog de FPS reinicia a 0 tras 2 s | `fpsWatchdogRef` ponía FPS a 0 tras 2 s sin resultados. | Ampliar timeout o condicionar al estado de sesión activa. | No cae a 0 abruptamente ante jitters puntuales. |
| 10 | Frontend (`apiService.js`) | `/health` consultado solo una vez al conectar | `fetch(healthUrl)` único sin reintentos. | Añadir backoff exponencial para cold-starts del backend. | Cold-starts detectados sin dejar estado offline permanente. |
| 11 | Todos los componentes | Desalineación potencial del vector 178D | `buildPayload()`, `run_inference_async()` y `extract()` deben coincidir en `52 + 63 + 63`. | Fijar constantes de versión y validar el contrato 178D. | Todos los componentes producen/consumen la misma topología 178D. |
| 12 | Frontend (`mediapipe-worker.js`) | Delegado GPU puede no estar disponible | Ambos landmarkers pedían `delegate: 'GPU'` sin fallback a CPU. | Envolver con fallback `GPU -> CPU`. | Funciona incluso en navegadores/GPUs sin WebGL estable. |
| 13 | Frontend (`Translator.jsx`) | Lógica compleja de `usingDemoToken` / `authWarning` | Múltiples rutas de estado ambiguas y envío de `demo_fallback_token`. | Simplificar a conexión sin token falso y advertencia clara en UI. | Estado predecible sin tokens de prueba cableados. |

### Prioridad 4 — Baja (pulido y mejoras menores)

| # | Componente | Problema | Causa Raíz | Corrección Propuesta | Criterio de Aceptación |
|---|---|---|---|---|---|
| 14 | Frontend (`landmarkTracker.js`) | Uso de `seq.empty` no estándar en JS | `validateSequence()` usaba `seq.empty` (inexistente en `Array`). | Sustituir por `seq.length === 0`. | Validación de arreglos correcta. |
| 15 | Frontend (`mediapipe-worker.js`) | Riesgo de desajuste de versión WASM | `WASM_URL` fijado manualmente a `@1.0.1`. | Mantener sincronizado con `package.json`. | Versión WASM coincidente con el paquete instalado. |
| 16 | Dataset Generator (`types.h`) | Campos de landmark frente a API C++ | Pendiente verificar compatibilidad exacta de campos al enlazar MediaPipe C++. | Verificar `x, y, z, visibility` antes de quitar el stub. | Compila sin errores al enlazar API real. |
| 17 | Todos los componentes | Sin selector en runtime entre stub y MediaPipe real | Selección solo por compilación/instanciación fija. | Añadir flag de configuración o entorno. | Cambio limpio de modo sin recompilar. |
| 18 | Frontend (`useMediaPipe.js`) | `requestVideoFrameCallback` no universal | Ausencia de feature-detection y respaldo en navegadores sin soporte. | Implementar respaldo basado en `rAF`/`setInterval`. | Compatible en navegadores sin `rVFC`. |

---

## 2. Dependencias entre Correcciones

```text
[Fix 3: Typo CORS] -> [Fix 5: WebSocket 403] -> [Fix 1: isDemo en UI]
         |
[Fix 2: Verificación JWT] -> [Fix 5: WebSocket 403] -> [Fix 1: isDemo en UI]
         |
[Fix 4: Worker WASM/modelos] -> [Fix 6: Respaldo sin modelos] -> [FPS > 0]
         |
[Fix 7: Generador MediaPipe] -> [Fix 8: extract_landmarks() desktop] -> [Pipeline 178D]
         |
[Fix 11: Invariante 178D] -> [Inferencia consistente de extremo a extremo]
```

**Cadenas críticas:**
- **Cadena A (Auth -> WS -> UI Demo):** Typo CORS (3) -> Verificación de token (2) -> Conexión WS -> Estado `isDemo` consistente.
- **Cadena B (Motor -> FPS -> Traducción):** Carga WASM/modelos (4) -> Inicialización limpia -> `FPS > 0` -> Envío e inferencia.
- **Cadena C (Pipeline 178D):** Generador + extractores (7, 11) -> Consistencia matemática `52 + 63 + 63` -> Inferencia ONNX válida.

---

## 3. Criterios Medibles de Aceptación (Originales)

| Criterio | Medición | Componentes |
|---|---|---|
| **Flujo de cámara** | `<video>` con `srcObject` activo y señal visible. | Frontend (`startCamera()`) |
| **Inicialización del motor** | El detector inicializa en `< 5 s` sin errores `ModuleFactory not set`. | Frontend |
| **FPS > 0** | Contador muestra `>= 1` con cámara activa. | Frontend |
| **Envío de landmarks** | WebSocket transmite lotes `{ type: 'inference', payload: [15 frames] }`. | Frontend -> Backend |
| **Aceptación WebSocket** | Handshake sin cierre `1008` en modo demo o con JWT válido. | Backend (`main.py`) |
| **Inferencia activa** | Backend retorna `{"type": "translation", "payload": {"label": "...", "confidence": > 0}}`. | Backend (`run_inference_async()`) |
| **Render en UI** | UI muestra traducción e indicador `isDemo` sin `ReferenceError`. | Frontend (`Translator.jsx`) |
| **Invariante 178D** | Consistencia `52 + 63 + 63` en toda la arquitectura. | Todos |

---

## 4. Fases Planeadas (Histórico de Ejecución)

1. **Fase 1 (Crítica):** Typo CORS en `backend/main.py`, verificación de token, estado `isDemo` en `Translator.jsx`, alineación WASM/CDN y errores visibles en UI.
2. **Fase 2 (Alta prioridad):** Estabilidad de contador FPS, reintentos de `/health`, estado stub/MediaPipe en C++ y verificación de invariante 178D.
3. **Fase 3 (Prioridad media):** Simplificación de estados `usingDemoToken`/`authWarning`, respaldo `GPU -> CPU`, guardas de `validateSequence` y fallback `rVFC`.
4. **Fase 4 (Pulido):** Limpieza de documentación, tipos y mejoras menores de UX.

---

## 5. Estrategia de Despliegue Original (`fix-mediapipe`)

- **Rama inicial:** `fix-mediapipe` con commits atómicos verificados por pruebas manuales de extremo a extremo.
- **Evolución posterior:** Las correcciones de `mediapipe-fix/` resolvieron los fallos inmediatos (ver [REPORTE.md](./REPORTE.md)); posteriormente `rearquitectura-demo` eliminó los Workers ESM por completo y consolidó la arquitectura actual en 4 capas ([ARQUITECTURA.md](../ARQUITECTURA.md)).
