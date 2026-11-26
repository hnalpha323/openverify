/**
 * C62.6: DG1 against the latest government ID MRZ of the same document code and issuer (another
 * document: `no_reference_data`), exactly unless the printed MRZ's check digits failed, when OCR
 * confusables are tolerated; `not_requested` (non-blocking) without a government ID step; judged
 * on DG1's integrity (C62.4).
 */
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { idNfcMrzComparison } from './id-nfc-mrz-comparison.js';
import { mrzReference, nfcInput, nfcTemplate, paReport, TD3_LINES } from './testing.js';
import type { GovernmentIdNfcCheckInput, NfcMrzReference } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}) =>
  idNfcMrzComparison(nfcContext(nfcInput(input), nfcTemplate()));

const withReference = (fields: NfcMrzReference['fields'], extra: Partial<NfcMrzReference> = {}) =>
  judge({ mrzReferences: [mrzReference({ ...extra, fields })] });

describe('id_nfc_mrz_comparison (C62.6)', () => {
  it('passes a chip MRZ equal to the printed one, naming the reading it compared', () => {
    expect(judge()).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        integrity: 'established',
        'compared-fields': [
          'identification-number',
          'birthdate',
          'expiration-date',
          'name',
          'nationality',
        ],
        'mismatched-fields': [],
        'confusables-tolerated': false,
        'government-id-verification-id': 'ver_01JD0000000000000000000ID1',
      },
    });
  });

  it.each([
    [{ 'identification-number': 'L898902C4' }, 'document_number_mismatch'],
    [{ birthdate: '1990-01-02' }, 'birthdate_mismatch'],
    [{ 'expiration-date': '2032-01-01' }, 'expiration_date_mismatch'],
    [{ 'name-last': 'QUILLON' }, 'name_mismatch'],
    [{ 'name-first': 'ROWAN' }, 'name_mismatch'],
    [{ nationality: 'XXA' }, 'nationality_mismatch'],
  ] as const)('fails %j with %s', (fields, reason) => {
    expect(withReference(fields)).toMatchObject({ status: 'failed', reasons: [reason] });
  });

  it('names every mismatch, in field order', () => {
    expect(
      withReference({ birthdate: '1991-01-01', 'identification-number': 'X00000000' }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['document_number_mismatch', 'birthdate_mismatch'],
      metadata: { 'mismatched-fields': ['identification-number', 'birthdate'] },
    });
  });

  it('tolerates OCR confusables only when the printed check digits failed or are unknown', () => {
    const misread = { 'identification-number': 'L8989O2C3', 'name-last': 'QU1LL' };
    expect(withReference(misread)).toMatchObject({ status: 'failed' });
    for (const checkDigitsValid of [false, null]) {
      expect(withReference(misread, { checkDigitsValid })).toMatchObject({
        status: 'passed',
        metadata: { 'confusables-tolerated': true },
      });
    }
  });

  it('compares names across MRZ fillers, case and accents, and a truncated chip name as a prefix', () => {
    expect(withReference({ 'name-first': 'Rowan  Ásh', 'name-last': 'quill' }).status).toBe(
      'passed',
    );
    const truncated = ['P<UTOQUILLWORTHINGTONSHIRE<<ROWAN<ASHWOOD<MA', TD3_LINES[1] ?? ''];
    expect(
      judge({
        dg1: { mrzLines: truncated },
        mrzReferences: [
          mrzReference({
            fields: {
              'name-last': 'QUILLWORTHINGTONSHIRE',
              'name-first': 'ROWAN ASHWOOD MARIGOLD',
            },
          }),
        ],
      }).status,
    ).toBe('passed');
  });

  it('takes the latest reading of the same issuer and document code, else no_reference_data', () => {
    const other = mrzReference({
      verificationId: 'ver_01JD0000000000000000000ID0',
      fields: { 'issuing-authority-code': 'XXA' },
    });
    expect(judge({ mrzReferences: [other, mrzReference()] })).toMatchObject({
      status: 'passed',
      metadata: { 'government-id-verification-id': 'ver_01JD0000000000000000000ID1' },
    });
    for (const references of [
      [other],
      [mrzReference({ idClass: 'drivers_license' })],
      [mrzReference({ fields: { 'issuing-authority-code': null } })],
      [],
    ]) {
      expect(judge({ mrzReferences: references })).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
      });
    }
    expect(judge({ mrzReferences: [mrzReference({ idClass: null })] }).status).toBe('passed');
  });

  it('answers no_reference_data when the reading holds none of the compared fields', () => {
    expect(
      withReference({
        'name-first': null,
        'name-last': null,
        birthdate: null,
        'identification-number': null,
        'expiration-date': null,
        nationality: null,
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['no_reference_data'] });
  });

  it('answers not_requested without a government ID step (non-blocking)', () => {
    expect(judge({ governmentIdStep: false })).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_requested'],
    });
  });

  it('answers input_missing without a readable DG1', () => {
    for (const dg1 of [null, { mrzLines: ['NOT AN MRZ'] }]) {
      expect(judge({ dg1 })).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    }
  });

  it('judges on DG1 integrity (C62.4): a mismatch fails, a match is not evidence, broken is neither', () => {
    const unverified = paReport({
      integrity: 'not_established',
      integrityReason: 'trust_anchor_unavailable',
    });
    expect(judge({ passiveAuthentication: unverified })).toMatchObject({
      status: 'not_applicable',
      reasons: ['integrity_not_established'],
      metadata: { integrity: 'not_established' },
    });
    expect(
      judge({
        passiveAuthentication: unverified,
        mrzReferences: [mrzReference({ fields: { birthdate: '1991-01-01' } })],
      }),
    ).toMatchObject({ status: 'failed', reasons: ['birthdate_mismatch'] });
    const notIdentical = paReport({ dataGroups: { 1: 'not_identical', 2: 'identical' } });
    expect(judge({ passiveAuthentication: notIdentical }).reasons).toEqual([
      'integrity_not_established',
    ]);
    const broken = paReport({ integrity: 'broken', integrityReason: 'dg_hash_mismatch' });
    expect(
      judge({
        passiveAuthentication: broken,
        mrzReferences: [mrzReference({ fields: { birthdate: '1991-01-01' } })],
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['integrity_not_established'] });
    expect(judge({ passiveAuthentication: null }).reasons).toEqual(['integrity_not_established']);
  });
});
