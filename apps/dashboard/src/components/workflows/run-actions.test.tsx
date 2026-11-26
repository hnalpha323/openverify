import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { RunActions } from './run-actions';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

type Control = (
  state: ActionState<{ readonly runId: string }>,
  formData: FormData,
) => Promise<ActionResult<{ readonly runId: string }>>;
const RUN = 'wfr_01MB0000000000000000000001';
const NEW_RUN = 'wfr_01MB0000000000000000000002';

describe('RunActions (C120.3, C120.4, C141.6)', () => {
  it('asks a resume to acknowledge the steps whose outcome is unknown before skipping them', async () => {
    const control = vi.fn<Control>(() => Promise.resolve({ ok: true, data: { runId: RUN } }));
    render(
      <ToastProvider>
        <RunActions
          runId={RUN}
          controls={['resume']}
          unknownEffects={2}
          control={control}
          redact={undefined}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    const dialog = screen.getByRole('dialog', { name: 'Resume this run?' });
    const acknowledge = within(dialog).getByRole('checkbox', {
      name: /2 steps whose outcome is unknown/,
    });
    expect(acknowledge).not.toBeChecked();
    await userEvent.click(acknowledge);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resume' }));

    const sent = control.mock.calls[0]?.[1];
    expect(sent?.get('control')).toBe('resume');
    expect(sent?.get('run-id')).toBe(RUN);
    expect(sent?.get('skip-unknown-effects')).toBe('acknowledged');
  });

  it('opens the new run after a rerun', async () => {
    const control = vi.fn<Control>(() => Promise.resolve({ ok: true, data: { runId: NEW_RUN } }));
    render(
      <ToastProvider>
        <RunActions
          runId={RUN}
          controls={['rerun']}
          unknownEffects={0}
          control={control}
          redact={undefined}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rerun' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Rerun this run?' })).getByRole('button', {
        name: 'Rerun',
      }),
    );

    expect(push).toHaveBeenCalledWith(`/workflows/runs/${NEW_RUN}`);
  });
});
