/** The catalogue of C122.2 as data: a row's grant, delivery and flags are this table's. */
import { describe, expect, it } from 'vitest';
import { createWorkflowActionEntries } from './catalogue.js';
import {
  ACTION_OBJECT_TYPE_ENTRIES,
  ActionRegistryError,
  WORKFLOW_ACTION_KEYS,
  createActionObjectTypeTable,
  createActionRegistry,
  type ActionObjectTypeEntry,
  type WorkflowActionKey,
} from './registry.js';

const table = createActionObjectTypeTable(ACTION_OBJECT_TYPE_ENTRIES);
const entries = createWorkflowActionEntries(table);
const registry = createActionRegistry(entries);
const entryOf = (key: WorkflowActionKey) => {
  const found = registry.latest(key);
  if (found === undefined) {
    throw new Error(`no ${key}`);
  }
  return found as unknown as {
    grant: (config: object) => { scopes: readonly string[]; pii: boolean };
    delivery: string;
    adverse: string;
    adverseRule: string | null;
    stage: string;
    availability: string;
    biometric: boolean;
    irreversible: boolean;
    causeChecked: boolean;
    kind: string;
    requires: readonly string[];
    emits: readonly string[];
    retry: { allowed: boolean };
    grantDependsOnConfig: boolean;
    config: { safeParse: (value: unknown) => { success: boolean } };
  };
};

