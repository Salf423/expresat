export class ApiService {
    /**
     * Initializes the API service with WebSocket support.
     * @param {string} url - Server base URL (http/https/ws/wss, with or without path).
     *   Extracts only the origin internally to build endpoints without duplicate path segments.
     *   Configures exponential backoff for transient network disconnections and uses the
     *   canonical /ws/translate endpoint.
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
     * Opens the WebSocket connection to the server.
     * Sends the JWT in an initial `{ type: "auth", token }` message to avoid leaking
     * credentials in logs, keeping the query param fallback when provided.
     * Fetches `/health` first to wake sleeping backend instances and surfaces
     * reachability failures to the UI status callback.
     * @param {string} token - Supabase access token.
     */
    async connect(token) {
        // URL sanitization via new URL(): extract only the origin so env vars with paths
        // (such as /ws/translate) never duplicate routes. Normalize ws(s) to http(s) first.
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

        // Derive endpoints from canonical constants
        const healthUrl = `${origin}/health`;
        const effectiveToken = token || (typeof window !== 'undefined' ? localStorage.getItem('supabaseToken') : null);
        const queryParam = effectiveToken ? `?token=${encodeURIComponent(effectiveToken)}` : '';
        const wsUrl = `${wsProtocol}//${host}${ApiService.WS_ENDPOINT}${queryParam}`;

        console.log('[ApiService] health check ->', healthUrl);
        const tokenSafe = effectiveToken && effectiveToken.length > 0 ? effectiveToken.substring(0, 20) + "..." : "empty";
        console.log('[ApiService] websocket    ->', `${wsProtocol}//${host}${ApiService.WS_ENDPOINT}`, "(token:", tokenSafe, ")");

        // Wake up Render container before opening WebSocket
        this.updateStatus('Despertando servidor...', 'status-offline');
        try {
            await fetch(healthUrl);
        } catch (error) {
            console.warn('[ApiService] Health check falló, continuando con WS...', error);
            // Surface health check failure to UI state once; WebSocket handles retries
            this.updateStatus('Servidor inalcanzable', 'status-offline');
        }

        // Open WebSocket
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

            // Send authentication message after handshake to avoid keeping token only in query param
            const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('supabaseToken') : null);
            if (authToken) {
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

            // Do not reconnect in a tight loop on auth/policy rejections (1008, 4403, missing/invalid token)
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

            // Reconnect with exponential backoff on unexpected network disconnects
            this.updateStatus('Desconectado', 'status-offline');
            this.handleReconnect(token);
        };

        this.ws.onerror = (error) => {
            console.error('[ApiService] WebSocket Error: conexión fallida, intentando reconexión', error);
            this.updateStatus('Error', 'status-offline');
        };
    }

    /**
     * Implements exponential backoff reconnection.
     * Increases delay between attempts up to 10 retries before reporting failure.
     * @param {string} token - Access token used to re-authenticate on reconnect.
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
            if (this.onStatusChangeCallback) {
                this.onStatusChangeCallback('Máximo intentos de reconexión alcanzados', 'status-offline');
            }
        }
    }

    /**
     * Cleanly closes the WebSocket connection and clears pending timers.
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
     * Updates the visual connection state in the UI.
     * @param {string} text - Label to display (e.g., "Conectado").
     * @param {string} className - CSS class for status styling.
     */
    updateStatus(text, className) {
        if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback(text, className);
        }
    }

    /**
     * Sends detected hand and pose landmarks to the server for inference.
     * Only sends when the WebSocket is open to avoid socket errors.
     * @param {Object} landmarksData - Hand and pose X, Y, Z coordinates.
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