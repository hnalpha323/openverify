/**
 * C62.7: the trust-store sync (`trust-anchors:sync` and the worker's `trust-anchor-refresh`).
 * For each enabled source of `trust-anchors/manifest.json`, after `selfTest()`:
 *
 * 1. the publisher's root CSCA is fetched through the outbound client (https, no redirects, no
 *    private networks) and must hash to the manifest's pin;
 * 2. the master list (DER, or the one list in a zip) is fetched (16 MiB, 15 s) and verified
 *    against that root (`verifyMasterList`: content type, the signer's EKU and key usage, its AKI
 *    to the root or a verified link, `messageDigest`, the signature over the original bytes);
 * 3. the list's CSCAs become candidate anchors; a link certificate only once it verifies under a
 *    held anchor; Utopia certificates never (the specimen issuer is the seed's alone);
 * 4. each anchor's CRLs are fetched from its distribution points (5 MiB; national hosts only,
 *    ICAO PKD hosts only with `OPENVERIFY_NFC_ALLOW_ICAO_CRLS=true`; one redirect to https
 *    followed, Workflow 5C review K2), verified under the anchor, and the signer is refused when
 *    its issuer's CRL lists it;
 * 5. the store applies it in one transaction (`applyTrustSync`: rollback refused, withdrawal,
 *    current and monotonic CRLs, the audit rows).
 *
 * `--import` reads a list from a file instead, verified against a root the operator supplies.
 * Nothing it fetches is committed or logged; it never runs in tests or CI against a real list.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
  applyTrustSync,
  loadTrustStore,
  recordTrustAnchorSync,
  syncTrustAnchorSources,
  type Db,
  type TrustAnchorInput,
  type TrustCrlInput,
} from '@openverify/db';
import {
  EmrtdError,
  parseCertificate,
  parseCrl,
  parseMasterList,
  selfTest as emrtdSelfTest,
  verifyCertificateSignature,
  verifyCrlSignature,
  verifyMasterList,
  type ParsedCertificate,
  type ParsedCrl,
  type SelfTestResult,
} from '@openverify/emrtd';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpClient,
  type OutboundHttpResponse,
} from '../http/index.js';
import type { Clock } from '../ports.js';
import {
  MASTER_LIST_SIGNER_EKU,
  type TrustAnchorManifest,
  type TrustAnchorSourceEntry,
} from './manifest.js';

/** The source an `--import` without `--source` is listed under. */
export const IMPORT_SOURCE = 'operator-import';

/** C62.7: the caps of what the sync fetches. */
export const TRUST_SYNC_LIMITS = Object.freeze({
  listBytes: 16 * 1024 * 1024,
  crlBytes: 5 * 1024 * 1024,
  certificateBytes: 1024 * 1024,
  timeoutMs: 15_000,
});

/** The outbound client's name in errors (never a URL). */
const CLIENT = 'trust-anchor-sync';

/** What a publisher serves a certificate, a master list or a CRL as. */
const CERTIFICATE_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/pkix-cert',
  'application/x-x509-ca-cert',
  'application/x-pem-file',
  'application/octet-stream',
];
const LIST_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'application/pkcs7-mime',
  'application/x-pkcs7-mime',
];
const CRL_TYPES = [
  'application/pkix-crl',
  'application/x-pkcs7-crl',
  'application/x-x509-crl',
  'application/octet-stream',
];

/** The Utopia specimen issuer: only the seed's sandbox anchor may carry it (C62.8). */
const SPECIMEN_COUNTRY = 'UT';

export interface TrustAnchorSyncDeps {
  db: Db;
  outboundHttp: OutboundHttp;
  clock: Clock;
  /** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS`: also fetch CRLs from ICAO PKD hosts. */
  allowIcaoCrls: boolean;
  /** The platform self-test; `@openverify/emrtd`'s by default. */
  selfTest?: (() => SelfTestResult) | undefined;
  /** Progress lines (codes and counts only). */
  log?: ((line: string) => void) | undefined;
}

