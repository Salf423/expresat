---
title: "Matriz General de Skills y Capacidades de Agentes"
description: "Índice maestro de habilidades (skills) instaladas en el entorno local (~/.gemini/config/skills/), organizadas por dominio técnico, perfil de agente y casos de uso en ExpresaT."
version: "2.3.0"
category: "Skills & Orquestación"
status: "Producción"
target_agents: ["all"]
related_docs:
  - "[[../00_INDICE_MAESTRO]]"
  - "[[UI_UX_y_Frontend]]"
  - "[[Auditoria_Seguridad_y_Calidad]]"
  - "[[Gestion_y_Revision_de_Skills]]"
  - "[[Backend_APIs_y_Sistemas]]"
  - "[[MachineLearning_y_Vision]]"
  - "[[DevOps_CI_CD_y_Despliegue]]"
  - "[[Estrategia_Producto_y_Negocio]]"
---

# 🧭 Matriz General de Skills y Capacidades de Agentes — ExpresaT

> [!NOTE]
> Esta matriz centraliza el catálogo de **skills instaladas** en el entorno (`~/.gemini/config/skills/` y plugins). Proporciona a los agentes de IA un mapa claro de decisión para saber exactamente qué skill activar según el tipo de tarea a ejecutar en el repositorio **ExpresaT**.

---

## 🗂️ Categorías Especializadas (Carpetas de Skills)

| Carpeta / Dominio | Especialidad | Skills Principales Destacadas | Casos de Uso Típicos en ExpresaT |
|---|---|---|---|
| **[[UI_UX_y_Frontend]]** | Diseño de interfaces, accesibilidad (a11y/WCAG 2.2), React 19, Tailwind CSS y validación visual. | `ui-ux-designer`, `ui-visual-validator`, `tailwind-design-system`, `wcag-audit-patterns`, `a11y-debugging`, `react-modernization`, `react-state-management` | Refactorizar `Translator.jsx`, optimizar `useSignEngine.js`, verificar contrastes y anuncios ARIA en pantalla. |
| **[[Auditoria_Seguridad_y_Calidad]]** | Revisión de código, auditoría estática SAST, prevención XSS/Inyección, threat modeling STRIDE y remediación Opencode. | `code-reviewer`, `code-review-excellence`, `security-auditor`, `backend-security-coder`, `frontend-security-coder`, `sast-configuration`, `secrets-management` | Auditar endpoints FastAPI, verificar firmas JWT de Supabase, sanear entradas WebSocket y prevenir fugas de claves. |
| **[[Backend_APIs_y_Sistemas]]** | Concurrencia C++17, memoria segura, FastAPI asíncrono, WebSockets en tiempo real y buffers lock-free SPSC. | `cpp-pro`, `fastapi-pro`, `fastapi-templates`, `async-python-patterns`, `python-performance-optimization`, `memory-safety-patterns`, `api-design-principles` | Optimizar `main.py` y `ConnectionManager`, auditar `inference_thread.cpp` y `frame_queue.h`, garantizar inferencia no bloqueante. |
| **[[MachineLearning_y_Vision]]** | MediaPipe Tasks Vision CPU, PyTorch GRU, ONNX Runtime INT8, aumentación estocástica y FEATURE_SPEC v1.3.0. | `ml-engineer`, `mlops-engineer`, `machine-learning-ops-ml-pipeline`, `data-engineering-data-pipeline`, `data-quality-frameworks` | Entrenar `SignLanguageGRU`, exportar con opset 17, validar paridad $L_\infty \le 10^{-6}$ en `test_feature_spec.py`, aislar cuarentena. |
| **[[DevOps_CI_CD_y_Despliegue]]** | Docker, Netlify, Supabase, CMake, Android NDK/Gradle, GitHub Actions CI/CD y observabilidad. | `deployment-pipeline-design`, `github-actions-templates`, `android-cli`, `deployment-validation-config-validate`, `devops-troubleshooter` | Construir imagen Docker multi-stage, configurar `netlify.toml`, compilar para Android NDK y automatizar tests en CI. |
| **[[Estrategia_Producto_y_Negocio]]** | Modelo Open-Core, pricing B2B/B2G en MXN, compliance legal/LFPDPPP/GDPR y métricas de mercado INEGI/OMS. | `startup-business-analyst-business-case`, `startup-business-analyst-financial-projections`, `competitive-landscape`, `legal-advisor`, `gdpr-data-handling`, `billing-automation` | Proyecciones financieras, análisis de economía unitaria (< $0.002 MXN por usuario-hora) y políticas de privacidad sin video en nube. |
| **[[Gestion_y_Revision_de_Skills]]** | Descubrimiento, instalación, benchmarking, auditoría y creación de nuevas habilidades para agentes. | `antigravity-skills-manager`, `agent-orchestration-improve-agent`, `agent-orchestration-multi-agent-optimize`, `workflow-skill-creator`, `dx-optimizer` | Crear nuevas skills para pipelines de señas, optimizar prompts de sistema y verificar consistencia de herramientas. |

