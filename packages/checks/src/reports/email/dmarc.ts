/**
 * C82.1: `email-dmarc-policy`, found by the RFC 9989 §4.10 DNS tree walk (at most eight queries,
 * no public-suffix list) and read as §4.10.1 says. Informational only: a strict DMARC policy
 * protects the domain from spoofing and says nothing about a person, so it never changes the
 * email band.
 *
 * - **Records.** At each name, only a TXT record beginning `v=DMARC1` (the tag value matched
 *   exactly) counts; two or more such records are all discarded. Unknown tags are ignored.
 * - **Walk.** The Author Domain's `_dmarc` name first. Without a record there, the walk starts at
 *   its parent (or, for a name of eight labels or more, at its last seven labels) and drops one
 *   label at a time down to the top-level label. It stops early only at a record carrying
 *   `psd=n` or `psd=y`.
 * - **Organizational Domain.** Of the records the walk found, longest name first: a `psd=n` record
 *   names it; a `psd=y` record makes it the name one label below; otherwise the record with the
 *   fewest labels names it.
 * - **Policy.** A record at the Author Domain gives `p`. Otherwise the Organizational Domain's
 *   record (or, without one, the PSD's) gives `sp` when the Author Domain exists and `np` when it
 *   does not (NXDOMAIN), `np` falling back to `sp` and both to `p`. A missing or invalid
 *   `p`, or an invalid `sp` or `np`, reads `none` when the record has a valid `rua`, and `invalid`
 *   otherwise (no DMARC processing). `t=y` is the testing flag: receivers apply a step less.
 */
import { riskConstant } from '../constants.js';

/** The values of `email-dmarc-policy` (the contracts' enum). */
export const DMARC_POLICIES = ['none', 'quarantine', 'reject', 'no_record', 'invalid'] as const;
export type DmarcPolicy = (typeof DMARC_POLICIES)[number];

/** A requested policy value. */
export type DmarcRequestedPolicy = 'none' | 'quarantine' | 'reject';

/** One DMARC record's tags, as far as the policy reads them. */
export interface DmarcRecord {
  /** `p`, or `null` when absent; `invalid` when present with another value. */
  readonly p: DmarcRequestedPolicy | 'invalid' | null;
  readonly sp: DmarcRequestedPolicy | 'invalid' | null;
  readonly np: DmarcRequestedPolicy | 'invalid' | null;
  /** `t=y`: the owner is testing. */
  readonly testing: boolean;
  /** `psd`: `u` when absent or not `y` or `n`. */
  readonly psd: 'y' | 'n' | 'u';
  /** `rua` holds at least one URI. */
  readonly validRua: boolean;
}

/** What a lookup of one `_dmarc` name answered. */
export type DmarcLookup =
  | { readonly kind: 'records'; readonly records: readonly (readonly string[])[] }
  /** NXDOMAIN or NODATA: no record at that name. */
  | { readonly kind: 'none' }
  /** A timeout or server failure after the resolver's tries. */
  | { readonly kind: 'error' };

/** Where the record that applies was found. */
export type DmarcFoundAt = 'author_domain' | 'organizational_domain' | 'public_suffix_domain';

/** The policy the walk read. */
export interface DmarcReading {
  readonly policy: DmarcPolicy;
  /** `t=y` on the record that applies, with a quarantine or reject policy. */
  readonly testing: boolean;
  readonly foundAt: DmarcFoundAt | null;
  /** How many `_dmarc` names were asked (at most eight). */
  readonly queries: number;
}

/** The walk's outcome: a reading, or a lookup that failed (the policy is then unknown). */
export type DmarcOutcome =
  | { readonly kind: 'reading'; readonly reading: DmarcReading }
  | { readonly kind: 'error'; readonly queries: number }
  /** The Author Domain's existence decides between `sp` and `np`, and it is not known. */
  | { readonly kind: 'undetermined'; readonly queries: number };

/** Parses one TXT record's text; `null` when it is not a DMARC record (no leading `v=DMARC1`). */
export function parseDmarcRecord(text: string): DmarcRecord | null {
  const tags = text.split(';').map((tag) => {
    const equals = tag.indexOf('=');
    return equals === -1
      ? { name: tag.trim().toLowerCase(), value: null }
      : { name: tag.slice(0, equals).trim().toLowerCase(), value: tag.slice(equals + 1).trim() };
  });
  const [version, ...rest] = tags;
  if (version?.name !== 'v' || version.value !== 'DMARC1') {
    return null;
  }
  const values = new Map<string, string>();
  for (const { name, value } of rest) {
    if (value !== null && !values.has(name)) {
      values.set(name, value);
    }
  }
  const psd = values.get('psd');
  return {
    p: requestedPolicy(values.get('p')),
    sp: requestedPolicy(values.get('sp')),
    np: requestedPolicy(values.get('np')),
    testing: values.get('t') === 'y',
    psd: psd === 'y' || psd === 'n' ? psd : 'u',
    validRua: (values.get('rua') ?? '').split(',').some((uri) => URI.test(uri.trim())),
  };
}

