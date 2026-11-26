import { describe, expect, it } from 'vitest';
import {
  addBranch,
  canDelete,
  canMove,
  connectPort,
  deleteStep,
  emptyDefinition,
  insertionPlaceOf,
  insertStep,
  moveStep,
  placeNode,
  readDraft,
  renameStep,
  replaceLayout,
  serialise,
  setTrigger,
  type DraftDefinition,
} from './document-model';

const chainOf = (definition: DraftDefinition) =>
  definition.edges.map((edge) => `${edge.from} ${edge['from-port']} ${edge.to}`);

/** trigger -> first -> second -> output, both actions. */
function linear(): DraftDefinition {
  const action = (id: string) => ({
    id,
    name: id,
    type: 'action',
    'action-key': 'calculate',
    'action-version': 1,
    config: {},
  });
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-api', config: {} },
    inputs: [],
    variables: [{ name: 'kept', type: 'number' }],
    steps: [
      action('first'),
      action('second'),
      { id: 'output', name: 'Output', type: 'output', mappings: {} },
    ],
    edges: [
      { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'first' },
      { id: 'e2', from: 'first', 'from-port': 'next', to: 'second' },
      { id: 'e3', from: 'second', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: { first: { x: 0, y: 100 } },
  };
}

describe('reading a definition the editor can edit (C113.1)', () => {
  it('reads a definition with its members, and keeps the ones it does not edit', () => {
    const read = readDraft(linear());
    expect(read?.steps.map((step) => step.id)).toEqual(['first', 'second', 'output']);
    expect(read?.variables).toEqual([{ name: 'kept', type: 'number' }]);
  });

  it('fills a missing layout, and refuses what it cannot edit safely', () => {
    const withoutLayout = Object.fromEntries(
      Object.entries(linear()).filter(([member]) => member !== 'layout'),
    );
    expect(readDraft(withoutLayout)?.layout).toEqual({});
    expect(readDraft(null)).toBeNull();
    expect(readDraft([])).toBeNull();
    expect(readDraft({ ...linear(), steps: 'no' })).toBeNull();
    expect(readDraft({ ...linear(), steps: [{ id: 3, type: 'action' }] })).toBeNull();
    expect(readDraft({ ...linear(), edges: [{ id: 'e', from: 'a' }] })).toBeNull();
    expect(readDraft({ ...linear(), trigger: { type: 4 } })).toBeNull();
    expect(readDraft({ ...linear(), layout: [] })).toBeNull();
  });

  it('starts an empty definition with the output node a draft needs, and no trigger', () => {
    const empty = emptyDefinition();
    expect(empty.trigger).toBeNull();
    expect(empty.steps).toEqual([{ id: 'output', name: 'Output', type: 'output', mappings: {} }]);
    expect(empty.edges).toEqual([]);
    expect(JSON.parse(serialise(empty))).toEqual(empty);
  });
});

describe('setting the trigger (C118)', () => {
  it('sets a trigger with the config its type needs and connects it to the output', () => {
    const { definition, select } = setTrigger(emptyDefinition(), 'trigger-api');
    expect(definition.trigger).toEqual({ type: 'trigger-api', config: {} });
    expect(chainOf(definition)).toEqual(['trigger next output']);
    expect(select).toBe('trigger');
  });

  it('gives each trigger type a config its schema accepts, keeping the per-workflow options', () => {
    const kept = {
      ...linear(),
      trigger: { type: 'trigger-api', config: {}, 'one-run-per-subject': true },
    };
    expect(setTrigger(kept, 'trigger-event').definition.trigger).toEqual({
      type: 'trigger-event',
      config: { events: ['inquiry.completed'] },
      'one-run-per-subject': true,
    });
    expect(setTrigger(kept, 'trigger-recurring').definition.trigger?.config).toEqual({
      'every-minutes': 60,
      'time-zone': 'UTC',
      'object-type': 'inquiry',
    });
    expect(setTrigger(kept, 'trigger-direct').definition.trigger?.config).toEqual({
      'object-type': 'inquiry',
    });
    expect(setTrigger(kept, 'trigger-verification').definition.trigger?.config).toEqual({
      events: ['verification.passed'],
    });
    // Its existing edge stays where it was.
    expect(chainOf(setTrigger(kept, 'trigger-case').definition)[0]).toBe('trigger next first');
  });

  it('adds the output node when a definition lacks it', () => {
    const bare = { ...emptyDefinition(), steps: [] };
    const { definition } = setTrigger(bare, 'trigger-api');
    expect(definition.steps.map((step) => step.id)).toEqual(['output']);
    expect(chainOf(definition)).toEqual(['trigger next output']);
  });
});

describe('adding steps (C141.2)', () => {
  it('adds an action after a step, on the port it names, and moves the old edge after it', () => {
    const { definition, select } =
      insertStep(
        linear(),
        { from: 'first', port: 'next' },
        {
          kind: 'action',
          key: 'send_slack_message',
          version: 2,
        },
      ) ?? {};
    expect(select).toBe('send_slack_message');
    expect(definition?.steps.find((step) => step.id === 'send_slack_message')).toEqual({
      id: 'send_slack_message',
      name: 'Send slack message',
      type: 'action',
      'action-key': 'send_slack_message',
      'action-version': 2,
      config: {},
    });
    expect(definition && chainOf(definition)).toEqual([
      'trigger next first',
      'first next send_slack_message',
      'second next output',
      'send_slack_message next second',
    ]);
  });

  it('gives a repeated step a fresh id and name, and its edges fresh ids', () => {
    const once = insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'wait-time' });
    const twice =
      once && insertStep(once.definition, { from: 'trigger', port: 'next' }, { kind: 'wait-time' });
    const waits = twice?.definition.steps.filter((step) => step.type === 'wait') ?? [];
    expect(waits.map((step) => [step.id, step.name])).toEqual([
      ['wait', 'Wait for a time'],
      ['wait_2', 'Wait for a time 2'],
    ]);
    expect(waits[0]).toMatchObject({ mode: 'time', seconds: 3600 });
    const ids = twice?.definition.edges.map((edge) => edge.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('adds a wait for events that names its subject, events, timeout and what a timeout does', () => {
    const added = insertStep(linear(), { from: 'first', port: 'next' }, { kind: 'wait-events' });
    expect(added?.definition.steps.find((step) => step.id === added.select)).toEqual({
      id: 'wait_for_event',
      name: 'Wait for an event',
      type: 'wait',
      mode: 'events',
      subject: 'trigger.id',
      events: ['inquiry.completed'],
      'timeout-seconds': 86400,
      'on-timeout': 'continue',
    });
  });

  it('adds a conditional whose route and else both lead on, so the graph stays connected', () => {
    const added = insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'conditional' });
    expect(added?.definition.steps.find((step) => step.id === 'conditional')).toEqual({
      id: 'conditional',
      name: 'Conditional',
      type: 'conditional',
      routes: [{ key: 'route-1', label: 'Route 1' }],
    });
    expect(added && chainOf(added.definition)).toContain('conditional route:route-1 first');
    expect(added && chainOf(added.definition)).toContain('conditional else first');
  });

  it('adds a parallel with its paired join, each branch leading to the join', () => {
    const added = insertStep(linear(), { from: 'first', port: 'next' }, { kind: 'parallel' });
    const steps = added?.definition.steps ?? [];
    expect(steps.find((step) => step.id === 'parallel')).toMatchObject({
      branches: [{ key: 'a' }, { key: 'b' }],
    });
    expect(steps.find((step) => step.id === 'parallel_join')).toEqual({
      id: 'parallel_join',
      name: 'Join',
      type: 'join',
      'join-of': 'parallel',
    });
    expect(added && chainOf(added.definition)).toEqual(
      expect.arrayContaining([
        'first next parallel',
        'parallel branch:a parallel_join',
        'parallel branch:b parallel_join',
        'parallel_join next second',
      ]),
    );
  });

  it('adds on an unconnected port without an edge after the new step, and refuses an unknown place', () => {
    const bare = { ...linear(), edges: [] };
    const added = insertStep(bare, { from: 'first', port: 'next' }, { kind: 'wait-time' });
    expect(added && chainOf(added.definition)).toEqual(['first next wait']);
    expect(
      insertStep(linear(), { from: 'nowhere', port: 'next' }, { kind: 'wait-time' }),
    ).toBeNull();
    expect(insertStep(linear(), { from: 'first', port: 'body' }, { kind: 'wait-time' })).toBeNull();
  });

  it('says where "add a step after" puts a step for each kind of item', () => {
    const withBranches =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'parallel' })?.definition ??
      linear();
    expect(insertionPlaceOf(linear(), 'trigger')).toEqual({ from: 'trigger', port: 'next' });
    expect(insertionPlaceOf(linear(), 'first')).toEqual({ from: 'first', port: 'next' });
    expect(insertionPlaceOf(withBranches, 'parallel')).toEqual({
      from: 'parallel_join',
      port: 'next',
    });
    expect(insertionPlaceOf(withBranches, 'parallel/branch:a')).toEqual({
      from: 'parallel',
      port: 'branch:a',
    });
    expect(insertionPlaceOf(linear(), 'output')).toBeNull();
    expect(insertionPlaceOf(linear(), 'nowhere')).toBeNull();
    expect(insertionPlaceOf({ ...linear(), trigger: null }, 'trigger')).toBeNull();
    const conditional =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'conditional' })
        ?.definition ?? linear();
    expect(insertionPlaceOf(conditional, 'conditional')).toBeNull();
    expect(
      insertionPlaceOf(
        { ...linear(), steps: [...linear().steps, { id: 'each', name: 'each', type: 'loop' }] },
        'each',
      ),
    ).toEqual({ from: 'each', port: 'done' });
  });
});

