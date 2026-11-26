/**
 * C243.1 (Phase 11, Workflow 11A, `workflow-connect`): Connect's three registry entries, built from
 * the frozen contracts (`CONNECT_ACTION_CONTRACTS`, `CONNECT_ACTION_ROWS`) and passed to the API's
 * registry beside the case steps' (the 8B precedent, F33). Each is an internal, exactly-once action
 * under its one scope, never adverse, never biometric, its output marked plain, and each has a
 * handler in the process table. No action activates a connection or records or withdraws a consent
 * (C243.3). Every value is synthetic.
 */
import {
  CONNECT_ACTION_CONTRACTS,
  CONNECT_ACTION_ROWS,
  RESERVED_CONNECT_ACTION_KEYS,
  actionOutputMarks,
} from '@openverify/workflow-engine/actions';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../../definitions/registry.js';
import { processActions } from '../../engine/actions.js';
import { createConnectActionEntries } from './entries.js';

describe('the Connect action entries (C243.1)', () => {
  it('are one version of each reserved key, in the API registry', () => {
    const entries = createConnectActionEntries();
    expect(entries.map(({ key, version }) => `${key}@${String(version)}`).sort()).toEqual([
      'create_share_token@1',
      'expire_share_token@1',
      'redeem_share_token@1',
    ]);
    for (const key of RESERVED_CONNECT_ACTION_KEYS) {
      expect(WORKFLOW_ACTIONS.latest(key)?.version, key).toBe(1);
    }
  });

  it('take the frozen config and output, the row scope and its events', () => {
    for (const entry of createConnectActionEntries()) {
      const key = entry.key as (typeof RESERVED_CONNECT_ACTION_KEYS)[number];
      expect(entry.config, key).toBe(CONNECT_ACTION_CONTRACTS[key].config);
      expect(entry.output, key).toBe(CONNECT_ACTION_CONTRACTS[key].output);
      expect(entry.grant({} as never), key).toEqual({
        scopes: [CONNECT_ACTION_ROWS[key].scope],
        pii: false,
      });
      expect(entry.grantDependsOnConfig, key).toBe(false);
      expect(entry.emits, key).toEqual(CONNECT_ACTION_ROWS[key].emits);
    }
  });

  it('are internal, exactly once and never retried, adverse, biometric or irreversible', () => {
    for (const entry of createConnectActionEntries()) {
      expect(
        {
          kind: entry.kind,
          delivery: entry.delivery,
          retry: entry.retry,
          availability: entry.availability,
          triggers: entry.triggers,
          requires: entry.requires,
          adverse: entry.adverse,
          adverseRule: entry.adverseRule,
          biometric: entry.biometric,
          irreversible: entry.irreversible,
          causeChecked: entry.causeChecked,
          stage: entry.stage,
        },
        entry.key,
      ).toEqual({
        kind: 'internal',
        delivery: 'exactly-once',
        retry: { allowed: false, defaultIntervalsSeconds: [] },
        availability: 'none',
        triggers: null,
        requires: [],
        adverse: 'never',
        adverseRule: null,
        biometric: false,
        irreversible: false,
        causeChecked: false,
        stage: 'ga',
      });
    }
  });

  it('output only plain members: a token id, a status and a reason, never shared data', () => {
    for (const entry of createConnectActionEntries()) {
      const marks = actionOutputMarks(entry.key, entry.output);
      expect(
        Object.values(marks).every((pii) => !pii),
        entry.key,
      ).toBe(true);
      expect(Object.keys(marks), entry.key).toContain('share-token-id');
      expect(Object.keys(marks), entry.key).not.toContain('source-data');
    }
  });

  it('each has a handler in the process table', () => {
    const { handlers } = processActions();
    for (const key of RESERVED_CONNECT_ACTION_KEYS) {
      expect(handlers.get(key, 1)?.shape, key).toBe('transaction');
    }
  });

  it('offer no action for activation, consent creation or withdrawal (C243.3)', () => {
    for (const key of [
      'activate_connection',
      'create_consent_record',
      'attest_consent_record',
      'withdraw_consent_record',
    ]) {
      expect(WORKFLOW_ACTIONS.latest(key), key).toBeUndefined();
    }
  });
});
