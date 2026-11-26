import { describe, expect, it } from 'vitest';
import { outlineOf, type OutlineItem } from './definition-outline-model';

const step = (id: string, type: string, more: Record<string, unknown> = {}) => ({
  id,
  name: id.replaceAll('_', ' '),
  type,
  ...more,
});
const edge = (from: string, port: string, to: string) => ({
  id: `${from}-${port.replace(':', '-')}-${to}`,
  from,
  'from-port': port,
  to,
});

const definition = {
  'schema-version': 1,
  trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'] } },
  inputs: [],
  variables: [],
  steps: [
    step('check_risk', 'conditional', {
      routes: [{ key: 'high', condition: true }],
    }),
    step('send_slack', 'action', { 'action-key': 'send_slack_message' }),
    step('wait_a_day', 'wait'),
    step('output', 'output'),
    step('orphan', 'action', { 'action-key': 'make_https_request' }),
  ],
  edges: [
    edge('trigger', 'next', 'check_risk'),
    edge('check_risk', 'route:high', 'send_slack'),
    edge('check_risk', 'else', 'wait_a_day'),
    edge('send_slack', 'next', 'output'),
    edge('wait_a_day', 'next', 'output'),
  ],
  outputs: [],
  layout: {},
};

const labels = (items: readonly OutlineItem[]): unknown[] =>
  items.map((item) =>
    item.children.length === 0 ? item.label : { [item.label]: labels(item.children) },
  );

describe('outlineOf (C141.2)', () => {
  it('roots the steps at the trigger, groups each route and the else, and lists unconnected steps apart', () => {
    expect(labels(outlineOf(definition, []))).toEqual([
      {
        'Trigger: An event': [
          {
            'Conditional: check risk': [
              { 'Route high': ['Action send_slack_message: send slack', 'Output: output'] },
              { Else: ['Wait: wait a day', 'Goes on at output'] },
            ],
          },
        ],
      },
      { 'Not connected': ['Action make_https_request: orphan'] },
    ]);
  });

  it('counts each step’s problems by its pointer, and keeps its index in steps', () => {
    const [root] = outlineOf(definition, [
      { pointer: '/steps/1/config/text', detail: 'is required' },
      { pointer: '/steps/1', detail: 'is not reachable' },
      { pointer: '/steps/10/config', detail: 'not this step' },
    ]);
    const conditional = root?.children[0];
    const slack = conditional?.children[0]?.children[0];
    expect(slack?.stepIndex).toBe(1);
    expect(slack?.issues.map((issue) => issue.detail)).toEqual(['is required', 'is not reachable']);
  });

  it('says a draft has no trigger yet, and outlines nothing it cannot read', () => {
    expect(labels(outlineOf({ ...definition, trigger: null, steps: [], edges: [] }, []))).toEqual([
      'Trigger: No trigger yet',
    ]);
    expect(outlineOf('not a definition', [])).toEqual([]);
  });
});
