import { REPORT_TYPES, WORKFLOW_TRIGGER_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ACTION_ADAPTERS,
  ACTION_ADVERSE,
  ACTION_ADVERSE_RULES,
  ACTION_DELIVERIES,
  ACTION_KEYS,
  ACTION_KINDS,
  ACTION_OBJECT_TYPES,
  ACTION_OBJECT_TYPE_ENTRIES,
  ACTION_REPORT_TYPE_TABLE,
  ACTION_REQUIREMENTS,
  ACTION_STAGES,
  ActionRegistryError,
  GENERIC_ACTION_KEYS,
  RESERVED_CASE_ACTION_KEYS,
  VERIFICATION_RUNNABLE_WITHOUT_CAPTURE,
  WORKFLOW_ACTION_KEYS,
  actionKeySchema,
  actionOutputMarks,
  createActionObjectTypeTable,
  createActionRegistry,
  type ActionObjectTypeEntry,
  type AnyActionRegistryEntry,
} from './registry.js';

const entry = (overrides: Partial<AnyActionRegistryEntry> = {}): AnyActionRegistryEntry => ({
  key: 'approve_inquiry',
  version: 1,
  kind: 'internal',
  config: z.strictObject({ 'inquiry-id': z.string() }) as never,
  output: z.strictObject({ outcome: z.string().meta({ pii: false }) }),
  grant: () => ({ scopes: ['inquiries:write'], pii: false }),
  grantDependsOnConfig: false,
  emits: ['inquiry.approved'],
  delivery: 'exactly-once',
  retry: { allowed: false, defaultIntervalsSeconds: [] },
  availability: 'none',
  triggers: null,
  requires: [],
  adverse: 'never',
  adverseRule: null,
  biometric: false,
  irreversible: false,
  causeChecked: true,
  stage: 'ga',
  ...overrides,
});

describe('the vocabulary (C122.1)', () => {
  it('re-exports the lists the entries take', () => {
    expect(ACTION_KINDS).toContain('compute');
    expect(ACTION_DELIVERIES).toContain('control');
    expect(ACTION_ADVERSE).toEqual(['always', 'by-config', 'never']);
    expect(ACTION_STAGES).toEqual(['ga', 'beta']);
    expect(ACTION_ADAPTERS).toEqual(['none', 'mailer', 'sms', 'slack', 'code-runner']);
    expect(ACTION_REQUIREMENTS).toEqual(['inquiry-in-scope', 'not-in-loop']);
    expect(ACTION_ADVERSE_RULES).toEqual([
      'list-purpose',
      'transaction-adverse-status',
      'account-archive',
    ]);
  });
});

describe('the keys (C122.2)', () => {
  it('names every 8A action of the catalogue once, with 8D’s re-screen step', () => {
    expect(WORKFLOW_ACTION_KEYS).toHaveLength(36);
    expect(new Set(WORKFLOW_ACTION_KEYS).size).toBe(36);
    expect(WORKFLOW_ACTION_KEYS).toEqual(
      expect.arrayContaining([
        'run_report',
        'rerun_report',
        'rescreen_account_reports',
        'get_list_match',
        'add_face_list_item',
        'sync_graph',
        'trust_device',
        'evaluate_code',
        'make_https_request',
        'send_slack_message',
      ]),
    );
  });

  it('reserves the eight case actions for Workflow 8B, apart from 8A', () => {
    expect(RESERVED_CASE_ACTION_KEYS).toEqual([
      'create_case',
      'assign_case',
      'update_case_status',
      'add_case_comment',
      'add_case_to_queue',
      'attach_objects_to_case',
      'set_case_sla',
      'clear_case_sla',
    ]);
    const eightA: readonly string[] = WORKFLOW_ACTION_KEYS;
    for (const key of RESERVED_CASE_ACTION_KEYS) {
      expect(eightA).not.toContain(key);
      expect(actionKeySchema.safeParse(key).success).toBe(true);
    }
    // Workflow 11A (C243.1): the three Connect keys are reserved too.
    expect(ACTION_KEYS).toHaveLength(47);
  });

  it('refuses a key off the catalogue, the actions decision 27 leaves out among them', () => {
    expect(actionKeySchema.safeParse('transliterate_fields').success).toBe(false);
  });

  it('lists the generic actions of C122.1', () => {
    expect(GENERIC_ACTION_KEYS).toEqual([
      'tag_object',
      'remove_tag',
      'copy_tags',
      'fetch_object',
      'update_object',
      'redact_object',
    ]);
  });
});

