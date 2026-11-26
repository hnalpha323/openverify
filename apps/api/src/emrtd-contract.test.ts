/**
 * C62.2, C62.3 (Workflow 5B Stage 1): the `@openverify/emrtd` report speaks the frozen NFC check
 * vocabulary (C51.2), so the job and the checks map it without inventing a reason. A broken
 * integrity is a passive authentication failure (proven tampering); every gap in it is a review
 * reason, never a failure (ADR 0002). An undetermined revocation answers `crl_unavailable`: the
 * report's `no_distribution_point` detail says why, as check metadata.
 */
import { NFC_CHECK_OUTCOMES } from '@openverify/contracts';
import { INTEGRITY_BREAKS, INTEGRITY_GAPS, REVOCATION_GAPS } from '@openverify/emrtd';
import { describe, expect, it } from 'vitest';

const PASSIVE = NFC_CHECK_OUTCOMES.id_nfc_passive_authentication_detection;

describe('the emrtd report and the NFC check reasons', () => {
  it('fails passive authentication for each integrity break', () => {
    for (const reason of INTEGRITY_BREAKS) {
      expect(PASSIVE.failed, reason).toContain(reason);
    }
  });

  it('sends each integrity gap to review, never to failure', () => {
    for (const reason of INTEGRITY_GAPS) {
      expect(PASSIVE.notApplicable, reason).toContain(reason);
      expect(PASSIVE.failed, reason).not.toContain(reason);
    }
  });

  it('answers an undetermined revocation with crl_unavailable', () => {
    expect(REVOCATION_GAPS).toEqual(['crl_unavailable', 'no_distribution_point']);
    expect(PASSIVE.notApplicable).toContain('crl_unavailable');
  });
});
