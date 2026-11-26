import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eventAttributesSchema } from './events.js';
import {
  ACCOUNT_GRAPH_COMPONENT_STATES,
  accountGraphComponentResourceSchema,
  PII_GRAPH_ATTRIBUTES,
  buildGraphQueryResource,
  buildGraphQueryTemplateResource,
  buildGraphQueryTemplateVersionResource,
  createGraphQueryBodySchema,
  graphNodeIdSchema,
  graphNodeSchema,
  graphQueryActionBodySchema,
  graphQueryActionResultDocumentSchema,
  graphQueryTemplateConfigSchema,
  graphTemplateConfigProblems,
  resolveGraphQueryTemplateConfig,
  type GraphQueryRecord,
  type GraphQueryTemplateConfig,
} from './graph-queries.js';

const AT = new Date('2026-10-31T12:00:00.000Z');
const TEMPLATE = 'grqt_01M5CK3190XEVBM5ZXA76E1JSN';
const VERSION = 'grqtv_01M5CK3190XEVBM5ZXA76E1JSN';
const QUERY = 'grphq_01M5CK3190XEVBM5ZXA76E1JSN';
const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const NODE = 'gn_0123456789abcdefghijkl';

const refused = (schema: z.ZodType, value: unknown) => !schema.safeParse(value).success;

