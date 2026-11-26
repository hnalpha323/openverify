import { describe, expect, it } from 'vitest';
import type { DraftDefinition, DraftStep } from './document-model';
import {
  canConnect,
  edgeOn,
  portsOf,
  portWords,
  requiredPortsOf,
  validTargets,
} from './port-rules';

const step = (id: string, type: string, more: Record<string, unknown> = {}): DraftStep => ({
  id,
  name: id,
  type,
  ...more,
});

const edge = (from: string, port: string, to: string, toPort?: string) => ({
  id: `${from}-${port.replace(':', '-')}-${to}`,
  from,
  'from-port': port,
  to,
  ...(toPort === undefined ? {} : { 'to-port': toPort }),
});

/** trigger -> check -> (route high -> notify, else -> wait) -> output; a loose step apart. */
const definition: DraftDefinition = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    step('check', 'conditional', { routes: [{ key: 'high', label: 'High' }] }),
    step('notify', 'action', { 'action-key': 'send_slack_message', 'action-version': 1 }),
    step('wait', 'wait', { mode: 'time', seconds: 60 }),
    step('loose', 'action', { 'action-key': 'calculate', 'action-version': 1 }),
    step('output', 'output', { mappings: {} }),
  ],
  edges: [
    edge('trigger', 'next', 'check'),
    edge('check', 'route:high', 'notify'),
    edge('check', 'else', 'wait'),
    edge('notify', 'next', 'output'),
    edge('wait', 'next', 'output'),
  ],
  outputs: [],
  layout: {},
};

describe('the ports of a node (C113.3)', () => {
  it('names the ports each node type must connect, and the error port where it has one', () => {
    expect(requiredPortsOf(null)).toEqual(['next']);
    expect(requiredPortsOf(step('o', 'output'))).toEqual([]);
    expect(
      requiredPortsOf(step('c', 'conditional', { routes: [{ key: 'a' }, { key: 'b' }] })),
    ).toEqual(['route:a', 'route:b', 'else']);
    expect(
      requiredPortsOf(step('p', 'parallel', { branches: [{ key: 'a' }, { key: 'b' }] })),
    ).toEqual(['branch:a', 'branch:b']);
    expect(requiredPortsOf(step('l', 'loop'))).toEqual(['body', 'done']);
    expect(requiredPortsOf(step('w', 'wait'))).toEqual(['next']);
    expect(portsOf(step('a', 'action'))).toEqual(['next', 'error']);
    expect(portsOf(step('l', 'loop'))).toEqual(['body', 'done', 'error']);
    expect(portsOf(step('m', 'module'))).toEqual(['next', 'error']);
    expect(portsOf(step('w', 'wait'))).toEqual(['next']);
    expect(portsOf(null)).toEqual(['next']);
  });

  it('reads a malformed route or branch list as no ports rather than throwing', () => {
    expect(requiredPortsOf(step('c', 'conditional', { routes: 'none' }))).toEqual(['else']);
    expect(requiredPortsOf(step('p', 'parallel', { branches: [null, { key: 3 }] }))).toEqual([]);
  });

  it('finds the one edge on a port', () => {
    expect(edgeOn(definition, 'check', 'else')?.to).toBe('wait');
    expect(edgeOn(definition, 'check', 'route:missing')).toBeUndefined();
  });

  it('says each port in words', () => {
    expect(
      ['next', 'route:high', 'branch:b', 'else', 'body', 'done', 'error', 'other'].map(portWords),
    ).toEqual([
      'Next',
      'Route high',
      'Branch b',
      'Else',
      'Loop body',
      'After the loop',
      'On error',
      'other',
    ]);
  });
});

describe('which targets a port may connect to (C113.5, C141.2, C141.3)', () => {
  it('refuses the trigger, the step itself, an unknown node, an unknown port and a missing source', () => {
    expect(canConnect(definition, 'notify', 'next', 'trigger')).toBe(false);
    expect(canConnect(definition, 'notify', 'next', 'notify')).toBe(false);
    expect(canConnect(definition, 'notify', 'next', 'nowhere')).toBe(false);
    expect(canConnect(definition, 'notify', 'route:high', 'output')).toBe(false);
    expect(canConnect(definition, 'nowhere', 'next', 'output')).toBe(false);
    expect(canConnect({ ...definition, trigger: null }, 'trigger', 'next', 'check')).toBe(false);
  });

  it('refuses a target that already leads back to the source, which would make a cycle', () => {
    expect(canConnect(definition, 'notify', 'next', 'check')).toBe(false);
    expect(canConnect(definition, 'wait', 'next', 'check')).toBe(false);
  });

  it('accepts a forward target and a loose step, and lists the valid targets in definition order', () => {
    expect(canConnect(definition, 'notify', 'next', 'wait')).toBe(true);
    expect(canConnect(definition, 'trigger', 'next', 'loose')).toBe(true);
    expect(validTargets(definition, 'notify', 'next')).toEqual(['wait', 'loose', 'output']);
    expect(validTargets(definition, 'check', 'else')).toEqual([
      'notify',
      'wait',
      'loose',
      'output',
    ]);
    expect(validTargets(definition, 'output', 'next')).toEqual([]);
  });

  it('never counts a loop body’s back-edge as a cycle', () => {
    const looped: DraftDefinition = {
      ...definition,
      steps: [
        step('each', 'loop', { mode: 'for-each', items: 'trigger.items' }),
        step('body_step', 'action', { 'action-key': 'calculate', 'action-version': 1 }),
        step('after', 'wait', { mode: 'time', seconds: 1 }),
        step('output', 'output', { mappings: {} }),
      ],
      edges: [
        edge('trigger', 'next', 'each'),
        edge('each', 'body', 'body_step'),
        edge('body_step', 'next', 'each', 'continue'),
        edge('each', 'done', 'output'),
      ],
    };
    expect(canConnect(looped, 'each', 'done', 'after')).toBe(true);
    expect(canConnect(looped, 'body_step', 'error', 'after')).toBe(true);
  });
});
