/**
 * C253 (Workflow 11B, integration-11b): `@openverify/node`'s account-export group over the four
 * routes: `create(accountId)` posts `POST /accounts/:id/export` with the empty body and answers the
 * pending export (202), `retrieve(id)` and `manifest(id)` read the export and its
 * `openverify.account-export.v1` manifest, and `fileContent(id, fileId)` answers a listed file's bytes
 * with their type, throwing the API's problem for a refusal (410 once the file was redacted). The
 * answers are contracts-11b's golden fixtures; every token is synthetic.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { OpenVerifyApiError } from './errors.js';
import { apiFixture } from './test-support.js';

type AnyMethod = (...args: unknown[]) => Promise<unknown>;

const pending = apiFixture('account-exports/account-export-pending');
const ready = apiFixture('account-exports/account-export-ready');
const manifest = apiFixture('account-exports/manifest');
const EXPORT = (pending.data as { id: string }).id;
const ACCOUNT = 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8';
const FILE = 'file_01M5CJZC301G4JHXZQ3PZBYH3Q';
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function clientAnswering(response: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
  const client = createClient({
    apiKey: 'ov_sbx_synthetictesttokenaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseUrl: 'https://api.example.test',
    fetch,
    maxRetries: 0,
  });
  const method = (name: string): AnyMethod => {
    const group = (client as unknown as Record<string, Record<string, AnyMethod> | undefined>)
      .accountExports;
    const call = group?.[name];
    if (call === undefined) {
      throw new Error(`accountExports.${name} is not built`);
    }
    return call;
  };
  return { fetch, client, method };
}

describe('accountExports (C253)', () => {
  it('creates an export of an account and answers it pending', async () => {
    const { fetch, method } = clientAnswering(() => Response.json(pending, { status: 202 }));

    const answer = await method('create')(ACCOUNT);

    expect(answer).toEqual(pending);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example.test/api/v1/accounts/${ACCOUNT}/export`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({});
  });

  it('retrieves an export and its manifest', async () => {
    const answers = [ready, manifest];
    const { fetch, method } = clientAnswering(() => Response.json(answers.shift()));

    expect(await method('retrieve')(EXPORT)).toEqual(ready);
    expect(await method('manifest')(EXPORT)).toEqual(manifest);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `https://api.example.test/api/v1/account-exports/${EXPORT}`,
      `https://api.example.test/api/v1/account-exports/${EXPORT}/manifest`,
    ]);
  });

  it('answers a listed file’s bytes unchanged, with their type', async () => {
    const { fetch, method } = clientAnswering(
      () => new Response(BYTES, { headers: { 'content-type': 'application/pdf' } }),
    );

    const content = (await method('fileContent')(EXPORT, FILE)) as {
      bytes: Uint8Array;
      mimeType: string | null;
    };

    expect(content.bytes).toEqual(BYTES);
    expect(content.mimeType).toBe('application/pdf');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/account-exports/${EXPORT}/files/${FILE}`,
    );
  });

  it('throws the API’s problem for a redacted file', async () => {
    const { method } = clientAnswering(() =>
      Response.json(
        { type: 'about:blank', title: 'Gone', status: 410, detail: 'Redacted.' },
        { status: 410, headers: { 'content-type': 'application/problem+json' } },
      ),
    );

    await expect(method('fileContent')(EXPORT, FILE)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });
});
