---
title: "Skills Especializadas: UI/UX, Accesibilidad y Frontend"
description: "Conjunto curado de habilidades para diseño de interfaces inclusivas, auditoría de accesibilidad WCAG 2.2, desarrollo React 19, Dear ImGui y validación estética."
version: "2.0.0"
category: "Skills / Frontend & UI"
target_agents: ["frontend-developer", "ui-ux-designer", "accessibility-auditor"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Explicacion del codigo/Frontend/Vite_React]]"
  - "[[../Explicacion del codigo/Frontend/Legacy_Vanilla]]"
  - "[[../Explicacion del codigo/Frontend]]"
  - "[[../Explicacion del codigo/Dataset_Generator/04_Interfaz_Grafica_ImGui]]"
---

# 🎨 Skills Especializadas: UI/UX, Accesibilidad y Frontend

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **UI/UX y Frontend**

Este conjunto de skills está diseñado específicamente para abordar la experiencia de usuario, diseño visual, maquetación adaptativa, accesibilidad universal y desarrollo del frontend web y de escritorio dentro de **ExpresaT**.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `ui-ux-designer`
- **Ubicación:** `~/.gemini/config/skills/ui-ux-designer/SKILL.md`
- **Objetivo:** Creación de flujos de interacción centrados en el usuario, jerarquía visual, diseño responsivo y patrones de usabilidad específicos para personas con discapacidad auditiva o del habla.
- **Cuándo invocar:**
  - Rediseñar vistas clave de la aplicación (`Translator.jsx`, `Home.jsx`, `Learn.jsx`).
  - Definir la retroalimentación háptica y visual para confirmación de palabras reconocidas.
  - Asegurar consistencia entre el modo oscuro y modo claro con estética *Glassmorphism*.

### 2. `ui-visual-validator`
- **Ubicación:** `~/.gemini/config/skills/ui-visual-validator/SKILL.md`
- **Objetivo:** Inspección visual de componentes, validación de espaciado, tipografía, alineación de video y detección de regresiones visuales.
- **Cuándo invocar:**
  - Tras modificar hojas de estilo CSS o componentes de React.
  - Validar que el overlay de la cámara no cubra controles críticos en dispositivos móviles o ventanas compactas.

### 3. `wcag-audit-patterns` & `a11y-debugging`
- **Ubicación:** 
  - `~/.gemini/config/skills/wcag-audit-patterns/SKILL.md`
  - `~/.gemini/config/plugins/chrome-devtools-plugin/skills/a11y-debugging/SKILL.md`
- **Objetivo:** Auditorías exhaustivas de conformidad WCAG 2.2 nivel AA/AAA, pruebas de contraste cromático, navegación por teclado, focus rings y semántica ARIA.
- **Cuándo invocar:**
  - Puesto que **ExpresaT es una herramienta de accesibilidad**, este skill es **obligatorio** en cada ciclo de release de frontend.
  - Verificación de etiquetas `<button>`, roles `aria-live="polite"` para los anuncios de texto traducido en tiempo real.

### 4. `screen-reader-testing`
- **Ubicación:** `~/.gemini/config/skills/screen-reader-testing/SKILL.md`
- **Objetivo:** Simulación y validación de compatibilidad con lectores de pantalla (NVDA, VoiceOver, Orca).
- **Cuándo invocar:**
  - Probar que el motor de síntesis de voz o la caja de texto traducido anuncia correctamente las palabras a usuarios con discapacidad visual concurrente.

### 5. `react-modernization` & `react-state-management`
- **Ubicación:**
  - `~/.gemini/config/skills/react-modernization/SKILL.md`
  - `~/.gemini/config/skills/react-state-management/SKILL.md`
- **Objetivo:** Buenas prácticas en React 19, Server/Client components, custom hooks, optimización de renderizados (`useCallback`, `useMemo`) y gestión de estado con Context API o librerías reactivas.
- **Cuándo invocar:**
  - Refactorizar hooks como `useCamera.jsx` o `useInference.jsx`.
  - Evitar fugas de memoria en la conexión WebSocket o bucles innecesarios en la captura a 15-60 FPS.

### 6. `tailwind-design-system`
- **Ubicación:** `~/.gemini/config/skills/tailwind-design-system/SKILL.md`
- **Objetivo:** Implementación de tokens de diseño, paletas accesibles, micro-interacciones y utilidades CSS estructuradas.

---

## 📋 Protocolo de Ejecución para Agentes Frontend

Cuando un agente trabaje en el frontend web (`expresat/frontend`) o en la interfaz C++ con ImGui (`expresat-dataset-generator/src/gui`):

1. **Lectura Previa:** Inspeccionar [[../Explicacion del codigo/Frontend/Vite_React]] y verificar la relación entre `Translator.jsx`, `apiService.js` y `mediapipeEngine.js`.
2. **Prioridad de Rendimiento:** El renderizado del DOM no debe interrumpir el loop de la cámara web (15 FPS). Delegar operaciones pesadas a Web Workers.
3. **Validación de Accesibilidad:** Ejecutar checklist con `wcag-audit-patterns`:
   - [ ] Relación de contraste mínimo 4.5:1 para texto normal y 3:1 para elementos de control.
   - [ ] Navegabilidad completa por teclado (`Tab`, `Enter`, `Space`, `Esc`).
   - [ ] Feedback explícito ante fallos en la cámara o pérdida de conexión con el WebSocket.
