/**
 * C62.7: the trust-store sync over synthetic sources. A scripted outbound client stands in for
 * the network (nothing here leaves the process): the publisher's root, served in a zip as BSI
 * serves it, must hash to the manifest's pin; the master list, a synthetic CMS list from
 * `@openverify/emrtd/testing`, must verify against it; CSCAs become anchors, link certificates
 * only once they verify under a held anchor, never a Utopia certificate; CRLs come from national
 * distribution points only (ICAO hosts only when allowed), verified under their anchor; a list
 * older than the last, a revoked signer, a failed self-test or a refused download changes
 * nothing; and an operator's import verifies against the root it is given.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { loadTrustStore, trustStoreOverview } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { parseMasterList } from '@openverify/emrtd';
import {
  buildCrl,
  buildCsca,
  buildLinkCertificate,
  buildMasterList,
  type TestCertificate,
  type TestMasterListVariant,
} from '@openverify/emrtd/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  OutboundHttp,
  OutboundHttpClientOptions,
  OutboundHttpRequest,
  OutboundHttpResponse,
} from '../http/index.js';
import type { TrustAnchorManifest } from './manifest.js';
import {
  IMPORT_SOURCE,
  TRUST_SYNC_LIMITS,
  TrustContainerError,
  importTrustAnchorList,
  isFetchableCrlUrl,
  readTrustContainer,
  syncTrustAnchors,
  type TrustAnchorSyncDeps,
} from './sync.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const T1 = new Date('2026-09-01T08:00:00.000Z');
const T2 = new Date('2026-10-01T08:00:00.000Z');

const ROOT_URL = 'https://lists.example.test/root.zip';
const LIST_URL = 'https://lists.example.test/master-list.zip';
const ROOT_CRL_URL = 'http://crl.example.test/de.crl';
const ICAO_CRL_URL = 'https://pkddownload1.icao.int/CRLs/FRA.crl';

const root = buildCsca({
  seed: 'sync/root',
  now: NOW,
  country: 'DE',
  commonName: 'Synthetic CSCA DE',
  crlDistributionPoint: ROOT_CRL_URL,
});
const french = buildCsca({
  seed: 'sync/fr',
  now: NOW,
  country: 'FR',
  commonName: 'Synthetic CSCA FR',
  crlDistributionPoint: ICAO_CRL_URL,
});
const newer = buildCsca({
  seed: 'sync/root-2',
  now: NOW,
  country: 'DE',
  commonName: 'Synthetic CSCA DE 2',
});
const link = buildLinkCertificate({ from: root, to: newer, now: NOW });
const stranger = buildCsca({
  seed: 'sync/stranger',
  now: NOW,
  country: 'DE',
  commonName: 'Stranger',
});
const strayLink = buildLinkCertificate({ from: stranger, to: newer, now: NOW });
const utopia = buildCsca({ seed: 'sync/utopia', now: NOW, country: 'UT' });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A zip of `entries`, each stored or deflated, as a publisher's download would be. */
function zip(
  entries: readonly { name: string; data: Uint8Array; deflate?: boolean }[],
): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = entry.deflate === false ? Buffer.from(entry.data) : deflateRawSync(entry.data);
    const method = entry.deflate === false ? 0 : 8;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

function masterList(
  certificates: readonly TestCertificate[],
  signingTime: Date,
  variants: readonly TestMasterListVariant[] = [],
): Uint8Array {
  return buildMasterList({ signerSeed: 'sync/signer', root, certificates, signingTime, variants });
}

interface Route {
  status?: number;
  contentType?: string;
  /** A redirect's `location` header. */
  location?: string;
  body: Uint8Array;
}

/** An outbound client answering from `routes`; it records each request and its client's options. */
function scriptedHttp(routes: Map<string, Route>) {
  const requests: { url: string; options: OutboundHttpClientOptions }[] = [];
  const http: OutboundHttp = {
    client: (options) => ({
      request: (request: OutboundHttpRequest): Promise<OutboundHttpResponse> => {
        requests.push({ url: request.url, options });
        const route = routes.get(request.url);
        const status = route?.status ?? (route === undefined ? 404 : 200);
        return Promise.resolve(
          status >= 200 && status < 300 && route !== undefined
            ? {
                status,
                contentType: route.contentType ?? 'application/octet-stream',
                body: route.body,
              }
            : {
                status,
                contentType: null,
                body: new Uint8Array(),
                ...(route?.location === undefined ? {} : { headers: { location: route.location } }),
              },
        );
      },
    }),
    close: () => Promise.resolve(),
  };
  return { http, requests };
}