---

## 🤖 Guía de Decisión Rápida para Agentes Autónomos

```mermaid
flowchart TD
    Start["Nueva Tarea de Ingeniería"] --> Tipo{"¿Cuál es la naturaleza de la tarea?"}
    
    Tipo -->|"Interfaz, CSS, Accesibilidad, Componente Web"| UI["Usar Skills de [[UI_UX_y_Frontend]]\n(ui-ux-designer, wcag-audit-patterns, react-modernization)"]
    Tipo -->|"Revisión de PR, Vulnerabilidad, Escaneo SAST"| Sec["Usar Skills de [[Auditoria_Seguridad_y_Calidad]]\n(code-reviewer, security-auditor, backend-security-coder)"]
    Tipo -->|"C++ Nativo, FastAPI, WebSocket, IPC Lock-Free"| Back["Usar Skills de [[Backend_APIs_y_Sistemas]]\n(cpp-pro, fastapi-pro, async-python-patterns)"]
    Tipo -->|"Modelo GRU, MediaPipe 178D, Aumentador, Datasets"| ML["Usar Skills de [[MachineLearning_y_Vision]]\n(ml-engineer, data-engineering-data-pipeline)"]
    Tipo -->|"Docker, Netlify, Android NDK, GitHub Actions"| Ops["Usar Skills de [[DevOps_CI_CD_y_Despliegue]]\n(deployment-pipeline-design, android-cli)"]
    Tipo -->|"Estrategia de Precios, Monetización, Privacidad"| Biz["Usar Skills de [[Estrategia_Producto_y_Negocio]]\n(business-case, gdpr-data-handling)"]
    Tipo -->|"Administrar/Actualizar Skills o Metaprompts"| Mgt["Usar Skills de [[Gestion_y_Revision_de_Skills]]\n(antigravity-skills-manager, workflow-skill-creator)"]

    style UI fill:#1a3a6b,color:#fff
    style Sec fill:#6b1a2d,color:#fff
    style Mgt fill:#4a2d6b,color:#fff
    style Back fill:#1d5b4a,color:#fff
    style ML fill:#6b5a1a,color:#fff
    style Ops fill:#2b4a6b,color:#fff
    style Biz fill:#2d5a27,color:#fff
```

---

## 🔍 Localización de Archivos de Skills en el Entorno Local

Todas las skills operan desde el filesystem local del agente en:
- **Directorio global de skills:** `~/.gemini/config/skills/<skill-name>/SKILL.md`
- **Plugins de Android:** `~/.gemini/config/plugins/android-cli-plugin/skills/SKILL.md`
- **Plugins de Chrome DevTools:** `~/.gemini/config/plugins/chrome-devtools-plugin/skills/`
- **Plugins de Firebase:** `~/.gemini/config/plugins/firebase/skills/`

> [!IMPORTANT]
> Antes de ejecutar tareas complejas sobre cualquier subsistema, el agente debe inspeccionar el archivo `SKILL.md` correspondiente usando `read_file` para internalizar las mejores prácticas y patrones defensivos de dicha disciplina.
