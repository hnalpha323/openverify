/**
 * K7B-9 (owner decision 12 after Workflow 7B): the routes whose answers are not JSON documents: a
 * transaction file's upload (multipart) and content (bytes), and the graph export (CSV), which
 * sends an `Idempotency-Key` like every `POST`. `graphQueries.action` refuses `export`, whose answer
 * it could not parse. Workflow 8B (C135, C138) adds a case attachment's upload, rendition and
 * original, and an export's file. Every value is synthetic.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { OpenVerifyApiError } from './errors.js';
import { apiFixture } from './test-support.js';

const TRANSACTION = 'txn_01M5CK3190XEVBM5ZXA76E1JSN';
const FILE = 'txnf_01M5CK3190XEVBM5ZXA76E1JSN';
const QUERY = 'grphq_01M5CK16P0D13FXHZSS4TCFBVH';
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80]);

function clientAnswering(response: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
  return {
    fetch,
    client: createClient({
      apiKey: 'ov_sbx_synthetictesttokenaaaaaaaaaaaaaaaaaaaaaaaaaa',
      baseUrl: 'https://api.example.test',
      fetch,
      maxRetries: 0,
    }),
  };
}

describe('transactions.uploadFile', () => {
  it('sends the bytes as multipart, under the field’s route, and parses the transaction', async () => {
    const document = apiFixture('transaction');
    const { client, fetch } = clientAnswering(() => Response.json(document));

    const answer = await client.transactions.uploadFile(TRANSACTION, 'statement', {
      bytes: BYTES,
      filename: 'statement.pdf',
      mimeType: 'application/pdf',
    });

    expect(answer).toEqual(document);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example.test/api/v1/transactions/${TRANSACTION}/files/statement`);
    expect(init?.method).toBe('PUT');
    const form = init?.body as FormData;
    const part = form.get('file') as File;
    expect(part.name).toBe('statement.pdf');
    expect(part.type).toBe('application/pdf');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(BYTES);
    const headers = init?.headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    expect(headers['idempotency-key']).toEqual(expect.any(String));
  });
});

describe('transactions.fileContent', () => {
  it('answers the bytes unchanged, with their type', async () => {
    const { client, fetch } = clientAnswering(
      () => new Response(BYTES, { headers: { 'content-type': 'application/pdf' } }),
    );

    const content = await client.transactions.fileContent(TRANSACTION, FILE);

    expect(content.bytes).toEqual(BYTES);
    expect(content.mimeType).toBe('application/pdf');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/transactions/${TRANSACTION}/files/${FILE}/content`,
    );
  });

  it('throws the API’s problem for a refusal', async () => {
    const { client } = clientAnswering(() =>
      Response.json(
        { type: 'about:blank', title: 'Gone', status: 410, detail: 'Redacted.' },
        { status: 410, headers: { 'content-type': 'application/problem+json' } },
      ),
    );

    await expect(client.transactions.fileContent(TRANSACTION, FILE)).rejects.toBeInstanceOf(
      OpenVerifyApiError,
    );
  });
});

describe('graphQueries.exportCsv', () => {
  it('posts the export action with an Idempotency-Key and answers the CSV text', async () => {
    const csv = 'account-id,reference-id\nacc_1,ref-1\n';
    const { client, fetch } = clientAnswering(
      () => new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } }),
    );

    const answer = await client.graphQueries.exportCsv(QUERY, { all: true });

    expect(answer).toBe(csv);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example.test/api/v1/graph-queries/${QUERY}/actions`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      data: { attributes: { action: 'export', all: true } },
    });
    expect((init?.headers as Record<string, string>)['idempotency-key']).toEqual(
      expect.any(String),
    );
  });
});

describe('graphQueries.action', () => {
  it('refuses export, whose answer is not a JSON document, before any request', async () => {
    const { client, fetch } = clientAnswering(() => new Response('unused'));

    await expect(
      client.graphQueries.action(QUERY, { action: 'export', all: true }),
    ).rejects.toThrow(/exportCsv/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const CASE = 'case_01M5CN00000000000000000001';
const ATTACHMENT = 'catt_01M5CN00000000000000000019';
const EXPORT = 'cexp_01M5CN00000000000000000014';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('cases.uploadAttachment (C135.1)', () => {
  it('sends one file as multipart with an Idempotency-Key, and parses the case', async () => {
    const document = apiFixture('case');
    const { client, fetch } = clientAnswering(() => Response.json(document));

    const answer = await client.cases.uploadAttachment(CASE, {
      bytes: BYTES,
      filename: 'synthetic-statement.pdf',
    });

    expect(answer).toEqual(document);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example.test/api/v1/cases/${CASE}/attachments`);
    expect(init?.method).toBe('POST');
    const part = (init?.body as FormData).get('file') as File;
    expect(part.name).toBe('synthetic-statement.pdf');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(BYTES);
    expect((init?.headers as Record<string, string>)['idempotency-key']).toEqual(
      expect.any(String),
    );
  });
});

describe('cases.attachmentContent and cases.attachmentOriginal (C135.4)', () => {
  it('reads the rendition, a PDF page by its number, and answers the bytes with their type', async () => {
    const { client, fetch } = clientAnswering(
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    );

    const first = await client.cases.attachmentContent(CASE, ATTACHMENT);
    const second = await client.cases.attachmentContent(CASE, ATTACHMENT, { page: 2 });

    expect(first).toEqual({ bytes: PNG, mimeType: 'image/png' });
    expect(second.bytes).toEqual(PNG);
    const base = `https://api.example.test/api/v1/cases/${CASE}/attachments/${ATTACHMENT}`;
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${base}/content`,
      `${base}/content?page=2`,
    ]);
  });

  it('reads the original by its own route', async () => {
    const { client, fetch } = clientAnswering(
      () => new Response(BYTES, { headers: { 'content-type': 'application/pdf' } }),
    );

    const original = await client.cases.attachmentOriginal(CASE, ATTACHMENT);

    expect(original).toEqual({ bytes: BYTES, mimeType: 'application/pdf' });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/cases/${CASE}/attachments/${ATTACHMENT}/original`,
    );
  });

  it('throws the problem of a scan not done (C135.5)', async () => {
    const { client } = clientAnswering(() =>
      Response.json(apiFixture('../problems/cases/attachment-scan-pending'), {
        status: 409,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    await expect(client.cases.attachmentContent(CASE, ATTACHMENT)).rejects.toBeInstanceOf(
      OpenVerifyApiError,
    );
  });
});

describe('caseExports.download (C138.1)', () => {
  it('answers the export file with its type', async () => {
    const csv = new TextEncoder().encode('"id","name"\r\n');
    const { client, fetch } = clientAnswering(
      () => new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } }),
    );

    const file = await client.caseExports.download(EXPORT);

    expect(file.bytes).toEqual(csv);
    expect(file.mimeType).toBe('text/csv');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/case-exports/${EXPORT}/download`,
    );
  });
});

describe('exports.download (C166.4)', () => {
  it('answers the export file with its type', async () => {
    const csv = new TextEncoder().encode('"id","status"\r\n');
    const { client, fetch } = clientAnswering(
      () => new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8' } }),
    );
    const exports = (
      client as unknown as {
        exports: {
          download: (id: string) => Promise<{ bytes: Uint8Array; mimeType: string | null }>;
        };
      }
    ).exports;

    const file = await exports.download('exp_01M5CN00000000000000009B33');

    expect(file.bytes).toEqual(csv);
    expect(file.mimeType).toBe('text/csv');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/api/v1/exports/exp_01M5CN00000000000000009B33/download',
    );
  });
});

// C160.6 (Workflow 9A Stage 1a, (H)): a theme asset's upload (multipart) and its rendition.
const THEME_ASSET = 'tsa_01M5CN00000000000000009A42';
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]);

interface ThemeAssetMethods {
  themeSets: {
    uploadAsset: (
      kind: 'logo' | 'font',
      file: { bytes: Uint8Array; filename: string; mimeType?: string },
      options?: { licenceAttested?: boolean; unicodeRange?: string },
    ) => Promise<unknown>;
    assetContent: (id: string) => Promise<{ bytes: Uint8Array; mimeType: string | null }>;
  };
}
const themes = (client: unknown) => client as ThemeAssetMethods;

describe('themeSets.uploadAsset (C160.6)', () => {
  it('sends a font as multipart with its attestation and unicode-range, and parses the asset', async () => {
    const document = apiFixture('theme-asset-font');
    const { client, fetch } = clientAnswering(() => Response.json(document));

    const answer = await themes(client).themeSets.uploadAsset(
      'font',
      { bytes: WOFF2, filename: 'brand.woff2', mimeType: 'font/woff2' },
      { licenceAttested: true, unicodeRange: 'U+0000-00FF' },
    );

    expect(answer).toEqual(document);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.test/api/v1/theme-sets/assets');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form.get('kind')).toBe('font');
    expect(form.get('meta[licence-attested]')).toBe('true');
    expect(form.get('unicode-range')).toBe('U+0000-00FF');
    const part = form.get('file') as File;
    expect(part.name).toBe('brand.woff2');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(WOFF2);
    expect((init?.headers as Record<string, string>)['idempotency-key']).toEqual(
      expect.any(String),
    );
  });

  it('sends a logo with its kind alone', async () => {
    const document = apiFixture('theme-asset');
    const { client, fetch } = clientAnswering(() => Response.json(document));

    await themes(client).themeSets.uploadAsset('logo', { bytes: PNG, filename: 'logo.png' });

    const form = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect([...form.keys()].sort()).toEqual(['file', 'kind']);
  });
});

describe('themeSets.assetContent (C160.6, review P17)', () => {
  it('answers the rendition bytes with their type', async () => {
    const { client, fetch } = clientAnswering(
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    );

    const content = await themes(client).themeSets.assetContent(THEME_ASSET);

    expect(content).toEqual({ bytes: PNG, mimeType: 'image/png' });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/theme-sets/assets/${THEME_ASSET}/content`,
    );
  });
});