/** What one source's sync did. */
export interface TrustSyncOutcome {
  sourceId: string;
  outcome: 'accepted' | 'refused' | 'failed';
  /** A snake_case code when refused or failed (`root_pin_mismatch`, `signature_invalid`, ...). */
  reason: string | null;
  anchorsSeen: number;
  anchorsWithdrawn: number;
  crlsUpdated: number;
  crlsRefused: number;
}

/** A download could not be read as what it should hold. */
export class TrustContainerError extends Error {
  override name = 'TrustContainerError';
}

/** A download failed: an error, a redirect or another status. Names no URL. */
class FetchFailedError extends Error {
  override name = 'FetchFailedError';
}

/** A refusal (or a failure) of the source's sync, with its audit code. */
class SyncRefusal extends Error {
  override name = 'SyncRefusal';
  readonly reason: string;
  readonly outcome: 'refused' | 'failed';

  constructor(reason: string, outcome: 'refused' | 'failed' = 'refused') {
    super(reason);
    this.reason = reason;
    this.outcome = outcome;
  }
}

/** C62.9: the self-test failed, so nothing is fetched. */
const selfTestFailed = () => new SyncRefusal('self_test_failed', 'failed');

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_MAX_ENTRIES = 64;
const ZIP_MAX_COMMENT = 65_535;

/** The entry of a zip whose name `accept` takes, within `maxBytes` (no ZIP64, no encryption). */
function unzipEntry(bytes: Uint8Array, accept: (name: string) => boolean, maxBytes: number) {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string): never => {
    throw new TrustContainerError(`zip: ${why}`);
  };
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - ZIP_MAX_COMMENT); at -= 1) {
    if (zip.readUInt32LE(at) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    fail('no end of central directory');
  }
  const entries = zip.readUInt16LE(end + 10);
  const directoryOffset = zip.readUInt32LE(end + 16);
  if (entries > ZIP_MAX_ENTRIES || directoryOffset >= zip.length) {
    fail('directory out of bounds');
  }
  let at = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== ZIP_CENTRAL) {
      fail('bad central record');
    }
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, Math.min(zip.length, at + 46 + nameLength));
    at = next;
    if (name.endsWith('/') || !accept(name.toLowerCase())) {
      continue;
    }
    if (
      (flags & 1) !== 0 ||
      size > maxBytes ||
      compressed > zip.length ||
      localOffset + 30 > zip.length
    ) {
      fail('entry refused');
    }
    if (zip.readUInt32LE(localOffset) !== ZIP_LOCAL) {
      fail('bad local header');
    }
    const start =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (start + compressed > zip.length) {
      fail('entry out of bounds');
    }
    const data = zip.subarray(start, start + compressed);
    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(data);
    } else if (method === 8) {
      try {
        content = inflateRawSync(data, { maxOutputLength: maxBytes });
      } catch {
        return fail('entry does not inflate within the cap');
      }
    } else {
      return fail('compression method');
    }
    if (content.length !== size) {
      fail('entry size');
    }
    return new Uint8Array(content);
  }
  return fail('no matching entry');
}

/** The DER of a PEM block, when `bytes` is one. */
function pemBlock(bytes: Uint8Array): Uint8Array | null {
  const text = Buffer.from(bytes).toString('latin1');
  const begin = text.indexOf('-----BEGIN ');
  const opened = begin < 0 ? -1 : text.indexOf('-----', begin + 11);
  const close = opened < 0 ? -1 : text.indexOf('-----END ', opened + 5);
  if (close < 0) {
    return null;
  }
  const body = text.slice(opened + 5, close).replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(body)) {
    return null;
  }
  const der = Buffer.from(body, 'base64');
  return der[0] === 0x30 ? new Uint8Array(der) : null;
}