describe('adding a branch (C141.2)', () => {
  it('adds a route to a conditional that leads where its else leads', () => {
    const conditional =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'conditional' })
        ?.definition ?? linear();
    const branched = addBranch(conditional, 'conditional');
    expect(branched?.definition.steps.find((step) => step.id === 'conditional')?.routes).toEqual([
      { key: 'route-1', label: 'Route 1' },
      { key: 'route-2', label: 'Route 2' },
    ]);
    expect(branched && chainOf(branched.definition)).toContain('conditional route:route-2 first');
    expect(branched?.select).toBe('conditional/route:route-2');
  });

  it('adds a branch to a parallel that leads to its join, and refuses other steps', () => {
    const parallel =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'parallel' })?.definition ??
      linear();
    const branched = addBranch(parallel, 'parallel');
    expect(branched?.definition.steps.find((step) => step.id === 'parallel')?.branches).toEqual([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
    ]);
    expect(branched && chainOf(branched.definition)).toContain('parallel branch:c parallel_join');
    expect(addBranch(linear(), 'first')).toBeNull();
    expect(addBranch(linear(), 'nowhere')).toBeNull();
  });

  it('stops at ten branches (C113.4)', () => {
    let parallel =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'parallel' })?.definition ??
      linear();
    for (let index = 0; index < 8; index += 1) {
      parallel = addBranch(parallel, 'parallel')?.definition ?? parallel;
    }
    expect(parallel.steps.find((step) => step.id === 'parallel')?.branches).toHaveLength(10);
    expect(addBranch(parallel, 'parallel')).toBeNull();
  });
});