function manifestOf(pin = sha256(root.der), enabled = true): TrustAnchorManifest {
  return {
    schema_version: 1,
    sources: [
      {
        id: 'bsi-de',
        enabled,
        publisher: 'Synthetic publisher',
        list_url: LIST_URL,
        root_certificate_url: ROOT_URL,
        root_certificate_sha256: pin,
        fingerprint_checked_against: 'synthetic',
        content_type: '2.23.136.1.1.2',
        signer_eku: '2.23.136.1.1.3',
        terms: 'synthetic',
      },
      {
        id: 'npkd-nl',
        enabled: false,
        publisher: 'Synthetic publisher',
        list_url: 'https://lists.example.test/nl.ml',
        root_certificate_url: 'https://lists.example.test/nl.cer',
        root_certificate_sha256: 'f'.repeat(64),
        fingerprint_checked_against: 'synthetic',
        content_type: '2.23.136.1.1.2',
        signer_eku: '2.23.136.1.1.3',
        terms: 'synthetic',
      },
    ],
  };
}

function routesWith(
  list: Uint8Array,
  crl: Uint8Array | null = buildCrl({ issuer: root, now: NOW, crlNumber: 5 }),
) {
  const routes = new Map<string, Route>([
    [
      ROOT_URL,
      {
        body: zip([{ name: '[ROOT-CA]_CSCA.cer', data: root.der }]),
        contentType: 'application/zip',
      },
    ],
    [
      LIST_URL,
      { body: zip([{ name: 'DE_ML_2026-10-01.ml', data: list }]), contentType: 'application/zip' },
    ],
  ]);
  if (crl !== null) {
    routes.set(ROOT_CRL_URL, { body: crl, contentType: 'application/pkix-crl' });
  }
  return routes;
}

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  // The trust store is install-wide: each test starts from an empty one.
  await database.db.execute(
    sql`truncate trust_anchor_syncs, trust_crls, trust_anchor_memberships, trust_anchors, trust_anchor_sources`,
  );
});

afterAll(async () => {
  await database.close();
});

function deps(
  http: OutboundHttp,
  overrides: Partial<TrustAnchorSyncDeps> = {},
): TrustAnchorSyncDeps {
  return {
    db: database.db,
    outboundHttp: http,
    clock: { now: () => NOW },
    allowIcaoCrls: false,
    ...overrides,
  };
}

async function storedAnchors() {
  const { anchors } = await loadTrustStore(database.db, { environmentKind: 'production' });
  return new Map(anchors.map((anchor) => [anchor.id, anchor]));
}