/** The one DMARC record of a TXT answer, or `null` for none or for two or more. */
export function dmarcRecordOf(records: readonly (readonly string[])[]): DmarcRecord | null {
  const found = records
    .map((strings) => parseDmarcRecord(strings.join('')))
    .filter((record) => record !== null);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * The `_dmarc` names the walk may ask, in order: the Author Domain's, then the walk's targets
 * (at most eight in all). The walk stops earlier at a `psd` record.
 */
export function dmarcQueryNames(domain: string): string[] {
  const labels = domain.split('.');
  const walk = labels.slice(labels.length >= WALK_LONG_NAME ? -WALK_START_LABELS : 1);
  const names = [`_dmarc.${domain}`];
  for (let start = 0; start < walk.length; start += 1) {
    names.push(`_dmarc.${walk.slice(start).join('.')}`);
  }
  return names.slice(0, riskConstant('email-dmarc-max-queries'));
}

/**
 * Runs the tree walk for a lower-case ASCII Author Domain through `lookup`, asking one name at a
 * time and stopping as RFC 9989 says. `authorDomainExists` is `false` for an NXDOMAIN Author Domain
 * (`np`), `true` when it exists (`sp`), `null` when unknown.
 */
export async function walkDmarc(
  domain: string,
  lookup: (name: string) => Promise<DmarcLookup>,
  authorDomainExists: boolean | null,
): Promise<DmarcOutcome> {
  const [authorName = '', ...walkNames] = dmarcQueryNames(domain);
  let queries = 1;
  const author = await lookup(authorName);
  if (author.kind === 'error') {
    return { kind: 'error', queries };
  }
  const authorRecord = author.kind === 'records' ? dmarcRecordOf(author.records) : null;
  if (authorRecord !== null) {
    return reading(authorRecord, authorPolicy(authorRecord), 'author_domain', queries);
  }
  const found: { name: string; record: DmarcRecord }[] = [];
  for (const name of walkNames) {
    queries += 1;
    const answer = await lookup(name);
    if (answer.kind === 'error') {
      return { kind: 'error', queries };
    }
    const record = answer.kind === 'records' ? dmarcRecordOf(answer.records) : null;
    if (record !== null) {
      found.push({ name: name.slice(PREFIX.length), record });
      if (record.psd !== 'u') {
        break;
      }
    }
  }
  const applicable = applicableRecord(domain, found);
  if (applicable === null) {
    return {
      kind: 'reading',
      reading: { policy: 'no_record', testing: false, foundAt: null, queries },
    };
  }
  const policy = subdomainPolicy(applicable.record, authorDomainExists);
  return policy === null
    ? { kind: 'undetermined', queries }
    : reading(applicable.record, policy, applicable.foundAt, queries);
}

const PREFIX = '_dmarc.';
/** RFC 9989 §4.10: a name of eight labels or more starts the walk at its last seven. */
const WALK_LONG_NAME = 8;
const WALK_START_LABELS = 7;
/** A URI: a scheme, a colon and something after it. */
const URI = /^[a-z][\d+.a-z-]*:\S/iu;
const REQUESTED: ReadonlySet<string> = new Set(['none', 'quarantine', 'reject']);

function requestedPolicy(value: string | undefined): DmarcRecord['p'] {
  if (value === undefined) {
    return null;
  }
  const lower = value.toLowerCase();
  return REQUESTED.has(lower) ? (lower as DmarcRequestedPolicy) : 'invalid';
}

/** RFC 9989: no valid `p` (or an invalid `sp` or `np`) reads `none` beside a valid `rua`. */
const fallback = (record: DmarcRecord): DmarcPolicy => (record.validRua ? 'none' : 'invalid');

function authorPolicy(record: DmarcRecord): DmarcPolicy {
  return record.p === null || record.p === 'invalid' ? fallback(record) : record.p;
}

/** The policy for a subdomain that exists (`sp`) or not (`np`). */
function chainPolicy(record: DmarcRecord, exists: boolean): DmarcPolicy {
  const own = exists ? record.sp : (record.np ?? record.sp);
  if (own === 'invalid') {
    return fallback(record);
  }
  return own ?? authorPolicy(record);
}

/** The policy for the Author Domain under a record found above it; `null` when it cannot tell. */
function subdomainPolicy(record: DmarcRecord, exists: boolean | null): DmarcPolicy | null {
  if (exists !== null) {
    return chainPolicy(record, exists);
  }
  const existing = chainPolicy(record, true);
  return existing === chainPolicy(record, false) ? existing : null;
}

/** RFC 9989 §4.10.2: the Organizational Domain's record, or the PSD's without one. */
function applicableRecord(
  domain: string,
  found: readonly { name: string; record: DmarcRecord }[],
): { record: DmarcRecord; foundAt: DmarcFoundAt } | null {
  const last = found.at(-1);
  if (last === undefined) {
    return null;
  }
  if (last.record.psd !== 'y') {
    // A psd=n record ends the walk and names the Organizational Domain; without a psd tag, the
    // record with the fewest labels (the walk's last) does.
    return { record: last.record, foundAt: 'organizational_domain' };
  }
  const labels = domain.split('.');
  const organizational = labels.slice(-(last.name.split('.').length + 1)).join('.');
  const own = found.find((entry) => entry.name === organizational);
  return own === undefined
    ? { record: last.record, foundAt: 'public_suffix_domain' }
    : { record: own.record, foundAt: 'organizational_domain' };
}

function reading(
  record: DmarcRecord,
  policy: DmarcPolicy,
  foundAt: DmarcFoundAt,
  queries: number,
): DmarcOutcome {
  const testing = record.testing && (policy === 'quarantine' || policy === 'reject');
  return { kind: 'reading', reading: { policy, testing, foundAt, queries } };
}
