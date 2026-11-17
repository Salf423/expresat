---
title: "Explicación del Código: Frontend Web Moderno (React 19 + Vite + SignEngine)"
description: "Estructura modular del frontend de producción: SignEngine en main-thread con Tasks Vision CPU, hook useSignEngine, featureExtractor.js canónico 178D v1.2.1, clasificador geométrico y WSClient con máquina de estados."
version: "2.2.1"
category: "Código / Frontend Web"
status: "Producción"
target_agents: ["frontend-developer", "ui-ux-designer", "accessibility-auditor", "ml-engineer"]
recommended_skills:
  - "[[../../Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`react-modernization`, `react-state-management`, `wcag-audit-patterns`)"
  - "[[../../Skills/Auditoria_Seguridad_y_Calidad|Auditoria_Seguridad_y_Calidad]] (`frontend-security-coder`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../../Especificacion_Feature_Spec_v1_2_1]]"
  - "[[../Frontend]]"
  - "[[Legacy_Vanilla]]"
  - "[[../../Websocket]]"
  - "[[../../Flujo de datos]]"
---

# ⚛️ Explicación del Código: Frontend Web Moderno (React 19 + Vite)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Frontend** > **Vite + React**

El frontend de producción de **ExpresaT** (`expresat/frontend`) está construido con **React 19.2** y empaquetado con **Vite 8.1**, ofreciendo una interfaz ultra-rápida, completamente accesible (conforme a WCAG 2.2) y potenciada por un motor de visión local en JavaScript.

---

## 1. Decisiones Arquitectónicas Clave (Rearquitectura 2026)

- **Eliminación de Web Workers:** La arquitectura legacy mediante Web Workers introducía cuellos de botella severos en la transferencia de estructuras complejas de landmarks y causaba incompatibilidades con los binarios WebAssembly de MediaPipe. Se migró a un motor directo en el hilo principal optimizado (**`SignEngine`**).
- **`SignEngine` (@mediapipe/tasks-vision 1.0.1 en CPU):**
  - Carga conjunta de `HandLandmarker` y `PoseLandmarker Lite` en modo `VIDEO`.
  - Limpieza idempotente (`cleanup()`, `close()`) que previene fugas de descriptores de memoria WebAssembly o bucles de captura huérfanos.
  - Soporte de emisión de landmarks crudos sin interpolación artificial (`smoothLandmarks: false`) para recolección de datasets.
  - Medidor de FPS reales de procesamiento en vivo.
- **Extractor Canónico 178D (`featureExtractor.js`):**
  - Implementa con precisión bitwise el contrato [[../../Especificacion_Feature_Spec_v1_2_1|FEATURE_SPEC v1.2.1]].
  - Normalización 3D por hombros, coordenada $Z$ desacoplada respecto a la propia muñeca, y asignación conjunta húngara de manos.
  - Suite de paridad en Vitest contra fixtures de referencia con tolerancia $|\Delta| \le 10^{-6}$.
- **Clasificador Geométrico Directo (`recognition/`):**
  - Motor de heurística espacial pura que clasifica señas estáticas (como letras del abecedario) y gestos dinámicos en tiempo real sin esperar la respuesta del servidor.
- **Capa de Transporte Robusta (`transport/wsClient.js`):**
  - Cliente WebSocket con **máquina de estados finitos explícita** (`CONNECTING`, `OPEN`, `CLOSING`, `CLOSED`), reconexión con backoff exponencial, heartbeats y modo de demostración automático ante ausencia de backend.

---

## 2. Organización del Código Fuente (`expresat/frontend/src`)

