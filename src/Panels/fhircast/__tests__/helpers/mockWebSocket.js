/**
 * A WebSocket double for the fhircastSession tests.
 *
 * The session code drives the socket entirely through the standard handler
 * properties (onopen/onmessage/onclose/onerror) and reads the static
 * OPEN/CONNECTING constants, so that is all this implements. Server-side
 * behavior is simulated with the server* helpers.
 */
class MockWebSocket {
  static instances = [];

  static reset() {
    MockWebSocket.instances = [];
  }

  static get last() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'client close' });
  }

  // ── server-side simulation ────────────────────────────────────────────────

  serverOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Open the socket and deliver the FHIRcast bind confirmation. */
  serverBind() {
    this.serverOpen();
    this.onmessage?.({ data: JSON.stringify({ bound: true }) });
  }

  serverEvent(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Unexpected connection loss (not initiated by the client). */
  serverDrop(code = 1006) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason: 'connection dropped' });
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

/** Flush pending microtasks (fetch/await chains) without advancing timers. */
async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

module.exports = { MockWebSocket, flushMicrotasks };
