import { describe, expect, it } from 'vitest';
import { canvasOf, pathListOf, runPathOf, statusBadgeOf } from './canvas-model';
import type { DraftDefinition } from './document-model';

const definition: DraftDefinition = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    { id: 'decide', name: 'Decide', type: 'conditional', routes: [{ key: 'hit', label: 'Hit' }] },
    { id: 'tell', name: 'Tell', type: 'action', 'action-key': 'send_slack_message' },
    { id: 'wait', name: 'Wait', type: 'wait', mode: 'time', seconds: 60 },
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'decide' },
    { id: 'e1', from: 'decide', 'from-port': 'route:hit', to: 'tell' },
    { id: 'e2', from: 'decide', 'from-port': 'else', to: 'wait' },
    { id: 'e3', from: 'tell', 'from-port': 'next', to: 'output' },
    { id: 'e4', from: 'wait', 'from-port': 'next', to: 'output' },
  ],
  outputs: [],
  layout: {},
};

const rows = [
  { nodeId: 'decide', iterationPath: '', status: 'succeeded' },
  { nodeId: 'tell', iterationPath: '', status: 'failed' },
];

describe('a run’s path over the read-only canvas (C141.6, C141.9)', () => {
  it('says each step status as an icon and a word, never by colour alone', () => {
    expect(statusBadgeOf('succeeded')).toEqual({ icon: '✓', word: 'Succeeded' });
    expect(statusBadgeOf('failed')).toEqual({ icon: '✕', word: 'Failed' });
    expect(statusBadgeOf('timed_out')).toEqual({ icon: '⏱', word: 'Timed out' });
    expect(statusBadgeOf(undefined)).toEqual({ icon: '–', word: 'Not reached' });
    expect(statusBadgeOf('something_new').word).toBe('something_new');
  });

  it('takes each node’s status from its rows, and the edges between steps that ran', () => {
    const path = runPathOf(definition, rows);

    expect(path.statuses).toEqual({ trigger: 'started', decide: 'succeeded', tell: 'failed' });
    expect(path.taken).toEqual(['e0', 'e1']);
  });

  it('lists the path in the order of its edges, with each status', () => {
    expect(
      pathListOf(definition, runPathOf(definition, rows)).map(
        ({ id, label, badge }) => `${id} ${label} ${badge.word}`,
      ),
    ).toEqual([
      'trigger Trigger: The API Started',
      'decide Conditional: Decide Succeeded',
      'tell Action send_slack_message: Tell Failed',
    ]);
  });

  it('draws each node’s status and marks the edges taken', () => {
    const canvas = canvasOf(definition, [], {}, runPathOf(definition, rows));

    expect(canvas.nodes.map((node) => [node.id, node.data.status?.word])).toEqual([
      ['trigger', 'Started'],
      ['decide', 'Succeeded'],
      ['tell', 'Failed'],
      ['wait', 'Not reached'],
      ['output', 'Not reached'],
    ]);
    expect(canvas.edges.filter((edge) => edge.taken).map((edge) => edge.id)).toEqual(['e0', 'e1']);
    expect(canvasOf(definition, [], {}).nodes[0]?.data.status).toBeNull();
  });
});

describe('the overridden state on a test run (C156.6; requested by dashboard-preview)', () => {
  it('says an overridden step in an icon and a word', () => {
    expect(statusBadgeOf('overridden')).toEqual({ icon: '✎', word: 'Overridden' });
  });
});
