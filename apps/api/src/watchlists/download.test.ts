/**
 * C80.1: the Wikidata Query Service runner the PEP build asks through, against a fake list
 * client (no request leaves the process): one POST per query with the operator's User-Agent, the
 * source's deadline and cap, the 429 back-off that honours `Retry-After`, and the failures. Also
 * the download URL of a source and the codes of outbound failures (C76.2). Pins written after the
 * code, and seen failing against mutations (see the TDD record).
 */
import { describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpRequest,
  type OutboundStreamClientOptions,
} from '../http/index.js';
import {
  SPARQL_BACKOFF_MS,
  SPARQL_MAX_WAIT_MS,
  WatchlistDownloadError,
  createSparqlRunner,
  downloadCodeOf,
  sourceDownloadUrl,
} from './download.js';
import { manifestSource, type WatchlistManifestSource } from './manifest.js';

function sourceOf(id: string): WatchlistManifestSource {
  const source = manifestSource(id);
  if (source === undefined) {
    throw new Error(`no source ${id}`);
  }
  return source;
}

const wikidata = sourceOf('wikidata-pep');
const USER_AGENT = 'SyntheticScreening/1.0 (ops@example.com)';

type Answer = { status: number; body?: string; retryAfter?: string } | Error;

function fake(answers: Answer[]) {
  const created: OutboundStreamClientOptions[] = [];
  const requests: OutboundHttpRequest[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('no buffered client');
    },
    streamClient: (options) => {
      created.push(options);
      return {
        async stream(request, sink) {
          requests.push(request);
          const answer = answers.shift() ?? { status: 200, body: '{}' };
          if (answer instanceof Error) {
            throw answer;
          }
          const bytes = new TextEncoder().encode(answer.body ?? '');
          if (answer.status === 200) {
            await sink.write(bytes);
          }
          return {
            status: answer.status,
            contentType: 'application/sparql-results+json',
            headers: answer.retryAfter === undefined ? {} : { 'retry-after': answer.retryAfter },
            bytes: answer.status === 200 ? bytes.byteLength : 0,
          };
        },
      };
    },
    close: () => Promise.resolve(),
  };
  return { http, created, requests };
}

function runner(answers: Answer[], waits: number[] = []) {
  const service = fake(answers);
  const run = createSparqlRunner({
    outboundHttp: service.http,
    source: wikidata,
    url: 'https://query.wikidata.org/sparql',
    userAgent: USER_AGENT,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    maxRetries: 3,
  });
  return { run, ...service };
}

describe('the Wikidata runner (C80.1)', () => {
  it('POSTs the query form-encoded with the operator’s User-Agent, within the source’s deadline and cap', async () => {
    const { run, created, requests } = runner([{ status: 200, body: '{"results":{}}' }]);

    const body = await run('SELECT ?person WHERE { ?person wdt:P39 wd:Q-test-1 }');

    expect(Buffer.from(body).toString('utf8')).toBe('{"results":{}}');
    expect(requests).toEqual([
      {
        method: 'POST',
        url: 'https://query.wikidata.org/sparql',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/sparql-results+json',
          'user-agent': USER_AGENT,
        },
        body: `query=${encodeURIComponent('SELECT ?person WHERE { ?person wdt:P39 wd:Q-test-1 }')}`,
      },
    ]);
    expect(created).toEqual([
      expect.objectContaining({
        timeoutMs: 75_000,
        maxResponseBytes: 64 * 1024 * 1024,
        exposeHeaders: ['retry-after'],
      }),
    ]);
    expect(created[0]?.redirect).toBeUndefined();
  });

  it('waits as long as a 429 asks, and backs off without a Retry-After', async () => {
    const waits: number[] = [];
    const { run, requests } = runner(
      [{ status: 429, retryAfter: '7' }, { status: 503 }, { status: 200, body: '{}' }],
      waits,
    );

    await run('SELECT 1');

    expect(requests).toHaveLength(3);
    expect(waits).toEqual([7_000, 2 * SPARQL_BACKOFF_MS]);
  });

  it('caps a Retry-After that asks too much', async () => {
    const waits: number[] = [];
    const { run } = runner(
      [
        { status: 429, retryAfter: '86400' },
        { status: 200, body: '{}' },
      ],
      waits,
    );

    await run('SELECT 1');

    expect(waits).toEqual([SPARQL_MAX_WAIT_MS]);
  });

  it('retries a timeout, and gives up after its retries', async () => {
    const waits: number[] = [];
    const timeout = () => new OutboundHttpError('wikidata-pep', 'timeout');
    const { run, requests } = runner([timeout(), timeout(), timeout(), timeout()], waits);

    await expect(run('SELECT 1')).rejects.toMatchObject({ code: 'timeout' });
    expect(requests).toHaveLength(4);
    expect(waits).toEqual([SPARQL_BACKOFF_MS, 2 * SPARQL_BACKOFF_MS, 4 * SPARQL_BACKOFF_MS]);
  });

  it('fails at once on an answer it cannot retry', async () => {
    const { run, requests } = runner([{ status: 400 }]);

    await expect(run('SELECT 1')).rejects.toMatchObject({ code: 'download_failed' });
    expect(requests).toHaveLength(1);
    await expect(
      runner([new OutboundHttpError('wikidata-pep', 'blocked')]).run('SELECT 1'),
    ).rejects.toMatchObject({ code: 'redirect_refused' });
  });

  it('fails without the list client', async () => {
    const run = createSparqlRunner({
      outboundHttp: undefined,
      source: wikidata,
      url: 'https://query.wikidata.org/sparql',
      userAgent: USER_AGENT,
      sleep: () => Promise.resolve(),
    });

    await expect(run('SELECT 1')).rejects.toBeInstanceOf(WatchlistDownloadError);
  });
});

describe('download URLs and failure codes (C76.2)', () => {
  const settings = { euFsfToken: 'change-me-synthetic-token' } as WatchlistSettings;

  it('adds the EU token to the EU URL alone', () => {
    expect(sourceDownloadUrl(sourceOf('eu-fsf'), settings)).toBe(
      'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=change-me-synthetic-token',
    );
    expect(sourceDownloadUrl(sourceOf('uk-sanctions-list'), settings)).toBe(
      'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml',
    );
    expect(() => sourceDownloadUrl(sourceOf('openverify-sandbox'), settings)).toThrow(
      WatchlistDownloadError,
    );
  });

  it('names each outbound failure by the sources page’s code', () => {
    const code = (kind: ConstructorParameters<typeof OutboundHttpError>[1]) =>
      downloadCodeOf(new OutboundHttpError('synthetic', kind));
    expect([
      code('too_large'),
      code('content_type'),
      code('blocked'),
      code('timeout'),
      code('network'),
      code('dns'),
      downloadCodeOf(new Error('anything else')),
    ]).toEqual([
      'download_too_large',
      'content_type_refused',
      'redirect_refused',
      'timeout',
      'download_failed',
      'download_failed',
      'download_failed',
    ]);
  });
});
