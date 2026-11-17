/**
 * Optional WebSocket client with an explicit connection state machine.
 *
 * Explicit states:
 *   'idle' | 'connecting' | 'open' | 'auth_error' | 'failed'
 *
 * Behavior:
 * - 100% optional: never blocks local landmark tracking.
 * - Uses exponential backoff for transient network failures.
 * - Never retries when rejected by policy or authentication:
 *     - WebSocket close codes 1008 (Policy Violation), 4001, 4003, 4401, 4403
 *     - HTTP 401 or 403 on the `/health` pre-check
 *     - Missing token when the server reports `demo_mode === false`
 *   In those cases, transitions immediately to `'auth_error'` for UI reporting.
 */

import { getActiveEndpoints } from '../config.js';

export const WS_STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  AUTH_ERROR: 'auth_error',
  FAILED: 'failed',
});

const AUTH_REJECT_CODES = new Set([1008, 4001, 4003, 4401, 4403]);

/**
 * Normalizes any base URL (`http://...`, `https://...`, `ws://...`, `wss://...`)
 * into a WebSocket URL targeting `/ws/translate`.
 */
export function normalizeWsEndpoint(rawUrl) {
  const endpoints = getActiveEndpoints();
  const base = (rawUrl || endpoints.wsUrl || '').trim();
  if (!base) return 'ws://127.0.0.1:8000/ws/translate';

  let wsBase = base;
  if (wsBase.startsWith('https://')) {
    wsBase = `wss://${wsBase.slice('https://'.length)}`;
  } else if (wsBase.startsWith('http://')) {
    wsBase = `ws://${wsBase.slice('http://'.length)}`;
  }

  wsBase = wsBase.replace(/\/+$/, '');
  if (wsBase.endsWith('/ws/translate')) return wsBase;
  if (wsBase.endsWith('/ws')) return `${wsBase}/translate`;
  return `${wsBase}/ws/translate`;
}

/**
 * Derives the HTTP `/health` URL associated with a WebSocket endpoint.
 */
export function deriveHealthUrl(wsUrl) {
  try {
    const parsed = new URL(wsUrl);
    const httpProto = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    return `${httpProto}//${parsed.host}/health`;
  } catch (err) {
    console.warn('[WSClient] No se pudo derivar /health desde:', wsUrl, err.message);
    return null;
  }
}

