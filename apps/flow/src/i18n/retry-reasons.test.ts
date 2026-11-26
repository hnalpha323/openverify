/**
 * Every reason a retry hint can carry has a message in every language of the flow (C29.4, C37).
 *
 * The reasons come from the contracts, never from a hand-copied list. A retry hint names a
 * failed, required `user_behavior` check (`retryHintsFromChecks`), so its reasons are the ones
 * `GOVERNMENT_ID_CHECK_REASONS`, `SELFIE_CHECK_REASONS` (C39.2) and `PHASE1_CHECK_REASONS` list for
 * `user_behavior` checks, less
 * the shared reasons only a `not_applicable` result carries: C29.4 makes every shared reason
 * `not_applicable` except `image_unreadable`, which fails the check. Phase 5 (C51.2) states the
 * failure reasons of its user-behaviour checks itself: `PHASE5_RETRY_HINT_REASONS`.
 *
 * The Android SDK reads the same list from `contracts/fixtures/flow/retry-hint-reasons.json`,
 * which this file keeps equal to the contracts.
 */
import {
  GOVERNMENT_ID_CHECK_REASONS,
  IMAGE_UNREADABLE_REASON,
  PHASE1_CHECK_REASONS,
  PHASE5_RETRY_HINT_REASONS,
  SELFIE_CHECK_REASONS,
  SHARED_GOVERNMENT_ID_REASONS,
  SHARED_SELFIE_REASONS,
} from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../contracts/fixtures/flow/retry-hint-reasons.json';
import { createI18n } from './create-i18n';
import { SUPPORTED_LANGUAGES } from './languages';
import { CATALOGS } from './catalogs';
import type { Messages } from './locales/en';
import { translateKey } from './translate-key';

/** The reasons a retry hint can carry, sorted, per the contracts. */
function contractRetryHintReasons(): string[] {
  const notApplicableOnly = new Set<string>(
    [...SHARED_GOVERNMENT_ID_REASONS, ...SHARED_SELFIE_REASONS].filter(
      (reason) => reason !== IMAGE_UNREADABLE_REASON,
    ),
  );
  const reasonsByCheck: Record<string, readonly string[]> = {
    ...PHASE1_CHECK_REASONS,
    ...GOVERNMENT_ID_CHECK_REASONS,
    ...SELFIE_CHECK_REASONS,
  };
  const reasons = Object.entries(reasonsByCheck)
    .filter(([check]) => getCheckDefinition(check)?.checkType === 'user_behavior')
    .flatMap(([, codes]) => codes)
    .filter((reason) => !notApplicableOnly.has(reason));
  // C51.2: Phase 5 states each check's failure reasons, so its frozen list is taken as it is.
  return [...new Set([...reasons, ...PHASE5_RETRY_HINT_REASONS])].sort();
}

const MESSAGES: Readonly<Record<(typeof SUPPORTED_LANGUAGES)[number], Messages>> = CATALOGS;

/** The flow's own message for `reason` in `messages`, without any fallback. */
function messageFor(messages: Messages, reason: string): string | undefined {
  return (messages.retry.reasons as Readonly<Record<string, string | undefined>>)[reason];
}

const REASONS = contractRetryHintReasons();

describe('the reasons a retry hint can carry', () => {
  it('come from the contracts: the user_behavior checks of Phases 1, 3 and 4', () => {
    // Guards the derivation itself: Phase 1's capture reasons and the Phase 3 additions are in,
    // fraud reasons and the not_applicable-only shared reasons are out.
    expect(REASONS).toEqual(expect.arrayContaining(['image_blurry', 'resolution_too_low']));
    expect(REASONS).not.toContain('specimen_marker_found');
    expect(REASONS).not.toContain('input_missing');
    expect(REASONS).toContain(IMAGE_UNREADABLE_REASON);
    // C39.2: the frozen selfie user-behaviour reasons, and never not_consented.
    expect(REASONS).toEqual(
      expect.arrayContaining([
        'face_too_small',
        'face_glare',
        'pose_not_center',
        'pose_not_left',
        'pose_not_right',
        'face_covered',
        'glasses_detected',
      ]),
    );
    expect(REASONS).not.toContain('not_consented');
    expect(REASONS).not.toContain('capture_not_live');
    // C51.2: the frozen Phase 5 user-behaviour reasons, never their not_applicable answers.
    expect(REASONS).toEqual(expect.arrayContaining([...PHASE5_RETRY_HINT_REASONS]));
    expect(REASONS).toContain('document_name_mismatch');
    expect(REASONS).not.toContain('document_type_unknown');
    expect(REASONS).not.toContain('otp_delivery_unavailable');
  });

  it('are listed, exactly, in the fixture the Android SDK reads', () => {
    expect(fixture.schema_version).toBe(1);
    expect(fixture.reasons).toEqual(REASONS);
  });
});

describe.each(SUPPORTED_LANGUAGES)('retry messages in %s', (language) => {
  const messages = MESSAGES[language];

  it('has its own message for every reason a retry hint can carry', () => {
    const missing = REASONS.filter((reason) => {
      const message = messageFor(messages, reason);
      return message === undefined || message.trim() === '' || message === messages.retry.generic;
    });

    expect(missing).toEqual([]);
  });

  it('shows each of those messages in this language, not a fallback', () => {
    const i18n = createI18n(language);

    for (const reason of REASONS) {
      expect(translateKey(i18n, `retry.reasons.${reason}`)).toBe(messageFor(messages, reason));
    }
  });

  it('says something different for each reason', () => {
    const texts = REASONS.map((reason) => messageFor(messages, reason));

    expect(new Set(texts).size).toBe(texts.length);
  });

  it('never tells the user about a fraud signal', () => {
    const fraudWords =
      /fraud|fake|forg|counterfeit|tamper|suspic|specimen|falso|falsific|manipul|sospech|espécimen|faux|contrefa|suspect|spécimen|betrug|gefälscht|fälsch|verdächt|muster|احتيال|مزور|مزيف|تزوير|مشبوه|عينة/i;

    expect(
      Object.values(messages.retry.reasons).filter((message) => fraudWords.test(message)),
    ).toEqual([]);
  });
});