```text
expresat/frontend/src/
├── engine/                           # Motor de visión e ingeniería de características
│   ├── signEngine.js                 # MediaPipe Tasks Vision CPU, ciclo de vida y FPS
│   ├── featureExtractor.js           # Extractor canónico 178D conforme a FEATURE_SPEC v1.2.1
│   ├── index.js                      # Punto de entrada del paquete compartido
│   └── __tests__/                    # Tests unitarios en Vitest (paridad y regresión)
│
├── recognition/                      # Clasificación geométrica offline en cliente
│   ├── geometry.js                   # Cálculo de distancias euclidianas, ángulos y palmScale
│   ├── classifier.js                 # Lógica de clasificación articular y ventana de votación
│   └── syntheticHand.js              # Fixtures de manos sintéticas para pruebas
│
├── transport/                        # Capa de red y sincronización WebSocket
│   ├── wsClient.js                   # Máquina de estados finitos y reconexión automática
│   └── __tests__/                    # Tests de resiliencia de red
│
├── ui/                               # Componentes de presentación visual
│   ├── useSignEngine.js              # Custom Hook que enlaza cámara, canvas e inferencia
│   └── drawLandmarks.js              # Dibujado acelerado en Canvas 2D de manos y torso
│
├── pages/                            # Vistas principales de la aplicación
│   ├── Translator.jsx                # Interfaz principal de traducción interactiva
│   ├── Home.jsx                      # Landing page con propuesta de valor y accesibilidad
│   ├── Auth.jsx                      # Formulario de inicio de sesión Supabase Auth
│   ├── Learn.jsx                     # Módulo interactivo de aprendizaje de lengua de señas
│   └── About.jsx                     # Misión del proyecto, equipo y tecnología
│
├── components/                       # Componentes reutilizables (Navbar, Footer, ThemeToggle)
└── services/                         # Servicios auxiliares (authService.js)
```

---

## 3. Fragmentos Clave de Implementación

### Hook `useSignEngine` (`ui/useSignEngine.js`)
Gestiona el enlace de la cámara, el loop de animación `requestAnimationFrame` y el renderizado sobre el canvas:

```jsx
import { useEffect, useRef, useState } from 'react';
import { SignEngine } from '../engine/signEngine';
import { drawLandmarks } from './drawLandmarks';

export function useSignEngine({ onFrame, onPrediction }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const engineRef = useRef(null);
    const [fps, setFps] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const engine = new SignEngine({
            onResults: (results, framePayload) => {
                if (!isMounted) return;
                setFps(engine.getFps());
                if (canvasRef.current) {
                    drawLandmarks(canvasRef.current, results);
                }
                if (onFrame) onFrame(framePayload);
            }
        });
        engineRef.current = engine;
        engine.init().then(() => engine.start(videoRef.current));

        return () => {
            isMounted = false;
            engine.cleanup();
        };
    }, []);

    return { videoRef, canvasRef, fps };
}
```

### Extractor Canónico 178D (`engine/featureExtractor.js`)
Asegura la invarianza exacta respecto al centro de hombros y muñecas:

```javascript
// En engine/featureExtractor.js
export function extract178D(pose, leftHand, rightHand) {
    if (!pose || pose.length < 23) {
        return { valid: false, error: 'ERR_POSE_MISSING' };
    }
    const ls = pose[11], rs = pose[12];
    if (ls.visibility < 0.40 || rs.visibility < 0.40) {
        return { valid: false, error: 'ERR_SHOULDER_VISIBILITY' };
    }

    const cx = (ls.x + rs.x) * 0.5;
    const cy = (ls.y + rs.y) * 0.5;
    const cz = (ls.z + rs.z) * 0.5;
    const D = Math.hypot(ls.x - rs.x, ls.y - rs.y, ls.z - rs.z);

    if (D < 0.08) {
        return { valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
    }

    const features = new Float32Array(178);
    // [0..51] Upper Pose normalizado relativo a C y escalado por D
    // [52..114] Mano Izquierda: (x-cx)/D, (y-cy)/D, (z-z_wrist)/D
    // [115..177] Mano Derecha: (x-cx)/D, (y-cy)/D, (z-z_wrist)/D
    return { valid: true, features };
}
```

---

## 4. Pruebas Automatizadas y Calidad

El frontend cuenta con compuertas estrictas de calidad y pruebas de integración:
1. **Linter Estricto:** Reglas ESLint con `rules-of-hooks` y `no-undef` obligatorias, complementadas por Oxlint.
2. **Vitest Unit Suite:** Cobertura de extracción 178D (TC-01 a TC-05C), clasificador geométrico y estados de WSClient.
3. **Playwright E2E:** Flujo visual completo del traductor simulando cámara web en navegador headless (`e2e/translator.spec.js`).

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Desarrollo React y Refactorizaciones:** Invocar **`react-modernization`** y **`react-state-management`** (ver [[../../Skills/UI_UX_y_Frontend]]).
- **Para Auditorías de Accesibilidad e Inclusión:** Invocar **`wcag-audit-patterns`** y **`a11y-debugging`** para verificar contraste, lectores de pantalla y directivas ARIA.
- **Para Validación de Extracción 178D:** Consultar [[../../Especificacion_Feature_Spec_v1_2_1]].
