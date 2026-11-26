import {
  GOVERNMENT_ID_CHECK_REASONS,
  LEGACY_SELFIE_REASONS,
  NOT_IMPLEMENTED_REASON,
  PHASE1_CHECK_REASONS,
  SELFIE_CHECK_REASONS,
  SHARED_GOVERNMENT_ID_REASONS,
  SHARED_SELFIE_REASONS,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { REASON_WORDS, reasonText } from './check-reasons';

/** Every reason a §4.2 selfie check may emit (C39.2), and the legacy ones stored rows carry. */
const SELFIE_REASONS = [
  ...new Set([
    ...Object.values(SELFIE_CHECK_REASONS).flat(),
    ...SHARED_SELFIE_REASONS,
    ...LEGACY_SELFIE_REASONS,
  ]),
].sort();

/**
 * Every reason code the API can return for a check: the government ID lists (C29.4), the Phase 1
 * lists, the selfie lists (C39.2), and the pending reason of an enabled check without an
 * implementation.
 */
const CONTRACT_REASONS = [
  ...new Set([
    ...Object.values(GOVERNMENT_ID_CHECK_REASONS).flat(),
    ...Object.values(PHASE1_CHECK_REASONS).flat(),
    ...SHARED_GOVERNMENT_ID_REASONS,
    ...SELFIE_REASONS,
    NOT_IMPLEMENTED_REASON,
  ]),
].sort();

describe('reason codes in words (C37)', () => {
  it('covers more than a hundred contract reasons', () => {
    expect(CONTRACT_REASONS.length).toBeGreaterThan(100);
  });

  it('covers every reason of the fifteen selfie checks (C39.2, C47)', () => {
    expect(Object.keys(SELFIE_CHECK_REASONS)).toHaveLength(15);
    expect(SELFIE_REASONS.filter((code) => reasonText(code) === undefined)).toEqual([]);
  });

  it('says what the matching consent and the capture reasons mean (C42.3, C43)', () => {
    expect(reasonText('not_consented')?.explanation).toMatch(/matching consent/);
    expect(reasonText('capture_not_live')?.explanation).toMatch(/live camera capture/);
    expect(reasonText('capture_device_suspicious')?.explanation).toMatch(/virtual-camera list/);
  });

  it.each(CONTRACT_REASONS)('says %s in short English words', (code) => {
    const text = reasonText(code);

    expect(text?.words, code).toMatch(/^[A-Z][^_]{1,59}$/);
  });

  it('knows no code the contracts do not list', () => {
    expect(Object.keys(REASON_WORDS).filter((code) => !CONTRACT_REASONS.includes(code))).toEqual(
      [],
    );
  });

  it('says an unconfigured provider is "Not configured", and why (ADR 0002 §3e)', () => {
    expect(reasonText('provider_not_configured')).toEqual({
      words: 'Not configured',
      explanation: 'No provider is bound to this check in this environment.',
    });
  });

  it('says what the non-blocking reasons mean', () => {
    expect(reasonText('feature_absent')?.words).toBe('Not on this kind of document');
    expect(reasonText('not_requested')?.words).toBe('Not asked for by the flow');
  });

  it.each(['a_reason_from_the_future', 'constructor', 'to_string', '__proto__'])(
    'knows nothing of %s, a code it was not given words for',
    (code) => {
      expect(reasonText(code)).toBeUndefined();
    },
  );
});
