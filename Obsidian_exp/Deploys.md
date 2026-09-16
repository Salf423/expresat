# Guía General de Despliegue (Deploy)

Este documento detalla los pasos, consideraciones y notas críticas para desplegar la arquitectura completa de **Expresat**. Aunque el proyecto cuenta ahora con una rama nativa (C++ para Escritorio/Android), esta guía cubre principalmente la **arquitectura web cliente-servidor** (Frontend, Backend, Base de Datos y Modelo), así como la distribución del binario nativo.

---

## 1. Base de Datos y Autenticación (Supabase)

El proyecto utiliza **Supabase** como Backend-as-a-Service (BaaS) para proveer la base de datos (PostgreSQL) y el sistema de autenticación (JWT).

### Pasos de Despliegue:
1. Crear un proyecto en [Supabase](https://supabase.com).
2. Configurar el esquema de la base de datos (ejecutar migraciones o scripts SQL para crear las tablas de usuarios y métricas, si las hay).
3. Habilitar los proveedores de autenticación necesarios (Email/Password, Google, etc.).
4. Obtener las credenciales: `SUPABASE_URL` y `SUPABASE_KEY` (anon/public).

> [!CRITICAL] Detalles Críticos
> - **RLS (Row Level Security)**: Asegúrate de habilitar y configurar políticas RLS en tus tablas de PostgreSQL para que los usuarios no puedan leer o modificar datos de otros usuarios.
> - **Claves Secretas**: Nunca expongas la `SUPABASE_SERVICE_ROLE_KEY` en el frontend. El frontend solo debe usar la clave "anon".

---

## 2. Backend (FastAPI + WebSockets)

El backend expone la API REST y gestiona las conexiones WebSocket para la inferencia en tiempo real. 

### Opciones de Hosting Recomendadas:
- **PaaS (Platform as a Service)**: Render, Railway, Fly.io (muy recomendados para WebSockets).
- **VPS / IaaS**: DigitalOcean Droplet, AWS EC2, Google Compute Engine (requiere configurar Docker o Nginx + Uvicorn manualmente).

### Pasos Generales (usando Docker / VPS):
1. Clonar el repositorio en el servidor o vincular el repositorio al servicio PaaS.
2. Configurar las variables de entorno (`.env`):
   ```env
   SUPABASE_URL=tu_supabase_url
   SUPABASE_KEY=tu_supabase_key
   MODEL_DIR=./models/exported_model
   CONFIDENCE_THRESHOLD=0.8
   ```
3. Construir la imagen de Docker (usando el `Dockerfile` proporcionado):
   ```bash
   docker build -t expresat-backend .
   ```
4. Levantar el contenedor, exponiendo el puerto necesario (ej. 8000):
   ```bash
   docker run -d -p 8000:8000 --env-file .env expresat-backend
   ```

> [!WARNING] Notas Importantes para WebSockets
> - Muchos balanceadores de carga y proxies inversos (como Nginx o Cloudflare) cierran las conexiones WebSocket si están inactivas por mucho tiempo. Debes configurar **timeouts** (ej. `proxy_read_timeout` en Nginx) para evitar desconexiones.
> - En plataformas Serverless puros (como AWS Lambda o Vercel Functions), los WebSockets **NO** funcionan de manera persistente. Usa siempre servicios alojados (PaaS/VPS) para el backend.

---

## 3. Frontend (React + Vite)

El frontend captura el video, ejecuta MediaPipe Holistic y se comunica con el Backend.

### Opciones de Hosting Recomendadas:
- Vercel, Netlify (ya existe un `netlify.toml`), Cloudflare Pages.

### Pasos de Despliegue:
1. Vincular el repositorio a Netlify o Vercel.
2. Especificar el directorio raíz (`expresat/frontend`).
3. Comando de build: `npm run build` (o `yarn build`).
4. Directorio de salida: `dist`.
5. Configurar las variables de entorno en el panel del hosting:
   ```env
   VITE_API_URL=wss://tu-backend.com/ws
   VITE_SUPABASE_URL=tu_supabase_url
   VITE_SUPABASE_ANON_KEY=tu_supabase_anon_key
   ```

> [!TIP] Notas
> - Dado que es una Single Page Application (SPA), asegúrate de que el hosting esté configurado para redirigir todas las peticiones a `index.html` (Netlify ya lo hace mediante el `netlify.toml`).
> - Usa siempre **HTTPS** (`wss://` en lugar de `ws://`) en producción, de lo contrario los navegadores modernos bloquearán el acceso a la cámara y la conexión mixta por seguridad.

---

## 4. El Modelo (Inferencia)

El modelo entrenado (`expresat_gru_float32.onnx`) no se despliega de forma independiente, sino que forma parte integral del despliegue.

### Consideraciones:
- **Backend Web**: El archivo `.onnx` debe copiarse dentro de la imagen de Docker (asegúrate de que el path en `MODEL_DIR` coincide). Como ONNX Runtime ejecutará esto en CPU en la mayoría de hostings estándar, asegúrate de que tu instancia tenga suficientes recursos de CPU, o usa un hosting con GPU si compilas ONNX Runtime con soporte CUDA.
- **Peso del Archivo**: Si el modelo `.onnx` pesa más de 50-100MB (no suele ser el caso de GRU cuantizados), Git LFS podría ser necesario, o deberás descargar el modelo desde un bucket S3 durante la construcción de la imagen de Docker.

---

## 5. Distribución Nativa (C++ / Android)

Si el objetivo principal ahora es **`expresat-native`**, el paradigma cambia completamente:
- **No hay backend ni hosting Web**: La inferencia ocurre localmente en el dispositivo del usuario.
- **Windows/Linux**: Compila el binario en modo `Release` usando CMake, empaqueta el ejecutable junto con `expresat_gru_float32.onnx` y las DLLs de ONNX Runtime, y distribúyelo en un instalador (ej. NSIS) o `.zip`.
- **Android**: Compila el `.apk` o `.aab` a través de Android Studio / Gradle. El modelo `.onnx` debe empaquetarse en la carpeta `assets/` de la app y extraerse al almacenamiento local durante el inicio para que el código C++ (JNI) pueda leerlo.
