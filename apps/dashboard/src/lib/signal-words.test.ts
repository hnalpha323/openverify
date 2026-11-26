import {
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
  SIGNAL_REVIEW_CAUSES,
  type SignalDetail,
} from '@openverify/contracts';
import { SIGNAL_LAYERS, SIGNAL_NAMES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  SIGNAL_EVIDENCE_REASON_WORDS,
  SIGNAL_LABELS,
  SIGNAL_LAYER_LABELS,
  SIGNAL_NULL_REASON_WORDS,
  SIGNAL_REVIEW_CAUSE_WORDS,
  notEvaluatedText,
  signalValueText,
  thresholdText,
} from './signal-words';

/** Words a console must never use for an unknown or a low reading (ADR 0006, H04, H06). */
const VERDICTS = /\b(no|false|safe|human|clean|passed|failed|declined)\b/i;

const AT = '2026-10-20T04:40:00.000Z';

const rDetail = (overrides: Partial<SignalDetail> = {}): SignalDetail =>
  ({
    tier: 'R',
    stage: 'ga',
    version: 1,
    'null-reason': null,
    reasons: [],
    'computed-at': AT,
    ...overrides,
  }) as SignalDetail;

const hDetail = (overrides: Partial<SignalDetail> = {}): SignalDetail =>
  ({
    tier: 'H',
    stage: 'beta',
    version: 2,
    confidence: 0.4,
    thresholds: {},
    'null-reason': null,
    reasons: [],
    'computed-at': AT,
    ...overrides,
  }) as SignalDetail;

describe('signal vocabularies in words (C90, C108)', () => {
  it.each(SIGNAL_NAMES)('labels the signal %s', (name) => {
    expect(SIGNAL_LABELS[name]).toMatch(/^[A-Z]/);
  });

  it.each(SIGNAL_LAYERS)('labels the layer %s', (layer) => {
    expect(SIGNAL_LAYER_LABELS[layer]).toMatch(/^[A-Z]/);
  });

  it.each(SIGNAL_NULL_REASONS)(
    'says why %s left a value unevaluated, never as a verdict',
    (code) => {
      expect(SIGNAL_NULL_REASON_WORDS[code]).toMatch(/^[a-z]/);
      expect(SIGNAL_NULL_REASON_WORDS[code]).not.toMatch(/\b(false|safe|human|clean)\b/i);
    },
  );

  it.each(SIGNAL_EVIDENCE_REASONS)('says the evidence reason %s in words', (code) => {
    expect(SIGNAL_EVIDENCE_REASON_WORDS[code]).toMatch(/^[a-z]/);
  });

  it.each(SIGNAL_REVIEW_CAUSES)('says the review cause %s in words', (cause) => {
    expect(SIGNAL_REVIEW_CAUSE_WORDS[cause]).toMatch(/^[A-Z]/);
  });

  it('words the reasons C93.4 and H06 fix', () => {
    expect(SIGNAL_NULL_REASON_WORDS.not_in_known_ranges).toBe('not in the lists we hold');
    expect(SIGNAL_EVIDENCE_REASON_WORDS.no_artefact_found).toBe('no automation artefacts found');
  });
});

describe('notEvaluatedText', () => {
  it('names the reason', () => {
    expect(notEvaluatedText('ipv6_not_covered')).toBe(
      `Not evaluated: ${SIGNAL_NULL_REASON_WORDS.ipv6_not_covered}`,
    );
  });

  it('reads "Not evaluated" without one', () => {
    expect(notEvaluatedText(null)).toBe('Not evaluated');
  });
});

describe('signalValueText (ADR 0006, H04, H06)', () => {
  it('reads a null value as not evaluated with its reason, never "no"', () => {
    const text = signalValueText(
      'inquiry/tor_detected',
      null,
      rDetail({ 'null-reason': 'ipv6_not_covered' }),
    );
    expect(text).toBe(notEvaluatedText('ipv6_not_covered'));
    expect(text).not.toMatch(/^No\b/);
  });

  it.each(SIGNAL_NAMES)('never reads a null %s as a verdict', (name) => {
    for (const code of SIGNAL_NULL_REASONS) {
      expect(signalValueText(name, null, rDetail({ 'null-reason': code }))).not.toMatch(
        /^(No|False|Safe|Human)\b/,
      );
    }
  });

  it('reads a low bot score as "no automation artefacts found", never "human"', () => {
    const text = signalValueText(
      'inquiry/bot_score',
      12,
      hDetail({ reasons: ['no_artefact_found'] }),
    );
    expect(text).toBe('12 of 100: no automation artefacts found');
    expect(text).not.toMatch(/human/i);
  });

  it('reads a high bot score as its number', () => {
    expect(signalValueText('inquiry/bot_score', 95, hDetail({ reasons: ['webdriver'] }))).toBe(
      '95 of 100',
    );
  });

  it.each(['inquiry/network_threat_level', 'inquiry/behavior_threat_level'])(
    'reads a low %s as "no listed risk found", never "safe"',
    (name) => {
      const text = signalValueText(name, 'low', hDetail());
      expect(text).toBe('Low: no listed risk found');
      expect(text).not.toMatch(/safe/i);
      expect(signalValueText(name, 'high', hDetail())).toBe('High');
    },
  );

  it('reads no artefact as a count that found none', () => {
    expect(
      signalValueText(
        'inquiry/automation_artefact_count',
        0,
        rDetail({ reasons: ['no_artefact_found'] }),
      ),
    ).toBe('0: no automation artefacts found');
  });

  it('reads a distance in whole meters, approximate', () => {
    expect(signalValueText('inquiry/max_session_distance', 1234567, rDetail({ reasons: [] }))).toBe(
      '1,234,567 m (approximate)',
    );
  });

  it('reads a boolean flag as found or as checked and not found', () => {
    expect(signalValueText('inquiry/tor_detected', true, rDetail())).toBe('Yes');
    // false only where the data is exhaustive for the question (C90.3).
    expect(signalValueText('inquiry/tor_detected', false, rDetail())).toBe('Checked: not found');
  });

  it('reads a country and a comparison in words', () => {
    expect(signalValueText('inquiry/country_from_session', 'ZZ', hDetail())).toBe('ZZ');
    expect(signalValueText('inquiry/country_comparison', 'different', hDetail())).toBe(
      'Different country',
    );
    expect(signalValueText('inquiry/country_comparison', 'same', hDetail())).toBe('Same country');
  });

  it('reads a count as its number', () => {
    expect(signalValueText('inquiry/session_count', 3, rDetail())).toBe('3');
  });

  it('never uses a verdict word for any low reading', () => {
    for (const text of [
      signalValueText('inquiry/bot_score', 0, hDetail({ reasons: ['no_artefact_found'] })),
      signalValueText('inquiry/network_threat_level', 'low', hDetail()),
      signalValueText(
        'inquiry/automation_artefact_count',
        0,
        rDetail({ reasons: ['no_artefact_found'] }),
      ),
    ]) {
      expect(text.replace(/no automation artefacts found|no listed risk found/, '')).not.toMatch(
        VERDICTS,
      );
    }
  });
});

describe('thresholdText', () => {
  it('says the applied threshold in words', () => {
    expect(thresholdText('fast-screen-floor-seconds', 2)).toBe('Fast screen floor seconds: 2');
  });
});
