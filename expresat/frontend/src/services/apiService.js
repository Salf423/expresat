export class ApiService {
    /**
     * Inicializa el servicio de API con soporte para WebSockets.
     * @param {string} url - La URL base del servidor (puede ser http/https/ws/wss,
     *   con o sin path). Internamente se extrae sólo el origin para construir los
     *   endpoints correctos, evitando duplicación de rutas.
     * Configura parámetros de reconexión exponencial para manejar caídas de red de forma resiliente.
     */
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.baseDelay = 1000; // 1 second
        this.onMessageCallback = null;
        this.onStatusChangeCallback = null;
        this.pingInterval = null;
        this.lastPingTime = 0;
    }

    /**
     * Establece la conexión WebSocket con el servidor.
     * Decisión: El token JWT se envía en la URL para simplificar la autenticación en el handshake inicial.
     * Configura manejadores para eventos open, message, close y error.
     * Hace un fetch a /health primero para despertar el contenedor de Render.
     * @param {string} token - Token de acceso de Supabase.
     */
    async connect(token) {
        // ── URL Sanitization via new URL() ────────────────────────────────────
        // new URL().origin strips ALL path/query/hash from the env var,
        // so it doesn't matter if VITE_WS_URL contains a path like /ws/translate:
        // we ALWAYS derive health and WS endpoints from the bare origin only.
        //
        //   'https://expresat.onrender.com'            → origin = 'https://expresat.onrender.com'
        //   'wss://expresat.onrender.com/ws/translate' → origin = 'https://expresat.onrender.com'
        //   'http://127.0.0.1:8000'                    → origin = 'http://127.0.0.1:8000'
        //
        // new URL() does not accept ws:// / wss:// — normalise to http(s) first.
        const rawUrl = this.url;
        const httpNormalised = rawUrl
            .replace(/^wss:\/\//i, 'https://')
            .replace(/^ws:\/\//i,  'http://');

        let origin;
        try {
            origin = new URL(httpNormalised).origin; // e.g. 'https://expresat.onrender.com'
        } catch {
            console.error('[ApiService] URL inválida en la configuración:', rawUrl);
            this.updateStatus('Error de configuración', 'status-offline');
            return;
        }

        // Derive WebSocket protocol from the HTTP origin
        const wsProtocol = origin.startsWith('https') ? 'wss:' : 'ws:';
        const host = new URL(origin).host; // 'expresat.onrender.com' | '127.0.0.1:8000'

        // Final endpoints — paths are HARDCODED here, never taken from the env var.
        const healthUrl = `${origin}/health`;
        const wsUrl     = `${wsProtocol}//${host}/ws/translate?token=${encodeURIComponent(token)}`;

        console.log('[ApiService] health check →', healthUrl);
        console.log('[ApiService] websocket    →', wsUrl);

        // ── Wake-up Render container ───────────────────────────────────────────
        this.updateStatus('Despertando servidor...', 'status-offline');
        try {
            await fetch(healthUrl);
        } catch (error) {
            console.warn('[ApiService] Health check falló, continuando con WS...', error);
        }

        // ── Open WebSocket ─────────────────────────────────────────────────────
        this.ws = new WebSocket(wsUrl);
        this.updateStatus('Conectando...', 'status-offline');

        this.ws.onopen = () => {
            console.log('WebSocket Conectado');
            this.reconnectAttempts = 0;
            this.updateStatus('Conectado', 'status-online');

            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.lastPingTime = performance.now();
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 2000);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
                const latency = Math.round(performance.now() - this.lastPingTime);
                const latencyEl = document.getElementById('latency-counter');
                if (latencyEl) latencyEl.innerText = `Latencia: ${latency} ms`;
            } else if (data.type === 'translation' && this.onMessageCallback) {
                this.onMessageCallback(data.payload);
            }
        };

        this.ws.onclose = (event) => {
            console.warn('WebSocket Desconectado', event);
            this.updateStatus('Desconectado', 'status-offline');
            clearInterval(this.pingInterval);
            this.handleReconnect(token);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            this.updateStatus('Error', 'status-offline');
        };
    }

    /**
     * Implementa la lógica de reconexión con backoff exponencial.
     * Incrementa el tiempo de espera entre intentos para no saturar el servidor.
     * @param {string} token - El token para re-autenticar la conexión.
     */
    handleReconnect(token) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
            console.log(`Reconectando en ${delay}ms... (Intento ${this.reconnectAttempts + 1})`);
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect(token);
            }, delay);
        } else {
            console.error('Máximos intentos de reconexión alcanzados.');
            this.updateStatus('Fallo conexión', 'status-offline');
        }
    }

    /**
     * Actualiza el estado visual de la conexión en la UI.
     * @param {string} text - Texto a mostrar (ej. "Conectado").
     * @param {string} className - Clase CSS para el estilo visual.
     */
    updateStatus(text, className) {
        if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback(text, className);
        }
    }

    /**
     * Envía los puntos clave (landmarks) detectados al servidor para su procesamiento.
     * Solo envía datos si la conexión está abierta para evitar errores.
     * @param {Object} landmarksData - Coordenadas X,Y,Z de manos y pose.
     */
    sendLandmarks(landmarksData) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'inference',
                payload: landmarksData
            }));
        }
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onStatusChange(callback) {
        this.onStatusChangeCallback = callback;
    }
}