export class WSClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.url] WebSocket URL
   * @param {number} [options.maxRetries=4] Max reconnect retries on network failures
   * @param {number} [options.baseDelayMs=1000] Base delay for exponential backoff
   * @param {number} [options.pingIntervalMs=5000] Ping interval for latency measurement
   * @param {Function} [options.WebSocketImpl] Injected WebSocket class (for tests)
   * @param {Function} [options.fetchImpl] Injected fetch function (for tests)
   */
  constructor(options = {}) {
    this.url = normalizeWsEndpoint(options.url);
    this.maxRetries = options.maxRetries ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.pingIntervalMs = options.pingIntervalMs ?? 5000;
    this.WebSocketImpl =
      options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.fetchImpl =
      options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    this.state = WS_STATES.IDLE;
    this.statusDetail = 'Modo local en navegador (sin conexión remota iniciada)';
    this.serverDemoMode = null;
    this.latencyMs = 0;

    this._ws = null;
    this._token = null;
    this._retryCount = 0;
    this._retryTimer = null;
    this._pingTimer = null;
    this._lastPingSentAt = 0;
    this._manualDisconnect = false;
    this._connectRunId = 0;

    this._stateListeners = new Set();
    this._messageListeners = new Set();
  }

  /**
   * Subscribes a listener to connection state changes:
   * `cb({ state, detail, retryCount, serverDemoMode, latencyMs })`
   */
  onStateChange(callback) {
    if (typeof callback === 'function') {
      this._stateListeners.add(callback);
      callback(this.getSnapshot());
    }
    return () => this._stateListeners.delete(callback);
  }

  /**
   * Subscribes a listener to server translation or telemetry messages.
   */
  onMessage(callback) {
    if (typeof callback === 'function') {
      this._messageListeners.add(callback);
    }
    return () => this._messageListeners.delete(callback);
  }

  getSnapshot() {
    return {
      state: this.state,
      detail: this.statusDetail,
      retryCount: this._retryCount,
      serverDemoMode: this.serverDemoMode,
      latencyMs: this.latencyMs,
      url: this.url,
    };
  }

  /**
   * Opens the optional connection to the WebSocket server.
   * @param {Object} [params]
   * @param {string|null} [params.token] Supabase JWT token (optional in demo mode)
   * @param {string} [params.url] Optional URL override for environment switching (Local vs Cloud)
   */
  async connect({ token = null, url = null } = {}) {
    if (url) {
      this.url = normalizeWsEndpoint(url);
    }
    this._token = token || null;
    this._manualDisconnect = false;
    this._clearTimers();
    const runId = ++this._connectRunId;

    if (!this.WebSocketImpl) {
      this._transition(
        WS_STATES.FAILED,
        'WebSocket no soportado en este entorno. Operando en modo local.'
      );
      return;
    }

    this._transition(WS_STATES.CONNECTING, 'Verificando servidor de traducción...');

    // Optional /health pre-check to detect demo_mode, missing token, or 401/403
    const healthUrl = deriveHealthUrl(this.url);
    if (healthUrl && this.fetchImpl) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
        const resp = await this.fetchImpl(healthUrl, {
          method: 'GET',
          signal: controller ? controller.signal : undefined,
        });
        if (timeoutId) clearTimeout(timeoutId);

        if (runId !== this._connectRunId || this._manualDisconnect) return;

        if (resp.status === 401 || resp.status === 403) {
          this._transition(
            WS_STATES.AUTH_ERROR,
            `Acceso rechazado por el servidor (${resp.status}). El tracking local sigue activo.`
          );
          return;
        }

        if (resp.ok) {
          const data = await resp.json();
          if (typeof data?.demo_mode === 'boolean') {
            this.serverDemoMode = data.demo_mode;
          }
          // Skip opening WebSocket if server requires auth and no token is available
          if (data?.demo_mode === false && !this._token) {
            this._transition(
              WS_STATES.AUTH_ERROR,
              'El servidor remoto requiere iniciar sesión (token ausente). El modo demo local sigue funcionando.'
            );
            return;
          }
        }
      } catch (healthErr) {
        if (runId !== this._connectRunId || this._manualDisconnect) return;
        console.warn(
          '[WSClient] /health no disponible (posible backend apagado), intentando handshake WS:',
          healthErr?.message || healthErr
        );
      }
    }

    if (runId !== this._connectRunId || this._manualDisconnect) return;
    this._openSocket(runId);
  }

  _openSocket(runId) {
    this._closeCurrentSocketSilently();

    let wsFullUrl = this.url;
    if (this._token) {
      const sep = wsFullUrl.includes('?') ? '&' : '?';
      wsFullUrl = `${wsFullUrl}${sep}token=${encodeURIComponent(this._token)}`;
    }

    this._transition(WS_STATES.CONNECTING, `Conectando a ${this.url}...`);

    let ws;
    try {
      ws = new this.WebSocketImpl(wsFullUrl);
      this._ws = ws;
    } catch (err) {
      this._scheduleReconnectOrFail(`Error al crear WebSocket: ${err.message}`, runId);
      return;
    }

    ws.onopen = () => {
      if (runId !== this._connectRunId || this._manualDisconnect) {
        ws.close();
        return;
      }
      this._retryCount = 0;
      this._transition(WS_STATES.OPEN, 'Conectado');

      if (this._token) {
        this._safeSend({ type: 'auth', token: this._token });
      }
      this._startPingLoop();
    };

    ws.onmessage = (event) => {
      if (runId !== this._connectRunId) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') {
          if (this._lastPingSentAt > 0) {
            this.latencyMs = Math.round(performance.now() - this._lastPingSentAt);
            this._emitState();
          }
          return;
        }
        if (msg.type === 'error' && String(msg.payload || '').toLowerCase().includes('auth')) {
          this._manualDisconnect = true;
          this._transition(
            WS_STATES.AUTH_ERROR,
            `Autenticación rechazada: ${msg.payload}. Tracking local activo.`
          );
          ws.close();
          return;
        }
        for (const cb of this._messageListeners) {
          cb(msg);
        }
      } catch (parseErr) {
        console.warn('[WSClient] Mensaje JSON inválido recibido:', parseErr.message);
      }
    };

    ws.onerror = () => {
      // onclose fires immediately afterward with the close code and reason
    };

    ws.onclose = (event) => {
      if (runId !== this._connectRunId) return;
      this._stopPingLoop();

      if (this._manualDisconnect) {
        if (this.state !== WS_STATES.AUTH_ERROR) {
          this._transition(WS_STATES.IDLE, 'Desconectado manualmente.');
        }
        return;
      }

      const code = event?.code ?? 1006;
      const reason = event?.reason || '';

      // Strict policy: never retry on 1008 / 403 / token errors
      if (
        AUTH_REJECT_CODES.has(code) ||
        reason.toLowerCase().includes('token') ||
        reason.toLowerCase().includes('origin') ||
        reason.toLowerCase().includes('403')
      ) {
        const detailMsg = reason
          ? `Conexión rechazada (${code}: ${reason}). Tracking local activo.`
          : `Conexión rechazada por política/autenticación (código ${code}). Tracking local activo.`;
        this._transition(WS_STATES.AUTH_ERROR, detailMsg);
        return;
      }

      this._scheduleReconnectOrFail(
        `Servidor desconectado (código ${code}). Tracking local activo.`,
        runId
      );
    };
  }

  _scheduleReconnectOrFail(reasonText, runId) {
    if (this._manualDisconnect || runId !== this._connectRunId) return;

    if (this._retryCount >= this.maxRetries) {
      this._transition(
        WS_STATES.FAILED,
        `Backend no disponible tras ${this.maxRetries} intentos. Modo demo local funcionando.`
      );
      return;
    }

    const delayMs = this.baseDelayMs * Math.pow(2, this._retryCount);
    this._retryCount++;
    this._transition(
      WS_STATES.CONNECTING,
      `${reasonText} Reintentando en ${Math.round(delayMs / 1000)}s (${this._retryCount}/${this.maxRetries})...`
    );

    this._retryTimer = setTimeout(() => {
      if (runId === this._connectRunId && !this._manualDisconnect) {
        this._openSocket(runId);
      }
    }, delayMs);
  }

  /**
   * Sends a frame or frame batch only when the socket is OPEN.
   * @param {Array<Object>|Object} landmarksPayload
   * @returns {boolean}
   */
  sendLandmarks(landmarksPayload) {
    if (this.state !== WS_STATES.OPEN || !this._ws || this._ws.readyState !== 1) {
      return false;
    }
    return this._safeSend({
      type: 'inference',
      payload: landmarksPayload,
    });
  }

  _safeSend(obj) {
    try {
      if (this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify(obj));
        return true;
      }
    } catch (err) {
      console.warn('[WSClient] Error enviando mensaje WS:', err.message);
    }
    return false;
  }

  _startPingLoop() {
    this._stopPingLoop();
    if (this.pingIntervalMs <= 0) return;
    this._pingTimer = setInterval(() => {
      if (this.state === WS_STATES.OPEN) {
        this._lastPingSentAt = performance.now();
        this._safeSend({ type: 'ping' });
      }
    }, this.pingIntervalMs);
  }

  _stopPingLoop() {
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _clearTimers() {
    this._stopPingLoop();
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _closeCurrentSocketSilently() {
    if (this._ws) {
      try {
        this._ws.onopen = null;
        this._ws.onmessage = null;
        this._ws.onerror = null;
        this._ws.onclose = null;
        this._ws.close();
      } catch (err) {
        console.warn('[WSClient] Error cerrando socket previo:', err.message);
      }
      this._ws = null;
    }
  }

  /**
   * Cleanly closes the WebSocket connection and transitions to `'idle'`.
   */
  disconnect() {
    this._manualDisconnect = true;
    this._connectRunId++;
    this._clearTimers();
    this._closeCurrentSocketSilently();
    this._retryCount = 0;
    this._transition(WS_STATES.IDLE, 'Desconectado (Modo Demo Local activo)');
  }

  _transition(newState, detail) {
    this.state = newState;
    if (detail !== undefined) {
      this.statusDetail = detail;
    }
    this._emitState();
  }

  _emitState() {
    const snap = this.getSnapshot();
    for (const cb of this._stateListeners) {
      try {
        cb(snap);
      } catch (err) {
        console.warn('[WSClient] Error en listener onStateChange:', err);
      }
    }
  }
}

export default WSClient;
