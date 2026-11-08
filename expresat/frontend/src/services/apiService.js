export class ApiService {
    /**
     * Inicializa el servicio de API con soporte para WebSockets.
     * @param {string} url - La URL base del servidor (puede ser http/https/ws/wss,
     *   con o sin path). Internamente se extrae sólo el origin para construir los
     *   endpoints correctos, evitando duplicación de rutas.
     * Configura parámetros de reconexión exponencial para manejar caídas de red de forma resiliente.
     * Define el endpoint WebSocket canónico /ws/translate y permite configurar
     * el número máximo de intentos de reconexión.
     */
    static WS_ENDPOINT = "/ws/translate";

    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10; // Max 10 attempts before giving up
        this.baseDelay = 1000; // 1 second initial delay
        this.onMessageCallback = null;
        this.onStatusChangeCallback = null;
        this.pingInterval = null;
        this.lastPingTime = 0;
        this.lastHealthCheck = 0;
        this.healthCheckInterval = null;
    }

    /**
     * Establece la conexión WebSocket con el servidor.
     * Decisión: El token JWT se enviará por mensaje inicial { type: "auth", token: "..." }
     * para evitar filtraciones en logs HTTP/WS, con fallback a query param solo en modo desarrollo.
     * Configura manejadores para eventos open, message, close y error.
     * Hace un fetch a /health primero para despertar el contenedor de Render.
     * Propaga fallos críticos del health-check al callback de estado de UI cuando el servidor
     * sea inalcanzable después de varios intentos.
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

        // Final endpoints — paths are derived from canonical constant, not hardcoded
        const healthUrl = `${origin}/health`;
        // C4: Use canonical WS endpoint constant /ws/translate, token sent via query param + auth message
        const effectiveToken = token || (typeof window !== 'undefined' ? localStorage.getItem('supabaseToken') : null);
        const queryParam = effectiveToken ? `?token=${encodeURIComponent(effectiveToken)}` : '';
        const wsUrl = `${wsProtocol}//${host}${ApiService.WS_ENDPOINT}${queryParam}`;

        console.log('[ApiService] health check →', healthUrl);
        // Mask token in log - avoid printing full tokens
        const tokenSafe = effectiveToken && effectiveToken.length > 0 ? effectiveToken.substring(0, 20) + "..." : "vacío";
        console.log('[ApiService] websocket    →', `${wsProtocol}//${host}${ApiService.WS_ENDPOINT}`, "(token:", tokenSafe, ")");

        // ── Wake-up Render container ───────────────────────────────────────────
        this.updateStatus('Despertando servidor...', 'status-offline');
        try {
            await fetch(healthUrl);
        } catch (error) {
            console.warn('[ApiService] Health check falló, continuando con WS...', error);
            // M4: Propagar fallo crítico del health check al estado de UI
            // después de un solo intento (no reintentamos aquí, el WS maneja reconexión)
            this.updateStatus('Servidor inalcanzable', 'status-offline');
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

            // Send authentication message after handshake to avoid token in URL/query param
            // H5: Auth via initial message { type: "auth", token: "..." }
            const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('supabaseToken') : null);
            if (authToken) {
                // Mask token in log
                const authTokenSafe = authToken.length > 20 ? authToken.substring(0, 20) + "..." : authToken;
                console.log('[ApiService] Enviando auth mensaje (token masked: ' + authTokenSafe + ')');
                try {
                    this.ws.send(JSON.stringify({ type: "auth", token: authToken }));
                } catch (e) {
                    console.error('[ApiService] Error sending auth message:', e);
                }
            }
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
                const latency = Math.round(performance.now() - this.lastPingTime);
                const latencyEl = document.getElementById('latency-counter');
                if (latencyEl) latencyEl.innerText = `Latencia: ${latency} ms`;
            } else if (data.type === 'auth_ack') {
                console.log('[ApiService] Autenticación confirmada por el servidor:', data.payload);
            } else if ((data.type === 'translation' || data.type === 'telemetry') && this.onMessageCallback) {
                this.onMessageCallback(data.payload);
            }
        };

        this.ws.onclose = (event) => {
            console.warn('WebSocket Desconectado', event);
            clearInterval(this.pingInterval);

            // M4: Si el cierre fue por política de autenticación (1008), 403 o token ausente/inválido,
            // NO reintentamos en bucle para no saturar el servidor ni el navegador.
            const closeReason = event.reason || '';
            const isAuthOrTokenError = 
                event.code === 1008 ||
                event.code === 4403 ||
                closeReason.includes('Token ausente') || 
                closeReason.includes('Token inválido') || 
                closeReason.includes('Token expirado') ||
                closeReason.toLowerCase().includes('token');

            if (isAuthOrTokenError) {
                console.warn(`[ApiService] Cierre por autenticación (código ${event.code}, motivo: "${closeReason}") — reintentos cancelados.`);
                this.updateStatus('Autenticación requerida', 'status-offline');
                if (this.onStatusChangeCallback) {
                    this.onStatusChangeCallback(closeReason || 'Sesión expirada o token requerido', 'status-offline');
                }
                return;
            }

            // Reconexión normal con backoff para desconexiones de red imprevistas
            this.updateStatus('Desconectado', 'status-offline');
            this.handleReconnect(token);
        };

        this.ws.onerror = (error) => {
            // C4: No imprimir tokens completos en logs de error
            console.error('[ApiService] WebSocket Error: conexión fallida, intentando reconexión', error);
            this.updateStatus('Error', 'status-offline');
        };
    }

    /**
     * Implementa la lógica de reconexión con backoff exponencial.
     * Incrementa el tiempo de espera entre intentos para no saturar el servidor.
     * Lanza al máximo 10 intentos antes de reportar estado final.
     * @param {string} token - El token para re-autenticar la conexión.
     */
    handleReconnect(token) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = this.baseDelay * Math.pow(2, this.reconnectAttempts);
            console.log(`Reconectando en ${delay}ms... (Intento ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectAttempts++;
                this.connect(token);
            }, delay);
        } else {
            console.error('Máximos intentos de reconexión alcanzados (10).');
            this.updateStatus('Fallo conexión', 'status-offline');
            // M4: Propagar estado de fallo crítico a la UI
            if (this.onStatusChangeCallback) {
                this.onStatusChangeCallback('Máximo intentos de reconexión alcanzados', 'status-offline');
            }
        }
    }

    /**
     * Cierra limpiamente la conexión WebSocket y cancela temporizadores.
     */
    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        clearInterval(this.pingInterval);
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
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
            try {
                this.ws.send(JSON.stringify({
                    type: 'inference',
                    payload: landmarksData
                }));
            } catch (err) {
                console.warn('[ApiService] Error al enviar landmarks (WS desconectado):', err);
            }
        }
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onStatusChange(callback) {
        this.onStatusChangeCallback = callback;
    }
}