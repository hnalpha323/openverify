/**
 * C178.4 (Workflow 9A, integration-9a): the e2e stack serves the customer page of
 * `e2e/fixtures/embed-page/` with the embed client's IIFE build beside it, from a loopback origin
 * of its own, so a spec embeds the flow from an origin the sandbox allows (`127.0.0.1`) and from
 * one it does not (`localhost`, the same server under another origin). Chromium's local network
 * access checks refuse a page fulfilled by `page.route` that frames the loopback flow server, so
 * the page needs a real server (flow-server-embed's handoff). It serves three files and nothing
 * else, whatever the path says.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface EmbedPageFiles {
  /** `e2e/fixtures/embed-page/`: `index.html` and `embed-page.js`. */
  pageDir: string;
  /** The built `openverify.iife.js` of `@openverify/js`. */
  clientFile: string;
}

export interface EmbedPageServer {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

const HTML = 'text/html; charset=utf-8';
const JAVASCRIPT = 'text/javascript; charset=utf-8';

/** The only paths served, each to a fixed file: no request path ever reaches the file system. */
function routesOf(files: EmbedPageFiles): ReadonlyMap<string, { file: string; type: string }> {
  const page = { file: path.join(files.pageDir, 'index.html'), type: HTML };
  return new Map([
    ['/', page],
    ['/index.html', page],
    ['/embed-page.js', { file: path.join(files.pageDir, 'embed-page.js'), type: JAVASCRIPT }],
    ['/openverify.iife.js', { file: files.clientFile, type: JAVASCRIPT }],
  ]);
}

/** Starts the page server; `port` 0 takes a free one. */
export async function startEmbedPageServer(
  files: EmbedPageFiles,
  options: { host?: string; port?: number } = {},
): Promise<EmbedPageServer> {
  const routes = routesOf(files);
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://page.invalid').pathname;
    const route = routes.get(pathname);
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    readFile(route.file).then(
      (body) => {
        response.writeHead(200, {
          'content-type': route.type,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      },
      () => {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}
