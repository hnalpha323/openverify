/** C128.2, C140.2, F33: what counts as a person taking part, as data, decided from what happened. */
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../expressions/json.js';
import { HUMAN_STEP_ENTRIES, createHumanStepTable, humanStepOf } from './human-steps.js';

const table = createHumanStepTable(HUMAN_STEP_ENTRIES);

const resolved = {
  'resolved-by': 'event',
  'event-name': 'case.resolved',
  'event-id': 'evt_01M5CM00000000000000000020',
  'resolver-type': 'user',
  'resolver-id': 'usr_01M5CM00000000000000000021',
  'resolved-via': 'single',
  'resolver-held-inquiries-write': true,
};

describe('the human-step entry table (C140.2, F33)', () => {
  it('holds the rule for case.resolved as data', () => {
    expect(table.entryFor('case.resolved')).toEqual({
      kind: 'case-resolution',
      event: 'case.resolved',
      resolverType: 'user',
      resolvedVia: 'single',
      heldScopeMember: 'resolver-held-inquiries-write',
    });
  });

  it('knows no other event', () => {
    expect(table.entryFor('inquiry.approved')).toBeUndefined();
    expect(table.entryFor('constructor')).toBeUndefined();
  });

  it('lets Workflow 8B pass its own rows', () => {
    const extended = createHumanStepTable([
      ...HUMAN_STEP_ENTRIES,
      {
        ...HUMAN_STEP_ENTRIES[0],
        kind: 'other',
        event: 'case.other',
      } as (typeof HUMAN_STEP_ENTRIES)[number],
    ]);
    expect(extended.list()).toHaveLength(2);
  });

  it('refuses one event given twice', () => {
    expect(() => createHumanStepTable([...HUMAN_STEP_ENTRIES, ...HUMAN_STEP_ENTRIES])).toThrow(
      TypeError,
    );
  });
});

describe('solely automated, decided at run time (C128.2: the golden cases)', () => {
  it('a single resolution by a user who held inquiries:write is a human step', () => {
    expect(humanStepOf(table, resolved)).toEqual({
      kind: 'case-resolution',
      'actor-id': 'usr_01M5CM00000000000000000021',
      'event-id': 'evt_01M5CM00000000000000000020',
      'resolved-via': 'single',
    });
  });

  it.each<[string, JsonValue]>([
    ['a timeout', { ...resolved, 'resolved-by': 'timeout' }],
    ['a resolution by an API key', { ...resolved, 'resolver-type': 'api-key' }],
    ['a resolution by a run', { ...resolved, 'resolver-type': 'workflow-run' }],
    ['a bulk resolution', { ...resolved, 'resolved-via': 'bulk' }],
    ['a user without inquiries:write', { ...resolved, 'resolver-held-inquiries-write': false }],
    ['a user whose scope is unknown', { ...resolved, 'resolver-held-inquiries-write': null }],
    ['an event no entry names', { ...resolved, 'event-name': 'inquiry.approved' }],
    ['a wait with no resolver', { 'resolved-by': 'event', 'event-name': 'case.resolved' }],
    ['no event id', { ...resolved, 'event-id': null }],
    ['the output of a step that failed', null],
    ['something that is no output', 'event'],
  ])('%s is no human step', (_label, output) => {
    expect(humanStepOf(table, output)).toBeNull();
  });
});
