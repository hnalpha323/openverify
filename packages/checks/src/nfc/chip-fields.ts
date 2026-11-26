/**
 * DG1's fields (C52.8 `government-id-nfc` attributes, C53.3 `chip_reads.fields`), read from the
 * chip's MRZ exactly (`parseMrz` without OCR corrections, C62.1). PII: sealed at rest, never
 * logged.
 */
import type { IdClass } from '@openverify/core';
import type { ParsedDg1 } from '@openverify/emrtd';
import { normalizeCountryCode } from '../country-codes.js';
import { MrzParseError, parseMrz } from '../mrz.js';
import { mrzDateToIso } from './dates.js';

export interface NfcChipFields {
  readonly 'name-first': string | null;
  readonly 'name-last': string | null;
  /** YYYY-MM-DD, or `null` when the chip leaves a part unknown. */
  readonly birthdate: string | null;
  readonly sex: 'M' | 'F' | 'X' | null;
  readonly 'expiration-date': string | null;
  readonly 'identification-number': string | null;
  /** ICAO three-letter codes (`D` read as `DEU`). */
  readonly nationality: string | null;
  readonly 'issuing-country': string | null;
  /** The MRZ document code (`P`, `I`, `ID`, ...). */
  readonly 'document-code': string;
  /** `passport` for a `P` code, `visa` for `V`; `null` otherwise (the code alone does not say). */
  readonly 'id-class': IdClass | null;
}

const text = (value: string) => (value === '' ? null : value);

/** DG1's fields, or `null` when its MRZ cannot be parsed. */
export function nfcChipFields(dg1: ParsedDg1, now: Date): NfcChipFields | null {
  let parsed;
  try {
    parsed = parseMrz(dg1.mrzLines);
  } catch (error) {
    if (error instanceof MrzParseError) {
      return null;
    }
    throw error;
  }
  const code = parsed.documentCode;
  return {
    'name-first': text(parsed.givenNames),
    'name-last': text(parsed.surname),
    birthdate: mrzDateToIso(parsed.birthDate, 'birth', now),
    sex: parsed.sex,
    'expiration-date': mrzDateToIso(parsed.expirationDate, 'expiry', now),
    'identification-number': text(parsed.documentNumber),
    nationality: normalizeCountryCode(parsed.nationality),
    'issuing-country': normalizeCountryCode(parsed.issuingState),
    'document-code': code,
    'id-class': code.startsWith('P') ? 'passport' : code.startsWith('V') ? 'visa' : null,
  };
}
