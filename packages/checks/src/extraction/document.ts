/**
 * The document class, issuer and layout established from the document itself (C30.2): from an
 * MRZ document code (the issuer from the MRZ), else from an AAMVA header (the issuer from the
 * IIN), else from visual-zone keywords together with the layout of the document outline (no
 * issuer). A class the user picked is never "established", so it is not an input here.
 */
import type { IdClass } from '@openverify/core';
import type { ParsedAamva } from '../aamva.js';
import { alpha3ToAlpha2, normalizeCountryCode } from '../country-codes.js';
import type { DocumentIssuer, DocumentLayout } from '../data/feature-table.js';
import type { ParsedMrz } from '../mrz.js';

export type ClassSource = 'mrz' | 'barcode' | 'viz';

export interface EstablishedDocument {
  /** `null` when the document did not establish a class. */
  idClass: IdClass | null;
  classSource: ClassSource | null;
  /** `null` when no MRZ or AAMVA header named the issuer. */
  issuer: DocumentIssuer | null;
  layout: DocumentLayout | null;
}

export const UNKNOWN_DOCUMENT: EstablishedDocument = Object.freeze({
  idClass: null,
  classSource: null,
  issuer: null,
  layout: null,
});

/** What a document shows of its class: the MRZ, the AAMVA payload, the visual-zone text, the outline. */
export interface DocumentEvidence {
  mrz: ParsedMrz | null;
  aamva: ParsedAamva | null;
  /** The OCR text of the visual zone (PII), every side. */
  vizTexts: readonly string[];
  /** The front document's aspect ratio (C32.1), or `null` when no document was found. */
  aspectRatio: number | null;
}

/** The class of an ICAO document code: P passport, V visa, second letter R a residence permit. */
function mrzClass(code: string): IdClass {
  const [first, second] = code;
  if (first === 'P') {
    return 'passport';
  }
  if (first === 'V') {
    return 'visa';
  }
  if (second === 'R') {
    return 'residence_permit';
  }
  return first === 'I' ? 'national_id' : 'travel_document';
}

/** Keywords per class, as folded words (upper case, accents removed, punctuation a space). */
const KEYWORDS: readonly (readonly [IdClass, readonly string[]])[] = [
  ['passport', ['PASSPORT', 'PASAPORTE', 'PASSEPORT', 'REISEPASS']],
  [
    'drivers_license',
    [
      'DRIVER LICENSE',
      'DRIVERS LICENSE',
      'DRIVER S LICENSE',
      'DRIVER LICENCE',
      'DRIVING LICENCE',
      'DRIVING LICENSE',
      'PERMIS DE CONDUIRE',
      'FUHRERSCHEIN',
      'PERMISO DE CONDUCIR',
      'LICENCIA DE CONDUCIR',
      'LICENCIA DE CONDUCCION',
    ],
  ],
  [
    'residence_permit',
    [
      'RESIDENCE PERMIT',
      'PERMISO DE RESIDENCIA',
      'TITRE DE SEJOUR',
      'AUFENTHALTSTITEL',
      'AUFENTHALTSERLAUBNIS',
    ],
  ],
  [
    'national_id',
    [
      'IDENTITY CARD',
      'ID CARD',
      'IDENTIFICATION CARD',
      'DOCUMENTO NACIONAL DE IDENTIDAD',
      'CEDULA DE IDENTIDAD',
      'CARTE NATIONALE D IDENTITE',
      'CARTE D IDENTITE',
      'PERSONALAUSWEIS',
    ],
  ],
];

const ID1_ASPECT = 85.6 / 53.98;
const TD3_ASPECT = 125 / 88;
const ASPECT_TOLERANCE = 0.12;

/** The nearer of ID-1 and TD3 to an aspect ratio, within the C32.1 tolerance. */
function layoutOf(aspectRatio: number | null): 'ID1' | 'TD3' | null {
  if (aspectRatio === null) {
    return null;
  }
  const id1 = Math.abs(aspectRatio - ID1_ASPECT) / ID1_ASPECT;
  const td3 = Math.abs(aspectRatio - TD3_ASPECT) / TD3_ASPECT;
  const [layout, distance] = id1 <= td3 ? (['ID1', id1] as const) : (['TD3', td3] as const);
  return distance <= ASPECT_TOLERANCE ? layout : null;
}

function keywordClass(texts: readonly string[], aspectRatio: number | null): EstablishedDocument {
  const folded = ` ${texts
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')} `;
  const classes = KEYWORDS.filter(([, words]) =>
    words.some((word) => folded.includes(` ${word} `)),
  );
  const layout = layoutOf(aspectRatio);
  const [match] = classes;
  if (classes.length !== 1 || match === undefined || layout === null) {
    return UNKNOWN_DOCUMENT;
  }
  const [idClass] = match;
  const expected = idClass === 'passport' ? 'TD3' : 'ID1';
  return layout === expected
    ? { idClass, classSource: 'viz', issuer: null, layout }
    : UNKNOWN_DOCUMENT;
}

/** Establishes the document's class, issuer and layout from the document itself (C30.2). */
export function establishDocument(evidence: DocumentEvidence): EstablishedDocument {
  const { mrz, aamva } = evidence;
  if (mrz !== null && !mrz.formatIssues.includes('document_code_invalid')) {
    const issuerValid = !mrz.formatIssues.includes('issuing_state_invalid');
    return {
      idClass: mrzClass(mrz.documentCode),
      classSource: 'mrz',
      issuer: issuerValid
        ? {
            scheme: 'icao',
            code: normalizeCountryCode(mrz.issuingState) ?? mrz.issuingState,
            country: alpha3ToAlpha2(mrz.issuingState),
            jurisdiction: null,
          }
        : null,
      layout: mrz.format,
    };
  }
  if (aamva?.documentType != null) {
    return {
      idClass: aamva.documentType === 'DL' ? 'drivers_license' : 'national_id',
      classSource: 'barcode',
      issuer: {
        scheme: 'aamva',
        code: aamva.header.iin,
        country: aamva.issuer?.country ?? null,
        jurisdiction: aamva.issuer?.code ?? null,
      },
      layout: 'ID1',
    };
  }
  return keywordClass(evidence.vizTexts, evidence.aspectRatio);
}
