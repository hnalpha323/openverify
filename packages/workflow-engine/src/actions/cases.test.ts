import { describe, expect, it } from 'vitest';
import { createActionSinkTable, ACTION_SINK_ROWS } from '../templates/sinks.js';
import {
  CASE_ACTION_CONTRACTS,
  CASE_ACTION_OBJECT_TYPE_ENTRY,
  CASE_ACTION_SINK_ROWS,
  CASE_SLA_UNITS,
  addCaseCommentConfigSchema,
  assignCaseConfigSchema,
  assignCaseOutputSchema,
  attachObjectsToCaseConfigSchema,
  clearCaseSlaConfigSchema,
  createCaseActionEntries,
  createCaseConfigSchema,
  createCaseOutputSchema,
  setCaseSlaConfigSchema,
  updateCaseStatusConfigSchema,
  updateCaseStatusOutputSchema,
} from './cases.js';
import { createWorkflowActionEntries } from './catalogue.js';
import {
  ACTION_OBJECT_TYPE_ENTRIES,
  RESERVED_CASE_ACTION_KEYS,
  actionOutputMarks,
  createActionObjectTypeTable,
  createActionRegistry,
} from './registry.js';

const CASE = '{{ steps.open.output.case-id }}';

describe('the case action contracts (C140.3, C122.2)', () => {
  it('holds a contract for each reserved key, and no other', () => {
    expect(Object.keys(CASE_ACTION_CONTRACTS).sort()).toEqual(
      [...RESERVED_CASE_ACTION_KEYS].sort(),
    );
  });

  it('marks every output member PII or not, as C120.6 needs', () => {
    for (const [key, { output }] of Object.entries(CASE_ACTION_CONTRACTS)) {
      expect(Object.values(actionOutputMarks(key, output))).not.toContain(true);
    }
  });

  it("joins 8A's catalogue with its case row, each key once (F33)", () => {
    const table = createActionObjectTypeTable([
      ...ACTION_OBJECT_TYPE_ENTRIES,
      CASE_ACTION_OBJECT_TYPE_ENTRY,
    ]);
    const registry = createActionRegistry([
      ...createWorkflowActionEntries(table),
      ...createCaseActionEntries(),
    ]);
    for (const key of RESERVED_CASE_ACTION_KEYS) {
      expect(registry.latest(key)?.version, key).toBe(1);
    }
    expect(table.ofId('case_01M5CN00000000000000000001')?.type).toBe('case');
    expect(registry.get('tag_object', 1)?.grant({ 'object-type': 'case' } as never)).toEqual({
      scopes: ['cases:write'],
      pii: false,
    });
    expect(registry.get('redact_object', 1)?.grant({ 'object-type': 'case' } as never)).toEqual({
      scopes: ['cases:redact'],
      pii: false,
    });
  });

  it('is exactly once, internal, never adverse, and asks cases:assign only to assign (C122.2)', () => {
    for (const entry of createCaseActionEntries()) {
      expect(entry.kind, entry.key).toBe('internal');
      expect(entry.delivery, entry.key).toBe('exactly-once');
      expect(entry.adverse, entry.key).toBe('never');
      // C143.3 (H30): create_case defers past case-create; the other steps never retry.
      expect(entry.retry, entry.key).toEqual(
        entry.key === 'create_case'
          ? { allowed: true, defaultIntervalsSeconds: [60, 300, 900] }
          : { allowed: false, defaultIntervalsSeconds: [] },
      );
      expect(entry.grant({} as never), entry.key).toEqual({
        scopes: [entry.key === 'assign_case' ? 'cases:assign' : 'cases:write'],
        pii: false,
      });
    }
  });

  it('says what each emits, for the warning that a graph emits its own trigger (C118.8)', () => {
    const emits = Object.fromEntries(
      createCaseActionEntries().map(({ key, emits: names }) => [key, names]),
    );
    expect(emits.create_case).toContain('case.created');
    expect(emits.update_case_status).toEqual([
      'case.status-updated',
      'case.resolved',
      'case.reopened',
    ]);
    expect(emits.add_case_comment).toEqual(['case-comment.created']);
  });
});

describe('create_case', () => {
  const fits = (config: Record<string, unknown>) =>
    createCaseConfigSchema.safeParse({ 'case-template-id': 'ctmpl_x', ...config }).success;

  it('takes a template, fields, tags, a queue, what it holds and an SLA', () => {
    expect(
      fits({
        fields: { summary: '{{ trigger.fields.summary }}' },
        tags: ['manual-review'],
        'case-queue-id': 'cqueue_x',
        'object-ids': ['{{ trigger.id }}', '{{ steps.run_report.output.report-id }}'],
        sla: { value: 4, unit: 'hours' },
      }),
    ).toBe(true);
  });

  it("has no name member: a case's name is generated (Stage 1a amendment 8)", () => {
    expect(fits({ name: 'KYC-6' })).toBe(false);
    expect(fits({ status: 'open' })).toBe(false);
  });

  it('refuses an SLA unit it does not know, and more tags or objects than a case holds', () => {
    expect(CASE_SLA_UNITS).toEqual(['minutes', 'hours', 'days']);
    expect(fits({ sla: { value: 4, unit: 'weeks' } })).toBe(false);
    expect(fits({ tags: Array.from({ length: 51 }, () => 'a') })).toBe(false);
    expect(fits({ 'object-ids': Array.from({ length: 1001 }, () => CASE) })).toBe(false);
  });

  it('answers the case it made, and refuses another id', () => {
    const output = {
      'case-id': 'case_01M5CN00000000000000000001',
      name: 'KYC-6',
      status: 'open',
      outcome: 'applied',
    };
    expect(createCaseOutputSchema.safeParse(output).success).toBe(true);
    expect(createCaseOutputSchema.safeParse({ ...output, 'case-id': 'inq_x' }).success).toBe(false);
    expect(createCaseOutputSchema.safeParse({ ...output, fields: {} }).success).toBe(false);
  });
});

