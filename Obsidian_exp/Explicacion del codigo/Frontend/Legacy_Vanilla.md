---
title: "Explicación del Código: Frontend Clásico de Referencia (Vanilla JS)"
description: "Arquitectura del frontend original implementado en JavaScript puro sin dependencias de compilación: mediapipe_engine.js, ventana deslizante, comparativa técnica con React 19 y valor como referencia histórica."
version: "2.3.0"
category: "Código / Frontend Legacy"
status: "Mantenimiento / Referencia Histórica"
target_agents: ["frontend-developer", "javascript-pro"]
recommended_skills:
  - "[[../../Skills/UI_UX_y_Frontend|UI_UX_y_Frontend]] (`javascript-pro`, `wcag-audit-patterns`)"
  - "[[../../Skills/Auditoria_Seguridad_y_Calidad|Auditoria_Seguridad_y_Calidad]] (`frontend-security-coder`)"
related_docs:
  - "[[../../00_INDICE_MAESTRO]]"
  - "[[Vite_React]]"
  - "[[../Frontend]]"
  - "[[../../Flujo de datos]]"
---

# 📜 Explicación del Código: Frontend Clásico de Referencia (Vanilla JS)

> **Navegación:** [[../../00_INDICE_MAESTRO|🏠 Índice Maestro]] > **Explicación del Código** > **Frontend** > **Legacy Vanilla**

Esta versión (`expresat/frontend-legacy/`) constituye la implementación fundacional del cliente web. Sirve como referencia técnica transparente para entender la integración de MediaPipe Holistic en el navegador sin las capas de abstracción de un framework moderno.

---

## 1. Tabla Comparativa: Vanilla JS vs React 19 + Tasks Vision

| Dimensión Técnica | Frontend Legacy (Vanilla JS) | Frontend Moderno (`expresat/frontend`) |
|---|---|---|
| **Framework y Build** | ES6 nativo, sin bundler (abrible directamente en navegador) | React 19.2 + Vite 8.1 con HMR instantáneo |
| **Librería de Visión** | `window.Holistic` + `window.Camera` vía CDN | `@mediapipe/tasks-vision` 1.0.1 con WASM local (`/wasm`) |
| **Entorno de Detección** | Main Thread básico a 15 FPS | `SignEngine` en Main Thread optimizado con FPS reales |
| **Manejo de Estados** | Variables globales en `mediapipe_engine.js` | Hooks reactivos (`useSignEngine.js`) y contextos |
| **Transporte de Red** | WebSocket elemental sin reconexión | `WSClient` con máquina de estados y fallback a demo mode |
| **Accesibilidad** | Básica en etiquetas HTML | WCAG 2.2 nivel AA/AAA con regiones vivas `aria-live="polite"` |

---

## 2. Estructura Modular de Archivos (`expresat/frontend-legacy/js`)

1. **`app.js`:** Controlador maestro que coordina los módulos de cámara, WebSocket y DOM.
2. **`mediapipe_engine.js`:** Encapsula la inicialización de la cámara (`Camera` de MediaPipe) y la función de callback `onResults`.
3. **`api_service.js`:** Gestiona el socket bidireccional y la serialización JSON.
4. **`ui_controller.js`:** Manipulación directa de los nodos HTML para presentar resultados y alertas.

---

## 3. Lógica de Extracción y Ventana Deslizante

```javascript
// En mediapipe_engine.js
const SEQUENCE_LENGTH = 15;
const frameBuffer = [];

function onResults(results) {
    // 1. Extraer landmarks de pose y manos
    const frameData = extractLandmarks(results);

    if (frameData) {
        frameBuffer.push(frameData);

        // 2. Cuando el buffer alcanza la longitud requerida (15 frames = 1 segundo)
        if (frameBuffer.length >= SEQUENCE_LENGTH) {
            // Emitir lote para inferencia
            apiService.sendSequence(frameBuffer);
            // Mantener ventana deslizante descartando el frame más antiguo
            frameBuffer.shift();
        }
    }
}
```

---

## 🤖 Guía de Operación para Agentes

- **Regla Inmutable:** `expresat/frontend-legacy/` se preserva intacto como banco de pruebas y referencia de compatibilidad. No refactorizar ni eliminar sus archivos.
- Para el desarrollo de nuevas características de usuario, operar exclusivamente sobre `expresat/frontend` (React 19).
