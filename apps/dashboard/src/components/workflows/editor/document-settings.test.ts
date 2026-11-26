import { describe, expect, it } from 'vitest';
import {
  emptyDefinition,
  insertStep,
  moveRoute,
  removeRoute,
  setDeclarations,
  setTrigger,
  updateRoute,
  updateStep,
  updateTrigger,
  type DraftDefinition,
  type DraftStep,
} from './document-model';

const base = (): DraftDefinition => setTrigger(emptyDefinition(), 'trigger-api').definition;

const withConditional = (): DraftDefinition => ({
  ...base(),
  steps: [
    {
      id: 'decide',
      name: 'Decide',
      type: 'conditional',
      routes: [
        { key: 'high', label: 'High' },
        { key: 'low', label: 'Low' },
      ],
    },
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'decide' },
    { id: 'e1', from: 'decide', 'from-port': 'route:high', to: 'output' },
    { id: 'e2', from: 'decide', 'from-port': 'route:low', to: 'output' },
    { id: 'e3', from: 'decide', 'from-port': 'else', to: 'output' },
  ],
});

const step = (definition: DraftDefinition, id: string): DraftStep | undefined =>
  definition.steps.find((candidate) => candidate.id === id);

describe('updateStep (C141.4): a step form’s change, one member at a time', () => {
  const withAction = (): DraftDefinition =>
    insertStep(
      base(),
      { from: 'trigger', port: 'next' },
      { kind: 'action', key: 'tag_object', version: 1 },
    )?.definition ?? base();

  it('sets and removes members, keeping the rest', () => {
    const edited = updateStep(withAction(), 'tag_object', {
      config: { tag: 'review' },
      'continue-on-error': true,
    });
    const cleared =
      edited === null
        ? null
        : updateStep(edited.definition, 'tag_object', { 'continue-on-error': undefined });

    expect(edited?.select).toBe('tag_object');
    expect(step(edited?.definition ?? base(), 'tag_object')).toMatchObject({
      config: { tag: 'review' },
      'continue-on-error': true,
      'action-key': 'tag_object',
    });
    expect(step(cleared?.definition ?? base(), 'tag_object')).not.toHaveProperty(
      'continue-on-error',
    );
  });

  it('never changes a step’s id or type, and refuses a step that does not exist', () => {
    expect(updateStep(withAction(), 'tag_object', { id: 'other' })).toBeNull();
    expect(updateStep(withAction(), 'tag_object', { type: 'wait' })).toBeNull();
    expect(updateStep(withAction(), 'missing', { name: 'x' })).toBeNull();
  });
});

describe('routes (C113.2, C114.6): a conditional’s ordered routes', () => {
  it('sets a route’s condition and on-null, and removes a member set to undefined', () => {
    const condition = { '>': [{ var: 'vars.risk' }, 3] };
    const edited = updateRoute(withConditional(), 'decide', 'high', {
      condition,
      'on-null': 'skip-route',
    });
    const cleared =
      edited === null
        ? null
        : updateRoute(edited.definition, 'decide', 'high', {
            condition: undefined,
            'on-null': undefined,
          });

    expect(step(edited?.definition ?? base(), 'decide')?.routes).toEqual([
      { key: 'high', label: 'High', condition, 'on-null': 'skip-route' },
      { key: 'low', label: 'Low' },
    ]);
    expect(step(cleared?.definition ?? base(), 'decide')?.routes).toEqual([
      { key: 'high', label: 'High' },
      { key: 'low', label: 'Low' },
    ]);
    expect(updateRoute(withConditional(), 'decide', 'none', { label: 'x' })).toBeNull();
    expect(updateRoute(withConditional(), 'decide', 'high', { key: 'other' })).toBeNull();
  });

  it('moves a route up or down the order, which is the order they are tried in', () => {
    const moved = moveRoute(withConditional(), 'decide', 'low', 'up');

    expect(
      (step(moved?.definition ?? base(), 'decide')?.routes as { key: string }[]).map(
        ({ key }) => key,
      ),
    ).toEqual(['low', 'high']);
    expect(moveRoute(withConditional(), 'decide', 'high', 'up')).toBeNull();
    expect(moveRoute(withConditional(), 'decide', 'low', 'down')).toBeNull();
  });

  it('removes a route with its edge, and keeps the last one', () => {
    const removed = removeRoute(withConditional(), 'decide', 'high');

    expect(step(removed?.definition ?? base(), 'decide')?.routes).toEqual([
      { key: 'low', label: 'Low' },
    ]);
    expect(removed?.definition.edges.map((edge) => edge.id)).toEqual(['e0', 'e2', 'e3']);
    expect(removed === null ? null : removeRoute(removed.definition, 'decide', 'low')).toBeNull();
  });
});

