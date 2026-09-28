---
title: "Explicación del Código: Frontend Web Moderno (React 19 + Vite)"
description: "Estructura modular del frontend de producción: hooks de cámara y WebSocket, servicios de MediaPipe Holistic, diseño accesible y renderizado reactivo."
version: "2.0.0"
category: "Código / Frontend Web"
status: "Producción"
target_agents: ["frontend-developer", "ui-ux-designer", "accessibility-auditor"]
recommended_skills:
  - "[[../../Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`react-modernization`, `react-state-management`, `wcag-audit-patterns`)"
  - "[[../../Skills/Auditoria_Seguridad_y_Calidad|Auditoria_Seguridad_y_Calidad]] (`frontend-security-coder`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[../Frontend]]"
  - "[[Legacy_Vanilla]]"
  - "[[../../Websocket]]"
  - "[[../../Flujo de datos]]"
---

# ⚛️ Explicación del Código: Frontend Web Moderno (React 19 + Vite)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Frontend** > **Vite + React**

El frontend de producción de **ExpresaT** (`expresat/frontend`) está construido con **React 19** y empaquetado con **Vite 8**, ofreciendo una interfaz web ultra-rápida, modular y accesible.

---

## 1. Conceptos Clave

- **React 19 + Vite:** Arquitectura de componentes desacoplados con reemplazo de módulos en caliente (*Hot Module Replacement*) y compilación estática optimizada para CDNs.
- **Web Workers:** Procesamiento de puntos clave de MediaPipe y manipulación de arreglos fuera del hilo principal (*Main Thread*) para preservar la fluidez visual a 60 FPS.
- **Custom Hooks (`hooks/`):** Abstracciones reactivas reutilizables para el ciclo de vida del video WebRTC (`useCamera.jsx`) y la sesión de WebSocket (`useInference.jsx`).
- **Autenticación Supabase (`authService.js`):** Gestión de inicio de sesión con JWT y sincronización de perfiles en la nube.

---

## 2. Organización del Código Fuente (`expresat/frontend/src`)

1. **`components/`:** Componentes de interfaz reutilizables (Navbar, Footer, ThemeToggle, EnvironmentSelector).
2. **`pages/`:** Vistas de la aplicación:
   - `Translator.jsx`: Vista principal que coordina el streaming de video y la visualización de la traducción en tiempo real.
   - `Home.jsx`: Portada de bienvenida y explicación del proyecto.
   - `Auth.jsx`: Formulario de login/registro con Supabase.
   - `Learn.jsx`: Módulo educativo y glosario interactivo de señas.
3. **`services/`:** Capa de comunicación y visión:
   - `apiService.js`: Conexión de WebSocket con reconexión automática y emisión de lotes (15 frames).
   - `mediapipeEngine.js`: Inicialización de MediaPipe Holistic y extracción geométrica.
   - `authService.js`: Cliente de autenticación Supabase.
4. **`hooks/`:** Lógica de estado reactiva desacoplada del DOM.

---

## 3. Fragmentos Clave de Implementación

### Hook de Conexión de Inferencia (`hooks/useInference.js`)
Encapsula la suscripción al flujo de traducción por WebSocket:

```jsx
import { useState, useEffect } from 'react';

export function useInference(socketUrl) {
    const [prediction, setPrediction] = useState("");
    const [confidence, setConfidence] = useState(0.0);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const ws = new WebSocket(socketUrl);

        ws.onopen = () => setIsConnected(true);
        ws.onclose = () => setIsConnected(false);
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'translation' && data.payload) {
                setPrediction(data.payload.label);
                setConfidence(data.payload.confidence);
            }
        };

        return () => ws.close();
    }, [socketUrl]);

    return { prediction, confidence, isConnected };
}
```

### Componente de Traducción (`pages/Translator.jsx`)
Muestra el stream de la cámara web respetando directivas de reproducción inline para dispositivos móviles:

```jsx
import React from 'react';
import { useCamera } from '../hooks/useCamera';
import { useInference } from '../hooks/useInference';

export function Translator() {
    const { videoRef, startCamera, isCameraReady } = useCamera();
    const { prediction, confidence, isConnected } = useInference('wss://api.expresat.com/ws/translate');

    return (
        <section className="translator-view" aria-label="Traductor en tiempo real">
            <div className="video-card">
                <video ref={videoRef} autoPlay playsInline muted />
                {!isCameraReady && <button onClick={startCamera}>Encender Cámara</button>}
            </div>

            <div className="output-card" aria-live="polite">
                <h2>Traducción Detectada:</h2>
                <p className="prediction-label">{prediction || "Esperando seña..."}</p>
                {confidence > 0 && <span className="confidence-pill">Confianza: {(confidence * 100).toFixed(1)}%</span>}
            </div>
        </section>
    );
}
```

---

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Desarrollo React y Refactorizaciones:** Invocar **`react-modernization`** y **`react-state-management`** (ver [[../../Skills/UI_UX_y_Frontend]]).
- **Para Auditorías de Accesibilidad e Inclusión:** Invocar **`wcag-audit-patterns`** y **`a11y-debugging`** para verificar contraste, lectores de pantalla y directivas ARIA.
- **Para Seguridad en el Cliente:** Invocar **`frontend-security-coder`** (ver [[../../Skills/Auditoria_Seguridad_y_Calidad]]).