export function readTrustContainer(
  bytes: Uint8Array,
  accept: (name: string) => boolean,
  maxBytes: number,
): Uint8Array {
  if (bytes.length === 0 || bytes.length > maxBytes + ZIP_MAX_COMMENT + 1024 * 1024) {
    throw new TrustContainerError('empty or oversized download');
  }
  if (bytes[0] === 0x30) {
    if (bytes.length > maxBytes) {
      throw new TrustContainerError('over the cap');
    }
    return new Uint8Array(bytes);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return unzipEntry(bytes, accept, maxBytes);
  }
  const pem = pemBlock(bytes);
  if (pem !== null && pem.length <= maxBytes) {
    return pem;
  }
  throw new TrustContainerError('not DER, PEM or a zip');
}

export function isFetchableCrlUrl(url: string, allowIcaoCrls: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  const icao = host === 'icao.int' || host.endsWith('.icao.int');
  return !icao || allowIcaoCrls;
}

const isCertificateName = (name: string) =>
  name.endsWith('.cer') || name.endsWith('.crt') || name.endsWith('.der') || name.endsWith('.pem');
const isListName = (name: string) => name.endsWith('.ml') || name.endsWith('.mls');

interface Clients {
  certificate: OutboundHttpClient;
  list: OutboundHttpClient;
  crl: OutboundHttpClient;
}

function clientsOf(http: OutboundHttp): Clients {
  const { timeoutMs } = TRUST_SYNC_LIMITS;
  // Workflow 5C review K3 (owner decision 4 after Workflow 5B): some publishers (the Netherlands,
  // Switzerland) send no Content-Type. Each payload is verified by its pin or its signature
  // before use, so a missing type is taken; a wrong one is still refused.
  const acceptMissingContentType = true;
  return {
    certificate: http.client({
      name: CLIENT,
      contentTypes: CERTIFICATE_TYPES,
      maxResponseBytes: TRUST_SYNC_LIMITS.certificateBytes,
      timeoutMs,
      acceptMissingContentType,
    }),
    list: http.client({
      name: CLIENT,
      contentTypes: LIST_TYPES,
      maxResponseBytes: TRUST_SYNC_LIMITS.listBytes,
      timeoutMs,
      acceptMissingContentType,
    }),
    // CRLs are signed and their distribution points are often http: plain http is read, and a
    // private network is still refused.
    crl: http.client({
      name: CLIENT,
      contentTypes: CRL_TYPES,
      maxResponseBytes: TRUST_SYNC_LIMITS.crlBytes,
      timeoutMs,
      allowPlainHttp: true,
      acceptMissingContentType,
    }),
  };
}

/** One GET's answer. */
async function get(client: OutboundHttpClient, url: string): Promise<OutboundHttpResponse> {
  try {
    return await client.request({ method: 'GET', url });
  } catch (error) {
    if (error instanceof OutboundHttpError) {
      throw new FetchFailedError(error.code);
    }
    throw error;
  }
}

/** A 200 answer's body; a redirect or any other status is a failure. */
function bodyOf(response: OutboundHttpResponse): Uint8Array {
  if (response.status !== 200) {
    throw new FetchFailedError(`status ${String(response.status)}`);
  }
  return response.body;
}

/** One GET; a redirect or any status but 200 is a failure (C54.6: never followed). */
async function fetchBytes(client: OutboundHttpClient, url: string): Promise<Uint8Array> {
  return bodyOf(await get(client, url));
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The https URL a redirect's `location` names against `base`, or `null` for any other. */
function redirectTarget(base: string, location: string | undefined): string | null {
  if (location === undefined) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(location, base);
  } catch {
    return null;
  }
  return target.protocol === 'https:' && target.username === '' && target.password === ''
    ? target.href
    : null;
}

/**
 * A CRL download (Workflow 5C review K2, owner decision 3 after Workflow 5B: C54.6 and C62.7
 * amended for CRLs only). One redirect is followed when it names an https URL, through the same
 * client, so the private-network refusal, the cap and the deadline apply to the hop too; a second
 * redirect is a failure. The hop adds no trust: the CRL must still verify under its anchor, be
 * current and keep its number. Master lists and root certificates follow none (`fetchBytes`).
 */