describe('assign_case', () => {
  it('names a user or a policy, one of them (C140.3)', () => {
    const fits = (config: Record<string, unknown>) =>
      assignCaseConfigSchema.safeParse({ 'case-id': CASE, ...config }).success;
    expect(fits({ 'user-id': 'usr_x' })).toBe(true);
    expect(fits({ 'assignment-policy-id': 'cap_x' })).toBe(true);
    expect(fits({ 'user-id': 'usr_x', 'assignment-policy-id': 'cap_x' })).toBe(false);
    expect(fits({})).toBe(false);
  });

  it('answers null when a policy found nobody eligible', () => {
    expect(
      assignCaseOutputSchema.safeParse({
        'case-id': 'case_01M5CN00000000000000000001',
        'assignee-id': null,
        outcome: 'no_change',
      }).success,
    ).toBe(true);
  });
});

describe('update_case_status', () => {
  it('takes a status, and what a status can ask for (C131.1)', () => {
    expect(
      updateCaseStatusConfigSchema.safeParse({
        'case-id': CASE,
        status: 'declined',
        resolution: 'Declined',
        comment: 'Synthetic',
        'status-tag': 'fraud',
      }).success,
    ).toBe(true);
    expect(updateCaseStatusConfigSchema.safeParse({ 'case-id': CASE }).success).toBe(false);
  });

  it('answers the status and its category, and a null resolution before an end status', () => {
    expect(
      updateCaseStatusOutputSchema.safeParse({
        'case-id': 'case_01M5CN00000000000000000001',
        status: 'pending',
        'status-category': 'intermediate',
        resolution: null,
        outcome: 'applied',
      }).success,
    ).toBe(true);
  });
});

describe('the other steps', () => {
  it('takes a message of its own for a comment', () => {
    expect(addCaseCommentConfigSchema.safeParse({ 'case-id': CASE, message: 'x' }).success).toBe(
      true,
    );
    expect(addCaseCommentConfigSchema.safeParse({ 'case-id': CASE }).success).toBe(false);
  });

  it('attaches at least one object', () => {
    expect(
      attachObjectsToCaseConfigSchema.safeParse({ 'case-id': CASE, 'object-ids': [] }).success,
    ).toBe(false);
  });

  it('sets an SLA with a number or a template, and clears it with nothing else', () => {
    const set = (value: unknown) =>
      setCaseSlaConfigSchema.safeParse({ 'case-id': CASE, sla: { value, unit: 'days' } }).success;
    expect(set(3)).toBe(true);
    expect(set('{{ vars.days }}')).toBe(true);
    expect(set(0)).toBe(false);
    expect(clearCaseSlaConfigSchema.safeParse({ 'case-id': CASE }).success).toBe(true);
    expect(clearCaseSlaConfigSchema.safeParse({ 'case-id': CASE, sla: {} }).success).toBe(false);
  });
});

describe("the case rows of 8A's tables (F33)", () => {
  it('reads a case by its prefix, with its own scopes and writable attributes', () => {
    expect(CASE_ACTION_OBJECT_TYPE_ENTRY).toEqual({
      type: 'case',
      idPrefix: 'case',
      readScope: 'cases:read',
      writeScope: 'cases:write',
      redactScope: 'cases:redact',
      tags: true,
      writableAttributes: ['fields', 'case-queue-id'],
    });
  });

  it('keeps PII out of a status, a resolution, a status tag and a tag (C115.6)', () => {
    const sinks = createActionSinkTable([...ACTION_SINK_ROWS, ...CASE_ACTION_SINK_ROWS]);
    expect(sinks.sinkOf('create_case', '/tags/0').plain).toBe(true);
    expect(sinks.sinkOf('update_case_status', '/status').plain).toBe(true);
    expect(sinks.sinkOf('update_case_status', '/resolution').plain).toBe(true);
    expect(sinks.sinkOf('update_case_status', '/status-tag').plain).toBe(true);
  });

  it('lets a comment and a case field carry PII, as a copy the effect row records (C120.9)', () => {
    const sinks = createActionSinkTable([...ACTION_SINK_ROWS, ...CASE_ACTION_SINK_ROWS]);
    expect(sinks.sinkOf('add_case_comment', '/message').plain).toBe(false);
    expect(sinks.sinkOf('update_case_status', '/comment').plain).toBe(false);
    expect(sinks.sinkOf('create_case', '/fields/summary').plain).toBe(false);
  });
});