describe('syncTrustAnchors (C62.7)', () => {
  it('accepts a list verified against the pinned root: CSCAs, verified links and national CRLs', async () => {
    const { http, requests } = scriptedHttp(
      routesWith(masterList([root, french, link, strayLink, utopia], T2)),
    );

    const outcomes = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcomes).toEqual([
      {
        sourceId: 'bsi-de',
        outcome: 'accepted',
        reason: null,
        anchorsSeen: 3,
        anchorsWithdrawn: 0,
        crlsUpdated: 1,
        crlsRefused: 0,
      },
    ]);
    const anchors = await storedAnchors();
    expect([...anchors.keys()].sort()).toEqual(
      [sha256(root.der), sha256(french.der), sha256(link.der)].sort(),
    );
    expect(anchors.get(sha256(link.der))).toMatchObject({
      isLink: true,
      country: 'DE',
      withdrawn: false,
    });
    expect(anchors.get(sha256(root.der))).toMatchObject({ isLink: false, sandboxOnly: false });
    const { crls } = await loadTrustStore(database.db, { environmentKind: 'production' });
    expect(crls).toMatchObject([{ issuerCountry: 'DE' }]);
    // The disabled source is never fetched, and the ICAO host is not asked without the flag.
    expect(requests.map((request) => request.url)).toEqual([ROOT_URL, LIST_URL, ROOT_CRL_URL]);
    const byUrl = new Map(requests.map((request) => [request.url, request.options]));
    expect(byUrl.get(LIST_URL)).toMatchObject({
      maxResponseBytes: TRUST_SYNC_LIMITS.listBytes,
      timeoutMs: TRUST_SYNC_LIMITS.timeoutMs,
    });
    expect(byUrl.get(ROOT_CRL_URL)).toMatchObject({
      maxResponseBytes: TRUST_SYNC_LIMITS.crlBytes,
      allowPlainHttp: true,
    });
    for (const options of byUrl.values()) {
      expect(options.allowPrivateNetworks).not.toBe(true);
      // Workflow 5C review K3: every payload is verified by its pin or signature before use.
      expect(options.acceptMissingContentType).toBe(true);
    }
    const overview = await trustStoreOverview(database.db, NOW);
    expect(overview.sources.find((source) => source.id === 'npkd-nl')).toMatchObject({
      enabled: false,
    });
  });

  it('fetches ICAO PKD CRLs only with OPENVERIFY_NFC_ALLOW_ICAO_CRLS', async () => {
    const routes = routesWith(masterList([root, french], T2));
    routes.set(ICAO_CRL_URL, { body: buildCrl({ issuer: french, now: NOW, crlNumber: 1 }) });
    const { http, requests } = scriptedHttp(routes);

    const [outcome] = await syncTrustAnchors(deps(http, { allowIcaoCrls: true }), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 2 });
    expect(requests.map((request) => request.url)).toContain(ICAO_CRL_URL);
  });

  it('refuses a root that does not hash to its pin, storing nothing', async () => {
    const { http } = scriptedHttp(routesWith(masterList([root], T2)));

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf(sha256(french.der)));

    expect(outcome).toMatchObject({ outcome: 'refused', reason: 'root_pin_mismatch' });
    expect((await storedAnchors()).size).toBe(0);
    const overview = await trustStoreOverview(database.db, NOW);
    expect(overview.sources[0]?.lastSync).toMatchObject({
      outcome: 'refused',
      reason: 'root_pin_mismatch',
    });
  });

  it.each([
    ['bad-signature', 'signature_invalid'],
    ['signer-without-eku', 'signer_profile_invalid'],
    ['wrong-content-type', 'content_type_invalid'],
    ['tampered-content', 'message_digest_mismatch'],
  ] as const)('refuses a %s list (%s), storing nothing', async (variant, reason) => {
    const { http } = scriptedHttp(routesWith(masterList([root, french], T2, [variant])));

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'refused', reason });
    expect((await storedAnchors()).size).toBe(0);
  });

  it('refuses an older list than the last accepted (rollback), and withdraws what a newer one drops', async () => {
    const first = scriptedHttp(routesWith(masterList([root, french], T2)));
    await syncTrustAnchors(deps(first.http), manifestOf());

    const older = scriptedHttp(routesWith(masterList([root], T1)));
    const [rolledBack] = await syncTrustAnchors(deps(older.http), manifestOf());
    expect(rolledBack).toMatchObject({ outcome: 'refused', reason: 'list_signing_time_rollback' });
    expect((await storedAnchors()).get(sha256(french.der))?.withdrawn).toBe(false);

    const later = new Date('2026-10-10T08:00:00.000Z');
    const newerList = scriptedHttp(routesWith(masterList([root], later)));
    const [accepted] = await syncTrustAnchors(deps(newerList.http), manifestOf());
    expect(accepted).toMatchObject({ outcome: 'accepted', anchorsSeen: 1, anchorsWithdrawn: 1 });
    expect((await storedAnchors()).get(sha256(french.der))?.withdrawn).toBe(true);
  });

  it('refuses a list whose signer its issuer revoked', async () => {
    const list = masterList([root], T2);
    const signer = parseMasterList(list).signer;
    const revoking = buildCrl({
      issuer: root,
      now: NOW,
      crlNumber: 6,
      revokedSerials: [signer?.serialNumber ?? ''],
    });
    const { http } = scriptedHttp(routesWith(list, revoking));

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'refused', reason: 'signer_revoked' });
    expect((await storedAnchors()).size).toBe(0);
  });

  it('keeps no CRL that does not verify under its anchor', async () => {
    const forged = buildCrl({ issuer: stranger, now: NOW, crlNumber: 9 });
    const { http } = scriptedHttp(routesWith(masterList([root], T2), forged));

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 0 });
    expect((await loadTrustStore(database.db, { environmentKind: 'production' })).crls).toEqual([]);
  });

  // Workflow 5C review P002: CRLs come over plain http; one an on-path attacker re-tagged so that
  // asn1js throws must be skipped like a CRL that fails its signature, not abort the run.
  it('skips a CRL asn1js cannot decode, and accepts the list', async () => {
    const der = buildCrl({ issuer: root, now: NOW, crlNumber: 5 });
    const hex = Buffer.from(der).toString('hex');
    // The issuer's country, PrintableString "DE", re-tagged as a UniversalString of two bytes.
    const hostile = new Uint8Array(Buffer.from(hex.replace('13024445', '1c024445'), 'hex'));
    expect(Buffer.from(hostile).toString('hex')).not.toBe(hex);
    const { http } = scriptedHttp(routesWith(masterList([root], T2), hostile));

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 0 });
    expect((await loadTrustStore(database.db, { environmentKind: 'production' })).crls).toEqual([]);
  });

  it('records a failed download, a redirect included, and stores nothing', async () => {
    const routes = routesWith(masterList([root], T2));
    routes.set(LIST_URL, { status: 302, body: new Uint8Array() });
    const { http } = scriptedHttp(routes);

    const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'fetch_failed' });
    expect((await storedAnchors()).size).toBe(0);
  });

  // Workflow 5C review K2 (owner decision 3 after Workflow 5B): a CRL distribution point may
  // redirect once, to https; the hop goes through the same client (its SSRF rules, caps and
  // deadline), and the CRL must still verify under its anchor.
  describe('a CRL download that redirects', () => {
    const MIRROR_URL = 'https://crl-mirror.example.test/csca/de.crl';

    function redirected(target: string, served: Route | null) {
      const routes = routesWith(masterList([root], T2), null);
      routes.set(ROOT_CRL_URL, { status: 302, location: target, body: new Uint8Array() });
      if (served !== null) {
        routes.set(target, served);
      }
      return scriptedHttp(routes);
    }

    it('follows one redirect to https and stores the CRL verified under its anchor', async () => {
      const crl = buildCrl({ issuer: root, now: NOW, crlNumber: 5 });
      const { http, requests } = redirected(MIRROR_URL, {
        body: crl,
        contentType: 'application/pkix-crl',
      });

      const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

      expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 1 });
      expect(requests.map((request) => request.url)).toEqual([
        ROOT_URL,
        LIST_URL,
        ROOT_CRL_URL,
        MIRROR_URL,
      ]);
      // The hop is a request of the CRL client itself: the same SSRF rules, cap and deadline.
      expect(requests[3]?.options).toEqual(requests[2]?.options);
      const { crls } = await loadTrustStore(database.db, { environmentKind: 'production' });
      expect(crls).toMatchObject([{ issuerCountry: 'DE' }]);
    });

    it.each([
      [
        'a second redirect',
        MIRROR_URL,
        { status: 301, location: 'https://other.example.test/de.crl', body: new Uint8Array() },
      ],
      ['a plain http target', 'http://crl-mirror.example.test/de.crl', null],
      ['a target with credentials', 'https://user:synthetic@crl-mirror.example.test/de.crl', null],
      ['a location that is no URL', 'https://[not a url', null],
      // Resolved against the http distribution point, a relative location stays http.
      ['a relative location under an http distribution point', '/moved/de.crl', null],
    ] as const)('refuses %s, storing no CRL', async (_label, target, served) => {
      const { http, requests } = redirected(target, served);

      const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

      expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 0 });
      expect((await loadTrustStore(database.db, { environmentKind: 'production' })).crls).toEqual(
        [],
      );
      const fetched = requests.map((request) => request.url);
      expect(fetched.slice(0, 3)).toEqual([ROOT_URL, LIST_URL, ROOT_CRL_URL]);
      expect(fetched.filter((url) => url === 'https://other.example.test/de.crl')).toEqual([]);
      if (served === null) {
        expect(fetched).toHaveLength(3);
      }
    });

    it('refuses a CRL behind the redirect that does not verify under its anchor', async () => {
      const { http } = redirected(MIRROR_URL, {
        body: buildCrl({ issuer: stranger, now: NOW, crlNumber: 9 }),
        contentType: 'application/pkix-crl',
      });

      const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

      expect(outcome).toMatchObject({ outcome: 'accepted', crlsUpdated: 0 });
      expect((await loadTrustStore(database.db, { environmentKind: 'production' })).crls).toEqual(
        [],
      );
    });

    it('still follows no redirect of a master list or a root certificate', async () => {
      for (const moved of [LIST_URL, ROOT_URL]) {
        const routes = routesWith(masterList([root], T2));
        routes.set(moved, { status: 302, location: MIRROR_URL, body: new Uint8Array() });
        routes.set(MIRROR_URL, { body: new Uint8Array([1]), contentType: 'application/zip' });
        const { http, requests } = scriptedHttp(routes);

        const [outcome] = await syncTrustAnchors(deps(http), manifestOf());

        expect(outcome).toMatchObject({ outcome: 'failed', reason: 'fetch_failed' });
        expect(requests.map((request) => request.url)).not.toContain(MIRROR_URL);
      }
    });
  });

  it('runs the self-test first, and fetches nothing when it fails', async () => {
    const { http, requests } = scriptedHttp(routesWith(masterList([root], T2)));

    const [outcome] = await syncTrustAnchors(
      deps(http, {
        selfTest: () => ({
          ok: false,
          failures: ['brainpoolP256r1-explicit'],
          node: 'test',
          openssl: 'test',
        }),
      }),
      manifestOf(),
    );

    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'self_test_failed' });
    expect(requests).toEqual([]);
  });

  it('syncs only the source it is told, and refuses a disabled or unknown one', async () => {
    const { http } = scriptedHttp(routesWith(masterList([root], T2)));

    expect(await syncTrustAnchors(deps(http), manifestOf(), { source: 'npkd-nl' })).toMatchObject([
      { sourceId: 'npkd-nl', outcome: 'refused', reason: 'source_disabled' },
    ]);
    await expect(syncTrustAnchors(deps(http), manifestOf(), { source: 'ita' })).rejects.toThrow(
      RangeError,
    );
    expect(await syncTrustAnchors(deps(http), manifestOf(), { source: 'bsi-de' })).toMatchObject([
      { sourceId: 'bsi-de', outcome: 'accepted' },
    ]);
  });
});