async function fetchCrlBytes(client: OutboundHttpClient, url: string): Promise<Uint8Array> {
  const response = await get(client, url);
  if (!REDIRECT_STATUSES.has(response.status)) {
    return bodyOf(response);
  }
  const target = redirectTarget(url, response.headers?.location);
  if (target === null) {
    throw new FetchFailedError('redirect refused');
  }
  return bodyOf(await get(client, target));
}

/** Parses, or refuses with `reason` on a malformed object. */
function parsed<T>(read: () => T, reason: string): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof EmrtdError || error instanceof TrustContainerError) {
      throw new SyncRefusal(reason);
    }
    throw error;
  }
}

const anchorInput = (certificate: ParsedCertificate, isLink: boolean): TrustAnchorInput => ({
  sha256: certificate.sha256,
  certificate: certificate.der,
  country: certificate.country ?? '',
  subjectDn: certificate.subjectDn,
  ski: certificate.ski,
  aki: certificate.aki,
  notBefore: certificate.notBefore,
  notAfter: certificate.notAfter,
  isLink,
});

const isSelfSigned = (certificate: ParsedCertificate) =>
  certificate.subjectDnKey === certificate.issuerDnKey &&
  (certificate.aki === null || certificate.ski === null || certificate.aki === certificate.ski);

/** Whether `issuer` certifies `certificate` (key identifiers agreeing, the signature verifying). */
const certifies = (issuer: ParsedCertificate, certificate: ParsedCertificate) =>
  (certificate.aki === null || issuer.ski === null || certificate.aki === issuer.ski) &&
  verifyCertificateSignature(certificate, issuer);

/**
 * The list's anchors: its self-signed CSCAs, and each link certificate that a held anchor (the
 * root, a CSCA of the list, or one the store already holds) verifies; never a master list signer
 * or a Utopia certificate, nor one without a country.
 */
async function anchorsOf(
  deps: TrustAnchorSyncDeps,
  root: ParsedCertificate,
  certificates: readonly ParsedCertificate[],
): Promise<{ csca: ParsedCertificate[]; links: ParsedCertificate[] }> {
  const candidates = certificates.filter(
    (certificate) =>
      certificate.isCa &&
      certificate.country !== null &&
      certificate.country !== SPECIMEN_COUNTRY &&
      !certificate.extendedKeyUsage.includes(MASTER_LIST_SIGNER_EKU),
  );
  const csca = candidates.filter(
    (certificate) =>
      isSelfSigned(certificate) && verifyCertificateSignature(certificate, certificate),
  );
  const stored = (await loadTrustStore(deps.db, { environmentKind: 'production' })).anchors.flatMap(
    (anchor) => {
      try {
        return [parseCertificate(anchor.certificate)];
      } catch {
        return [];
      }
    },
  );
  const held = [root, ...csca, ...stored];
  const links = candidates.filter(
    (certificate) =>
      !isSelfSigned(certificate) && held.some((issuer) => certifies(issuer, certificate)),
  );
  return { csca, links };
}

/** The CRLs of `issuers` from their distribution points, each verified under its issuer. */
async function crlsOf(
  deps: TrustAnchorSyncDeps,
  clients: Clients,
  issuers: readonly ParsedCertificate[],
): Promise<{ crl: ParsedCrl; input: TrustCrlInput }[]> {
  const urls = [
    ...new Set(
      issuers.flatMap((issuer) =>
        issuer.crlDistributionPoints.filter((url) => isFetchableCrlUrl(url, deps.allowIcaoCrls)),
      ),
    ),
  ];
  const verified: { crl: ParsedCrl; input: TrustCrlInput }[] = [];
  for (const url of urls) {
    let der: Uint8Array;
    try {
      der = await fetchCrlBytes(clients.crl, url);
    } catch (error) {
      if (error instanceof FetchFailedError) {
        deps.log?.(`a CRL could not be fetched (${error.message})`);
        continue;
      }
      throw error;
    }
    let crl: ParsedCrl;
    try {
      crl = parseCrl(der);
    } catch (error) {
      if (error instanceof EmrtdError) {
        continue;
      }
      throw error;
    }
    const issuer = issuers.find(
      (candidate) =>
        (crl.issuerKeyId === null
          ? crl.issuerDnKey === candidate.subjectDnKey
          : crl.issuerKeyId === candidate.ski) && verifyCrlSignature(crl, candidate),
    );
    const country = crl.issuerCountry ?? issuer?.country ?? null;
    if (issuer === undefined || crl.nextUpdate === null || country === null) {
      continue;
    }
    verified.push({
      crl,
      input: {
        sha256: sha256(der),
        der,
        issuerCountry: country,
        issuerKeyId: crl.issuerKeyId ?? issuer.ski,
        thisUpdate: crl.thisUpdate,
        nextUpdate: crl.nextUpdate,
        crlNumber: crl.crlNumber,
        url,
      },
    });
  }
  return verified;
}

