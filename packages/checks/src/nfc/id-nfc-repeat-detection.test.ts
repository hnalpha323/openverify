/**
 * C62.6, decision 35, V01: repeat detection counts selfie-bound reads of the same signed SOD on
 * other accounts. A sighting is review-level (`not_applicable`/`chip_seen_on_other_account`)
 * unless the template sets `sighting-outcome: fail`; evaluated only with integrity established.
 */
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { idNfcRepeatDetection } from './id-nfc-repeat-detection.js';
import { nfcInput, nfcTemplate, paReport } from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}, config?: Record<string, unknown>) =>
  idNfcRepeatDetection(
    nfcContext(
      nfcInput(input),
      nfcTemplate(config === undefined ? {} : { id_nfc_repeat_detection: config }),
    ),
  );

describe('id_nfc_repeat_detection (C62.6)', () => {
  it('passes a chip no other account has read, counting the sightings', () => {
    expect(judge()).toMatchObject({
      status: 'passed',
      metadata: { sightings: 0 },
      provenance: { thresholds: { 'sighting-outcome': 'review' } },
    });
  });

  it('sends a sighting to review by default, and fails it with sighting-outcome fail', () => {
    expect(judge({ sightings: 2 })).toMatchObject({
      status: 'not_applicable',
      reasons: ['chip_seen_on_other_account'],
      metadata: { sightings: 2 },
    });
    expect(judge({ sightings: 1 }, { 'sighting-outcome': 'fail' })).toMatchObject({
      status: 'failed',
      reasons: ['chip_seen_on_other_account'],
    });
  });

  it('is evaluated only with integrity established', () => {
    for (const passiveAuthentication of [
      paReport({ integrity: 'not_established', integrityReason: 'dsc_missing' }),
      paReport({ integrity: 'broken', integrityReason: 'sod_signature_invalid' }),
      null,
    ]) {
      expect(judge({ passiveAuthentication, sightings: 3 })).toMatchObject({
        status: 'not_applicable',
        reasons: ['integrity_not_established'],
      });
    }
  });

  it('answers input_missing when the sightings were not looked up', () => {
    expect(judge({ sightings: null }).reasons).toEqual(['input_missing']);
  });
});
