---
title: "Explicación del Código: Frontend Clásico de Referencia (Vanilla JS)"
description: "Arquitectura del frontend original implementado en JavaScript puro sin dependencias de compilación: mediapipe_engine.js, ventana deslizante y manipulación directa del DOM."
version: "2.0.0"
category: "Código / Frontend Legacy"
status: "Mantenimiento / Referencia"
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

Esta versión (`expresat/frontend-legacy/`) constituye la implementación fundacional del cliente web. Sirve como referencia técnica transparente para entender la integración de MediaPipe Holistic en el navegador sin las capas de abstracción de un framework.

---

## 1. Conceptos Clave

- **JavaScript ES6 Nativo:** Sin herramientas de empaquetado (sin Vite ni Webpack), ejecutable de forma instantánea abriendo `index.html`.
- **MediaPipe Holistic en Cliente:** Extracción directa de los 178 puntos geométricos utilizando la librería CDN de Google MediaPipe.
- **Técnica de Ventana Deslizante (*Sliding Window*):** Almacenamiento temporal de fotogramas donde los datos entran por el extremo frontal y salen por el trasero (`push` / `shift`), permitiendo un flujo ininterrumpido de inferencia.

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
    // 1. Extraer landmarks normalizados de pose y manos (178D)
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

## 🤖 Asignación de Agentes y Skills Recomendadas

- **Para Mantenimiento y Compatibilidad JS:** Invocar **`javascript-pro`** (ver [[../../Skills/UI_UX_y_Frontend]]).
- **Para Migración hacia React:** Invocar **`framework-migration-code-migrate`** o consultar [[Vite_React]].