const isCurrent = (crl: ParsedCrl, now: Date) =>
  crl.nextUpdate !== null &&
  crl.thisUpdate.getTime() <= now.getTime() &&
  now.getTime() < crl.nextUpdate.getTime();

/** Verifies a master list against `root` and applies it to `sourceId` (C62.7). */
async function applyList(
  deps: TrustAnchorSyncDeps,
  clients: Clients,
  sourceId: string,
  listDer: Uint8Array,
  root: ParsedCertificate,
): Promise<TrustSyncOutcome> {
  const now = deps.clock.now();
  const list = parsed(() => parseMasterList(listDer), 'list_malformed');
  const verification = parsed(() => verifyMasterList(list, root, { now }), 'list_malformed');
  if (!verification.verified) {
    throw new SyncRefusal(verification.failure);
  }
  if (list.signingTime === null) {
    throw new SyncRefusal('signing_time_missing');
  }
  const { csca, links } = await anchorsOf(deps, root, list.certificates);
  const anchors = [...csca, ...links];
  const crls = await crlsOf(deps, clients, [root, ...anchors]);
  const signer = list.signer;
  const revoked =
    signer !== null &&
    crls.some(
      ({ crl }) =>
        isCurrent(crl, now) &&
        (crl.issuerKeyId === null || signer.aki === null || crl.issuerKeyId === signer.aki) &&
        crl.issuerDnKey === signer.issuerDnKey &&
        crl.revokedSerials.includes(signer.serialNumber),
    );
  if (revoked) {
    throw new SyncRefusal('signer_revoked');
  }
  const applied = await applyTrustSync(deps.db, {
    sourceId,
    list: {
      sha256: sha256(listDer),
      signingTime: list.signingTime,
      anchors: [
        ...csca.map((certificate) => anchorInput(certificate, false)),
        ...links.map((certificate) => anchorInput(certificate, true)),
      ],
    },
    crls: crls.map(({ input }) => input),
    now,
  });
  return {
    sourceId,
    outcome: applied.outcome,
    reason: applied.reason,
    anchorsSeen: applied.anchorsSeen,
    anchorsWithdrawn: applied.anchorsWithdrawn,
    crlsUpdated: applied.crlsUpdated,
    crlsRefused: applied.crlsRefused.length,
  };
}

const outcomeOf = (
  sourceId: string,
  outcome: 'refused' | 'failed',
  reason: string,
): TrustSyncOutcome => ({
  sourceId,
  outcome,
  reason,
  anchorsSeen: 0,
  anchorsWithdrawn: 0,
  crlsUpdated: 0,
  crlsRefused: 0,
});

