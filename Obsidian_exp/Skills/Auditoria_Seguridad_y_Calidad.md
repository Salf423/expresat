---
title: "Skills Especializadas: Auditoría, Seguridad y Calidad de Código"
description: "Catálogo de habilidades especializadas en revisión estática (SAST), auditoría de dependencias, protección contra inyecciones, seguridad en WebSockets y análisis de amenazas."
version: "2.0.0"
category: "Skills / Seguridad & Calidad"
target_agents: ["security-auditor", "code-reviewer", "backend-security-coder"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Websocket]]"
  - "[[../Deploys]]"
  - "[[../Explicacion del codigo/Backend/Python_FastAPI]]"
  - "[[../Explicacion del codigo/Backend/Main C++]]"
---

# 🛡️ Skills Especializadas: Auditoría, Seguridad y Calidad de Código

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **Auditoría, Seguridad y Calidad**

La naturaleza interactiva de **ExpresaT** (streaming de video por cámara, autenticación mediante JWT con Supabase, conexión bidireccional por WebSockets e inferencia en C++ y Python) exige rigurosos controles de seguridad, validación de entradas y revisiones de código sistemáticas.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `code-reviewer` & `code-review-excellence`
- **Ubicación:** 
  - `~/.gemini/config/skills/code-reviewer/SKILL.md`
  - `~/.gemini/config/skills/code-review-excellence/SKILL.md`
- **Objetivo:** Análisis profundo de Pull Requests y diffs. Evaluación de legibilidad, mantenibilidad, principios SOLID, cobertura de pruebas y detección de olores en el código (code smells).
- **Cuándo invocar:**
  - Antes de fusionar cualquier cambio a ramas principales.
  - Para auditar refactorizaciones en `inference_engine.py` o `ConnectionManager`.

### 2. `security-auditor` & `backend-security-coder`
- **Ubicación:**
  - `~/.gemini/config/skills/security-auditor/SKILL.md`
  - `~/.gemini/config/skills/backend-security-coder/SKILL.md`
- **Objetivo:** Identificación de vulnerabilidades en endpoints FastAPI, inyecciones de datos en payloads JSON/WebSocket, verificación de tokens JWT y políticas CORS restrictivas.
- **Cuándo invocar:**
  - Auditar `expresat/backend/main.py` y `websockets_handler.py`.
  - Asegurar que `verify_supabase_token` valide firmas criptográficas y expiración de tokens en entornos de producción.

### 3. `frontend-security-coder` & `frontend-mobile-security-xss-scan`
- **Ubicación:**
  - `~/.gemini/config/skills/frontend-security-coder/SKILL.md`
  - `~/.gemini/config/skills/frontend-mobile-security-xss-scan/SKILL.md`
- **Objetivo:** Protección contra Cross-Site Scripting (XSS), manipulación indebida del DOM, fugas de almacenamiento local (`localStorage`) e inyección de contenido en React.
- **Cuándo invocar:**
  - Auditar la renderización dinámica de etiquetas de traducción y componentes de feedback.
  - Verificar que las claves públicas de Supabase (`anon_key`) no se confundan con la `service_role_key`.

### 4. `sast-configuration` & `security-scanning-security-sast`
- **Ubicación:**
  - `~/.gemini/config/skills/sast-configuration/SKILL.md`
  - `~/.gemini/config/skills/security-scanning-security-sast/SKILL.md`
- **Objetivo:** Configuración de herramientas estáticas de análisis (Bandit, Flake8-Security, Cppcheck, SonarQube, Semgrep).
- **Cuándo invocar:**
  - Integrar escaneos automáticos de seguridad en GitHub Actions (`.github/workflows`).

### 5. `attack-tree-construction` & `stride-analysis-patterns`
- **Ubicación:**
  - `~/.gemini/config/skills/attack-tree-construction/SKILL.md`
  - `~/.gemini/config/skills/stride-analysis-patterns/SKILL.md`
- **Objetivo:** Modelado de amenazas sistemático según el modelo STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).
- **Cuándo invocar:**
  - Evaluar riesgos de saturación de sockets (DDoS sobre el servicio de inferencia ONNX).
  - Diseñar límites de tasa (rate-limiting) por cliente y validación de tamaños máximos de paquetes JSON.

### 6. `secrets-management`
- **Ubicación:** `~/.gemini/config/skills/secrets-management/SKILL.md`
- **Objetivo:** Prevención de fugas de credenciales en repositorios, manejo de variables de entorno seguras (`.env`) e integración con vaults.

---

## 📋 Lista de Verificación (Checklist) para Agentes de Auditoría

Al auditar cualquier componente de ExpresaT, el agente debe verificar:
1. **Validación de Tamaño de Payloads:** Ningún mensaje de WebSocket entrante puede exceder los límites predefinidos (un batch de 15 frames con 178 puntos flotantes debe validar estrictamente tipos y longitudes).
2. **Desinfección de Etiquetas:** El campo `label` devuelto por el modelo debe sanearse antes de inyectarse en el DOM.
3. **Manejo Seguro de Punteros en C++:** Validar que `frame_queue.h` y `inference_thread.cpp` no presenten fugas de memoria (*memory leaks*), condiciones de carrera (*race conditions*) ni referencias colgantes (*dangling pointers*).
