/**
 * C77.2: the hostile-input set, run against every parser: entity expansion, an external entity,
 * deep nesting, a truncated file, bytes over the cap and bytes that are not UTF-8, and for the
 * ZIP-borne SDN list a 1 GiB declared member, two members and a truncated archive. Each must fail
 * closed with its code and name no value.
 */
import { describe, expect, it } from 'vitest';
import { bytesSource } from '../zip/index.js';
import { writeZip } from '../zip/writer.js';
import { WatchlistParseError, type WatchlistParseErrorCode } from './errors.js';
import { EU_FSF_NAMESPACE, parseEuFsf } from './eu.js';
import { readPublication, type WatchlistParse } from './list.js';
import { parseUkSanctionsList } from './uk.js';
import { parseUnConsolidated } from './un.js';
import {
  OFAC_ENHANCED_NAMESPACE,
  OFAC_SDN_ZIP_MEMBER,
  parseOfacEnhanced,
  parseOfacEnhancedZip,
} from './ofac.js';

interface Format {
  readonly label: string;
  /** The document's opening, up to where entries would go, and its closing. */
  readonly open: string;
  readonly close: string;
  readonly parse: (bytes: Uint8Array, maxBytes: number) => WatchlistParse;
}

const FORMATS: readonly Format[] = [
  {
    label: 'OFAC enhanced XML',
    open:
      `<sanctionsData xmlns="${OFAC_ENHANCED_NAMESPACE}"><publicationInfo>` +
      '<dataAsOf>2026-10-21T00:00:00</dataAsOf></publicationInfo><entities>',
    close: '</entities></sanctionsData>',
    parse: (bytes, maxBytes) => parseOfacEnhanced([bytes], { maxBytes }),
  },
  {
    label: 'EU FSF XML',
    open: `<export xmlns="${EU_FSF_NAMESPACE}" generationDate="2026-10-15T12:10:34+02:00">`,
    close: '</export>',
    parse: (bytes, maxBytes) => parseEuFsf([bytes], { maxBytes }),
  },
  {
    label: 'UK Sanctions List XML',
    open: '<Designations><DateGenerated>16/10/2026</DateGenerated>',
    close: '</Designations>',
    parse: (bytes, maxBytes) => parseUkSanctionsList([bytes], { maxBytes }),
  },
  {
    label: 'UN consolidated XML',
    open: '<CONSOLIDATED_LIST dateGenerated="2026-10-22T23:00:06.809Z"><INDIVIDUALS>',
    close: '</INDIVIDUALS></CONSOLIDATED_LIST>',
    parse: (bytes, maxBytes) => parseUnConsolidated([bytes], { maxBytes }),
  },
];

const encoder = new TextEncoder();
const SECRET = 'QUILLFEATHER';

async function refusal(parse: WatchlistParse): Promise<WatchlistParseError> {
  try {
    await readPublication(parse, () => undefined);
  } catch (error) {
    expect(error).toBeInstanceOf(WatchlistParseError);
    return error as WatchlistParseError;
  }
  throw new Error('the input was not refused');
}

function hostile(format: Format): Record<string, readonly [Uint8Array, WatchlistParseErrorCode]> {
  const laughs =
    `<!DOCTYPE x [<!ENTITY a "${SECRET}"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">` +
    '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;">]>';
  const external = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>';
  const whole = `${format.open}${format.close}`;
  return {
    'entity expansion': [encoder.encode(`${laughs}${format.open}&d;${format.close}`), 'doctype'],
    'an external entity': [
      encoder.encode(`${external}${format.open}&e;${format.close}`),
      'doctype',
    ],
    'deep nesting': [
      encoder.encode(
        `${format.open}${'<x>'.repeat(10_000)}${'</x>'.repeat(10_000)}${format.close}`,
      ),
      'too_deep',
    ],
    'a truncated file': [
      encoder.encode(whole.slice(0, Math.floor(whole.length * 0.7))),
      'malformed',
    ],
    'an undefined entity': [
      encoder.encode(`${format.open}&${SECRET};${format.close}`),
      'malformed',
    ],
    'bytes over the cap': [
      encoder.encode(`${format.open}${'<x/>'.repeat(300_000)}${format.close}`),
      'too_large',
    ],
    'bytes that are not UTF-8': [
      Uint8Array.from([
        ...encoder.encode(format.open),
        0xc3,
        0x28,
        ...encoder.encode(format.close),
      ]),
      'encoding',
    ],
  };
}

describe.each(FORMATS)('$label fails closed', (format) => {
  it.each(Object.entries(hostile(format)))('on %s', async (_label, [bytes, code]) => {
    const error = await refusal(format.parse(bytes, 1_000_000));
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(SECRET);
  });
});

describe('the SDN ZIP fails closed', () => {
  const xml = encoder.encode(`${FORMATS[0]?.open ?? ''}${FORMATS[0]?.close ?? ''}`);
  const options = { maxBytes: 10_000_000, maxCompressedBytes: 1_000_000 };
  const cases: Record<string, readonly [Uint8Array, WatchlistParseErrorCode]> = {
    'a 1 GiB declared member': [
      writeZip([{ name: OFAC_SDN_ZIP_MEMBER, content: xml, central: { inflatedSize: 2 ** 30 } }]),
      'too_large',
    ],
    'two members': [
      writeZip([
        { name: OFAC_SDN_ZIP_MEMBER, content: xml },
        { name: 'CONS_ENHANCED.XML', content: xml },
      ]),
      'zip',
    ],
    'another member': [writeZip([{ name: 'SDN.XML', content: xml }]), 'zip'],
    'a truncated archive': [
      writeZip([{ name: OFAC_SDN_ZIP_MEMBER, content: xml }]).subarray(0, 40),
      'zip',
    ],
  };
  it.each(Object.entries(cases))('on %s', async (_label, [archive, code]) => {
    expect((await refusal(parseOfacEnhancedZip(bytesSource(archive), options))).code).toBe(code);
  });
});
