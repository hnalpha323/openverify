import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { Report } from '../../lib/report-documents';
import { later } from '../../testing/later';
import { REPORT_IDS, report } from '../../testing/report-fixtures';
import { ToastProvider } from '../toasts';
import { ReportMonitoring } from './report-monitoring';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function show(
  subject: Report,
  canAct = true,
  actions: Partial<Record<'pause' | 'resume' | 'run', Action>> = {},
) {
  const noop = vi.fn<Action>(() => later({ ok: true, data: undefined }));
  render(
    <ToastProvider>
      <ReportMonitoring
        report={subject}
        canAct={canAct}
        pause={actions.pause ?? noop}
        resume={actions.resume ?? noop}
        run={actions.run ?? noop}
      />
    </ToastProvider>,
  );
}
const section = () => screen.getByRole('region', { name: 'Monitoring' });
const term = (name: string) =>
  within(section()).getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('a report’s monitoring (C74.5, C86)', () => {
  it('shows a recurring report’s next run, and offers pause and run now', async () => {
    const pause = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    show(report('watchlist'), true, { pause });

    expect(term('Monitoring')).toHaveTextContent('Recurring: the next run is scheduled.');
    expect(term('Next run (UTC)')).toHaveTextContent('Nov 26, 2026, 9:00 AM');
    expect(term('Runs so far')).toHaveTextContent('One');
    expect(within(section()).queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(within(section()).getByRole('button', { name: 'Run now' })).toBeVisible();

    await userEvent.click(within(section()).getByRole('button', { name: 'Pause' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Monitoring paused.');
    expect(pause.mock.calls[0]?.[1].get('report-id')).toBe(REPORT_IDS.report);
  });

  it('shows why a report is paused, and offers resume and run now (a run is allowed while paused)', () => {
    show(
      report('watchlist', {
        attributes: {
          'paused-at': '2026-10-28T08:00:00.000Z',
          'paused-reason': 'match',
          'is-recurring': false,
        },
      }),
    );

    expect(term('Monitoring')).toHaveTextContent(
      'Paused on a match: it resumes once every open match is reviewed.',
    );
    expect(term('Paused (UTC)')).toHaveTextContent('Oct 28, 2026, 8:00 AM');
    expect(within(section()).getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(within(section()).getByRole('button', { name: 'Run now' })).toBeVisible();
    expect(within(section()).queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('says a report an operator paused waits for a resume, and one that never ran has no run yet', () => {
    show(
      report('watchlist', {
        attributes: {
          'paused-at': '2026-10-28T08:00:00.000Z',
          'paused-reason': 'operator',
          'is-recurring': false,
          'completed-at': null,
        },
      }),
    );

    expect(term('Monitoring')).toHaveTextContent(
      'Paused by an operator: nothing runs on schedule until it resumes.',
    );
    expect(term('Runs so far')).toHaveTextContent('None yet');
  });

  it('counts more than one run as continuous (M7)', () => {
    show(report('watchlist', { attributes: { 'is-continuous': true } }));
    expect(term('Runs so far')).toHaveTextContent('More than one');
  });

  it('says a report of a recurring type without a schedule runs once, and still offers run now', () => {
    show(report('business-watchlist'));

    expect(term('Monitoring')).toHaveTextContent('Not recurring: it runs only when asked.');
    expect(within(section()).getByRole('button', { name: 'Run now' })).toBeVisible();
  });

  it('offers no action without reports:write', () => {
    show(report('watchlist'), false);

    expect(within(section()).queryByRole('button')).toBeNull();
    expect(term('Monitoring')).toHaveTextContent('Recurring');
  });

  it('shows nothing for a type that does not recur', () => {
    show(report('email-address'));
    expect(screen.queryByRole('region', { name: 'Monitoring' })).toBeNull();
  });
});
