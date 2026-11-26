/**
 * A customer's webhook endpoint for the e2e run: it records every request with its raw body,
 * exactly as received, because the signature covers those bytes.
 *
 * It is reached as `http://localhost:<port>`: the API's guarded sender refuses literal IP
 * hosts, resolves the name itself and connects to the vetted address, which may be either
 * loopback, so the receiver listens on both IPv6 and IPv4 when the host has IPv6.
 */
import {
  createServer,
  type IncomingHttpHeaders,
  type RequestListener,
  type Server,
} from 'node:http';
import { createServer as createSecureServer } from 'node:https';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The body as received (UTF-8). */
  body: string;
  receivedAt: Date;
}

export interface WaitForOptions {
  timeoutMs: number;
  /** Names what is awaited in the timeout error. */
  description?: string;
}

export interface WebhookReceiver {
  /** `http://localhost:<port>/webhooks`, or `https:` with {@link WebhookReceiverOptions.tls}. */
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  /** The first request (already received or still to come) that matches. */
  waitFor(
    predicate: (request: RecordedRequest) => boolean,
    options: WaitForOptions,
  ): Promise<RecordedRequest>;
  close(): Promise<void>;
}

export interface WebhookReceiverOptions {
  /** The status every request gets. Defaults to 200. */
  status?: number;
  /** C146.3: serves `https:`, as Make HTTPS Request reaches nothing else. */
  tls?: { certificate: string | Buffer; key: string | Buffer };
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };
    server.once('error', onError);
    server.listen({ port: 0, host, ipv6Only: false }, () => {
      server.off('error', onError);
      const address = server.address();
      resolve(address !== null && typeof address === 'object' ? address.port : 0);
    });
  });
}

export async function startWebhookReceiver(
  options: WebhookReceiverOptions = {},
): Promise<WebhookReceiver> {
  const requests: RecordedRequest[] = [];
  const listeners = new Set<(request: RecordedRequest) => void>();

  const onRequest: RequestListener = (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const recorded: RecordedRequest = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        receivedAt: new Date(),
      };
      requests.push(recorded);
      for (const listener of listeners) {
        listener(recorded);
      }
      response.statusCode = options.status ?? 200;
      response.end();
    });
  };
  const { tls } = options;
  const server: Server =
    tls === undefined
      ? createServer(onRequest)
      : createSecureServer({ cert: tls.certificate, key: tls.key }, onRequest);

  let port: number;
  try {
    // Dual-stack: [::] also accepts IPv4 connections.
    port = await listen(server, '::');
  } catch {
    port = await listen(server, '127.0.0.1');
  }

  return {
    url: `${tls === undefined ? 'http' : 'https'}://localhost:${String(port)}/webhooks`,
    requests,
    waitFor(predicate, { timeoutMs, description }) {
      const found = requests.find(predicate);
      if (found !== undefined) {
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const listener = (request: RecordedRequest) => {
          if (predicate(request)) {
            clearTimeout(timer);
            listeners.delete(listener);
            resolve(request);
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(
            new Error(
              `No webhook matching ${description ?? 'the predicate'} within ${String(timeoutMs)} ms ` +
                `(${String(requests.length)} received)`,
            ),
          );
        }, timeoutMs);
        listeners.add(listener);
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
