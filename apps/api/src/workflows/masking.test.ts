/**
 * C120.6, C143.5 (P21): run values at the two masked exits, a route's serializer and a stored API log.
 * Without PII visibility each is masked whole, whatever it holds. `secret-value` never reaches a
 * stored log at all (C143.5).
 */
import {
  API_LOG_REDACTED_KEYS,
  PII_SANDBOX_MESSAGE_ATTRIBUTES,
  redactKeys,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { MASKED_ATTRIBUTES, piiMaskFor } from '../auth/pii.js';
import type { Principal } from '../ports.js';
import { maskPersonalData } from '../services/api-logs.js';

const viewer: Principal = {
  kind: 'user',
  userId: 'usr_1',
  userSessionId: 'uses_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'production',
  permissions: new Set(),
  mfaSatisfied: true,
};

const RUN_VALUES = {
  inputs: { name: 'Synthetic Person' },
  variables: { risk: 1 },
  outputs: { decision: 'Synthetic' },
  'trigger-snapshot': { fields: { name: 'Synthetic Person' } },
  input: { to: 'person@example.com' },
  output: { body: 'Synthetic Person' },
  console: ['Synthetic Person'],
};

describe('run values (C120.6, C143.5)', () => {
  it('are in the masked attributes', () => {
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining(Object.keys(RUN_VALUES)));
  });

  it('are nulled whole by a route’s mask', () => {
    const masked = piiMaskFor(viewer).attributes({ status: 'completed', ...RUN_VALUES });

    expect(masked).toEqual({
      status: 'completed',
      inputs: null,
      variables: null,
      outputs: null,
      'trigger-snapshot': null,
      input: null,
      output: null,
      console: null,
    });
  });

  it('are nulled whole in a stored API log', () => {
    const masked = maskPersonalData({
      data: {
        type: 'workflow-run',
        id: 'wfr_1',
        attributes: { status: 'completed', ...RUN_VALUES },
      },
    });

    expect(JSON.stringify(masked)).not.toContain('Synthetic Person');
    expect(JSON.stringify(masked)).not.toContain('person@example.com');
  });

  it('are nulled in the bodies of the routes that take them (P21)', () => {
    const masked = maskPersonalData({
      data: {
        attributes: {
          'trigger-payload': { name: 'Synthetic Person' },
          overrides: { step: { name: 'Synthetic Person' } },
          parameters: { name: 'Synthetic Person' },
          'object-ids': ['inq_1'],
          csv: 'id\ninq_1',
        },
      },
    });

    expect(masked).toEqual({
      data: {
        attributes: {
          'trigger-payload': null,
          overrides: null,
          parameters: null,
          'object-ids': null,
          csv: null,
        },
      },
    });
  });
});

describe('a sandbox message (C126.4, C143.5)', () => {
  const RECORD = {
    'message-ref': 'ref-1',
    'message-subject': 'Synthetic subject',
    'message-text': 'Hello Synthetic Person',
    'message-html': '<p>Hello Synthetic Person</p>',
  };

  it('is in the masked attributes', () => {
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining([...PII_SANDBOX_MESSAGE_ATTRIBUTES]));
  });

  it('is nulled by a route’s mask', () => {
    expect(piiMaskFor(viewer).attributes(RECORD)).toEqual({
      'message-ref': 'ref-1',
      'message-subject': null,
      'message-text': null,
      'message-html': null,
    });
  });

  it('is masked in a stored log, where a search answer holds it outside any attributes', () => {
    expect(maskPersonalData({ data: [RECORD] })).toEqual({
      data: [
        {
          'message-ref': 'ref-1',
          'message-subject': null,
          'message-text': null,
          'message-html': null,
        },
      ],
    });
  });

  it('never holds the address it was searched for in a stored log', () => {
    expect(maskPersonalData({ 'email-address': 'person@example.com' })).toEqual({
      'email-address': null,
    });
  });
});

describe('a workflow secret (C143.5)', () => {
  it('never reaches a stored log', () => {
    expect(API_LOG_REDACTED_KEYS).toContain('secret-value');
    expect(
      redactKeys({ data: { attributes: { 'secret-value': 'change-me-synthetic-canary' } } }),
    ).toEqual({ data: { attributes: { 'secret-value': '[REDACTED]' } } });
  });
});