describe('importTrustAnchorList (C62.7, --import)', () => {
  it('applies a list read from a file, verified against the given PEM root, to the import source', async () => {
    const { http } = scriptedHttp(
      new Map([[ROOT_CRL_URL, { body: buildCrl({ issuer: root, now: NOW, crlNumber: 5 }) }]]),
    );
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(root.der)
      .toString('base64')
      .replace(/(.{64})/gu, '$1\n')}\n-----END CERTIFICATE-----\n`;

    const outcome = await importTrustAnchorList(deps(http), {
      list: masterList([root, french], T2),
      root: new TextEncoder().encode(pem),
    });

    expect(outcome).toMatchObject({ sourceId: IMPORT_SOURCE, outcome: 'accepted', anchorsSeen: 2 });
    expect((await storedAnchors()).size).toBe(2);
  });

  it('refuses a list another root signed', async () => {
    const { http } = scriptedHttp(new Map());

    const outcome = await importTrustAnchorList(deps(http), {
      list: masterList([root], T2),
      root: french.der,
    });

    expect(outcome).toMatchObject({ outcome: 'refused', reason: 'signer_not_issued_by_root' });
  });
});

describe('readTrustContainer (C62.7)', () => {
  const accept = (name: string) => name.endsWith('.ml');

  it('reads DER as it is, a PEM block, and a stored or deflated zip entry', () => {
    const der = root.der;
    expect(readTrustContainer(der, accept, 1024 * 1024)).toEqual(der);
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(der).toString('base64')}\n-----END CERTIFICATE-----`;
    expect(readTrustContainer(new TextEncoder().encode(pem), accept, 1024 * 1024)).toEqual(der);
    for (const deflate of [true, false]) {
      expect(
        readTrustContainer(
          zip([
            { name: 'README.txt', data: new Uint8Array([1]) },
            { name: 'list.ml', data: der, deflate },
          ]),
          accept,
          1024 * 1024,
        ),
      ).toEqual(der);
    }
  });

  it('refuses a zip without the entry, an entry over the cap, and anything else', () => {
    expect(() =>
      readTrustContainer(zip([{ name: 'README.txt', data: new Uint8Array([1]) }]), accept, 1024),
    ).toThrow(TrustContainerError);
    expect(() =>
      readTrustContainer(zip([{ name: 'list.ml', data: new Uint8Array(4096) }]), accept, 1024),
    ).toThrow(TrustContainerError);
    expect(() =>
      readTrustContainer(new TextEncoder().encode('<html>not a list</html>'), accept, 1024),
    ).toThrow(TrustContainerError);
    expect(() => readTrustContainer(new Uint8Array(), accept, 1024)).toThrow(TrustContainerError);
  });
});

describe('isFetchableCrlUrl (C62.7)', () => {
  it.each([
    ['http://crl.example.test/de.crl', false, true],
    ['https://download.example.test/crl/DE_CRL.crl', false, true],
    ['https://pkddownload1.icao.int/CRLs/DEU.crl', false, false],
    ['https://icao.int/x.crl', false, false],
    ['https://pkddownload1.icao.int/CRLs/DEU.crl', true, true],
    ['https://icao.int.example.test/x.crl', false, true],
    ['ldap://ldap.example.test/cn=crl', false, false],
    ['not a url', false, false],
  ])('%s (ICAO CRLs allowed: %s): %s', (url, allowed, fetchable) => {
    expect(isFetchableCrlUrl(url, allowed)).toBe(fetchable);
  });
});
