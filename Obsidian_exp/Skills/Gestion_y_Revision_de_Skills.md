---
title: "Skills Especializadas: Gestión, Auditoría y Revisión de Skills"
description: "Guía y conjunto de herramientas para administrar, auditar, evaluar, optimizar y crear nuevas skills de agentes dentro del entorno de desarrollo Google Antigravity."
version: "2.0.0"
category: "Skills / Meta-Skills & Orquestación"
target_agents: ["skills-manager", "agent-orchestrator", "prompt-engineer"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../00_INDICE_MAESTRO]]"
  - "[[Auditoria_Seguridad_y_Calidad]]"
---

# ⚙️ Skills Especializadas: Gestión, Auditoría y Revisión de Skills

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Gestión y Revisión de Skills**

Esta sección define las herramientas y flujos de trabajo (*meta-skills*) utilizados para gobernar el propio ecosistema de habilidades de IA, evaluar el desempeño de los agentes y mantener actualizadas las instrucciones de contexto.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `antigravity-skills-manager`
- **Ubicación:** `~/.gemini/config/skills/antigravity-skills-manager/SKILL.md`
- **Objetivo:** Gestor integral para explorar, buscar, instalar, actualizar y auditar habilidades del catálogo global (más de 300 skills basadas en estándares CLI).
- **Comandos habituales ejecutados por el agente:**
  - Búsqueda de skills: `python3 -m skills_manager search <termino>`
  - Listado de instaladas: `python3 -m skills_manager list`
  - Verificación de integridad: `python3 -m skills_manager audit`
- **Cuándo invocar:**
  - Cuando se requiera incorporar una capacidad técnica inexistente en el entorno local.
  - Para verificar si una skill instalada tiene dependencias rotas o desactualizadas.

### 2. `agent-orchestration-improve-agent` & `agent-orchestration-multi-agent-optimize`
- **Ubicación:**
  - `~/.gemini/config/skills/agent-orchestration-improve-agent/SKILL.md`
  - `~/.gemini/config/skills/agent-orchestration-multi-agent-optimize/SKILL.md`
- **Objetivo:** Análisis sistemático del desempeño de agentes autónomos, optimización de prompts de sistema, reducción de tokens redundantes y perfilado de flujos multi-agente en tareas colaborativas.
- **Cuándo invocar:**
  - Si un agente experimenta alucinaciones en la lectura de la estructura de 178 landmarks.
  - Para distribuir cargas complejas (ej. entrenamiento simultáneo y generación de interfaz).

### 3. `workflow-skill-creator`
- **Ubicación:** `~/.gemini/config/skills/workflow-skill-creator/SKILL.md`
- **Objetivo:** Creación y empaquetado formal de nuevas skills a partir de flujos de trabajo repetitivos en el proyecto, generando la estructura estándar (`SKILL.md`, `scripts/`, `references/`, `examples/`).
- **Cuándo invocar:**
  - Cuando se formalice un nuevo pipeline específico de ExpresaT (por ejemplo, un generador automático de modelos ONNX cuantizados a partir de capturas de señas).

### 4. `prompt-engineering-patterns` & `prompt-engineer`
- **Ubicación:**
  - `~/.gemini/config/skills/prompt-engineering-patterns/SKILL.md`
  - `~/.gemini/config/skills/prompt-engineer/SKILL.md`
- **Objetivo:** Diseño de metaprompts, razonamiento en cadena de pensamiento (*Chain of Thought*), salidas estructuradas JSON y control determinista de respuestas.

### 5. `dx-optimizer`
- **Ubicación:** `~/.gemini/config/skills/dx-optimizer/SKILL.md`
- **Objetivo:** Optimización de la experiencia del desarrollador (Developer Experience), reduciendo fricciones en scripts de setup, linters y herramientas de diagnóstico.

---

## 🔄 Procedimiento para Crear o Actualizar una Skill para ExpresaT

Para documentar o estandarizar una nueva skill en el proyecto:

1. **Definir el Alcance:** Especificar exactamente la entrada, salida y restricciones de la habilidad.
2. **Estructura YAML Frontmatter:** Todo archivo `SKILL.md` debe contener:
   ```yaml
   ---
   name: expresat-gesture-validator
   description: "Valida la consistencia topológica y normalización de arrays de 178 puntos de MediaPipe."
   tools: ["run_command", "view_file"]
   ---
   ```
3. **Instrucciones Deterministas:** Proporcionar scripts verificables en Bash o Python en lugar de explicaciones abstractas.
4. **Verificación:** Ejecutar `antigravity-skills-manager audit` para garantizar que la nueva skill se integre sin conflictos.
