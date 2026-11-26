import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEmbedPageServer, type EmbedPageServer } from './embed-page.js';

let dir: string;
let page: EmbedPageServer;
const base = () => `http://127.0.0.1:${String(page.port)}`;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'embed-page-'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Example shop</title>');
  await writeFile(path.join(dir, 'embed-page.js'), 'window.page = true;');
  await writeFile(path.join(dir, 'secret.txt'), 'never served');
  await writeFile(path.join(dir, 'client.js'), 'window.OpenVerify = {};');
  page = await startEmbedPageServer(
    { pageDir: dir, clientFile: path.join(dir, 'client.js') },
    { host: '127.0.0.1', port: 0 },
  );
});

afterAll(async () => {
  await page.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the embed page server (C178.4)', () => {
  it('serves the page at / and /index.html as HTML that is never cached', async () => {
    for (const route of ['/', '/index.html']) {
      const response = await fetch(base() + route);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toContain('Example shop');
    }
  });

  it('serves the page script and the embed client beside it as JavaScript', async () => {
    const script = await fetch(`${base()}/embed-page.js`);
    const client = await fetch(`${base()}/openverify.iife.js`);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).toBe('window.page = true;');
    expect(await client.text()).toBe('window.OpenVerify = {};');
  });

  it('serves nothing else: another file, a traversal or a query-less unknown path is 404', async () => {
    for (const route of ['/secret.txt', '/client.js', '/../package.json', '/%2e%2e/x', '/x']) {
      const response = await fetch(base() + route);
      expect(response.status, route).toBe(404);
    }
  });

  it('answers only GET and HEAD', async () => {
    const response = await fetch(`${base()}/`, { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
  });

  it('listens on the requested loopback port and stops on close', async () => {
    expect(page.port).toBeGreaterThan(0);
    const other = await startEmbedPageServer(
      { pageDir: dir, clientFile: path.join(dir, 'client.js') },
      { host: '127.0.0.1', port: 0 },
    );
    await other.close();
    await expect(fetch(`http://127.0.0.1:${String(other.port)}/`)).rejects.toThrow();
  });
});
