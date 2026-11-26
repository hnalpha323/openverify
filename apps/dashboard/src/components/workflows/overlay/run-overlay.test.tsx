import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_COPY } from '../../../lib/copy/preview';
import { testRunDefinition } from '../../../testing/workflow-fixtures';
import { structureOf, type RunPath } from '../editor/canvas-model';
import { readDraft } from '../editor/document-model';
import { RunOverlay, type OverlayStepRow } from './run-overlay';

const canvas = vi.hoisted(() => ({ paths: [] as RunPath[] }));

vi.mock('../editor/run-path-canvas', () => ({
  RunPathCanvas: ({ path }: { path: RunPath }) => {
    canvas.paths.push(path);
    return <p>Read-only canvas</p>;
  },
}));

const definition = () => {
  const read = readDraft(testRunDefinition());
  if (read === null) {
    throw new Error('The synthetic definition does not read');
  }
  return structureOf(read);
};

const row = (nodeId: string, status: string, overridden = false): OverlayStepRow => ({
  nodeId,
  iterationPath: '',
  status,
  overridden,
  simulated: false,
});

const RUN = {
  id: 'wfr_01MB0000000000000000000007',
  status: 'running',
  steps: [row('score', 'succeeded', true), row('send_slack', 'skipped'), row('decline', 'waiting')],
};

const states = PREVIEW_COPY.overlay.states;

describe('the test run overlay (C156.6, K4)', () => {
  it('lists each step’s state as an icon and a word, overridden steps as overridden', () => {
    render(<RunOverlay definition={definition()} run={RUN} />);

    const region = screen.getByRole('region', { name: PREVIEW_COPY.overlay.heading });
    const list = within(region).getByRole('list', { name: PREVIEW_COPY.overlay.listLabel });
    const text = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(text).toEqual([
      expect.stringContaining('Started'),
      `Action evaluate_code: Score the inquiry: ✎ ${states.overridden}`,
      `Action send_slack_message: Tell the team: ↷ ${states.skipped}`,
      `Action decline_inquiry: Decline the inquiry: ⏸ ${states.waiting}`,
    ]);
    for (const item of within(list).getAllByRole('listitem')) {
      expect(within(item).getByText(/[✓✕↷⏸✎▶]/)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws the same path over the read-only canvas, overridden included', () => {
    canvas.paths.length = 0;
    render(<RunOverlay definition={definition()} run={RUN} />);

    expect(screen.getByText('Read-only canvas')).toBeVisible();
    const path = canvas.paths.at(-1);
    expect(path?.statuses).toMatchObject({
      score: 'overridden',
      send_slack: 'skipped',
      decline: 'waiting',
    });
    expect(path?.taken).toEqual(['edge_0', 'edge_1', 'edge_2']);
  });

  it('says succeeded and failed in words', () => {
    render(
      <RunOverlay
        definition={definition()}
        run={{ ...RUN, steps: [row('score', 'succeeded'), row('send_slack', 'failed')] }}
      />,
    );

    expect(screen.getByText(/Score the inquiry/)).toHaveTextContent(`✓ ${states.succeeded}`);
    expect(screen.getByText(/Tell the team/)).toHaveTextContent(`✕ ${states.failed}`);
  });

  it('says when no test run is chosen', () => {
    render(<RunOverlay definition={definition()} run={null} />);

    expect(screen.getByText(PREVIEW_COPY.overlay.none)).toBeVisible();
  });
});