describe('moving steps (C141.2)', () => {
  it('moves a step up and down a chain by rewiring its edges', () => {
    const up = moveStep(linear(), 'second', 'up');
    expect(up && chainOf(up.definition)).toEqual([
      'trigger next second',
      'second next first',
      'first next output',
    ]);
    expect(up?.select).toBe('second');
    const down = moveStep(linear(), 'first', 'down');
    expect(down && chainOf(down.definition)).toEqual(up && chainOf(up.definition));
  });

  it('says which moves a step can make', () => {
    expect(canMove(linear(), 'first', 'up')).toBe(false);
    expect(canMove(linear(), 'first', 'down')).toBe(true);
    expect(canMove(linear(), 'second', 'up')).toBe(true);
    expect(canMove(linear(), 'second', 'down')).toBe(false);
    expect(canMove(linear(), 'output', 'up')).toBe(false);
    expect(canMove(linear(), 'nowhere', 'up')).toBe(false);
    expect(moveStep(linear(), 'first', 'up')).toBeNull();
  });
});

describe('connecting a port (C141.2)', () => {
  it('moves the edge on a port to a valid target, keeping its id', () => {
    const connected = connectPort(linear(), { from: 'first', port: 'next' }, 'output');
    expect(connected?.definition.edges[1]).toEqual({
      id: 'e2',
      from: 'first',
      'from-port': 'next',
      to: 'output',
    });
    expect(connected?.select).toBe('first');
  });

  it('adds an edge on an unconnected port, and refuses a target the port rules refuse', () => {
    const connected = connectPort(linear(), { from: 'first', port: 'error' }, 'output');
    expect(connected && chainOf(connected.definition)).toContain('first error output');
    expect(connectPort(linear(), { from: 'second', port: 'next' }, 'first')).toBeNull();
  });
});

