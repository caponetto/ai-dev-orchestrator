import {
  AgentSessionRegistry,
  DefaultAgentSessionStore,
  RemoteAgentSessionSupervisor,
} from '@ai-dev-orchestrator/runner';

import { connectRemoteWebSocket } from '../../src/connect-remote-websocket.ts';

const [mode, root, url] = process.argv.slice(2);
const supervisor = new RemoteAgentSessionSupervisor(
  new AgentSessionRegistry(new DefaultAgentSessionStore(root)),
);
const ref = {
  sessionId: 'remote',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  transport: 'remote',
};
await supervisor.createSession(ref, undefined, {
  type: 'remote',
  remoteSessionId: 'server-session',
  reconnectUrl: url,
});
supervisor.setTransportFactory((_ref, meta, signal) =>
  connectRemoteWebSocket(meta, signal, mode === 'timeout' ? 500 : 10_000),
);
const pending = supervisor.reconnect(ref.sessionId);
const result = pending.then(
  (handle) => ({ handle }),
  (error) => ({ error: error.message }),
);
if (mode !== 'timeout') {
  await new Promise((resolve) => process.once('message', resolve));
  if (mode === 'abort') await supervisor.abort(ref.sessionId, 'shutdown');
  else if (mode === 'pause') await supervisor.pause(ref.sessionId);
  else await supervisor.finalize(ref.sessionId);
}
const outcome = await result;
const state = supervisor.getState(ref.sessionId);
await supervisor.finalize(ref.sessionId);
process.stdout.write(JSON.stringify({ outcome, state }) + '\n');
process.disconnect();
// Natural exit proves no establishment timer or socket keeps this process alive.
