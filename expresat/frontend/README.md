# ExpresaT - Frontend Documentation

## Descripción General
ExpresaT es una plataforma diseñada para la traducción en tiempo real de Lengua de Señas a texto, utilizando visión artificial en el navegador y procesamiento en el backend mediante WebSockets.

## Arquitectura del Sistema
El frontend está construido con tecnologías web estándar (HTML5, CSS3, JavaScript ES6) para maximizar la compatibilidad y velocidad.

### Componentes Principales (`frontend/js/`)

1.  **`app.js` (Orquestador)**:
    *   Gestiona el ciclo de vida inicial de la aplicación.
    *   Actúa como middleware de autenticación, decidiendo si mostrar el login o la app principal.
    *   Conecta los servicios de API y Visión Artificial.

2.  **`auth_service.js` (Autenticación)**:
    *   Integración directa con **Supabase Auth**.
    *   Maneja el registro, inicio de sesión y persistencia de la sesión mediante el SDK de Supabase.

3.  **`api_service.js` (Comunicación)**:
    *   Implementa la comunicación bidireccional mediante **WebSockets**.
    *   Incluye lógica de reconexión resiliente (backoff exponencial).
    *   Calcula la latencia (ping/pong) para asegurar una experiencia de usuario fluida.

4.  **`mediapipe_engine.js` (Visión Artificial)**:
    *   Utiliza **MediaPipe Holistic** para detectar poses y gestos de las manos.
    *   Captura la cámara a **15 FPS**, un balance óptimo entre precisión y carga computacional.
    *   Extrae y normaliza los "landmarks" (puntos clave) antes de enviarlos al backend.

5.  **`ui_controller.js` (Efectos Visuales)**:
    *   Gestiona el fondo dinámico de partículas.
    *   Implementa animaciones de entrada eficientes usando `IntersectionObserver`.

6.  **`navbar.js` (Navegación)**:
    *   Controla los menús responsivos y el estado visual del usuario en la barra superior.

## Flujo de Datos
1.  **Captura**: El `MediaPipeEngine` toma fotogramas del video.
2.  **Detección**: Se extraen las coordenadas de las manos y el cuerpo.
3.  **Envío**: El `ApiService` envía estas coordenadas vía WebSocket al servidor FastAPI.
4.  **Recepción**: El servidor procesa los datos y devuelve una traducción.
5.  **Visualización**: `app.js` recibe la traducción y la muestra en la pantalla principal.

## Decisiones Técnicas
*   **No Bundler (Vite/Webpack)**: Para este prototipo, se ha decidido usar JavaScript modular nativo para facilitar la edición rápida y despliegue directo.
*   **MediaPipe CDN**: Se cargan los modelos desde CDN para reducir el peso inicial del repositorio y aprovechar el almacenamiento en caché del navegador.
*   **WebSockets vs HTTP**: Se usa WebSockets para permitir una traducción "streaming", eliminando la latencia de las peticiones HTTP repetitivas.
