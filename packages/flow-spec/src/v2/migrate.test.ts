import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrationGolden } from './golden/migration-golden.js';
import { SYNTHETIC_V1_SOURCES, allV1Sources, type V1Source } from './golden/v1-sources.js';
import {
  MIGRATED_SUBMIT_LABEL_KEY,
  MIGRATION_NOTE_CODES,
  migrateFlow,
  migrateFlowWithNotes,
} from './migrate.js';
import {
  flowOutcome,
  nextPosition,
  resumeAt,
  type FlowStepRecordEntry,
  type NextPosition,
} from './next-position.js';
import { flowSchema } from '../flow.js';
import { flowV2Schema, type FlowV2 } from './schemas/flow.js';
import { testEvaluator } from './test-evaluator.js';
import { flowOf, consent, completion } from './test-flows.js';
import { isV1VerificationStep, v1Walk, type V1Outcome } from './test-v1-walk.js';

const GOLDEN = new URL('./golden/migrations/', import.meta.url);
const sources = allV1Sources();
const synthetic = (name: string): V1Source => {
  const found = SYNTHETIC_V1_SOURCES.find((source) => source.name === `synthetic-${name}`);
  if (found === undefined) throw new Error(name);
  return found;
};

describe('the migration goldens (C147.10)', () => {
  it('cover every stored v1 fixture, the flow-spec test fixture and the synthetic flows', () => {
    expect(sources.map(({ name }) => name).filter((name) => name.startsWith('fixture-'))).toEqual([
      'fixture-api-flow-session-declined',
      'fixture-api-flow-session-handed-off',
      'fixture-api-flow-session',
      'fixture-api-inquiry-template-version',
      'fixture-flows-default-gov-id-selfie',
    ]);
    expect(new Set(sources.map(({ name }) => name)).size).toBe(sources.length);
    // Each source migrates (the goldens are written from these), and each has its file.
    expect(sources.map(migrationGolden)).toHaveLength(sources.length);
    const files = readdirSync(GOLDEN).filter((file) => file.endsWith('.json'));
    expect(files.sort()).toEqual(sources.map(({ name }) => `${name}.json`).sort());
  });

  it.each(sources.map((source) => [source.name, source] as const))(
    '%s migrates to its committed golden, a valid v2 flow',
    (name, source) => {
      const golden = migrationGolden(source);
      expect(golden).toEqual(JSON.parse(readFileSync(new URL(`${name}.json`, GOLDEN), 'utf8')));
      expect(flowV2Schema.parse(golden.flow)).toEqual(golden.flow);
      for (const note of golden.notes) expect(MIGRATION_NOTE_CODES).toContain(note.code);
    },
  );
});

