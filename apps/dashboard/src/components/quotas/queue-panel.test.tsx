/**
 * C251.3 (Workflow 11B, `quotas`): the console's queue panel shows, per queue, how many of the
 * environment's jobs are queued or running against its cap. The caps come from the settings the page
 * already reads; the in-flight counts only from a server that reports them, and "Not reported"
 * otherwise, never a made-up zero.
 */
import { QUEUE_IN_FLIGHT_CAP_QUEUES } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { settings } from '../operators/test-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import { QUEUE_NAMES, QueuePanel, queuePanelRows } from './queue-panel';

const ADMITTED = [...QUEUE_IN_FLIGHT_CAP_QUEUES, 'workflow-step'] as const;

function rowOf(name: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name });
  const row = header.closest('tr');
  if (row === null) {
    throw new Error(`no row ${name}`);
  }
  return row;
}

const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('the queue panel (C251.3)', () => {
  it('names every capped queue in words, workflow steps last', () => {
    expect(Object.keys(QUEUE_NAMES)).toEqual([...ADMITTED]);
    expect(QUEUE_NAMES['process-verification']).toBe('Verification processing');
    expect(QUEUE_NAMES['report-run']).toBe('Report runs');
    expect(QUEUE_NAMES['connect-redeem']).toBe('Connect redemptions');
    expect(QUEUE_NAMES['account-export']).toBe('Account access exports');
    expect(QUEUE_NAMES['integrity-decode']).toBe('Device integrity decodes');
    expect(QUEUE_NAMES['workflow-step']).toBe('Workflow steps');
    for (const [queue, name] of Object.entries(QUEUE_NAMES)) {
      // Words, never the queue's id.
      expect(name).toMatch(/^[A-Z][a-z]* /);
      expect(name.toLowerCase()).not.toBe(queue);
    }
  });

  it('shows each queue’s cap from the settings, and says the in-flight count is not reported without it', () => {
    render(
      <QueuePanel
        environment="sandbox"
        settings={settings({
          'queue-in-flight-caps': { 'report-run': 5 },
          'workflow-in-flight-cap': 40,
        })}
      />,
    );

    const table = screen.getByRole('table', { name: 'Queues in Sandbox' });
    expect(within(table).getAllByRole('rowheader')).toHaveLength(16);
    expect(cells('Report runs')).toEqual(['Not reported', '5']);
    expect(cells('Verification processing')).toEqual(['Not reported', '50 (default)']);
    expect(cells('Workflow steps')).toEqual(['Not reported', '40']);
  });

  it('shows in flight against cap from a server that reports them', () => {
    render(
      <QueuePanel
        environment="production"
        settings={settings({ 'queue-in-flight-caps': { 'report-run': 5 } })}
        usage={[
          { queue: 'report-run', inFlight: 5, cap: 5 },
          { queue: 'process-verification', inFlight: 12, cap: 50 },
          { queue: 'workflow-step', inFlight: 0, cap: 50 },
        ]}
      />,
    );

    screen.getByRole('table', { name: 'Queues in Production' });
    expect(cells('Report runs')).toEqual(['5 (at its cap)', '5']);
    expect(cells('Verification processing')).toEqual(['12', '50']);
    expect(cells('Workflow steps')).toEqual(['0', '50']);
    // A queue the server left out is not reported, never zero.
    expect(cells('List screenings')).toEqual(['Not reported', '50 (default)']);
  });

  it('takes every cap as the default from a server that does not report the setting', () => {
    const rows = queuePanelRows({}, null);
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.inFlight === null && row.cap === 50 && row.defaulted)).toBe(
      true,
    );
  });

  it('says what a cap does and does not do (C251.6)', () => {
    render(<QueuePanel environment="sandbox" settings={settings()} />);
    expect(screen.getByText(/OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'A cap bounds how much of the worker this environment can hold; it adds no capacity, and a cap set too low delays this environment’s own work.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the browser the queue names and numbers only, never the rest of the settings', async () => {
    const payload = await rscPayloadOf(
      <QueuePanel
        environment="sandbox"
        settings={settings({
          'queue-in-flight-caps': { 'case-bulk': 7 },
          'organization-display-name': 'SYNTHETIC-PANEL-CANARY',
        })}
        usage={[{ queue: 'case-bulk', inFlight: 3, cap: 7 }]}
      />,
    );
    expect(payload).toContain('Case bulk actions');
    expect(payload).toContain('Queues in Sandbox');
    expect(payload).not.toContain('SYNTHETIC-PANEL-CANARY');
    expect(payload).not.toContain('organization-display-name');
  });
});
