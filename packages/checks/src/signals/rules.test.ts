/**
 * H24: the rule tables are pinned beside the registry version of the signal that applies them. A
 * rule, weight, group or constant that changes without a version bump (in the core registry,
 * `SIGNAL_REGISTRY`) fails here; bump the version and re-pin the digest beside it. The digests were
 * computed once from the canonical JSON of the tables (keys sorted, no spaces) by an independent
 * script, before the tables were written.
 */
import { createHash } from 'node:crypto';
import { getSignalDefinition } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { BEHAVIOUR_RULES } from './behaviour.js';
import { BOT_SCORE_RULES, EVIDENCE_GROUPS, IDENTITY_FIELD_STEP_TYPES } from './bot-score.js';
import { THREAT_LEVEL_RULES } from './threat-level.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

const digest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
    .slice(0, 16);

const versionOf = (name: string): number => getSignalDefinition(name)?.version ?? 0;

describe('the rule tables by version (golden, H24)', () => {
  it('pins BOT_SCORE_RULES and its step types with inquiry/bot_score', () => {
    const table = {
      rules: BOT_SCORE_RULES,
      'identity-step-types': IDENTITY_FIELD_STEP_TYPES,
      groups: EVIDENCE_GROUPS,
    };
    expect(`${String(versionOf('inquiry/bot_score'))}:${digest(table)}`).toBe('3:2e4a4601fc0a8f7e');
  });

  it('pins BEHAVIOUR_RULES with inquiry/behavior_threat_level', () => {
    expect(`${String(versionOf('inquiry/behavior_threat_level'))}:${digest(BEHAVIOUR_RULES)}`).toBe(
      '2:f8b98aa6eb4139a8',
    );
  });

  it('pins THREAT_LEVEL_RULES with inquiry/network_threat_level', () => {
    expect(
      `${String(versionOf('inquiry/network_threat_level'))}:${digest(THREAT_LEVEL_RULES)}`,
    ).toBe('1:0902dd0b3a363f89');
  });
});