describe('deleting steps (C141.2)', () => {
  it('deletes a step and leads what came into it to what came after it', () => {
    const deleted = deleteStep(linear(), 'first');
    expect(deleted?.definition.steps.map((step) => step.id)).toEqual(['second', 'output']);
    expect(deleted && chainOf(deleted.definition)).toEqual([
      'trigger next second',
      'second next output',
    ]);
    expect(deleted?.definition.layout).toEqual({});
    expect(deleted?.select).toBe('second');
  });

  it('deletes a parallel with its join, leaving its branch steps unconnected', () => {
    const parallel =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'parallel' })?.definition ??
      linear();
    const inBranch =
      insertStep(parallel, { from: 'parallel', port: 'branch:a' }, { kind: 'wait-time' })
        ?.definition ?? parallel;
    const deleted = deleteStep(inBranch, 'parallel');
    expect(deleted?.definition.steps.map((step) => step.id)).toEqual([
      'first',
      'second',
      'output',
      'wait',
    ]);
    expect(deleted && chainOf(deleted.definition)).toEqual([
      'trigger next first',
      'first next second',
      'second next output',
    ]);
  });

  it('deletes a conditional, leading what came into it to where its else led', () => {
    const conditional =
      insertStep(linear(), { from: 'first', port: 'next' }, { kind: 'conditional' })?.definition ??
      linear();
    const deleted = deleteStep(conditional, 'conditional');
    expect(deleted && chainOf(deleted.definition)).toEqual([
      'trigger next first',
      'first next second',
      'second next output',
    ]);
  });

  it('never deletes the output, a join on its own, or the trigger', () => {
    const parallel =
      insertStep(linear(), { from: 'trigger', port: 'next' }, { kind: 'parallel' })?.definition ??
      linear();
    expect(canDelete(linear(), 'output')).toBe(false);
    expect(canDelete(parallel, 'parallel_join')).toBe(false);
    expect(canDelete(linear(), 'trigger')).toBe(false);
    expect(canDelete(linear(), 'first')).toBe(true);
    expect(deleteStep(linear(), 'output')).toBeNull();
  });

  it('selects the trigger when nothing came after the deleted step', () => {
    const lone = {
      ...linear(),
      edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'first' }],
    };
    const deleted = deleteStep(lone, 'first');
    expect(deleted?.definition.edges).toEqual([]);
    expect(deleted?.select).toBe('trigger');
  });
});

describe('renaming and placing (C141.2, C141.3)', () => {
  it('renames a step to a trimmed name of 1 to 80 characters', () => {
    expect(renameStep(linear(), 'first', '  Score the risk ')?.definition.steps[0]?.name).toBe(
      'Score the risk',
    );
    expect(renameStep(linear(), 'first', '   ')).toBeNull();
    expect(renameStep(linear(), 'first', 'x'.repeat(81))).toBeNull();
    expect(renameStep(linear(), 'nowhere', 'Name')).toBeNull();
  });

  it('keeps positions only in the layout member, never in a step', () => {
    const placed = placeNode(linear(), 'second', { x: 10, y: 20 });
    expect(placed.layout).toEqual({ first: { x: 0, y: 100 }, second: { x: 10, y: 20 } });
    expect(placed.steps.some((step) => 'x' in step || 'position' in step)).toBe(false);
    expect(replaceLayout(linear(), { output: { x: 1, y: 2 } }).layout).toEqual({
      output: { x: 1, y: 2 },
    });
  });

  it('never changes the definition it was given', () => {
    const original = linear();
    const snapshot = JSON.stringify(original);
    insertStep(original, { from: 'first', port: 'next' }, { kind: 'parallel' });
    moveStep(original, 'second', 'up');
    deleteStep(original, 'first');
    placeNode(original, 'first', { x: 5, y: 5 });
    setTrigger(original, 'trigger-event');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