describe('migrateFlow: the rules (C147.10, review F07)', () => {
  it('returns a v2 flow as it is', () => {
    const v2 = flowOf([consent(), completion()], [['consent', 'next', 'done']]);
    expect(migrateFlow(v2)).toBe(v2);
    expect(migrateFlowWithNotes(v2)).toEqual({ flow: v2, notes: [] });
  });

  it('keeps every step id, starts at the first step and follows list order with next edges', () => {
    const { flow, notes } = migrateFlowWithNotes(synthetic('linear-no-terminal').flow);
    expect(flow.entry).toBe('consent');
    expect(flow.metadata).toEqual({
      specVersion: 2,
      id: 'linear-open',
      version: 1,
      name: 'Synthetic linear-open',
    });
    expect(flow.steps.map(({ id, type }) => [id, type])).toEqual([
      ['consent', 'consent'],
      ['id_card', 'government_id'],
      ['face', 'selfie'],
      ['completion', 'completion'],
    ]);
    expect(flow.steps.at(-1)).toEqual({ id: 'completion', type: 'completion' });
    expect(flow.edges).toEqual([
      { id: 'e1', from: 'consent', port: 'next', to: 'id_card' },
      { id: 'e2', from: 'id_card', port: 'next', to: 'face' },
      { id: 'e3', from: 'face', port: 'next', to: 'completion' },
    ]);
    expect(notes).toEqual([
      {
        pointer: '/steps/2',
        code: 'synthetic_completion',
        detail: 'v1 ends with completion after its last step; v2 names that completion step',
      },
    ]);
  });

  it('turns the conditional transitions before the first unconditional one into a branch', () => {
    const { flow, notes } = migrateFlowWithNotes(synthetic('routes-then-unconditional').flow);
    expect(flow.steps.find(({ id }) => id === 'id_card-routes')).toEqual({
      id: 'id_card-routes',
      type: 'branch',
      routes: [
        {
          key: 'r1',
          label: 'Transition 1',
          condition: { '==': [{ var: 'inquiry.status' }, 'failed'] },
          onNull: 'else',
        },
        {
          key: 'r2',
          label: 'Transition 2',
          condition: { '!=': [{ var: 'inquiry.status' }, 'pending'] },
          onNull: 'else',
        },
      ],
    });
    expect(flow.edges.filter(({ from }) => from.startsWith('id_card'))).toEqual([
      { id: 'e2', from: 'id_card', port: 'next', to: 'id_card-routes' },
      { id: 'e3', from: 'id_card-routes', port: 'route:r1', to: 'rejected' },
      { id: 'e4', from: 'id_card-routes', port: 'route:r2', to: 'proof' },
      { id: 'e5', from: 'id_card-routes', port: 'else', to: 'face' },
    ]);
    expect(notes).toEqual([
      {
        pointer: '/transitions/3',
        code: 'transition_dropped',
        detail: 'v1 takes the first unconditional transition, so this one was never reached',
      },
    ]);
  });

  it('sends a branch’s else to the next step in list order when no transition is unconditional', () => {
    const { flow } = migrateFlowWithNotes(synthetic('conditional-only').flow);
    expect(flow.edges).toContainEqual({
      id: 'e3',
      from: 'consent-routes',
      port: 'else',
      to: 'id_card',
    });
  });

  it('keeps inquiry.status, and folds every condition that reads no v1 fact to its v1 answer', () => {
    const { flow, notes } = migrateFlowWithNotes(synthetic('outside-context').flow);
    const conditions = Object.fromEntries(
      flow.steps.flatMap((step) =>
        step.type === 'branch' ? step.routes.map((r) => [`${step.id}/${r.key}`, r.condition]) : [],
      ),
    );
    expect(conditions).toEqual({
      'consent-routes/r1': { '!!': [false] },
      'consent-routes/r2': { '!!': [true] },
      'id_card-routes/r1': { '==': [{ var: 'inquiry.status' }, 'completed'] },
      'id_card-routes/r2': { '!!': [true] },
      'id_card-routes/r3': { '==': [{ var: 'inquiry.status' }, 1] },
      'id_card-routes/r4': { and: [{ '==': [{ var: 'inquiry.status' }, 'pending'] }, null] },
      'face-routes/r1': { '!!': [true] },
    });
    expect(notes.map(({ code, pointer }) => [code, pointer])).toEqual([
      ['path_outside_v1_context', '/transitions/0/condition/==/0/var'],
      ['condition_folded', '/transitions/0/condition'],
      ['path_outside_v1_context', '/transitions/1/condition/!/0/var'],
      ['condition_folded', '/transitions/1/condition'],
      ['var_default_dropped', '/transitions/2/condition/==/0/var'],
      ['path_outside_v1_context', '/transitions/3/condition/==/0/var'],
      ['condition_folded', '/transitions/3/condition'],
      ['loose_equality', '/transitions/4/condition/=='],
      ['path_outside_v1_context', '/transitions/5/condition/and/1/var'],
      ['null_operand', '/transitions/5/condition/and/1'],
      ['path_outside_v1_context', '/transitions/6/condition/!=/0/var'],
      ['condition_folded', '/transitions/6/condition'],
    ]);
  });

  it('turns a form into a screen with matching components, option keys and a submit button', () => {
    const { flow, notes } = migrateFlowWithNotes(synthetic('form-and-ids').flow);
    expect(flow.steps[0]).toEqual({
      id: 'details',
      type: 'screen',
      components: [
        {
          id: 'continue',
          field: 'continue',
          labelKey: 'form.nickname',
          required: true,
          kind: 'text_input',
          minLength: 2,
          maxLength: 20,
          pattern: '^(a+)+$',
        },
        {
          id: 'birthdate',
          field: 'birthdate',
          labelKey: 'form.birthdate',
          required: false,
          kind: 'date',
          max: '2010-01-01',
        },
        { id: 'email', field: 'email', labelKey: 'form.email', required: false, kind: 'email' },
        {
          id: 'phone',
          field: 'phone',
          labelKey: 'form.phone',
          required: false,
          kind: 'phone',
          allowedCountries: ['US'],
        },
        {
          id: 'occupation',
          field: 'occupation',
          labelKey: 'form.occupation',
          required: false,
          kind: 'select',
          options: [
            { key: 'o1', value: 'employed', labelKey: 'form.occupation.employed' },
            { key: 'o2', value: 'other', labelKey: 'form.occupation.other' },
          ],
        },
        {
          id: 'residence',
          field: 'residence',
          labelKey: 'form.residence',
          required: true,
          kind: 'country_select',
        },
        { id: 'continue_2', kind: 'button', labelKey: MIGRATED_SUBMIT_LABEL_KEY, action: 'submit' },
      ],
    });
    // `details-routes` is a v1 step's id already, so the branch takes the next suffix.
    expect(flow.steps.map(({ id }) => id)).toContain('details-routes-2');
    expect(notes.map(({ code, pointer }) => [code, pointer])).toEqual([
      ['form_to_screen', '/steps/0'],
      ['pattern_refused', '/steps/0/fields/0/validation/pattern'],
      ['consent_not_first', '/steps/0'],
      ['consent_not_first', '/steps/1'],
    ]);
  });

  it('notes an operator v1’s clients never ran and a var of v1’s whole context, folding neither', () => {
    const source = flowSchema.parse({
      metadata: { specVersion: 1, id: 'odd', version: 1, name: 'Odd' },
      steps: [
        { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
        { id: 'done', type: 'completion' },
      ],
      transitions: [
        { from: 'consent', to: 'done', condition: { '<': [{ var: 'inquiry.status' }, 'z'] } },
        { from: 'consent', to: 'done', condition: { '===': [{ var: '' }, { var: ['inquiry'] }] } },
        { from: 'consent', to: 'done', condition: { in: ['a', [{ var: 'x' }, 'a']] } },
      ],
    });
    const { flow, notes } = migrateFlowWithNotes(source);
    expect(flow.steps.find(({ type }) => type === 'branch')).toMatchObject({
      routes: [
        { condition: { '<': [{ var: 'inquiry.status' }, 'z'] } },
        { condition: { '===': [{ var: 'inquiry' }, { var: 'inquiry' }] } },
        { condition: { '!!': [true] } },
      ],
    });
    expect(notes.map(({ code, pointer }) => [code, pointer])).toEqual([
      ['operator_outside_v1', '/transitions/0/condition/<'],
      ['var_object_context', '/transitions/1/condition/===/0/var'],
      ['var_object_context', '/transitions/1/condition/===/1/var'],
      ['path_outside_v1_context', '/transitions/2/condition/in/1/0/var'],
      ['condition_folded', '/transitions/2/condition'],
    ]);
  });

  it('shortens a branch id past 64 characters with a hash suffix', () => {
    const { flow } = migrateFlowWithNotes(synthetic('long-id').flow);
    const branch = flow.steps.find(({ type }) => type === 'branch');
    expect(branch?.id).toMatch(/^id_x{53}-[0-9a-z]{7}$/);
    expect(branch?.id.length).toBeLessThanOrEqual(64);
  });
});

/** The migrated flow run as the server would, with the person finishing each step in turn. */
function v2Walk(flow: FlowV2, statuses: Readonly<Record<string, string>>) {
  const evaluate = testEvaluator();
  const scope = { inquiry: { status: 'pending' } };
  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const record: FlowStepRecordEntry[] = [];
  const outcomes: Record<string, string> = {};
  const path: string[] = [];
  const visits: Record<string, number> = {};
  let position: NextPosition = resumeAt(flow, scope, flow.entry, evaluate);
  for (;;) {
    for (const route of position.taken) {
      record.push({
        stepId: route.branchId,
        stepType: 'branch',
        exitPort: route.port,
        notes: route.notes,
      });
    }
    if (position.kind !== 'step') break;
    const step = steps.get(position.stepId);
    if (step === undefined) break;
    path.push(step.id);
    visits[step.id] = (visits[step.id] ?? 0) + 1;
    const status = statuses[step.id] ?? 'passed';
    if (step.type in V2_VERIFICATION) outcomes[step.id] = status;
    if (step.type in V2_VERIFICATION && status === 'failed') {
      // A migrated flow has no exhausted edge: the inquiry fails here (C50.5, C151.3).
      record.push({ stepId: step.id, stepType: step.type, exitPort: null, notes: [] });
      break;
    }
    record.push({ stepId: step.id, stepType: step.type, exitPort: 'next', notes: [] });
    position = nextPosition(flow, scope, step.id, 'next', evaluate, { visits });
  }
  if (position.kind === 'terminal') {
    record.push({
      stepId: position.stepId,
      stepType: position.terminal,
      exitPort: null,
      notes: [],
    });
  }
  const status = flowOutcome(record, outcomes, []).status;
  const outcome: V1Outcome =
    position.kind === 'halted' || status === 'pending' ? 'stopped' : status;
  return { path, outcome };
}

const V2_VERIFICATION: Readonly<Record<string, true>> = Object.freeze({
  government_id: true,
  selfie: true,
  document: true,
  phone_otp: true,
  email_otp: true,
  database: true,
  aamva: true,
  nfc: true,
  crypto_wallet: true,
  database_business: true,
  business_website: true,
});

describe('the equivalence test (C151.3, review F07): the v1 rules and the migrated v2 engine agree', () => {
  it.each(sources.map((source) => [source.name, source] as const))('%s', (_name, source) => {
    const migrated = migrateFlow(source.flow);
    const verifications = source.flow.steps.filter(isV1VerificationStep).map(({ id }) => id);
    const scenarios: Record<string, string>[] = [{}];
    for (const id of verifications) {
      for (const status of ['failed', 'needs_review', 'skipped']) scenarios.push({ [id]: status });
    }
    for (const scenario of scenarios) {
      expect(v2Walk(migrated, scenario), JSON.stringify(scenario)).toEqual(
        v1Walk(source.flow, scenario),
      );
    }
  });

  it('includes branching fixtures and one reading a path outside v1’s context', () => {
    const branching = sources.filter(({ flow }) =>
      flow.transitions.some(({ condition }) => condition !== undefined),
    );
    expect(branching.length).toBeGreaterThanOrEqual(6);
    expect(
      sources.some(({ flow }) => JSON.stringify(flow.transitions).includes('"var":"platform"')),
    ).toBe(true);
  });
});
