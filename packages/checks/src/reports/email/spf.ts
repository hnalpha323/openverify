/**
 * C82.1: `email-spf-policy`, read from the domain's own SPF record (RFC 7208) without following
 * `include:` or `redirect=`: each is another lookup the domain owner controls. Informational only:
 * a strict SPF policy protects the domain from spoofing and says nothing about a person, so it
 * never changes the email band.
 *
 * The record is chosen as RFC 7208 §4.5 says (the TXT strings of one record concatenated; only a
 * record beginning `v=spf1` counts; two such records are a permerror, read `invalid`), every term
 * is syntax-checked (§4.6: any syntax error is a permerror), and the first `all` mechanism's
 * qualifier is the policy (§5.1: mechanisms after `all` are never reached; §6.1: `redirect=` is
 * ignored when an `all` exists). Without an `all`, the policy is `no_all`, with `redirect` telling
 * whether another domain's record decides.
 */
import { isIPv4, isIPv6 } from 'node:net';
import { riskConstant } from '../constants.js';

/** The values of `email-spf-policy` (the contracts' enum). */
export const SPF_POLICIES = [
  'pass',
  'neutral',
  'softfail',
  'fail',
  'no_all',
  'no_record',
  'invalid',
] as const;
export type SpfPolicy = (typeof SPF_POLICIES)[number];

/** A TXT answer as `node:dns` gives it: each record a list of strings, to be concatenated. */
export type TxtRecords = readonly (readonly string[])[];

/** What the domain's SPF record says. */
export interface SpfReading {
  readonly policy: SpfPolicy;
  /** A `redirect=` modifier decides instead (only with `no_all`; never followed). */
  readonly redirect: boolean;
}

/** Reads the SPF policy from a domain's TXT records. */
export function readSpfPolicy(records: TxtRecords): SpfReading {
  const spf = records.map((strings) => strings.join('')).filter((text) => VERSION.test(text));
  const [record] = spf;
  if (record === undefined) {
    return { policy: 'no_record', redirect: false };
  }
  if (spf.length > 1 || record.length > riskConstant('email-txt-max-length')) {
    return INVALID;
  }
  let all: SpfPolicy | null = null;
  const modifiers = new Map<string, number>();
  for (const term of record.slice('v=spf1'.length).split(' ')) {
    if (term === '') {
      continue;
    }
    if (!VISIBLE.test(term)) {
      return INVALID;
    }
    const modifier = modifierOf(term);
    if (modifier !== null) {
      if (KNOWN_MODIFIERS.has(modifier.name)) {
        if (modifier.value === '' || modifiers.has(modifier.name)) {
          return INVALID;
        }
        modifiers.set(modifier.name, 1);
      }
      continue;
    }
    const directive = directiveOf(term);
    if (directive === null) {
      return INVALID;
    }
    if (directive.mechanism === 'all') {
      all ??= QUALIFIERS.get(directive.qualifier) ?? 'pass';
    }
  }
  return all === null
    ? { policy: 'no_all', redirect: modifiers.has('redirect') }
    : { policy: all, redirect: false };
}

const INVALID: SpfReading = Object.freeze({ policy: 'invalid', redirect: false });
/** RFC 7208 §4.5: the version section, ended by a space or the end of the record. */
const VERSION = /^v=spf1(?: |$)/iu;
/** RFC 7208 §12: terms are visible ASCII. */
const VISIBLE = /^[\x21-\x7e]+$/u;
/** A modifier's name (RFC 7208 §12): a letter, then letters, digits, `-`, `_` and `.`. */
const MODIFIER_NAME = /^[a-z][\w.-]*$/iu;
const KNOWN_MODIFIERS: ReadonlySet<string> = new Set(['redirect', 'exp']);
/** RFC 7208 §4.6.2: a qualifier's result; none is `+`. */
const QUALIFIERS: ReadonlyMap<string, SpfPolicy> = new Map([
  ['-', 'fail'],
  ['~', 'softfail'],
  ['?', 'neutral'],
]);
const DIGITS = /^\d{1,3}$/u;

function modifierOf(term: string): { name: string; value: string } | null {
  const equals = term.indexOf('=');
  const name = term.slice(0, Math.max(equals, 0)).toLowerCase();
  return equals > 0 && MODIFIER_NAME.test(name) ? { name, value: term.slice(equals + 1) } : null;
}

/** A directive's qualifier and mechanism, or `null` for a term RFC 7208 does not define. */
function directiveOf(term: string): { qualifier: string; mechanism: string } | null {
  const qualifier = '+-~?'.includes(term.charAt(0)) ? term.charAt(0) : '';
  const body = term.slice(qualifier.length);
  let end = 0;
  while (end < body.length && /[a-z\d]/iu.test(body.charAt(end))) {
    end += 1;
  }
  const mechanism = body.slice(0, end).toLowerCase();
  const rest = body.slice(end);
  const valid = MECHANISMS.get(mechanism)?.(rest) ?? false;
  return valid ? { qualifier, mechanism } : null;
}

/** `":" domain-spec`, required. */
const requiredDomain = (rest: string) => rest.startsWith(':') && rest.length > 1;
/** `[":" domain-spec]`. */
const optionalDomain = (rest: string) => rest === '' || requiredDomain(rest);

const prefixWithin = (value: string, max: number) => DIGITS.test(value) && Number(value) <= max;

/** `[":" domain-spec] [dual-cidr-length]`: `/24`, `//64` or `/24//64` after the domain. */
function domainAndCidr(rest: string): boolean {
  const [domain = '', ...cidr] = rest.split('/');
  if (!optionalDomain(domain)) {
    return false;
  }
  switch (cidr.length) {
    case 0:
      return true;
    case 1:
      return prefixWithin(cidr[0] ?? '', 32);
    case 2:
      return cidr[0] === '' && prefixWithin(cidr[1] ?? '', 128);
    case 3:
      return prefixWithin(cidr[0] ?? '', 32) && cidr[1] === '' && prefixWithin(cidr[2] ?? '', 128);
    default:
      return false;
  }
}

/** `":" ip-network ["/" length]`, at most `max` bits. */
function network(rest: string, isAddress: (value: string) => boolean, max: number): boolean {
  if (!rest.startsWith(':')) {
    return false;
  }
  const value = rest.slice(1);
  const slash = value.lastIndexOf('/');
  return slash === -1
    ? isAddress(value)
    : isAddress(value.slice(0, slash)) && prefixWithin(value.slice(slash + 1), max);
}

/** RFC 7208 §5: each mechanism and what may follow its name. */
const MECHANISMS: ReadonlyMap<string, (rest: string) => boolean> = new Map([
  ['all', (rest: string) => rest === ''],
  ['include', requiredDomain],
  ['exists', requiredDomain],
  ['ptr', optionalDomain],
  ['a', domainAndCidr],
  ['mx', domainAndCidr],
  ['ip4', (rest: string) => network(rest, isIPv4, 32)],
  ['ip6', (rest: string) => network(rest, isIPv6, 128)],
]);
