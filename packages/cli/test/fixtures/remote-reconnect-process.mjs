import { randomUUID } from 'node:crypto';

const createProtocolMessage = (type, payload) => ({
  protocol: 'ado/agent/v1',
  messageId: randomUUID(),
  timestamp: new Date().toISOString(),
  type,
  payload,
});
import {
  AgentSessionRegistry,
  CompositeAgentSessionSupervisor,
  LocalAgentSessionSupervisor,
  DefaultAgentSessionStore,
  RemoteAgentSessionSupervisor,
  WebSocketProtocolTransport,
} from '@ai-dev-orchestrator/runner';

const [mode, root, baseUrl] = process.argv.slice(2);
if (!mode || !root || !baseUrl) throw new Error('mode, root and local server URL required');
const registry = new AgentSessionRegistry(new DefaultAgentSessionStore(root));
await registry.rebuild();
const supervisor = new RemoteAgentSessionSupervisor(registry);
const sessions = new CompositeAgentSessionSupervisor([
  new LocalAgentSessionSupervisor(registry),
  supervisor,
]);
const ref = {
  sessionId: 'remote',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  transport: 'remote',
};
const meta = {
  type: 'remote',
  remoteSessionId: 'server-session',
  reconnectUrl: baseUrl.replace('http:', 'ws:') + '/socket',
  ...(mode === 'seed-expiry' ? { leaseExpiresAt: new Date(Date.now() + 5000).toISOString() } : {}),
};
let socketClosed;
const connection = async (_ref, metadata) => {
  const socket = new WebSocket(metadata.reconnectUrl);
  socketClosed = new Promise((resolve) =>
    socket.addEventListener('close', resolve, { once: true }),
  );
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new WebSocketProtocolTransport(socket);
};
const emit = async (message) => {
  const response = await fetch(baseUrl + '/emit', {
    method: 'POST',
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error('Fixture server refused message');
};
let output;
if (mode.startsWith('seed')) {
  await supervisor.createSession(ref, undefined, meta, await connection(ref, meta));
  const advancing = sessions.waitForAdvance(ref.sessionId);
  await emit(
    createProtocolMessage(
      'permission_request',
      { action: 'write', resource: '/file', riskLevel: 'low' },
      undefined,
    ),
  );
  const pending = await advancing;
  output = { pid: process.pid, pending, snapshot: registry.get(ref.sessionId) };
  process.stdout.write(JSON.stringify(output) + '\n');
  // Simulate abrupt orchestrator death after the durable permission checkpoint.
  process.exit(73);
} else if (mode === 'inspect') {
  supervisor.setTransportFactory(() => {
    throw new Error('Terminal recovery must not connect');
  });
  output = {
    pid: process.pid,
    attached: await sessions.attach(ref.sessionId),
    result: await sessions.waitForAdvance(ref.sessionId),
    snapshot: registry.get(ref.sessionId),
  };
} else {
  let release;
  let entered;
  let arrived;
  const connected = new Promise((resolve) => {
    arrived = resolve;
  });
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  supervisor.setTransportFactory(async (...args) => {
    entered();
    await gate;
    const transport = await connection(...args);
    arrived();
    return transport;
  });
  const first = sessions.attach(ref.sessionId);
  const second = supervisor.reconnect(ref.sessionId);
  await ready;
  if (mode === 'abort') {
    await supervisor.abort(ref.sessionId, 'fresh process shutdown');
    // The public calls must settle before the factory gate is released.
    const handles = await Promise.all([first, second]);
    release();
    await connected;
    await socketClosed;
    output = { pid: process.pid, handles, snapshot: registry.get(ref.sessionId) };
  } else if (mode === 'expire') {
    const result = await supervisor.getHost(ref.sessionId).resultPromise;
    const handles = await Promise.all([first, second]);
    await sessions.waitForAdvance(ref.sessionId);
    release();
    await connected;
    await socketClosed;
    output = { pid: process.pid, result, handles, snapshot: registry.get(ref.sessionId) };
  } else {
    release();
    const handles = await Promise.all([first, second]);
    const request = handles[0].pendingRequests[0];
    const accepted = await supervisor.sendHumanResponse(ref.sessionId, request.requestId, {
      granted: true,
    });
    const advancing = sessions.waitForAdvance(ref.sessionId);
    await emit(
      createProtocolMessage('done', {
        summary: 'recovered',
        tokenUsage: { inputTokens: 7, outputTokens: 3 },
      }),
    );
    output = { pid: process.pid, handles, accepted, result: await advancing };
  }
  await sessions.finalize(ref.sessionId);
}
process.stdout.write(JSON.stringify(output) + '\n');
