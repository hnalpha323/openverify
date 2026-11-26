/**
 * C243.1, C243.3 (Phase 11, Workflow 11A Stage 1a (U); the 8B precedent, F33): the three Connect
 * action keys are reserved beside Workflow 8B's, with their zod configs and typed outputs frozen
 * here; `workflow-connect` passes their entries to `createActionRegistry` from its own files, so no
 * one edits the registry again. Activating a connection and creating or withdrawing a consent
 * record are not actions. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as actions from './index.js';

const pick = (name: string): unknown => (actions as Readonly<Record<string, unknown>>)[name];
const contracts = (): Readonly<Record<string, { config: z.ZodType; output: z.ZodType }>> => {
  const found = pick('CONNECT_ACTION_CONTRACTS');
  if (found === undefined) {
    throw new TypeError('CONNECT_ACTION_CONTRACTS is not exported');
  }
  return found as Readonly<Record<string, { config: z.ZodType; output: z.ZodType }>>;
};

describe('the Connect action keys (C243.1)', () => {
  it('are reserved beside the case keys, and the catalogue knows them', () => {
    expect(pick('RESERVED_CONNECT_ACTION_KEYS')).toEqual([
      'create_share_token',
      'redeem_share_token',
      'expire_share_token',
    ]);
    for (const key of ['create_share_token', 'redeem_share_token', 'expire_share_token']) {
      expect(actions.actionKeySchema.safeParse(key).success, key).toBe(true);
      expect(actions.WORKFLOW_ACTION_KEYS as readonly string[], key).not.toContain(key);
    }
    for (const key of ['activate_connection', 'create_consent_record', 'withdraw_consent_record']) {
      expect(actions.actionKeySchema.safeParse(key).success, key).toBe(false);
    }
  });

  it('give each a config and an output, and no other key', () => {
    expect(Object.keys(contracts()).sort()).toEqual([
      'create_share_token',
      'expire_share_token',
      'redeem_share_token',
    ]);
  });

  it('create a token from a connection, a source and a consent, references allowed', () => {
    const { config } = contracts().create_share_token ?? { config: z.never() };
    expect(
      config.safeParse({
        'connection-id': 'cxn_01M5CN0000000000000011A100',
        'source-id': '{{trigger.data.id}}',
        'consent-record-id': '{{steps.consent.output.id}}',
        'expires-in-seconds': 86_400,
      }).success,
    ).toBe(true);
    for (const bad of [
      {
        'connection-id': 'cxn_01M5CN0000000000000011A100',
        'source-id': 'inq_01M5CN0000000000000011A300',
      },
      {
        'connection-id': 'cxn_01M5CN0000000000000011A100',
        'source-id': 'inq_01M5CN0000000000000011A300',
        'consent-record-id': 'cnsr_01M5CN0000000000000011A400',
        'expires-in-seconds': 59,
      },
    ]) {
      expect(config.safeParse(bad).success).toBe(false);
    }
  });

  it('redeem with the redeem body, whose destination consent is required (C243.4)', () => {
    const { config } = contracts().redeem_share_token ?? { config: z.never() };
    expect(
      config.safeParse({
        'share-token-id': '{{trigger.data.id}}',
        meta: {
          'inquiry-template-id': 'itmpl_01M5CN0000000000000011A600',
          'destination-consent-record-id': 'cnsr_01M5CN0000000000000011A410',
        },
      }).success,
    ).toBe(true);
    expect(config.safeParse({ 'share-token-id': '{{trigger.data.id}}', meta: {} }).success).toBe(
      false,
    );
    expect(
      config.safeParse({
        'share-token-id': '{{trigger.data.id}}',
        mode: 'fill-inquiry',
        meta: { 'destination-consent-record-id': 'cnsr_01M5CN0000000000000011A410' },
      }).success,
    ).toBe(false);
  });

  it('expire a token by its id', () => {
    const { config } = contracts().expire_share_token ?? { config: z.never() };
    expect(config.safeParse({ 'share-token-id': 'cnst_01M5CN0000000000000011A200' }).success).toBe(
      true,
    );
    expect(config.safeParse({}).success).toBe(false);
  });

  it('output the token as the run scope reads it, every member marked, never shared data', () => {
    for (const [key, { output }] of Object.entries(contracts())) {
      const shape = (output as unknown as { shape: Record<string, z.ZodType> }).shape;
      expect(Object.keys(shape), key).toContain('share-token-id');
      expect(Object.keys(shape), key).not.toContain('source-data');
      for (const [member, schema] of Object.entries(shape)) {
        expect(z.globalRegistry.get(schema)?.pii, `${key}.${member}`).toBe(false);
      }
    }
  });
});
