import { WebSocketProtocolTransport } from '@ai-dev-orchestrator/runner';
import type { RemoteReconnectMeta } from '@ai-dev-orchestrator/schemas';

/** Establish a socket within a bounded, cancellable attempt; transfer ownership on open. */
export async function connectRemoteWebSocket(
  meta: RemoteReconnectMeta,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<WebSocketProtocolTransport> {
  if (signal?.aborted) {
    throw new Error('WebSocket connection cancelled');
  }
  const baseUrl = meta.websocketUrl ?? meta.reconnectUrl;
  let wsUrl = baseUrl;
  if (meta.authHeader) {
    const headers: Record<string, string> = {};
    const [key, ...rest] = meta.authHeader.split(':');
    if (key && rest.length > 0) {
      headers[key.trim()] = rest.join(':').trim();
    }
    const authValue = headers['Authorization'];
    if (authValue) {
      wsUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}auth=${encodeURIComponent(authValue)}`;
    }
  }
  const ws = new globalThis.WebSocket(wsUrl);
  return new Promise<WebSocketProtocolTransport>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        ws.close();
      } catch {
        // Preserve the establishment error even if the socket is already unusable.
      }
      reject(new Error(message));
    };
    const onOpen = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(new WebSocketProtocolTransport(ws));
    };
    const onError = () => {
      fail('WebSocket connection failed');
    };
    const onClose = () => {
      fail('WebSocket closed before opening');
    };
    const onAbort = () => {
      fail('WebSocket connection cancelled');
    };
    const timer = setTimeout(() => {
      fail('WebSocket connection timed out');
    }, timeoutMs);
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Covers cancellation during construction or listener registration.
    if (signal?.aborted) {
      onAbort();
    }
  });
}
