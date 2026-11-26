/**
 * Public identifiers (contract C1): `<prefix>_<ULID>`, where the ULID is 26 uppercase
 * Crockford base32 characters encoding a 48-bit millisecond timestamp followed by 80 random
 * bits. IDs therefore sort by creation time, which cursor pagination (`page[after]`) relies on.
 *
 * Browser-safe: randomness comes from Web Crypto (`globalThis.crypto`).
 */
import { z } from 'zod';

/** Prefix of every public ID, keyed by the object it identifies. */
export const ID_PREFIXES = Object.freeze({
  organization: 'org',
  environment: 'env',
  apiKey: 'key',
  user: 'usr',
  userSession: 'uss',
  inquiryTemplate: 'itmpl',
  inquiryTemplateVersion: 'itmplv',
  inquiry: 'inq',
  inquirySession: 'iqse',
  verification: 'ver',
  file: 'file',
  event: 'evt',
  webhook: 'wbh',
  webhookDelivery: 'whd',
  // Phase 2 (C9).
  account: 'acc',
  accountType: 'acctp',
  role: 'role',
  userAuditLog: 'aud',
  apiLog: 'alog',
  mfaFactor: 'mfa',
  // Phase 4 (C40.1).
  selfieCapture: 'self',
  // Phase 5 (C53.2, C53.3): the OTP challenge is internal; the crypto and chip ones reach clients.
  otpChallenge: 'otpc',
  cryptoChallenge: 'cwc',
  chipChallenge: 'chc',
  // Phase 6 (C70.1): reports, report templates and versions, runs, actions, and matches (a
  // match's `record-token`).
  report: 'rep',
  reportTemplate: 'rptp',
  reportTemplateVersion: 'rptpv',
  reportRun: 'rpr',
  reportAction: 'ract',
  reportMatch: 'rpm',
  // Phase 7 (C91.2, C91.3): a device the device-recognition tier recorded, and one evaluation of
  // a session's address.
  device: 'dev',
  network: 'net',
  // C96.3: a handoff token's row (`id` of POST /flow/handoffs), never the token itself.
  handoff: 'hnd',
  // Workflow 7B (C97.1, C99.3, C100.1): lists, their item kinds, list matches and importers.
  list: 'lst',
  listItemBrowserFingerprint: 'libf',
  listItemDeviceFingerprint: 'lidf',
  listItemCountry: 'lic',
  listItemEmailAddress: 'liea',
  listItemFace: 'lifc',
  listItemGeolocation: 'ligl',
  listItemGovernmentIdNumber: 'ligin',
  listItemField: 'liif',
  listItemIpAddress: 'liip',
  listItemName: 'lin',
  listItemPhoneNumber: 'lipn',
  listItemSelfieBackground: 'lisb',
  listItemString: 'lis',
  listMatch: 'lmt',
  importer: 'mprt',
  // Workflow 7B (C104.1, C105): transactions, their types, versions, labels and files.
  transaction: 'txn',
  transactionType: 'txntp',
  transactionTypeVersion: 'txntpv',
  transactionLabel: 'txnl',
  transactionFile: 'txnf',
  // Workflow 7B (C102): graph queries, their templates and versions.
  graphQuery: 'grphq',
  graphQueryTemplate: 'grqt',
  graphQueryTemplateVersion: 'grqtv',
  // Phase 8, Workflow 8A (C112.1): workflows, versions, deployments, runs, scheduled runs, account
  // actions and secrets are public; a decision record (C128.1) is served; the step, delivery,
  // schedule, effect and file rows are internal, served only inside a run's step list.
  workflow: 'wfl',
  workflowVersion: 'wfv',
  workflowDeployment: 'wfd',
  workflowRun: 'wfr',
  scheduledRun: 'srrun',
  accountAction: 'accac',
  workflowSecret: 'wsec',
  // C125.1: a secret's value in one environment, the row its seal is bound to. Never served.
  workflowSecretValue: 'wsecv',
  workflowRunStep: 'wfst',
  workflowTriggerDelivery: 'wftd',
  workflowSchedule: 'wfsc',
  workflowEffect: 'wfef',
  workflowRunFile: 'wfrf',
  inquiryDecision: 'idec',
  // Phase 8, Workflow 8B (C129.1): the public case prefixes, then ours; the bulk action and the
  // notification are Stage 1a amendment 5.
  case: 'case',
  caseTemplate: 'ctmpl',
  caseTemplateVersion: 'ctmplv',
  caseQueue: 'cqueue',
  caseComment: 'cscm',
  caseAssignmentPolicy: 'cap',
  caseAttachment: 'catt',
  caseAction: 'cact',
  caseSlaPolicy: 'cslap',
  caseCalendar: 'ccal',
  caseExport: 'cexp',
  caseBulkAction: 'cblk',
  userNotification: 'unot',
  // Phase 9, Workflow 9A (C174.1): the public theme set and deployment, then ours: a theme set's
  // asset and a user's simulation preset. Step records, action waits, theme revisions and rollup
  // rows have no public id.
  themeSet: 'theset',
  deployment: 'dply',
  themeAsset: 'tsa',
  simulationPreset: 'ssp',
  // Phase 9, Workflow 9B (C174.1), all ours: an export (C166.1), a saved view (C165.1) and a bulk
  // report job (C166.5). Rollup rows have no public id.
  export: 'exp',
  savedView: 'svw',
  reportBulkJob: 'rbulk',
  // Phase 10, Workflow 10B (C211.3, C221.2), ours: an integrity challenge (POST /api/v1/flow/integrity-challenges).
  integrityChallenge: 'ich',
  // Phase 11, Workflow 11A (C230.1): a connection and a share token (the public prefixes), then
  // ours: a share-policy version and a consent record. A share token's id is a handle, not a secret
  // (C232.8). Consent texts are keyed by their SHA-256 and have no public id.
  connection: 'cxn',
  shareToken: 'cnst',
  sharePolicy: 'cxnp',
  consentRecord: 'cnsr',
  // Phase 11, Workflow 11B (C253.1), ours: an account's access export (`POST /accounts/:id/export`).
  accountExport: 'aexp',
  // Phase 11, Workflow 11B (C248.3), ours: an organisation's OIDC identity provider.
  ssoProvider: 'ssop',
} as const);

