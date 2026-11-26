/**
 * Phase 10 decision 66, C211.9 (Workflow 10B Stage 3, integration-10b): the notice that names Google as
 * a recipient is a built-in copy key with the legal mark `notice`, beside the session-integrity notice,
 * so publish can require it and the Android key map can take its words from the web catalogs (C199.1).
 */
import { describe, expect, it } from 'vitest';
import { COPY_KEYS } from './copy-keys.js';

/** `PLAY_INTEGRITY_NOTICE_TEXT_KEY` of `@openverify/contracts`, which this package does not import. */
const PLAY_INTEGRITY_NOTICE_TEXT_KEY = 'notice.play-integrity';

describe('notice.play-integrity (C211.9, decision 66)', () => {
  it('is a notice text an operator may word, with the organisation placeholder only', () => {
    expect(COPY_KEYS[PLAY_INTEGRITY_NOTICE_TEXT_KEY]).toEqual(
      COPY_KEYS['notice.session-integrity'],
    );
    expect(COPY_KEYS[PLAY_INTEGRITY_NOTICE_TEXT_KEY]).toMatchObject({
      legal: 'notice',
      consent: false,
      placeholders: ['organization'],
    });
  });
});
