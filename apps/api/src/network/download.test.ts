/**
 * C92.2 steps 3-4: a network source's download and DB-IP's page digest, through a fake stream
 * client with our own synthetic answers: no request leaves the process.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpErrorCode,
  type OutboundStreamClientOptions,
} from '../http/index.js';
import { STREAM_NO_CONTENT_TYPE } from '../http/stream.js';
import {
  NetworkDownloadError,
  downloadNetworkSource,
  networkSourceUrls,
  publisherDigestMatches,
} from './download.js';
import {
  loadNetworkManifest,
  networkManifestSource,
  type NetworkManifestSource,
} from './manifest.js';

const manifest = loadNetworkManifest();
const source = (id: string): NetworkManifestSource => {
  const found = networkManifestSource(id, manifest);
  if (found === undefined) {
    throw new Error(`no ${id}`);
  }
  return found;
};

type Answer =
  | { status: number; body?: string; headers?: Record<string, string> }
  | { error: OutboundHttpErrorCode };

/** A stream client answering each URL from `answers`; it records what it was asked. */
function fakeHttp(answers: Record<string, Answer>) {
  const options: OutboundStreamClientOptions[] = [];
  const requested: string[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('not used');
    },
    streamClient(clientOptions) {
      options.push(clientOptions);
      return {
        async stream(request, sink) {
          requested.push(request.url);
          const answer = answers[request.url] ?? { status: 404 };
          if ('error' in answer) {
            throw new OutboundHttpError(clientOptions.name, answer.error);
          }
          const body = Buffer.from(answer.body ?? '');
          if (answer.status >= 200 && answer.status <= 299) {
            await sink.write(body);
          }
          return {
            status: answer.status,
            contentType: null,
            headers: answer.headers ?? {},
            bytes: answer.status === 200 ? body.byteLength : 0,
          };
        },
      };
    },
    close: () => Promise.resolve(),
  };
  return { http, options, requested };
}

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function download(id: string, http: OutboundHttp | undefined, now: Date) {
  const directory = await mkdtemp(join(tmpdir(), 'openverify-network-download-'));
  directories.push(directory);
  const handle = await open(join(directory, 'file'), 'w+', 0o600);
  try {
    const result = await downloadNetworkSource(source(id), { outboundHttp: http, handle, now });
    const content = (await readFile(join(directory, 'file'))).toString('utf8');
    return { result, content };
  } finally {
    await handle.close();
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const OCT = new Date('2026-10-30T08:00:00Z');

describe('networkSourceUrls', () => {
  it('tries DB-IP’s file of this UTC month, then the previous one, across a year', () => {
    expect(networkSourceUrls(source('dbip-country-lite'), OCT)).toEqual([
      'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz',
      'https://download.db-ip.com/free/dbip-country-lite-2026-09.mmdb.gz',
    ]);
    expect(networkSourceUrls(source('dbip-asn-lite'), new Date('2027-01-01T00:10:00Z'))).toEqual([
      'https://download.db-ip.com/free/dbip-asn-lite-2027-01.mmdb.gz',
      'https://download.db-ip.com/free/dbip-asn-lite-2026-12.mmdb.gz',
    ]);
  });

  it('gives a fixed URL as it is, and none for an import-only source', () => {
    expect(networkSourceUrls(source('tor-exit-addresses'), OCT)).toEqual([
      'https://check.torproject.org/exit-addresses',
    ]);
    expect(networkSourceUrls(source('azure-service-tags'), OCT)).toEqual([]);
  });
});

describe('downloadNetworkSource', () => {
  it('streams the file under the source’s caps and content types, keeping Last-Modified', async () => {
    const fake = fakeHttp({
      'https://check.torproject.org/exit-addresses': {
        status: 200,
        body: 'ExitNode synthetic\n',
        headers: { 'last-modified': 'Fri, 30 Oct 2026 07:47:46 GMT' },
      },
    });
    const { result, content } = await download('tor-exit-addresses', fake.http, OCT);
    expect(content).toBe('ExitNode synthetic\n');
    expect(result).toEqual({
      sha256: sha256('ExitNode synthetic\n'),
      bytes: 19,
      lastModified: new Date('2026-10-30T07:47:46Z'),
    });
    expect(fake.options[0]).toMatchObject({
      name: 'tor-exit-addresses',
      contentTypes: ['text/plain', STREAM_NO_CONTENT_TYPE],
      maxResponseBytes: source('tor-exit-addresses').max_bytes.compressed,
      timeoutMs: 120_000,
      exposeHeaders: ['last-modified', 'etag'],
    });
    expect(fake.options[0]?.redirect).toBeUndefined();
  });

  it('falls back to last month’s DB-IP file when this month’s is not published', async () => {
    const fake = fakeHttp({
      'https://download.db-ip.com/free/dbip-country-lite-2026-09.mmdb.gz': {
        status: 200,
        body: 'synthetic',
      },
    });
    const { content } = await download('dbip-country-lite', fake.http, OCT);
    expect(content).toBe('synthetic');
    expect(fake.requested).toEqual([
      'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz',
      'https://download.db-ip.com/free/dbip-country-lite-2026-09.mmdb.gz',
    ]);
  });

  it('answers not_published when neither month is online, download_failed for another status', async () => {
    await expect(download('dbip-country-lite', fakeHttp({}).http, OCT)).rejects.toMatchObject({
      code: 'not_published',
    });
    const broken = fakeHttp({ 'https://check.torproject.org/exit-addresses': { status: 503 } });
    await expect(download('tor-exit-addresses', broken.http, OCT)).rejects.toMatchObject({
      code: 'download_failed',
    });
  });

  it.each([
    ['too_large', 'download_too_large'],
    ['content_type', 'content_type_refused'],
    ['blocked', 'redirect_refused'],
    ['timeout', 'timeout'],
    ['network', 'download_failed'],
  ] as const)('maps the client’s %s to %s', async (error, code) => {
    const fake = fakeHttp({ 'https://check.torproject.org/exit-addresses': { error } });
    const refused = await download('tor-exit-addresses', fake.http, OCT).catch(
      (thrown: unknown) => thrown,
    );
    expect(refused).toBeInstanceOf(NetworkDownloadError);
    expect(refused).toMatchObject({ code });
  });

  it('fails without a stream client, and a bad Last-Modified is no date', async () => {
    await expect(download('tor-exit-addresses', undefined, OCT)).rejects.toMatchObject({
      code: 'download_failed',
    });
    const fake = fakeHttp({
      'https://check.torproject.org/exit-addresses': {
        status: 200,
        body: 'x',
        headers: { 'last-modified': 'not a date' },
      },
    });
    expect((await download('tor-exit-addresses', fake.http, OCT)).result.lastModified).toBeNull();
  });
});

describe('publisherDigestMatches (DB-IP’s page digest covers the decompressed file)', () => {
  const decompressed = Buffer.from('synthetic decompressed MMDB');
  const sha1 = createHash('sha1').update(decompressed).digest('hex');
  const page = source('dbip-country-lite').digest?.page_url ?? '';

  it('is true when the page names the file’s SHA-1, in either case', async () => {
    const fake = fakeHttp({
      [page]: { status: 200, body: `<td>SHA1</td><td>${sha1.toUpperCase()}</td>` },
    });
    expect(await publisherDigestMatches(source('dbip-country-lite'), decompressed, fake.http)).toBe(
      true,
    );
    expect(fake.options[0]).toMatchObject({
      contentTypes: ['text/html'],
      maxResponseBytes: 2_097_152,
    });
  });

  it('is false when the page names another digest or none', async () => {
    const other = createHash('sha1').update('another file').digest('hex');
    const fake = fakeHttp({ [page]: { status: 200, body: `<td>${other}</td>` } });
    expect(await publisherDigestMatches(source('dbip-country-lite'), decompressed, fake.http)).toBe(
      false,
    );
  });

  it('is true for a source without a digest page, and fails on a page it cannot read', async () => {
    expect(
      await publisherDigestMatches(source('tor-exit-addresses'), decompressed, undefined),
    ).toBe(true);
    await expect(
      publisherDigestMatches(source('dbip-country-lite'), decompressed, fakeHttp({}).http),
    ).rejects.toMatchObject({ code: 'download_failed' });
  });
});
