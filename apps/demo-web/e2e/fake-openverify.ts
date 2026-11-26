/**
 * A fake OpenVerify installation for the sample site's spec: the API on one loopback port (create,
 * resume and retrieve an inquiry, shaped by the contracts' fixtures) and the flow on another (a
 * page that speaks the embed protocol: it answers the parent's hello with `ready` and posts
 * `complete` when its button is pressed). Synthetic data only.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '../../../contracts/fixtures/api');
export const FAKE_API_KEY = `ov_sbx_synthetic${'a'.repeat(32)}`;
export const FAKE_WEBHOOK_SECRET = `wbhsec_synthetic${'b'.repeat(32)}`;
export const FAKE_TEMPLATE_ID = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
const SESSION_TOKEN = `ovs_${'c'.repeat(43)}`;

interface InquiryDocument {
  data: { id: string; attributes: Record<string, unknown> };
}

export interface FakeOpenVerify {
  readonly apiUrl: string;
  readonly flowUrl: string;
  readonly inquiryId: string;
  /** Requests the API saw, as `METHOD path` with whether the key was presented. */
  readonly calls: readonly { readonly call: string; readonly keyPresented: boolean }[];
  decide(status: string): void;
  close(): Promise<void>;
}

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
    });
  });

const FLOW_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fake flow</title></head>
<body><p>Fake flow</p><button id="finish" type="button">Finish</button>
<script>
  const inquiryId = location.pathname.split('/').pop();
  let parentOrigin = null;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'openverify-parent' && event.data.type === 'hello') {
      parentOrigin = event.origin;
      parent.postMessage({ source: 'openverify-flow', version: 1, type: 'ready' }, parentOrigin);
    }
  });
  document.getElementById('finish').addEventListener('click', () => {
    parent.postMessage(
      { source: 'openverify-flow', version: 1, type: 'complete', 'inquiry-id': inquiryId, status: 'completed' },
      parentOrigin,
    );
  });
</script></body></html>`;

export async function startFakeOpenVerify(): Promise<FakeOpenVerify> {
  const inquiry = JSON.parse(
    readFileSync(join(FIXTURES, 'inquiry.json'), 'utf8'),
  ) as InquiryDocument;
  const inquiryId = inquiry.data.id;
  let status = String(inquiry.data.attributes.status);
  const calls: { call: string; keyPresented: boolean }[] = [];

  const flow = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/embed/') === true) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(FLOW_PAGE);
      return;
    }
    response.writeHead(404).end();
  });
  const flowUrl = await listen(flow);

  const api = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fake.invalid').pathname;
    calls.push({
      call: `${request.method ?? ''} ${path}`,
      keyPresented: request.headers.authorization === `Bearer ${FAKE_API_KEY}`,
    });
    request.resume();
    const json = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const current = {
      ...inquiry,
      data: { ...inquiry.data, attributes: { ...inquiry.data.attributes, status } },
    };
    if (request.headers.authorization !== `Bearer ${FAKE_API_KEY}`) {
      json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 });
    } else if (request.method === 'POST' && path === '/api/v1/inquiries') {
      json(201, current);
    } else if (request.method === 'POST' && path === `/api/v1/inquiries/${inquiryId}/resume`) {
      json(200, {
        ...current,
        meta: {
          'session-token': SESSION_TOKEN,
          'flow-url': `${flowUrl}/#inquiry-id=${inquiryId}&session-token=${SESSION_TOKEN}`,
        },
      });
    } else if (request.method === 'GET' && path === `/api/v1/inquiries/${inquiryId}`) {
      json(200, current);
    } else {
      json(404, { type: 'about:blank', title: 'Not found', status: 404 });
    }
  });
  const apiUrl = await listen(api);

  const close = (server: Server): Promise<void> =>
    new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  return {
    apiUrl,
    flowUrl,
    inquiryId,
    calls,
    decide: (next) => {
      status = next;
    },
    close: async () => {
      await Promise.all([close(api), close(flow)]);
    },
  };
}