describe('the output marks (C120.6)', () => {
  it('reads each top-level member', () => {
    const output = z.strictObject({
      status: z.string().meta({ pii: false }),
      value: z.json().meta({ pii: true }),
    });
    expect(actionOutputMarks('a', output)).toEqual({ status: false, value: true });
  });

  it('refuses a member with no mark, so a new action cannot leak by omission', () => {
    expect(() => actionOutputMarks('a', z.strictObject({ value: z.string() }))).toThrow(
      ActionRegistryError,
    );
  });

  it('names the member, and never a value', () => {
    expect(() => actionOutputMarks('a', z.strictObject({ value: z.string() }))).toThrow(
      'The output member value of a has no PII mark',
    );
  });

  it('refuses an output that is no object', () => {
    expect(() => actionOutputMarks('a', z.string())).toThrow(ActionRegistryError);
  });

  it('reads every variant of a union, and a member PII in one is PII in all', () => {
    const output = z.union([
      z.strictObject({ value: z.string().meta({ pii: false }) }),
      z.strictObject({
        value: z.string().meta({ pii: true }),
        code: z.string().meta({ pii: false }),
      }),
    ]);
    expect(actionOutputMarks('a', output)).toEqual({ value: true, code: false });
  });

  it('fails closed in either order of the variants', () => {
    const output = z.union([
      z.strictObject({ value: z.string().meta({ pii: true }) }),
      z.strictObject({ value: z.string().meta({ pii: false }) }),
    ]);
    expect(actionOutputMarks('a', output)).toEqual({ value: true });
  });
});

