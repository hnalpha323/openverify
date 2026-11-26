/**
 * Distinguished names and serial numbers as the verifier compares them: a DN for display
 * (`C=UT, O=OpenVerify Test, CN=CSCA Utopia`), a key for comparison (lower case, white space
 * collapsed, so a PrintableString and a UTF8String of one name agree) and the subject's
 * country; a serial number as lower-case hex without leading zero bytes.
 */
import type * as asn1js from 'asn1js';
import type * as pkijs from 'pkijs';
import { encodedOf, textOf, type Asn1 } from './asn1.js';
import { toHex } from './bytes.js';

const NAME_LABELS: Readonly<Record<string, string>> = {
  '2.5.4.3': 'CN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
};

export interface ReadName {
  readonly dn: string;
  readonly key: string;
  readonly country: string | null;
}

export function nameOf(name: pkijs.RelativeDistinguishedNames, step: string): ReadName {
  const parts = name.typesAndValues.map((attribute) => {
    const value = attribute.value as Asn1;
    let text: string;
    try {
      text = textOf(value, step);
    } catch {
      text = `#${toHex(encodedOf(value))}`;
    }
    return [NAME_LABELS[attribute.type] ?? attribute.type, text] as const;
  });
  const country =
    parts
      .find(([label]) => label === 'C')?.[1]
      .trim()
      .toUpperCase() ?? null;
  return {
    dn: parts.map(([label, text]) => `${label}=${text}`).join(', '),
    key: parts
      .map(
        ([label, text]) =>
          `${label.toLowerCase()}=${text.trim().toLowerCase().replaceAll(/\s+/g, ' ')}`,
      )
      .join(', '),
    country: country !== null && /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

/** Lower-case hex of an INTEGER's content, without leading zero bytes. */
export function serialHex(serial: asn1js.Integer): string {
  let bytes = new Uint8Array(serial.valueBlock.valueHexView);
  while (bytes.length > 1 && bytes[0] === 0) {
    bytes = bytes.subarray(1);
  }
  return toHex(bytes);
}
