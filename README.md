# ExpresaT — Traductor de Lengua de Señas Mexicana (LSM) en Tiempo Real

ExpresaT es una plataforma de accesibilidad que traduce gestos de **Lengua de Señas Mexicana (LSM)** a texto y voz en tiempo real directamente desde el navegador, optimizada para ejecutarse con fluidez (15–30 FPS) en hardware modesto sin GPU dedicada (ej. AMD Ryzen 3 7320U con iGPU Radeon 610M sobre Linux/Firefox).

---

## Arquitectura Desacoplada (4 Capas)

El frontend (`expresat/frontend/src/`) está organizado en 4 capas independientes:

1. **`src/engine/` (`SignEngine`)**: Captura de cámara (`getUserMedia`) + MediaPipe (`@mediapipe/tasks-vision` `HandLandmarker` con WASM local en `/public/wasm` y modelo en `/public/models/hand_landmarker.task`) ejecutándose **en el hilo principal (sin Workers)**. Mide y emite **FPS de Cámara** y **FPS de Inferencia** reales por separado, con cleanup 100% idempotente bajo React 19 `StrictMode`.
2. **`src/recognition/` (`GeometricClassifier`, `fingerStates`, `normalizeHand`)**: Funciones **100% puras y testeables** sin dependencias de React ni del DOM. Normaliza las manos por escala (`palmScale`) y rotación en el plano XY, evalúa extensión y ángulos articulares de los 5 dedos, detecta señas dinámicas (`Hola`) mediante ventana temporal y suaviza predicciones por votación de $N$ frames (`SmoothingVoter`). Define la interfaz `Classifier { predict(frames) -> { label, confidence } }` lista para enchufar `ModelClassifier` (ONNX/GRU) después.
3. **`src/transport/` (`WSClient`)**: Cliente WebSocket **opcional** hacia `/ws/translate` con máquina de estados explícita (`idle | connecting | open | auth_error | failed`), backoff exponencial para caídas de red y **cero reintentos** ante rechazo por política/autenticación (`1008`, `401`, `403` o ausencia de token).
4. **`src/ui/` (`useSignEngine`, `drawLandmarks`) y `src/pages/Translator.jsx`**: Interfaz React 19 que funciona **100% en el navegador en modo demo** incluso sin backend ni inicio de sesión.

Para el detalle completo de decisiones de diseño, consulta [`docs/ARQUITECTURA.md`](./docs/ARQUITECTURA.md) y [`docs/REPORTE.md`](./docs/REPORTE.md).

---

## Cómo Correr Todo en Local (Terminal `fish` en Linux)

### Opción A: Modo Demo 100% en el Navegador (Sin Backend)

El modo demo geométrico funciona íntegramente en el navegador sin necesidad de levantar FastAPI ni configurar Supabase:

```fish
cd /home/adrian/Proyectos/expresat/expresat/frontend

# (Opcional) Crear archivo .env a partir de la plantilla
cp -n .env.example .env

# Iniciar servidor de desarrollo Vite
npm run dev
```

Abre `http://localhost:5173/translator` en Firefox o Chromium, concede permiso de cámara y realiza cualquiera de los gestos soportados (`Mano Abierta`, `Puño`, `Uno`, `Dos`, `OK / Pinza`, `Bien`, `Te Quiero`, `Lunes`, `Hola`).

---

### Opción B: Con Backend FastAPI en Modo Demo (`EXPRESAT_DEMO_MODE=true`)

Si deseas conectar también el canal WebSocket hacia el servidor FastAPI local:

**Terminal 1 — Backend (fish):**
```fish
cd /home/adrian/Proyectos/expresat

# Activar entorno virtual de Python en fish
source expresat/venv/bin/activate.fish

# Iniciar FastAPI en modo demo (acepta WebSocket sin requerir token JWT de Supabase)
set -x PYTHONPATH expresat expresat/backend
set -x EXPRESAT_DEMO_MODE true
set -x FASTAPI_ENV development
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend (fish):**
```fish
cd /home/adrian/Proyectos/expresat/expresat/frontend
npm run dev
```

Al abrir `http://localhost:5173/translator` con el selector de entorno en **Local**, el indicador de estado mostrará **"Conectado"** (`ws-state="open"`).

---

## Comandos de Verificación, Linter y Pruebas (fish)

```fish
# 1. Linter, Pruebas Unitarias (Vitest) y Build de Producción del Frontend
cd /home/adrian/Proyectos/expresat/expresat/frontend
npm run lint
npm test
npm run build

# 2. Pruebas E2E Automatizadas en Navegador con Cámara Falsa (Playwright)
npm run test:e2e

# 3. Pruebas Unitarias e Integración del Backend (Python)
cd /home/adrian/Proyectos/expresat
source expresat/venv/bin/activate.fish
env PYTHONPATH="expresat:expresat/backend" python -m unittest expresat/backend/test_api_integration.py expresat/backend/test_demo_rules.py
```

---

## Configuración Manual en Producción (Netlify y Render)

### 1. En Render (Backend FastAPI)
Configura las siguientes variables de entorno en el panel **Environment** de tu servicio en Render:
- `EXPRESAT_DEMO_MODE` = `true` *(permite conexiones WebSocket públicas sin exigir token de Supabase y activa las reglas geométricas en el servidor)*
- `CORS_ORIGINS` = `https://expresat.netlify.app,https://ecpresatt.netlify.app,http://localhost:5173`
- `FASTAPI_ENV` = `production`

Después de guardar las variables, ejecuta **Manual Deploy -> Deploy latest commit**.

### 2. En Netlify (Frontend React + Vite)
Configura las siguientes variables en **Site configuration -> Environment variables**:
- `VITE_DEMO_MODE` = `true`
- `VITE_API_URL` = `https://expresat.onrender.com`
- `VITE_WS_URL_PROD` = `wss://expresat.onrender.com/ws/translate`
- *(Opcionales si habilitas login)* `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`

Después de guardar, ejecuta **Trigger deploy -> Clear cache and deploy site**.
