/**
 * Workflow 7B (G) (C102.4, C102.6, C107.5, P07, P17): the graph PII joins both masking sets. A
 * query's `params` is masked member-wise, keeping each parameter's name; a body's `parameter-map`
 * and `variable-map` and an unmasked node value are masked whole. A node's `value` in `nodes[]` is a
 * random id local to the result, so masking stays at the attribute level and leaves it. Every value
 * is synthetic.
 */
import { PII_GRAPH_ATTRIBUTES, graphQueryAttributesSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { maskPersonalData } from '../services/api-logs.js';
import type { UserPrincipal } from '../ports.js';
import { canViewPii, MASKED_ATTRIBUTES, piiMaskFor, UNMASKED } from './pii.js';

const masked: UserPrincipal = {
  kind: 'user',
  userId: 'usr_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  permissions: new Set(),
} as unknown as UserPrincipal;

const ACCOUNT = 'acc_01M5CK16P0D13FXHZSS4TCFBVH';
const NODE = 'gn_AbCdEfGhIjKlMnOpQrStUv';

const ATTRIBUTES = {
  status: 'completed',
  params: { email: 'synthetic@example.com', account_id: ACCOUNT },
  'created-at': '2026-11-01T00:00:00.000Z',
  'updated-at': '2026-11-01T00:00:00.000Z',
  'errored-at': null,
  'completed-at': '2026-11-01T00:00:01.000Z',
  'redacted-at': null,
  stats: {},
  'explorer-url': 'https://console.example.com/graph/grphq_01M5CK16P0D13FXHZSS4TCFBVH',
  'node-limit-reached': false,
  nodes: [
    { type: 'account', value: ACCOUNT },
    { type: 'email_address', value: NODE },
  ],
  'index-complete': true,
  'kinds-not-indexed': [],
  'skipped-hub-values': 0,
  'template-version-id': 'grqtv_01M5CK16P0D13FXHZSS4TCFBVH',
  links: [{ from: ACCOUNT, to: NODE, kind: 'email_address' }],
};

describe('the graph PII in MASKED_ATTRIBUTES (C102.4, C107.5)', () => {
  it('joins every graph name', () => {
    expect(canViewPii(masked)).toBe(false);
    for (const name of PII_GRAPH_ATTRIBUTES) {
      expect(MASKED_ATTRIBUTES, name).toContain(name);
    }
  });

  it('masks params member-wise, keeping each name, and the result still parses', () => {
    const attributes = piiMaskFor(masked).attributes(ATTRIBUTES);

    expect(attributes.params).toEqual({ email: null, account_id: null });
    expect(graphQueryAttributesSchema.parse(attributes)).toMatchObject({ status: 'completed' });
  });

  it('leaves the nodes and links, which hold ids local to the result (P17)', () => {
    const attributes = piiMaskFor(masked).attributes(ATTRIBUTES);

    expect(attributes.nodes).toEqual(ATTRIBUTES.nodes);
    expect(attributes.links).toEqual(ATTRIBUTES.links);
  });

  it('shows everything to a principal who may see it', () => {
    expect(UNMASKED.attributes(ATTRIBUTES).params).toEqual(ATTRIBUTES.params);
  });
});

describe('the graph PII in the API-log masked set (C102.4, C102.6, C107.5, P07)', () => {
  it('masks a query body’s parameter-map and its deprecated variable-map', () => {
    for (const name of ['parameter-map', 'variable-map']) {
      expect(
        maskPersonalData({
          data: {
            attributes: {
              'graph-query-template-id': 'grqt_01M5CK16P0D13FXHZSS4TCFBVH',
              [name]: { email: 'synthetic@example.com' },
            },
          },
        }),
      ).toEqual({
        data: {
          attributes: {
            'graph-query-template-id': 'grqt_01M5CK16P0D13FXHZSS4TCFBVH',
            [name]: null,
          },
        },
      });
    }
  });

  it('masks a stored answer’s params member-wise and keeps its nodes', () => {
    const stored = maskPersonalData({
      data: { type: 'graph-query', id: 'grphq_01M5CK16P0D13FXHZSS4TCFBVH', attributes: ATTRIBUTES },
    }) as { data: { attributes: typeof ATTRIBUTES } };

    expect(stored.data.attributes.params).toEqual({ email: null, account_id: null });
    expect(stored.data.attributes.nodes).toEqual(ATTRIBUTES.nodes);
    expect(JSON.stringify(stored)).not.toContain('synthetic@example.com');
  });

  it('masks the audited unmask’s plaintext value (C102.6)', () => {
    expect(
      maskPersonalData({
        data: {
          type: 'graph-node-value',
          id: NODE,
          attributes: { kind: 'email_address', value: 'synthetic@example.com' },
        },
      }),
    ).toEqual({
      data: {
        type: 'graph-node-value',
        id: NODE,
        attributes: { kind: 'email_address', value: null },
      },
    });
  });
});
