import { describe, it, expect, vi } from 'vitest';
import { WSClient, WS_STATES, normalizeWsEndpoint } from '../index.js';

class MockWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }
  simulateClose(code, reason = '') {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code, reason });
  }
}

describe('transport/WSClient — Máquina de estados explícita y no-reintento en 1008/403', () => {
  it('normaliza correctamente URLs HTTP/WS a /ws/translate', () => {
    expect(normalizeWsEndpoint('http://127.0.0.1:8000')).toBe('ws://127.0.0.1:8000/ws/translate');
    expect(normalizeWsEndpoint('https://expresat.onrender.com/ws')).toBe(
      'wss://expresat.onrender.com/ws/translate'
    );
    expect(normalizeWsEndpoint('wss://expresat.onrender.com/ws/translate')).toBe(
      'wss://expresat.onrender.com/ws/translate'
    );
  });

  it('NO abre WebSocket ni reintenta si /health indica demo_mode=false y no hay token', async () => {
    MockWebSocket.instances = [];
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', demo_mode: false }),
    });

    const client = new WSClient({
      url: 'ws://127.0.0.1:8000/ws/translate',
      WebSocketImpl: MockWebSocket,
      fetchImpl: fakeFetch,
      pingIntervalMs: 0,
    });

    await client.connect({ token: null });
    expect(client.state).toBe(WS_STATES.AUTH_ERROR);
    expect(MockWebSocket.instances.length).toBe(0);
    expect(client.statusDetail).toContain('token ausente');
  });

  it('NO reintenta jamás cuando el servidor cierra con código 1008 (Policy Violation / Token inválido)', async () => {
    MockWebSocket.instances = [];
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', demo_mode: true }),
    });

    const client = new WSClient({
      url: 'ws://127.0.0.1:8000/ws/translate',
      WebSocketImpl: MockWebSocket,
      fetchImpl: fakeFetch,
      baseDelayMs: 10,
      maxRetries: 3,
      pingIntervalMs: 0,
    });

    await client.connect({ token: 'invalid_jwt' });
    expect(MockWebSocket.instances.length).toBe(1);

    // Simular rechazo 1008 del servidor
    MockWebSocket.instances[0].simulateClose(1008, 'Token inválido o expirado');
    expect(client.state).toBe(WS_STATES.AUTH_ERROR);

    // Esperar más que baseDelayMs para confirmar que NO hubo reintentos
    await new Promise((r) => setTimeout(r, 40));
    expect(MockWebSocket.instances.length).toBe(1);
    expect(client.state).toBe(WS_STATES.AUTH_ERROR);
  });

  it('aplica backoff exponencial ante caídas de red (1006) y pasa a FAILED al agotar maxRetries', async () => {
    MockWebSocket.instances = [];
    const fakeFetch = vi.fn().mockRejectedValue(new Error('Network down'));

    const client = new WSClient({
      url: 'ws://127.0.0.1:8000/ws/translate',
      WebSocketImpl: MockWebSocket,
      fetchImpl: fakeFetch,
      baseDelayMs: 10,
      maxRetries: 2,
      pingIntervalMs: 0,
    });

    await client.connect();
    expect(MockWebSocket.instances.length).toBe(1);

    // Caída 1 -> reintento 1
    MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure');
    expect(client.state).toBe(WS_STATES.CONNECTING);
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBe(2);

    // Caída 2 -> reintento 2
    MockWebSocket.instances[1].simulateClose(1006, 'Abnormal closure');
    await new Promise((r) => setTimeout(r, 35));
    expect(MockWebSocket.instances.length).toBe(3);

    // Caída 3 -> alcanza maxRetries (2), pasa a FAILED y se detiene
    MockWebSocket.instances[2].simulateClose(1006, 'Abnormal closure');
    expect(client.state).toBe(WS_STATES.FAILED);
    await new Promise((r) => setTimeout(r, 50));
    expect(MockWebSocket.instances.length).toBe(3);
  });

  it('conecta en estado OPEN cuando el servidor acepta en modo demo y envía lotes de landmarks', async () => {
    MockWebSocket.instances = [];
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', demo_mode: true }),
    });

    const client = new WSClient({
      url: 'ws://127.0.0.1:8000/ws/translate',
      WebSocketImpl: MockWebSocket,
      fetchImpl: fakeFetch,
      pingIntervalMs: 0,
    });

    await client.connect();
    expect(MockWebSocket.instances.length).toBe(1);
    MockWebSocket.instances[0].simulateOpen();
    expect(client.state).toBe(WS_STATES.OPEN);

    const sentOk = client.sendLandmarks([{ rightHand: [] }]);
    expect(sentOk).toBe(true);
    expect(MockWebSocket.instances[0].sent[0]).toEqual({
      type: 'inference',
      payload: [{ rightHand: [] }],
    });

    client.disconnect();
    expect(client.state).toBe(WS_STATES.IDLE);
  });
});