describe('the registry (C122.1)', () => {
  it('finds a version, and the latest of a key', () => {
    const first = entry();
    const second = entry({ version: 2 });
    const registry = createActionRegistry([second, first]);
    expect(registry.get('approve_inquiry', 1)).toBe(first);
    expect(registry.get('approve_inquiry', 2)).toBe(second);
    expect(registry.latest('approve_inquiry')).toBe(second);
  });

  it('answers undefined for what it does not hold, which publish refuses', () => {
    const registry = createActionRegistry([entry()]);
    expect(registry.get('approve_inquiry', 2)).toBeUndefined();
    expect(registry.get('custom_function', 1)).toBeUndefined();
    expect(registry.latest('custom_function')).toBeUndefined();
  });

  it('keeps old versions listed, by key then version', () => {
    const registry = createActionRegistry([
      entry({ key: 'b_action', version: 2 }),
      entry({ key: 'b_action' }),
      entry({ key: 'a_action' }),
    ]);
    expect(
      registry.list().map((item: { key: string; version: number }) => [item.key, item.version]),
    ).toEqual([
      ['a_action', 1],
      ['b_action', 1],
      ['b_action', 2],
    ]);
  });

  it('takes Workflow 8B entries beside these, with no change here (F33)', () => {
    const registry = createActionRegistry([entry(), entry({ key: 'create_case' })]);
    expect(registry.latest('create_case')?.key).toBe('create_case');
  });

  it('cannot be changed through what it lists', () => {
    const registry = createActionRegistry([entry()]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it.each([
    ['a key that is not snake_case', { key: 'Approve' }],
    ['a version below 1', { version: 0 }],
    ['a fractional version', { version: 1.5 }],
    ['by-config with no rule', { adverse: 'by-config' as const }],
    ['a rule on an action that is not by-config', { adverseRule: 'list-purpose' as const }],
    ['a biometric action that is not adverse', { biometric: true }],
    ['an egress action that claims exactly once', { kind: 'egress' as const }],
    [
      'default intervals on an action that cannot retry',
      { retry: { allowed: false, defaultIntervalsSeconds: [5] } },
    ],
    ['an interval past an hour', { retry: { allowed: true, defaultIntervalsSeconds: [3601] } }],
    [
      'more than ten intervals',
      { retry: { allowed: true, defaultIntervalsSeconds: Array.from({ length: 11 }, () => 1) } },
    ],
    ['an output with an unmarked member', { output: z.strictObject({ value: z.string() }) }],
  ])('refuses %s', (_name, overrides) => {
    expect(() => createActionRegistry([entry(overrides)])).toThrow(ActionRegistryError);
  });

  it('refuses a key and version given twice', () => {
    expect(() => createActionRegistry([entry(), entry()])).toThrow('registered twice');
  });

  it('takes a by-config action with its rule, and a biometric one', () => {
    const adverse = entry({
      key: 'add_face_list_item',
      adverse: 'always',
      biometric: true,
      requires: ['inquiry-in-scope', 'not-in-loop'],
    });
    const byConfig = entry({
      key: 'add_list_item',
      adverse: 'by-config',
      adverseRule: 'list-purpose',
    });
    expect(createActionRegistry([adverse, byConfig]).list()).toHaveLength(2);
  });

  it('derives a grant from a config, which is API scopes and a flag (C121.2)', () => {
    const registry = createActionRegistry([
      entry({
        grant: (config: never) => ({
          scopes: ['graph:write'],
          pii: (config as { kind: string }).kind === 'email-address',
        }),
        grantDependsOnConfig: true,
      }),
    ]);
    const found = registry.get('approve_inquiry', 1);
    expect(found?.grant({ kind: 'email-address' } as never)).toEqual({
      scopes: ['graph:write'],
      pii: true,
    });
  });

  it('serves every trigger type with null, or the ones it names (C122.3)', () => {
    expect(entry().triggers).toBeNull();
    expect(WORKFLOW_TRIGGER_TYPES).toContain('trigger-event');
  });
});

describe('the object types (C122.1, F33)', () => {
  const table = createActionObjectTypeTable(ACTION_OBJECT_TYPE_ENTRIES);

  it('fills inquiries, accounts, reports, transactions and verifications', () => {
    expect(ACTION_OBJECT_TYPES).toEqual([
      'inquiry',
      'account',
      'report',
      'transaction',
      'verification',
    ]);
    expect(table.list().map((row: { type: string }) => row.type)).toEqual([...ACTION_OBJECT_TYPES]);
  });

  it('gives each type the scope of its own service', () => {
    expect(table.get('inquiry')).toMatchObject({
      readScope: 'inquiries:read',
      writeScope: 'inquiries:write',
      redactScope: 'inquiries:redact',
    });
    expect(table.get('report')?.redactScope).toBe('reports:redact');
    expect(table.get('transaction')?.writeScope).toBe('transactions:write');
  });

  it('holds a verification to a read: it has no tags and no redaction of its own', () => {
    expect(table.get('verification')).toMatchObject({
      readScope: 'verifications:read',
      writeScope: null,
      redactScope: null,
      tags: false,
    });
  });

  it('keeps a report and a verification out of update_object', () => {
    expect(table.get('report')?.writableAttributes).toEqual([]);
    expect(table.get('verification')?.writableAttributes).toEqual([]);
  });

  it('finds a type from an id', () => {
    expect(table.ofId('inq_01M5CJXHG07XPHF3HRM6NREDH7')?.type).toBe('inquiry');
    expect(table.ofId('txn_01M5CJXHG07XPHF3HRM6NREDH7')?.type).toBe('transaction');
    expect(table.ofId('wfl_01M5CJXHG07XPHF3HRM6NREDH7')).toBeUndefined();
    expect(table.ofId('no-underscore')).toBeUndefined();
  });

  it('takes the case row of Workflow 8B beside them (F33)', () => {
    const row: ActionObjectTypeEntry = {
      type: 'case',
      idPrefix: 'case',
      readScope: 'inquiries:read',
      writeScope: null,
      redactScope: null,
      tags: true,
      writableAttributes: [],
    };
    const extended = createActionObjectTypeTable([...ACTION_OBJECT_TYPE_ENTRIES, row]);
    expect(extended.get('case')).toBe(row);
    expect(extended.ofId('case_01M5CJXHG07XPHF3HRM6NREDH7')).toBe(row);
    expect(table.get('case')).toBeUndefined();
  });

  it('refuses a type or a prefix given twice', () => {
    const first: ActionObjectTypeEntry = {
      type: 'inquiry',
      idPrefix: 'inq',
      readScope: 'inquiries:read',
      writeScope: null,
      redactScope: null,
      tags: false,
      writableAttributes: [],
    };
    expect(() => createActionObjectTypeTable([first, first])).toThrow(ActionRegistryError);
    expect(() => createActionObjectTypeTable([first, { ...first, type: 'other' }])).toThrow(
      ActionRegistryError,
    );
  });
});

describe('the report types (C127.2, outcomes 14 and 15)', () => {
  it('holds every report type, ip-address and custom-list among them', () => {
    expect(Object.keys(ACTION_REPORT_TYPE_TABLE).sort()).toEqual([...REPORT_TYPES].sort());
    expect(ACTION_REPORT_TYPE_TABLE['custom-list']).toMatchObject({
      review: 'matches',
      hasMatch: true,
      heuristic: true,
    });
  });

  it('gives has-match no meaning on a type without review, whose own flag answers', () => {
    expect(ACTION_REPORT_TYPE_TABLE['ip-address']).toMatchObject({
      review: 'none',
      hasMatch: false,
      flag: 'flagged',
    });
    expect(ACTION_REPORT_TYPE_TABLE.watchlist.flag).toBeNull();
  });

  it('marks a type with H-tier results, which a decision must acknowledge (H10)', () => {
    expect(ACTION_REPORT_TYPE_TABLE.watchlist.heuristic).toBe(true);
  });

  it('gives a none-review type an answer of its own, or says it has none', () => {
    const rows: readonly { type: string; review: string; hasMatch: boolean }[] =
      Object.values(ACTION_REPORT_TYPE_TABLE);
    for (const row of rows) {
      expect(row.hasMatch, row.type).toBe(row.review === 'matches');
    }
  });
});

describe('run_verification (Stage 1a amendment 8)', () => {
  it('runs the four types that need no capture', () => {
    expect(VERIFICATION_RUNNABLE_WITHOUT_CAPTURE).toEqual([
      'database',
      'aamva',
      'database_business',
      'business_website',
    ]);
  });
});