describe('updateTrigger and setDeclarations (C118, C141.9)', () => {
  it('changes the trigger’s config and options, removing a member set to undefined', () => {
    const event = setTrigger(emptyDefinition(), 'trigger-event').definition;
    const edited = updateTrigger(
      event,
      { 'one-run-per-subject': true },
      { events: ['inquiry.failed'], criteria: undefined },
    );

    expect(edited?.definition.trigger).toEqual({
      type: 'trigger-event',
      config: { events: ['inquiry.failed'] },
      'one-run-per-subject': true,
    });
    expect(updateTrigger(emptyDefinition(), {}, {})).toBeNull();
    expect(updateTrigger(event, { type: 'trigger-api' }, {})).toBeNull();
  });

  it('replaces the inputs, variables or outputs whole', () => {
    const inputs = [{ name: 'email', type: 'string pii', required: true }];

    expect(setDeclarations(base(), 'inputs', inputs).definition.inputs).toEqual(inputs);
    expect(setDeclarations(base(), 'outputs', []).select).toBe('trigger');
  });
});

describe('a decision template from the palette (C128.5, decision 51)', () => {
  it('adds its review-first steps where the place was, leading on to where the place led', () => {
    const edited = insertStep(
      base(),
      { from: 'trigger', port: 'next' },
      {
        kind: 'decision-template',
        key: 'review-completed-inquiry',
      },
    );
    const ids = edited?.definition.steps.map((candidate) => candidate.id) ?? [];

    expect(ids).toEqual([
      'output',
      'mark_review',
      'open_case',
      'review_case',
      'read_case',
      'decide',
      'approve',
      'decline',
    ]);
    expect(edited?.select).toBe('mark_review');
    const into = edited?.definition.edges
      .filter((edge) => edge.to === 'output')
      .map((edge) => edge.from);
    expect(into?.sort()).toEqual(['approve', 'decide', 'decline']);
    expect(edited?.definition.edges.find((edge) => edge.from === 'trigger')?.to).toBe(
      'mark_review',
    );
  });

  it('gives a step a free id when its own is taken, and every reference follows it', () => {
    const taken: DraftDefinition = {
      ...base(),
      steps: [
        { id: 'read_case', name: 'Mine', type: 'wait', mode: 'time', seconds: 60 },
        { id: 'output', name: 'Output', type: 'output', mappings: {} },
      ],
      edges: [
        { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'read_case' },
        { id: 'e1', from: 'read_case', 'from-port': 'next', to: 'output' },
      ],
    };
    const edited = insertStep(
      taken,
      { from: 'read_case', port: 'next' },
      {
        kind: 'decision-template',
        key: 'review-completed-inquiry',
      },
    );
    const decide = step(edited?.definition ?? base(), 'decide');

    expect(step(edited?.definition ?? base(), 'read_case_2')).toMatchObject({
      'action-key': 'fetch_object',
    });
    expect(JSON.stringify(decide)).toContain('steps.read_case_2.output.object.resolution');
    expect(JSON.stringify(decide)).not.toContain('steps.read_case.output');
    expect(step(edited?.definition ?? base(), 'read_case')).toMatchObject({ name: 'Mine' });
  });
});
