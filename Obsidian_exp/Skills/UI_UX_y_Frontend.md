---
title: "Skills Especializadas: UI/UX, Accesibilidad y Frontend"
description: "Conjunto curado de habilidades para diseño de interfaces inclusivas, auditoría de accesibilidad WCAG 2.2 nivel AA/AAA, desarrollo React 19, Dear ImGui y validación estética en ExpresaT."
version: "2.3.0"
category: "Skills / Frontend & UI"
status: "Producción"
target_agents: ["frontend-developer", "ui-ux-designer", "accessibility-auditor"]
recommended_skills:
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

### 2. `wcag-audit-patterns` & `a11y-debugging`
- **Ubicación:** 
  - `~/.gemini/config/skills/wcag-audit-patterns/SKILL.md`
  - `~/.gemini/config/plugins/chrome-devtools-plugin/skills/a11y-debugging/SKILL.md`
- **Objetivo:** Auditorías exhaustivas de conformidad WCAG 2.2 nivel AA/AAA, pruebas de contraste cromático, navegación por teclado, focus rings y semántica ARIA.
- **Cuándo invocar:**
  - Puesto que **ExpresaT es una herramienta de accesibilidad**, este skill es **obligatorio** en cada ciclo de release de frontend.
  - Verificación de etiquetas `<button>`, roles `aria-live="polite"` para los anuncios de texto traducido en tiempo real.

### 3. `react-modernization` & `react-state-management`
- **Ubicación:**
  - `~/.gemini/config/skills/react-modernization/SKILL.md`
  - `~/.gemini/config/skills/react-state-management/SKILL.md`
- **Objetivo:** Buenas prácticas en React 19, custom hooks, optimización de renderizados (`useCallback`, `useMemo`) y coordinación con `SignEngine`.
- **Cuándo invocar:**
  - Optimizar hooks como `useSignEngine.js`.
  - Evitar fugas de memoria en la conexión WebSocket o bucles innecesarios en la captura a 15-60 FPS.

### 4. `tailwind-design-system` & `ui-visual-validator`
- **Ubicación:**
  - `~/.gemini/config/skills/tailwind-design-system/SKILL.md`
  - `~/.gemini/config/skills/ui-visual-validator/SKILL.md`
- **Objetivo:** Tokens de diseño Tailwind CSS, paletas accesibles, micro-interacciones y prevención de regresiones visuales.

---

## 📋 Protocolo de Accesibilidad Obligatorio (WCAG 2.2 AA/AAA)

Cuando un agente modifique componentes React en `expresat/frontend`:

1. **Lectores de Pantalla:** El display de traducción debe actualizar dinámicamente una región viva accesible:
   ```jsx
   <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
       {currentTranslation}
   </div>
   ```
2. **Contraste Cromático:** Ratio de contraste mínimo de **4.5:1** para texto convencional y **3:1** para componentes interactivos y badges de confianza.
3. **Navegación por Teclado:** Todo control debe ser operable mediante `Tab`, `Enter` y `Space`, con anillos de foco visibles (`focus-visible:ring-2`).
4. **Respeto a Preferencias del Sistema:** Respetar `prefers-reduced-motion` desactivando partículas y transiciones complejas si el usuario lo solicita.

---

## 🧪 Comandos de Prueba para Frontend

```bash
cd expresat/frontend

# 1. Ejecutar Linter y comprobación de hooks:
npm run lint

# 2. Ejecutar suite unitaria con Vitest:
npx vitest run

# 3. Ejecutar pruebas End-to-End con Playwright:
npx playwright test e2e/translator.spec.js
```
