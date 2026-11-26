/**
 * Workflow 10B Stage 1a (contracts-10b): the five device-integrity entries (C210.4, C211.5) and the
 * `decisive-alone` flag with the predicate both publish rules share (C210.5; 10B D2 (a)).
 */
import { describe, expect, it } from 'vitest';
import {
  getSignalDefinition,
  SIGNAL_REGISTRY,
  signalsNotDecisiveAlone,
} from './signal-registry.js';

const HEURISTICS = ['inquiry/device_emulated', 'inquiry/device_rooted', 'inquiry/device_hooked'];
const PLAY = ['inquiry/device_integrity_level', 'inquiry/app_recognized'];

describe('the device-integrity entries', () => {
  it('declares the three heuristics H-tier beta, true or null, on android-integrity', () => {
    for (const name of HEURISTICS) {
      const entry = getSignalDefinition(name);
      expect(entry, name).toMatchObject({
        public: false,
        layer: 'device',
        tier: 'H',
        stage: 'beta',
        version: 1,
        valueType: 'boolean',
        neverFalse: true,
        collectionTier: 'session-integrity',
        default: true,
        flowProvisional: true,
        decisiveAlone: false,
        inputs: ['android-integrity'],
      });
      expect(Object.keys(entry?.thresholds ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it('declares the two Play Integrity signals A-tier beta, with no threshold', () => {
    expect(getSignalDefinition('inquiry/device_integrity_level')).toMatchObject({
      tier: 'A',
      stage: 'beta',
      valueType: 'enum',
      values: ['strong', 'device', 'basic', 'none'],
      neverFalse: false,
      decisiveAlone: false,
      inputs: ['integrity-verdict'],
      thresholds: {},
    });
    expect(getSignalDefinition('inquiry/app_recognized')).toMatchObject({
      tier: 'A',
      stage: 'beta',
      valueType: 'boolean',
      neverFalse: false,
      decisiveAlone: false,
      inputs: ['integrity-verdict'],
      thresholds: {},
    });
  });

  it('keeps every earlier entry decisive alone', () => {
    const earlier = SIGNAL_REGISTRY.filter(
      (entry) => ![...HEURISTICS, ...PLAY].includes(entry.name),
    );
    expect(earlier.every((entry) => entry.decisiveAlone)).toBe(true);
  });

  it('names the signals a route reads that are never decisive alone, in the order given', () => {
    expect(
      signalsNotDecisiveAlone([
        'inquiry/bot_score',
        'inquiry/app_recognized',
        'inquiry/device_rooted',
        'unknown',
      ]),
    ).toEqual(['inquiry/app_recognized', 'inquiry/device_rooted']);
    expect(signalsNotDecisiveAlone([])).toEqual([]);
  });
});
