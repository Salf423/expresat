---
title: "Skills Especializadas: DevOps, CI/CD y Despliegue Multiplataforma"
description: "Habilidades para containerización con Docker, despliegue web en Netlify/Fly.io, compilación C++ multiplataforma con CMake, empaquetado Android y automatización con GitHub Actions."
version: "2.0.0"
category: "Skills / DevOps & Infraestructura"
target_agents: ["devops-troubleshooter", "deployment-engineer", "cloud-architect"]
related_docs:
  - "[[00_Matriz_General_Skills]]"
  - "[[../Deploys]]"
  - "[[../Estructura del proyecto]]"
  - "[[../Explicacion del codigo/Dataset_Generator/01_Arquitectura_y_Compilacion]]"
  - "[[../Explicacion del codigo/Dataset_Generator/05_Serializacion_JSON_y_CICD]]"
---

# 🚀 Skills Especializadas: DevOps, CI/CD y Despliegue Multiplataforma

> **Navegación:** [[../00_INDICE_MAESTRO|🏠 Índice Maestro]] > [[00_Matriz_General_Skills|🧭 Matriz de Skills]] > **DevOps, CI/CD y Despliegue**

**ExpresaT** tiene una infraestructura de entrega diversa que abarca:
1. **Frontend Web:** Netlify (`netlify.toml`) para distribución estática en CDN global con soporte HTTPS obligatorio.
2. **Backend Server:** Contenedores Docker desplegados en PaaS (Render, Fly.io, Railway) optimizados para WebSockets persistentes.
3. **Escritorio Nativo:** CMake 3.20+ con perfiles de optimización en GCC/Clang/MSVC para Windows y Linux.
4. **Móvil Android:** Gradle + Android NDK con empaquetado de assets `.onnx` para inferencia local offline.

---

## 🛠️ Catálogo de Skills Instaladas en este Dominio

### 1. `deployment-pipeline-design` & `github-actions-templates`
- **Ubicación:**
  - `~/.gemini/config/skills/deployment-pipeline-design/SKILL.md`
  - `~/.gemini/config/skills/github-actions-templates/SKILL.md`
- **Objetivo:** Creación y mantenimiento de workflows de GitHub Actions (`.github/workflows/`), incluyendo validación de tests, linting (`oxlint`), construcción de artefactos y pipeline de entrenamiento continuo del modelo.
- **Cuándo invocar:**
  - Configurar el pipeline CI que entrena automáticamente `SignLanguageGRU` al detectar commits con datasets `.json`.
  - Configurar releases automáticas de binarios de escritorio.

### 2. `android-cli`
- **Ubicación:** `~/.gemini/config/plugins/android-cli-plugin/skills/SKILL.md`
- **Objetivo:** Orquestación de tareas de Android SDK/NDK, compilación con `./gradlew assembleRelease`, diagnósticos de emuladores y verificación de manifiestos y permisos (cámara `android.permission.CAMERA`).
- **Cuándo invocar:**
  - Diagnosticar fallos de compilación en `expresat-native/android`.
  - Asegurar la correcta extracción de activos ONNX desde `assets/` a la memoria interna de la aplicación.

### 3. `deployment-validation-config-validate`
- **Ubicación:** `~/.gemini/config/skills/deployment-validation-config-validate/SKILL.md`
- **Objetivo:** Validación estricta de variables de entorno requeridas (`SUPABASE_URL`, `SUPABASE_KEY`, `MODEL_DIR`, `VITE_API_URL`), detección de configuraciones faltantes antes del arranque del servidor.

### 4. `prometheus-configuration` & `grafana-dashboards`
- **Ubicación:**
  - `~/.gemini/config/skills/prometheus-configuration/SKILL.md`
  - `~/.gemini/config/skills/grafana-dashboards/SKILL.md`
- **Objetivo:** Instrumentación de métricas operacionales (latencia de inferencia por frame, número de sockets concurrentes activos, uso de memoria de la sesión ONNX).

### 5. `devops-troubleshooter`
- **Ubicación:** `~/.gemini/config/skills/devops-troubleshooter/SKILL.md`
- **Objetivo:** Diagnóstico de incidentes en despliegues: errores 502/504 en proxies inversos Nginx para WebSockets, caídas de contenedores Docker por límite de memoria (OOM).

---

## 📋 Reglas Críticas de Despliegue para Agentes

1. **Protocolo Seguro Obligatorio:** En producción, el frontend web solo se conecta vía `wss://`. Los navegadores modernos bloquean WebSockets inseguros (`ws://`) desde dominios con `https://`.
2. **Persistencia de Conexiones WebSocket:** No desplegar el backend en entornos serverless efímeros (como AWS Lambda o Vercel Serverless Functions) debido a la desconexión inmediata de los WebSockets de inferencia en tiempo real.
3. **Single Process Uvicorn con Modelo en Memoria:** Mantener `--workers 1` si el contenedor aloja el modelo en memoria compartida, o escalar horizontalmente mediante contenedores independientes si la demanda concurrente lo amerita.