const config: GraphQueryTemplateConfig = {
  parameters: [{ name: 'email', kind: 'email_address' }],
  start: [{ kind: 'email_address', value: '{{email}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
};

const query: GraphQueryRecord = {
  id: QUERY,
  status: 'completed',
  params: { email: 'linked@example.test' },
  createdAt: AT,
  updatedAt: AT,
  erroredAt: null,
  completedAt: AT,
  redactedAt: null,
  explorerUrl: `https://console.example.test/graph/${QUERY}`,
  nodeLimitReached: false,
  nodes: [
    { type: 'account', value: ACCOUNT },
    { type: 'email_address', value: NODE },
  ],
  links: [{ from: ACCOUNT, to: NODE, kind: 'email_address' }],
  kindsNotIndexed: [],
  skippedHubValues: 0,
  templateVersionId: VERSION,
  accountIds: [ACCOUNT],
};

describe('the template config (C102.2)', () => {
  it('takes the plan shape, strictly', () => {
    expect(graphQueryTemplateConfigSchema.safeParse(config).success).toBe(true);
    expect(refused(graphQueryTemplateConfigSchema, { ...config, sql: 'select 1' })).toBe(true);
    expect(refused(graphQueryTemplateConfigSchema, { ...config, start: [] })).toBe(true);
    expect(refused(graphQueryTemplateConfigSchema, { ...config, 'max-hops': 3 })).toBe(true);
    expect(refused(graphQueryTemplateConfigSchema, { ...config, 'node-limit': 2001 })).toBe(true);
    expect(
      refused(graphQueryTemplateConfigSchema, {
        ...config,
        'connect-kinds': ['email_address', 'email_address'],
      }),
    ).toBe(true);
  });

  it('takes only {{param}} values: nothing a caller writes is interpreted', () => {
    expect(
      refused(graphQueryTemplateConfigSchema, {
        ...config,
        start: [{ kind: 'email_address', value: 'x@example.test' }],
      }),
    ).toBe(true);
    expect(
      refused(graphQueryTemplateConfigSchema, {
        ...config,
        parameters: [{ name: 'a-b', kind: 'email_address' }],
      }),
    ).toBe(true);
  });

  it('binds the account in context', () => {
    expect(
      graphQueryTemplateConfigSchema.safeParse({
        ...config,
        parameters: [{ name: 'account_id', kind: 'account_id' }],
        start: [{ kind: 'account_id', value: '{{account_id}}' }],
      }).success,
    ).toBe(true);
  });

  it('resolves its defaults', () => {
    expect(resolveGraphQueryTemplateConfig(config)).toMatchObject({
      'max-hops': 4,
      'node-limit': 100,
      'include-weak-kinds': false,
    });
  });

  it('refuses a weak kind without the flag, and the flag above 4 hops (C102.2, decision 34)', () => {
    const weak = { ...config, 'connect-kinds': ['email_address', 'ip_address'] } as const;
    expect(
      graphTemplateConfigProblems({ ...weak, 'connect-kinds': [...weak['connect-kinds']] }),
    ).toEqual([{ code: 'weak_kind_not_allowed', pointer: '/connect-kinds/1' }]);
    expect(
      graphTemplateConfigProblems({
        ...weak,
        'connect-kinds': [...weak['connect-kinds']],
        'include-weak-kinds': true,
      }),
    ).toEqual([]);
    expect(
      graphTemplateConfigProblems({
        ...weak,
        'connect-kinds': [...weak['connect-kinds']],
        'include-weak-kinds': true,
        'max-hops': 6,
      }),
    ).toEqual([{ code: 'weak_kind_not_allowed', pointer: '/max-hops' }]);
  });

  it('refuses an unbound parameter, in the start and the created-at window', () => {
    expect(
      graphTemplateConfigProblems({
        ...config,
        start: [{ kind: 'email_address', value: '{{other}}' }],
        filters: { 'created-at-start': '{{since}}', 'created-at-end': '{{until}}' },
      }),
    ).toEqual([
      { code: 'graph_parameter_unbound', pointer: '/start/0/value' },
      { code: 'graph_parameter_unbound', pointer: '/filters/created-at-start' },
      { code: 'graph_parameter_unbound', pointer: '/filters/created-at-end' },
    ]);
    expect(graphTemplateConfigProblems(config)).toEqual([]);
  });
});

describe('templates and versions (C102.1)', () => {
  it('builds a template', () => {
    expect(
      buildGraphQueryTemplateResource({
        id: TEMPLATE,
        name: 'Synthetic',
        status: 'active',
        latestVersion: 2,
        publishedVersion: 1,
        publishedVersionId: VERSION,
        createdAt: AT,
        updatedAt: AT,
      }).relationships['published-version'].data,
    ).toEqual({ type: 'graph-query-template-version', id: VERSION });
  });

  it('builds a version with its defaults, published exactly when it is no longer a draft', () => {
    const version = {
      id: VERSION,
      templateId: TEMPLATE,
      versionNumber: 1,
      status: 'published',
      config,
      createdAt: AT,
      publishedAt: AT,
    } as const;
    expect(buildGraphQueryTemplateVersionResource(version).attributes.config['max-hops']).toBe(4);
    expect(() =>
      buildGraphQueryTemplateVersionResource({ ...version, publishedAt: null }),
    ).toThrow();
  });
});

describe('an account’s component (C101.6, K7B-2)', () => {
  const component = (attributes: Record<string, unknown>) => ({
    type: 'account-graph-component',
    id: 'acc_01M5CJXHG0N6J5J4VQH5M3S1N8',
    attributes,
  });

  it('names its state, with a size and a time only when computed', () => {
    const at = '2026-10-20T03:00:00.000Z';
    const parses = (attributes: Record<string, unknown>) =>
      accountGraphComponentResourceSchema.safeParse(component(attributes)).success;

    expect(ACCOUNT_GRAPH_COMPONENT_STATES).toEqual(['computed', 'not-computed', 'disabled']);
    expect(parses({ state: 'computed', size: 4, 'computed-at': at })).toBe(true);
    expect(parses({ state: 'not-computed', size: null, 'computed-at': null })).toBe(true);
    expect(parses({ state: 'disabled', size: null, 'computed-at': null })).toBe(true);
    expect(parses({ state: 'computed', size: null, 'computed-at': null })).toBe(false);
    expect(parses({ state: 'disabled', size: 4, 'computed-at': at })).toBe(false);
    expect(parses({ state: 'computed', size: 4, 'computed-at': null })).toBe(false);
    expect(parses({ state: 'computed', size: 4, 'computed-at': at, 'component-id': 'c1' })).toBe(
      false,
    );
  });
});

describe('explorer-url (K7B-11)', () => {
  it('is null without a configured console, never a guess', () => {
    const { attributes } = buildGraphQueryResource({ ...query, explorerUrl: null });

    expect(attributes['explorer-url']).toBeNull();
  });
});

describe('graph queries (C102.4)', () => {
  it('builds the public attributes, ours, and the accounts relationship', () => {
    expect(buildGraphQueryResource(query)).toMatchObject({
      type: 'graph-query',
      id: QUERY,
      attributes: {
        status: 'completed',
        stats: {},
        'node-limit-reached': false,
        'index-complete': true,
        'kinds-not-indexed': [],
        'skipped-hub-values': 0,
        'template-version-id': VERSION,
      },
      relationships: { accounts: { data: [{ type: 'account', id: ACCOUNT }] } },
    });
  });

  it('says index-complete false whenever a kind is not indexed (H10)', () => {
    expect(
      buildGraphQueryResource({ ...query, kindsNotIndexed: ['device_fingerprint'] }).attributes[
        'index-complete'
      ],
    ).toBe(false);
  });

  it('never carries a value or a key in a property node (P17)', () => {
    expect(graphNodeIdSchema.safeParse(NODE).success).toBe(true);
    expect(refused(graphNodeIdSchema, 'linked@example.test')).toBe(true);
    expect(refused(graphNodeIdSchema, 'a'.repeat(64))).toBe(true);
    expect(refused(graphNodeSchema, { type: 'email_address', value: ACCOUNT })).toBe(true);
    expect(refused(graphNodeSchema, { type: 'account', value: NODE })).toBe(true);
  });

  it('empties nodes, links and params once redacted (C102.7)', () => {
    const redacted = { ...query, redactedAt: AT, params: null, nodes: [], links: [] };
    expect(buildGraphQueryResource(redacted).attributes.nodes).toEqual([]);
    expect(() => buildGraphQueryResource({ ...redacted, nodes: query.nodes })).toThrow();
    expect(() => buildGraphQueryResource({ ...redacted, params: {} })).toThrow();
  });

  it('says when it completed or errored', () => {
    expect(() => buildGraphQueryResource({ ...query, completedAt: null })).toThrow();
    expect(() =>
      buildGraphQueryResource({ ...query, status: 'errored', completedAt: null }),
    ).toThrow();
    expect(
      buildGraphQueryResource({ ...query, status: 'timed_out', completedAt: null }).attributes
        .status,
    ).toBe('timed_out');
  });

  it('takes parameter-map, or its deprecated name, never both or neither', () => {
    const body = (attributes: Record<string, unknown>) => ({
      data: { attributes: { 'graph-query-template-id': TEMPLATE, ...attributes } },
    });
    expect(
      createGraphQueryBodySchema.safeParse(body({ 'parameter-map': { email: 'x' } })).success,
    ).toBe(true);
    expect(
      createGraphQueryBodySchema.safeParse(body({ 'variable-map': { email: 'x' } })).success,
    ).toBe(true);
    expect(refused(createGraphQueryBodySchema, body({}))).toBe(true);
    expect(
      refused(createGraphQueryBodySchema, body({ 'parameter-map': {}, 'variable-map': {} })),
    ).toBe(true);
  });

  it('caps the timeout at 59 s, and takes run-sync (C102.4)', () => {
    const body = (seconds: number) => ({
      data: {
        attributes: {
          'graph-query-template-id': TEMPLATE,
          'parameter-map': {},
          'timeout-in-seconds': seconds,
        },
      },
      meta: { 'run-sync': true },
    });
    expect(createGraphQueryBodySchema.safeParse(body(59)).success).toBe(true);
    expect(refused(createGraphQueryBodySchema, body(60))).toBe(true);
    expect(refused(createGraphQueryBodySchema, body(0))).toBe(true);
  });

  it('marks the parameters and the unmasked value PII (C107.5, P07)', () => {
    expect(PII_GRAPH_ATTRIBUTES).toEqual(['params', 'parameter-map', 'variable-map', 'value']);
  });
});

describe('bulk actions (C103)', () => {
  const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

  it('selects by ids or all, never both or neither', () => {
    const add = { action: 'add-tag', tag: 'synthetic' };
    expect(
      graphQueryActionBodySchema.safeParse(body({ ...add, 'account-ids': [ACCOUNT] })).success,
    ).toBe(true);
    expect(graphQueryActionBodySchema.safeParse(body({ ...add, all: true })).success).toBe(true);
    expect(refused(graphQueryActionBodySchema, body(add))).toBe(true);
    expect(
      refused(graphQueryActionBodySchema, body({ ...add, all: true, 'account-ids': [ACCOUNT] })),
    ).toBe(true);
  });

  it('caps a selection at 500 distinct accounts', () => {
    const ids = Array.from(
      { length: 501 },
      (_, index) => `acc_01M5CK3190XEVBM5ZXA76E${String(1000 + index)}`,
    );
    expect(
      refused(graphQueryActionBodySchema, body({ action: 'export', 'account-ids': ids })),
    ).toBe(true);
    expect(
      refused(
        graphQueryActionBodySchema,
        body({ action: 'export', 'account-ids': [ACCOUNT, ACCOUNT] }),
      ),
    ).toBe(true);
  });

  it('takes the members of each action, strictly', () => {
    const list = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
    expect(
      graphQueryActionBodySchema.safeParse(
        body({ action: 'add-to-list', all: true, 'list-id': list, kind: 'email_address' }),
      ).success,
    ).toBe(true);
    expect(
      graphQueryActionBodySchema.safeParse(
        body({ action: 'set-account-status', all: true, status: 'archived' }),
      ).success,
    ).toBe(true);
    expect(
      refused(
        graphQueryActionBodySchema,
        body({ action: 'set-account-status', all: true, status: 'deleted' }),
      ),
    ).toBe(true);
    expect(refused(graphQueryActionBodySchema, body({ action: 'create-case', all: true }))).toBe(
      true,
    );
  });

  it('creates one case holding the selection, on a template (C140.6)', () => {
    const template = 'ctmpl_01M5CN00000000000000000002';
    expect(
      graphQueryActionBodySchema.safeParse(
        body({ action: 'create-case', all: true, 'case-template-id': template }),
      ).success,
    ).toBe(true);
    expect(
      graphQueryActionBodySchema.safeParse(
        body({
          action: 'create-case',
          'account-ids': [ACCOUNT],
          'case-template-id': template,
          'case-queue-id': 'cqueue_01M5CN00000000000000000005',
        }),
      ).success,
    ).toBe(true);
    const answer = (caseId: string | null) => ({
      data: {
        type: 'graph-query-action',
        attributes: {
          action: 'create-case',
          preview: false,
          'selected-count': 1,
          outcomes: [{ 'account-id': ACCOUNT, outcome: 'done' }],
          'case-id': caseId,
        },
      },
    });
    expect(
      graphQueryActionResultDocumentSchema.safeParse(answer('case_01M5CN00000000000000000001'))
        .success,
    ).toBe(true);
    expect(graphQueryActionResultDocumentSchema.safeParse(answer(null)).success).toBe(true);
    expect(refused(graphQueryActionResultDocumentSchema, answer(ACCOUNT))).toBe(true);
  });

  it('answers per-account outcomes from the closed set', () => {
    const result = (outcome: string) => ({
      data: {
        type: 'graph-query-action',
        attributes: {
          action: 'add-tag',
          preview: false,
          'selected-count': 1,
          outcomes: [{ 'account-id': ACCOUNT, outcome }],
        },
      },
    });
    expect(graphQueryActionResultDocumentSchema.safeParse(result('done')).success).toBe(true);
    expect(refused(graphQueryActionResultDocumentSchema, result('failed'))).toBe(true);
  });
});

describe('the graph-query events (C102.5, C107.5)', () => {
  const event = (data: unknown) => ({
    name: 'graph-query.completed',
    payload: { data },
    'created-at': '2026-10-31T12:00:00.000Z',
  });

  it('carry neither parameters nor nodes', () => {
    expect(
      eventAttributesSchema.safeParse(
        event(buildGraphQueryResource({ ...query, params: null, nodes: [], links: [] })),
      ).success,
    ).toBe(true);
    expect(refused(eventAttributesSchema, event(buildGraphQueryResource(query)))).toBe(true);
    expect(
      refused(eventAttributesSchema, event(buildGraphQueryResource({ ...query, params: null }))),
    ).toBe(true);
  });
});