export type IdObject = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdObject];
/** A public ID with a known prefix, e.g. `Id<'inq'>`. */
export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

/** Crockford base32: digits and uppercase letters without I, L, O and U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_BODY = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
/** A ULID: 128 bits in 26 characters, so the first character is at most `7`. */
export const ULID_PATTERN = new RegExp(`^${ULID_BODY}$`);
export const MAX_ULID_TIME = 2 ** 48 - 1;

const TIME_LENGTH = 10;
const RANDOM_BYTES = 10;

/** Returns `length` cryptographically random bytes. */
export type RandomBytes = (length: number) => Uint8Array;

export const webCryptoRandomBytes: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/** Reads exactly `length` bytes from `random`; a wrong length is a programming error. */
export function randomBytesOf(random: RandomBytes, length: number): Uint8Array {
  const bytes = random(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new TypeError(`The randomness source must return ${String(length)} bytes`);
  }
  return bytes;
}

export interface UlidOptions {
  /** Time component: a Date or epoch milliseconds. Defaults to now. */
  now?: Date | number;
  /** Randomness source; defaults to Web Crypto. Inject a fixed source in tests. */
  random?: RandomBytes;
}

const VALID_PREFIXES: ReadonlySet<string> = new Set(Object.values(ID_PREFIXES));

export function isIdPrefix(value: unknown): value is IdPrefix {
  return typeof value === 'string' && VALID_PREFIXES.has(value);
}

function assertPrefix(prefix: string): void {
  if (!isIdPrefix(prefix)) {
    throw new TypeError(`Unknown ID prefix "${prefix}"`);
  }
}

function encodeTime(time: number): string {
  let remaining = time;
  let out = '';
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    out = CROCKFORD.charAt(remaining % 32) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/** 80 random bits are exactly 16 base32 characters, most significant first. */
function encodeRandom(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/**
 * Generates a ULID.
 * @throws {RangeError} when the time is not an integer in [0, 2^48 - 1].
 * @throws {TypeError} when the randomness source returns the wrong number of bytes.
 */
export function ulid(options: UlidOptions = {}): string {
  const { now = Date.now(), random = webCryptoRandomBytes } = options;
  const time = now instanceof Date ? now.getTime() : now;
  if (!Number.isInteger(time) || time < 0 || time > MAX_ULID_TIME) {
    throw new RangeError('ULID time must be an integer number of milliseconds in [0, 2^48 - 1]');
  }
  return encodeTime(time) + encodeRandom(randomBytesOf(random, RANDOM_BYTES));
}

/**
 * Epoch milliseconds encoded in a ULID.
 * @throws {TypeError} when `value` is not a ULID.
 */
export function ulidTime(value: string): number {
  if (!ULID_PATTERN.test(value)) {
    throw new TypeError('Not a ULID');
  }
  let time = 0;
  for (const char of value.slice(0, TIME_LENGTH)) {
    time = time * 32 + CROCKFORD.indexOf(char);
  }
  return time;
}

/**
 * Creates a public ID such as `inq_01M5CJXHG07XPHF3HRM6NREDH7`.
 * @throws {TypeError} for an unknown prefix.
 */
export function newId<P extends IdPrefix>(prefix: P, options?: UlidOptions): Id<P> {
  assertPrefix(prefix);
  return `${prefix}_${ulid(options)}`;
}

const PATTERNS = new Map(
  [...VALID_PREFIXES].map((prefix) => [prefix, new RegExp(`^${prefix}_${ULID_BODY}$`)]),
);

/** Whether `value` is a well-formed ID with exactly this prefix. */
export function isId<P extends IdPrefix>(prefix: P, value: unknown): value is Id<P> {
  const pattern = PATTERNS.get(prefix);
  return pattern !== undefined && typeof value === 'string' && pattern.test(value);
}

/**
 * zod schema for IDs of one prefix. Its output type is plain `string` so database rows map
 * onto it without casts; use `Id<P>` where a branded template type is wanted.
 * @throws {TypeError} for an unknown prefix.
 */
export function idSchema(prefix: IdPrefix): z.ZodString {
  assertPrefix(prefix);
  return z.string().regex(new RegExp(`^${prefix}_${ULID_BODY}$`), `must be a ${prefix}_ ID`);
}

/** Any public ID with a known prefix, for example `filter[object-id]` on the events list. */
export const anyIdSchema = z
  .string()
  .regex(new RegExp(`^(?:${[...VALID_PREFIXES].join('|')})_${ULID_BODY}$`), 'must be an ID');
