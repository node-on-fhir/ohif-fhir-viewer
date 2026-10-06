/**
 * Tests for the module-scoped FHIRcast session (fhircastSession.ts).
 *
 * The whole point of the module is that the connection outlives the panel:
 * subscribing/unsubscribing React listeners must never touch the socket, state
 * survives a listener coming and going (tab switch), and an unintentional
 * close reconnects with capped exponential backoff — indefinitely, not for a
 * fixed number of attempts.
 */
const { MockWebSocket, flushMicrotasks } = require('./helpers/mockWebSocket');

const PARAMS = {
  hubUrl: 'http://hub.example/api/hub',
  wsUrl: 'ws://hub.example/bind',
  topic: 'topic-1',
  events: ['Patient-open', 'ImagingStudy-open'],
  authToken: 'smart-token-123',
};

function hubResponse(endpoint = 'ws://hub.example/bind/ep-1') {
  return {
    ok: true,
    status: 202,
    statusText: 'Accepted',
    json: async () => ({ 'hub.channel.endpoint': endpoint }),
  };
}

describe('fhircastSession', () => {
  let session;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    MockWebSocket.reset();
    global.WebSocket = MockWebSocket;
    global.fetch = jest.fn(async () => hubResponse());
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    session = require('../fhircastSession');
  });

  afterEach(async () => {
    // Tear the connection down so no reconnect timer leaks into the next test.
    await session.stopSubscription();
    await flushMicrotasks();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.WebSocket;
    delete global.fetch;
  });

  async function connect() {
    const done = session.startSubscription(PARAMS);
    // Swallow a potential bind-timeout rejection if a test never binds.
    done.catch(() => {});
    await flushMicrotasks();
    const socket = MockWebSocket.last;
    expect(socket).toBeDefined();
    return { done, socket };
  }

  describe('startSubscription', () => {
    it('POSTs hub.mode=subscribe with the events, channel type and bearer token', async () => {
      const { socket } = await connect();
      socket.serverBind();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe(PARAMS.hubUrl);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(init.headers.Authorization).toBe('Bearer smart-token-123');

      const body = new URLSearchParams(init.body);
      expect(body.get('hub.mode')).toBe('subscribe');
      expect(body.get('hub.topic')).toBe('topic-1');
      expect(body.get('hub.events')).toBe('Patient-open,ImagingStudy-open');
      expect(body.get('hub.channel.type')).toBe('websocket');
      expect(body.get('hub.channel.endpoint')).toMatch(/^ws:\/\/hub\.example\/bind\//);
    });

    it('opens the socket on the endpoint the hub returned and resolves on bind', async () => {
      const { done, socket } = await connect();
      expect(socket.url).toBe('ws://hub.example/bind/ep-1');
      expect(session.getSessionSnapshot().wsStatus).toBe('Opening');

      socket.serverBind();
      await expect(done).resolves.toBeUndefined();

      const state = session.getSessionSnapshot();
      expect(state.wsStatus).toBe('Open');
      expect(state.subscriptions['topic-1']).toEqual({
        topic: 'topic-1',
        events: ['Patient-open', 'ImagingStudy-open'],
        status: 'active',
      });
    });

    it('rejects when the hub refuses the subscription', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
      await expect(session.startSubscription(PARAMS)).rejects.toThrow(
        'Hub subscription failed: 401 Unauthorized'
      );
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('rejects when the bind is never confirmed, but keeps the connection trying', async () => {
      const { done, socket } = await connect();
      socket.serverOpen(); // open but no bind message

      jest.advanceTimersByTime(15000);
      await expect(done).rejects.toThrow(/Timed out waiting for the hub/);

      // The timeout is a UI affordance, not a teardown: the socket is still up.
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });
  });

  describe('received events', () => {
    it('prepends incoming events and ACKs them with status 200', async () => {
      const { socket } = await connect();
      socket.serverBind();

      socket.serverEvent({
        id: 'evt-1',
        timestamp: '2026-01-01T00:00:00Z',
        event: { 'hub.event': 'Patient-open', context: [] },
      });
      socket.serverEvent({
        id: 'evt-2',
        timestamp: '2026-01-01T00:00:01Z',
        event: { 'hub.event': 'ImagingStudy-open', context: [] },
      });

      const { receivedEvents } = session.getSessionSnapshot();
      expect(receivedEvents.map(e => e.id)).toEqual(['evt-2', 'evt-1']);

      const acks = socket.sent.map(JSON.parse);
      expect(acks).toEqual([
        { id: 'evt-1', status: '200' },
        { id: 'evt-2', status: '200' },
      ]);
    });

    it('returns a new snapshot identity on every change (useSyncExternalStore contract)', async () => {
      const before = session.getSessionSnapshot();
      const { socket } = await connect();
      socket.serverBind();
      const after = session.getSessionSnapshot();
      expect(after).not.toBe(before);
      // Unchanged state keeps its identity between reads.
      expect(session.getSessionSnapshot()).toBe(after);
    });
  });

  describe('tab-switch semantics (listener lifecycle is independent of the connection)', () => {
    it('keeps socket, subscriptions and events when a panel listener unsubscribes and a new one subscribes', async () => {
      const panel1 = jest.fn();
      const unsubscribePanel1 = session.subscribeToSession(panel1);

      const { socket } = await connect();
      socket.serverBind();
      socket.serverEvent({ id: 'evt-1', event: { 'hub.event': 'Patient-open' } });
      expect(panel1).toHaveBeenCalled();

      // Tab switch: the panel unmounts…
      unsubscribePanel1();
      panel1.mockClear();

      // …events keep arriving while no panel is mounted…
      socket.serverEvent({ id: 'evt-2', event: { 'hub.event': 'ImagingStudy-open' } });
      expect(panel1).not.toHaveBeenCalled();
      expect(socket.readyState).toBe(MockWebSocket.OPEN);

      // …and a remounted panel sees the full picture.
      const panel2 = jest.fn();
      session.subscribeToSession(panel2);
      const state = session.getSessionSnapshot();
      expect(state.wsStatus).toBe('Open');
      expect(state.subscriptions['topic-1']).toBeDefined();
      expect(state.receivedEvents.map(e => e.id)).toEqual(['evt-2', 'evt-1']);
      expect(session.getActiveParams()).toMatchObject({ topic: 'topic-1' });
    });

    it('keeps the ImagingStudy context across listener churn', async () => {
      session.setImagingStudyContext({ imagingStudyId: 'is-9', imagingStudyStatus: 'available' });
      const unsubscribe = session.subscribeToSession(() => {});
      unsubscribe();
      expect(session.getSessionSnapshot()).toMatchObject({
        imagingStudyId: 'is-9',
        imagingStudyStatus: 'available',
      });
    });
  });

  describe('reconnect', () => {
    it('reconnects after an unintentional close, with exponential backoff', async () => {
      const { socket } = await connect();
      socket.serverBind();

      socket.serverDrop();
      expect(session.getSessionSnapshot().wsStatus).toBe('Opening');

      // attempt 1 after 1s: reopens the already-bound endpoint without a new hub POST
      jest.advanceTimersByTime(999);
      expect(MockWebSocket.instances).toHaveLength(1);
      jest.advanceTimersByTime(1);
      await flushMicrotasks();
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(MockWebSocket.last.url).toBe('ws://hub.example/bind/ep-1');

      // attempt 2 after 2s
      MockWebSocket.last.serverDrop();
      jest.advanceTimersByTime(2000);
      await flushMicrotasks();
      expect(MockWebSocket.instances).toHaveLength(3);

      // attempt 3 (past REOPEN_ATTEMPTS_BEFORE_RESUBSCRIBE): re-POSTs for a fresh endpoint
      global.fetch.mockResolvedValueOnce(hubResponse('ws://hub.example/bind/ep-2'));
      MockWebSocket.last.serverDrop();
      jest.advanceTimersByTime(4000);
      await flushMicrotasks();
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(MockWebSocket.last.url).toBe('ws://hub.example/bind/ep-2');

      // and a successful bind resets the attempt counter
      MockWebSocket.last.serverBind();
      expect(session.getSessionSnapshot().wsStatus).toBe('Open');
    });

    it('caps the backoff delay at 30s and keeps retrying indefinitely', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const { socket } = await connect();
      socket.serverBind();
      socket.serverDrop();

      // Each reconnect reopens a socket; drop it to force the next retry. After
      // REOPEN_ATTEMPTS_BEFORE_RESUBSCRIBE the retry re-POSTs to the hub, so keep
      // that rejecting too. Delays must never exceed the 30s ceiling.
      for (let i = 0; i < 12; i++) {
        global.fetch.mockRejectedValue(new Error('hub unreachable'));
        jest.advanceTimersByTime(30000);
        await flushMicrotasks();
        const s = MockWebSocket.last;
        if (s && s.readyState !== MockWebSocket.CLOSED) {
          s.serverDrop();
        }
      }

      const delays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter(d => typeof d === 'number' && d >= 1000);
      expect(delays.length).toBeGreaterThanOrEqual(10);
      expect(Math.max(...delays)).toBe(30000);
      // Still scheduling after a dozen failures — no fixed attempt ceiling.
      expect(session.getSessionSnapshot().wsStatus).toBe('Opening');
    });

    it('does not reconnect after an intentional stop', async () => {
      const { socket } = await connect();
      socket.serverBind();

      await session.stopSubscription();
      await flushMicrotasks();

      const sockets = MockWebSocket.instances.length;
      jest.advanceTimersByTime(120000);
      await flushMicrotasks();
      expect(MockWebSocket.instances).toHaveLength(sockets);
      expect(session.getSessionSnapshot().wsStatus).toBe('Closed');
    });
  });

  describe('stopSubscription', () => {
    it('closes the socket, POSTs hub.mode=unsubscribe and clears the subscription', async () => {
      const { socket } = await connect();
      socket.serverBind();

      await session.stopSubscription();
      await flushMicrotasks();

      expect(socket.readyState).toBe(MockWebSocket.CLOSED);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [, init] = global.fetch.mock.calls[1];
      const body = new URLSearchParams(init.body);
      expect(body.get('hub.mode')).toBe('unsubscribe');
      expect(body.get('hub.topic')).toBe('topic-1');

      const state = session.getSessionSnapshot();
      expect(state.wsStatus).toBe('Closed');
      expect(state.subscriptions['topic-1']).toBeUndefined();
      expect(session.getActiveParams()).toBeNull();
    });
  });
});
