export class ApiService {
    /**
     * Initializes the API service with WebSocket support.
     * @param {string} url - WebSocket endpoint URL.
     * Configures exponential backoff parameters to recover cleanly from network drops.
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
     * Establishes the WebSocket connection with the server.
     * Sends the JWT token in the URL query string for initial handshake auth,
     * registers event handlers, and runs a ping/pong latency probe.
     * @param {string} token - Supabase access token.
     */
    connect(token) {
        const wsUrl = `${this.url}?token=${encodeURIComponent(token)}`;
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
                if(latencyEl) latencyEl.innerText = `Latencia: ${latency} ms`;
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
     * Implements exponential backoff reconnection logic to avoid overloading the server.
     * @param {string} token - Access token used to re-authenticate on reconnect.
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
     * Updates the visual connection state in the UI.
     * @param {string} text - Status label (e.g. "Conectado").
     * @param {string} className - CSS class applied for visual styling.
     */
    updateStatus(text, className) {
        if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback(text, className);
        }
    }

    /**
     * Sends detected landmarks to the server for processing.
     * Only transmits when the WebSocket is open to avoid errors.
     * @param {Object} landmarksData - Hand and pose X, Y, Z coordinates.
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
