// @vitest-environment node
import { readFileSync } from 'node:fs';
import { SELFIE_POSES } from '@openverify/contracts';
import {
  SELFIE_CAPTURE_ERROR_CODES,
  SELFIE_CAPTURE_METHODS,
  SELFIE_CAPTURE_STATUSES,
  THRESHOLD_BASES,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_ERROR_TEXT,
  CAPTURE_METHOD_LABELS,
  CAPTURE_STATUS_LABELS,
  LIVENESS_COMPONENTS,
  LIVENESS_COMPONENT_LABELS,
  LIVENESS_COMPONENT_STATUSES,
  LIVENESS_COMPONENT_STATUS_LABELS,
  LIVENESS_MODE_LABELS,
  POSE_LABELS,
  THRESHOLD_BASIS_LABELS,
  livenessFlagText,
  orderFollowedText,
} from './selfie-words';

/**
 * The evaluators' own source (`packages/checks`, which the console does not depend on): the
 * flags `selfie_liveness_detection` records are read from it, so a flag added there without
 * words here fails this test.
 */
const checksSource = (file: string) =>
  readFileSync(new URL(`../../../../packages/checks/src/selfie/${file}`, import.meta.url), 'utf8');
const liveness = checksSource('selfie-liveness-detection.ts');
const captureSignals = checksSource('capture-signals.ts');

/** The string literals of the array assigned to `name` (`const NAME = [...]`, frozen or not). */
function arrayOf(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);
}

const INTEGRITY_FLAGS = arrayOf(liveness, 'INTEGRITY_FLAGS');
const TIMING_FLAGS = arrayOf(captureSignals, 'CAPTURE_TIMING_FLAGS');
/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;

describe('the selfie flags in words (C43, C47)', () => {
  it('reads the four integrity flags and the six timing flags from the evaluators', () => {
    expect(INTEGRITY_FLAGS).toEqual([
      'file-path-label',
      'webdriver',
      'virtual-camera',
      'replayed-bytes',
    ]);
    expect(TIMING_FLAGS).toHaveLength(6);
  });

  it.each([...INTEGRITY_FLAGS, ...TIMING_FLAGS, 'test-capture-device'])(
    'says the flag %s in words',
    (flag) => {
      expect(livenessFlagText(flag)?.words, flag).toMatch(WORDS);
    },
  );

  it('reads the sandbox test-capture and order flags from the evaluator', () => {
    expect(liveness).toContain("'test-capture-device': true");
    expect(liveness).toContain("'order-followed': orderFollowed");
  });

  it('says whether the poses arrived in the prompted order, or that it could not be told', () => {
    expect(orderFollowedText(true)).toBe('In the prompted order');
    expect(orderFollowedText(false)).toBe('Not in the prompted order');
    expect(orderFollowedText(null)).toBe('Order could not be told');
  });

  it('explains the sandbox test-capture flag and the virtual-camera flag', () => {
    expect(livenessFlagText('test-capture-device')?.explanation).toMatch(/sandbox/i);
    expect(livenessFlagText('virtual-camera')?.explanation).toMatch(/review/);
  });

  it.each(['a-flag-from-the-future', 'constructor', '__proto__'])('knows nothing of %s', (flag) => {
    expect(livenessFlagText(flag)).toBeUndefined();
  });

  it('says the liveness components and their statuses as the evaluator types them', () => {
    expect(liveness).toMatch(
      /type LivenessComponentStatus = 'passed' \| 'failed' \| 'not_requested' \| 'not_executed';/,
    );
    expect(liveness).toMatch(
      /interface LivenessComponents \{\s+passive: LivenessComponentStatus;\s+active: LivenessComponentStatus;\s+integrity: LivenessComponentStatus;\s+\}/,
    );
    expect(LIVENESS_COMPONENTS.map((component) => LIVENESS_COMPONENT_LABELS[component])).toEqual([
      'Passive',
      'Active',
      'Integrity',
    ]);
    expect(
      LIVENESS_COMPONENT_STATUSES.map((status) => LIVENESS_COMPONENT_STATUS_LABELS[status]),
    ).toEqual(['Passed', 'Failed', 'Not requested', 'Not run']);
  });
});

describe('the capture vocabulary in words (C40.1, C47)', () => {
  it('names each pose', () => {
    expect(SELFIE_POSES.map((pose) => POSE_LABELS[pose])).toEqual(['Center', 'Left', 'Right']);
  });

  it.each(SELFIE_CAPTURE_STATUSES)('says the capture status %s in words', (status) => {
    expect(CAPTURE_STATUS_LABELS[status]).toMatch(WORDS);
  });

  it.each(SELFIE_CAPTURE_ERROR_CODES)('says the error code %s, and why', (code) => {
    expect(CAPTURE_ERROR_TEXT[code].words).toMatch(WORDS);
    expect(CAPTURE_ERROR_TEXT[code].explanation).toMatch(/^[A-Z].+\.$/);
  });

  it('says a superseded capture was replaced by a newer one before it was submitted', () => {
    expect(CAPTURE_ERROR_TEXT.superseded).toEqual({
      words: 'Superseded',
      explanation: 'A newer capture replaced it before it was submitted.',
    });
  });

  it.each(SELFIE_CAPTURE_METHODS)('says the capture method %s in words', (method) => {
    expect(CAPTURE_METHOD_LABELS[method]).toMatch(WORDS);
  });

  it('says the liveness modes in words', () => {
    expect(LIVENESS_MODE_LABELS).toEqual({ passive: 'Passive', active: 'Active (head turns)' });
  });

  it.each(THRESHOLD_BASES)('says the threshold basis %s in words', (basis) => {
    expect(THRESHOLD_BASIS_LABELS[basis]).toMatch(WORDS);
  });
});
