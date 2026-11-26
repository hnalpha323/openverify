/**
 * The pinned ASN seeds (plan C92.6, C93.3): X4BNet `lists_vpn`'s `input/datacenter/ASN.txt` and
 * `input/vpn/ASN.txt` (`AS<number>`, then optional blanks and a `#` comment), and
 * `brianhama/bad-asn-list`'s `bad-asn-list.csv` (`ASN,Entity`, RFC 4180 quoting). Each parser
 * drops repeated ASNs and reports the distinct count (the research counted 14 and 19 repeats).
 * The hosting set is the datacenter seed and bad-asn-list, less the overrides; the VPN set is the
 * VPN seed and the overrides (`network/asn-overrides.json`, `api-network`'s).
 */
import { NetworkParseError } from './errors.js';
import { csvFields, decodeText, splitLines } from './text.js';

/** One parsed seed. */
export interface AsnSeed {
  /** The distinct ASNs, ascending. */
  readonly asns: readonly number[];
  /** Lines or rows that named an ASN. */
  readonly entries: number;
  /** Entries whose ASN was already named. */
  readonly duplicates: number;
}

/** One row of `network/asn-overrides.json`, as the lookups need it. */
export interface AsnOverride {
  readonly asn: number;
  readonly list: 'hosting' | 'vpn';
  readonly action: 'add' | 'remove';
}

/** The ASN sets the lookups read. */
export interface AsnSets {
  readonly hosting: ReadonlySet<number>;
  readonly vpn: ReadonlySet<number>;
}

/** The largest AS number (RFC 6793: 32 bits); 0 is reserved (RFC 7607). */
const MAX_ASN = 4_294_967_295;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const X4BNET_LINE = /^AS((?:0|[1-9][0-9]{0,9}))[ \t]*(?:#.*)?$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,9})$/;

function asnOf(digits: string, where: string): number {
  const asn = Number.parseInt(digits, 10);
  if (asn < 1 || asn > MAX_ASN) {
    throw new NetworkParseError('asn', `${where}: an AS number outside 1 to ${String(MAX_ASN)}`);
  }
  return asn;
}

function seedOf(asns: readonly number[]): AsnSeed {
  const distinct = [...new Set(asns)].sort((a, b) => a - b);
  return { asns: distinct, entries: asns.length, duplicates: asns.length - distinct.length };
}

/** Parses an X4BNet `ASN.txt`. */
export function parseX4bnetAsnList(bytes: Uint8Array | string): AsnSeed {
  const asns: number[] = [];
  splitLines(decodeText(bytes)).forEach((line, index) => {
    const where = `line ${String(index + 1)}`;
    if (line.trim() === '' || line.startsWith('#')) {
      return;
    }
    const match = X4BNET_LINE.exec(line);
    if (match === null) {
      throw new NetworkParseError('format', `${where}: not AS<number> with an optional # comment`);
    }
    asns.push(asnOf(match[1] ?? '', where));
  });
  return seedOf(asns);
}

/** Parses `bad-asn-list.csv`. */
export function parseBadAsnList(bytes: Uint8Array | string): AsnSeed {
  const lines = splitLines(decodeText(bytes));
  if (lines[0] !== 'ASN,Entity') {
    throw new NetworkParseError('format', 'line 1: the header is not ASN,Entity');
  }
  const asns: number[] = [];
  lines.slice(1).forEach((line, index) => {
    const where = `line ${String(index + 2)}`;
    if (line === '') {
      return;
    }
    const fields = csvFields(line, where);
    if (fields.length !== 2) {
      throw new NetworkParseError('format', `${where}: not two columns`);
    }
    const [digits = ''] = fields;
    if (!DECIMAL.test(digits)) {
      throw new NetworkParseError('asn', `${where}: the ASN is not a decimal number`);
    }
    asns.push(asnOf(digits, where));
  });
  return seedOf(asns);
}

/** C93.3: the hosting set (its seeds less the overrides) and the VPN set (its seed and the overrides). */
export function buildAsnSets(input: {
  readonly hosting: readonly AsnSeed[];
  readonly vpn: readonly AsnSeed[];
  readonly overrides?: readonly AsnOverride[];
}): AsnSets {
  const hosting = new Set(input.hosting.flatMap((seed) => seed.asns));
  const vpn = new Set(input.vpn.flatMap((seed) => seed.asns));
  (input.overrides ?? []).forEach((override, index) => {
    if (!Number.isInteger(override.asn)) {
      throw new NetworkParseError('asn', `override ${String(index)}: not an integer`);
    }
    asnOf(String(override.asn), `override ${String(index)}`);
    const set = override.list === 'hosting' ? hosting : vpn;
    if (override.action === 'add') {
      set.add(override.asn);
    } else {
      set.delete(override.asn);
    }
  });
  return { hosting, vpn };
}