describe('the 8A catalogue (C122.2)', () => {
  it('registers every key, at version 1', () => {
    expect(
      registry
        .list()
        .map(({ key }) => key)
        .sort(),
    ).toEqual([...WORKFLOW_ACTION_KEYS].sort());
    expect(registry.list().every(({ version }) => version === 1)).toBe(true);
  });

  it.each([
    ['approve_inquiry', ['inquiries:write'], false, 'exactly-once'],
    ['decline_inquiry', ['inquiries:write'], false, 'exactly-once'],
    ['mark_inquiry_for_review', ['inquiries:write'], false, 'exactly-once'],
    [
      'send_inquiry_link_email',
      ['inquiries:write', 'inquiry-sessions:write'],
      false,
      'at-most-once',
    ],
    ['send_inquiry_link_sms', ['inquiries:write', 'inquiry-sessions:write'], false, 'at-most-once'],
    ['run_verification', ['inquiries:write'], false, 'exactly-once'],
    ['get_list_match', ['lists:read'], true, 'pure'],
    ['add_list_item', ['lists:write'], true, 'exactly-once'],
    ['add_face_list_item', ['lists:write'], true, 'exactly-once'],
    ['sync_graph', ['graph:read'], false, 'pure'],
    ['find_or_create_account', ['accounts:write'], false, 'exactly-once'],
    ['create_transaction', ['transactions:write'], false, 'exactly-once'],
    ['update_transaction_status', ['transactions:write'], false, 'exactly-once'],
    ['trust_device', ['devices:write'], false, 'exactly-once'],
    ['evaluate_code', [], false, 'pure'],
    ['calculate', [], false, 'control'],
    ['update_variable', [], false, 'control'],
    ['run_workflow', ['workflows:trigger'], false, 'exactly-once'],
    ['schedule_workflow', ['workflows:trigger'], false, 'exactly-once'],
  ] as const)('%s needs %j (pii %s), %s', (key, scopes, pii, delivery) => {
    const entry = entryOf(key);
    expect(entry.grant({})).toEqual({ scopes, pii });
    expect(entry.delivery).toBe(delivery);
  });

  it('fails closed on a graph query: a parameter kind is not known from the step (C121.2)', () => {
    expect(entryOf('run_graph_query').grant({})).toEqual({ scopes: ['graph:write'], pii: true });
  });

  it('adds the scope that links an object (C122.2)', () => {
    expect(entryOf('create_inquiry').grant({}).scopes).toEqual(['inquiries:write']);
    expect(entryOf('create_inquiry').grant({ 'account-id': '{{ a }}' }).scopes).toEqual([
      'inquiries:write',
      'accounts:read',
    ]);
    expect(entryOf('run_report').grant({ 'inquiry-id': '{{ i }}' }).scopes).toEqual([
      'reports:write',
      'inquiries:read',
    ]);
    expect(entryOf('run_report').grant({ 'account-id': '{{ a }}' }).scopes).toEqual([
      'reports:write',
      'accounts:read',
    ]);
    expect(entryOf('rerun_report').grant({}).scopes).toEqual(['reports:write']);
  });

  it('takes the scope of the object type on the generic actions', () => {
    const on = (type: string) => ({ 'object-type': type });
    expect(entryOf('tag_object').grant(on('transaction')).scopes).toEqual(['transactions:write']);
    expect(entryOf('remove_tag').grant(on('account')).scopes).toEqual(['accounts:write']);
    expect(entryOf('fetch_object').grant(on('report'))).toEqual({
      scopes: ['reports:read'],
      pii: true,
    });
    expect(entryOf('update_object').grant(on('inquiry')).scopes).toEqual(['inquiries:write']);
    expect(entryOf('redact_object').grant(on('transaction')).scopes).toEqual([
      'transactions:redact',
    ]);
    expect(entryOf('set_relation').grant(on('account')).scopes).toEqual(['accounts:write']);
    expect(entryOf('unset_relation').grant(on('transaction')).scopes).toEqual([
      'transactions:write',
    ]);
    expect(
      entryOf('copy_tags').grant({ 'from-object-type': 'report', 'object-type': 'account' }).scopes,
    ).toEqual(['reports:read', 'accounts:write']);
  });

  it('refuses a config with a type the table does not hold, and one no run may write', () => {
    expect(
      entryOf('tag_object').config.safeParse({
        'object-type': 'case',
        'object-id': '{{ c }}',
        tag: 'x',
      }).success,
    ).toBe(false);
    expect(
      entryOf('tag_object').config.safeParse({
        'object-type': 'verification',
        'object-id': '{{ v }}',
        tag: 'x',
      }).success,
    ).toBe(false);
    expect(
      entryOf('redact_object').config.safeParse({
        'object-type': 'verification',
        'object-id': '{{ v }}',
      }).success,
    ).toBe(false);
    expect(() => entryOf('tag_object').grant({ 'object-type': 'verification' })).toThrow(
      ActionRegistryError,
    );
  });

  it('takes a row Workflow 8B passes, with no edit here (F33)', () => {
    const caseRow: ActionObjectTypeEntry = {
      type: 'case',
      idPrefix: 'case',
      readScope: 'accounts:read',
      writeScope: 'accounts:write',
      redactScope: 'accounts:redact',
      tags: true,
      writableAttributes: ['fields'],
    };
    const extended = createWorkflowActionEntries(
      createActionObjectTypeTable([...ACTION_OBJECT_TYPE_ENTRIES, caseRow]),
    );
    const tag = extended.find(({ key }) => key === 'tag_object') as unknown as {
      config: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(
      tag.config.safeParse({ 'object-type': 'case', 'object-id': '{{ c }}', tag: 'x' }).success,
    ).toBe(true);
  });

  it('runs only the interpreter steps with no claim (C117.3, C127.5)', () => {
    const control = registry
      .list()
      .filter(({ kind }) => kind === 'control')
      .map(({ key }) => key)
      .sort();
    expect(control).toEqual(['calculate', 'update_variable']);
    expect(entryOf('sync_graph').kind).toBe('internal');
  });

  it('flags every adverse step as C122.1 does', () => {
    expect(entryOf('decline_inquiry').adverse).toBe('always');
    expect(entryOf('approve_inquiry').adverse).toBe('never');
    expect(entryOf('add_list_item')).toMatchObject({
      adverse: 'by-config',
      adverseRule: 'list-purpose',
    });
    expect(entryOf('add_face_list_item')).toMatchObject({
      adverse: 'by-config',
      adverseRule: 'list-purpose',
      biometric: true,
    });
    expect(entryOf('update_transaction_status')).toMatchObject({
      adverse: 'by-config',
      adverseRule: 'transaction-adverse-status',
    });
    expect(entryOf('update_object')).toMatchObject({
      adverse: 'by-config',
      adverseRule: 'account-archive',
    });
  });

  it('stages H-tier readers beta and nothing else (H10)', () => {
    const beta = registry
      .list()
      .filter(({ stage }) => stage === 'beta')
      .map(({ key }) => key)
      .sort();
    expect(beta).toEqual(['get_list_match', 'run_report']);
  });

  it('checks the causing principal on a decision and a redaction (C121.3)', () => {
    for (const key of ['approve_inquiry', 'decline_inquiry', 'redact_object'] as const) {
      expect(entryOf(key).causeChecked, key).toBe(true);
    }
    expect(entryOf('fetch_object').causeChecked).toBe(false);
  });

  it('needs an acknowledgement to redact, and places a face list step (C116.4, C122.3)', () => {
    expect(entryOf('redact_object').irreversible).toBe(true);
    expect(entryOf('add_face_list_item').requires).toEqual(['inquiry-in-scope', 'not-in-loop']);
  });

  it('binds an adapter where one is needed (C122.5)', () => {
    expect(entryOf('send_inquiry_link_email').availability).toBe('mailer');
    expect(entryOf('send_inquiry_link_sms').availability).toBe('sms');
    expect(entryOf('evaluate_code').availability).toBe('code-runner');
  });

  it('retries only what can be retried (C117.6)', () => {
    expect(entryOf('decline_inquiry').retry.allowed).toBe(false);
    expect(entryOf('evaluate_code').retry.allowed).toBe(true);
    expect(entryOf('send_inquiry_link_email').retry.allowed).toBe(true);
  });

  it('names what each step can emit, so a graph that feeds itself is warned about (C118.8)', () => {
    expect(entryOf('decline_inquiry').emits).toEqual(
      expect.arrayContaining(['inquiry.declined', 'inquiry.transitioned']),
    );
    expect(entryOf('add_list_item').emits).toEqual(['list.updated']);
    expect(entryOf('create_transaction').emits).toEqual(['transaction.created']);
    expect(entryOf('calculate').emits).toEqual([]);
  });
});