/** Runs `run`, turning a refusal or a failed download into its audited outcome. */
async function audited(
  deps: TrustAnchorSyncDeps,
  sourceId: string,
  run: () => Promise<TrustSyncOutcome>,
): Promise<TrustSyncOutcome> {
  let result: TrustSyncOutcome;
  try {
    result = await run();
  } catch (error) {
    if (!(error instanceof SyncRefusal) && !(error instanceof FetchFailedError)) {
      throw error;
    }
    result =
      error instanceof SyncRefusal
        ? outcomeOf(sourceId, error.outcome, error.reason)
        : outcomeOf(sourceId, 'failed', 'fetch_failed');
    await recordTrustAnchorSync(deps.db, {
      sourceId,
      outcome: result.outcome === 'failed' ? 'failed' : 'refused',
      reason: result.reason ?? 'unknown',
    });
  }
  deps.log?.(
    `${sourceId}: ${result.outcome}${result.reason === null ? '' : ` (${result.reason})`}, ` +
      `${String(result.anchorsSeen)} anchors, ${String(result.anchorsWithdrawn)} withdrawn, ` +
      `${String(result.crlsUpdated)} CRLs updated, ${String(result.crlsRefused)} refused`,
  );
  return result;
}

/** One manifest source: the pinned root, then its list. */
async function syncSource(
  deps: TrustAnchorSyncDeps,
  clients: Clients,
  source: TrustAnchorSourceEntry,
): Promise<TrustSyncOutcome> {
  const rootFile = await fetchBytes(clients.certificate, source.root_certificate_url);
  const der = parsed(
    () => readTrustContainer(rootFile, isCertificateName, TRUST_SYNC_LIMITS.certificateBytes),
    'root_malformed',
  );
  if (sha256(der) !== source.root_certificate_sha256) {
    throw new SyncRefusal('root_pin_mismatch');
  }
  const root = parsed(() => parseCertificate(der), 'root_malformed');
  const listFile = await fetchBytes(clients.list, source.list_url);
  const listDer = parsed(
    () => readTrustContainer(listFile, isListName, TRUST_SYNC_LIMITS.listBytes),
    'list_malformed',
  );
  return applyList(deps, clients, source.id, listDer, root);
}

/** The self-test the sync runs first (C62.9). */
const selfTestOf = (deps: TrustAnchorSyncDeps) => (deps.selfTest ?? emrtdSelfTest)();

export async function syncTrustAnchors(
  deps: TrustAnchorSyncDeps,
  manifest: TrustAnchorManifest,
  options: { source?: string | null } = {},
): Promise<TrustSyncOutcome[]> {
  const named = options.source ?? null;
  const targets =
    named === null
      ? manifest.sources.filter((source) => source.enabled)
      : manifest.sources.filter((source) => source.id === named);
  if (named !== null && targets.length === 0) {
    throw new RangeError(`${named} is not a source of the manifest`);
  }
  await syncTrustAnchorSources(
    deps.db,
    manifest.sources.map((source) => ({ id: source.id, enabled: source.enabled })),
  );
  const tested = selfTestOf(deps).ok;
  const clients = clientsOf(deps.outboundHttp);
  const outcomes: TrustSyncOutcome[] = [];
  for (const source of targets) {
    outcomes.push(
      await audited(deps, source.id, () => {
        if (!tested) {
          return Promise.reject(selfTestFailed());
        }
        return source.enabled
          ? syncSource(deps, clients, source)
          : Promise.reject(new SyncRefusal('source_disabled'));
      }),
    );
  }
  return outcomes;
}

export async function importTrustAnchorList(
  deps: TrustAnchorSyncDeps,
  input: { list: Uint8Array; root: Uint8Array; sourceId?: string | null },
): Promise<TrustSyncOutcome> {
  const sourceId = input.sourceId ?? IMPORT_SOURCE;
  if (sourceId === IMPORT_SOURCE) {
    await syncTrustAnchorSources(deps.db, [{ id: IMPORT_SOURCE, enabled: true }]);
  }
  return audited(deps, sourceId, async () => {
    if (!selfTestOf(deps).ok) {
      throw selfTestFailed();
    }
    const root = parsed(
      () =>
        parseCertificate(
          readTrustContainer(input.root, isCertificateName, TRUST_SYNC_LIMITS.certificateBytes),
        ),
      'root_malformed',
    );
    const listDer = parsed(
      () => readTrustContainer(input.list, isListName, TRUST_SYNC_LIMITS.listBytes),
      'list_malformed',
    );
    return applyList(deps, clientsOf(deps.outboundHttp), sourceId, listDer, root);
  });
}
