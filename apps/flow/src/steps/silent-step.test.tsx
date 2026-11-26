import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AamvaStep } from '../flow/flow-position';
import { renderWithFlow } from '../test-utils';
import { SilentStep } from './silent-step';

const SILENT: AamvaStep = { id: 'aamva', type: 'aamva', source: 'government_id' };

describe('SilentStep (C59.6, C64.1)', () => {
  it('says the license is being checked, and reads the session until the server moves on', async () => {
    const onPoll = vi.fn(() => Promise.resolve());
    renderWithFlow(<SilentStep step={SILENT} onPoll={onPoll} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Checking your license details' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'We are checking your driver’s license or ID card with the office that issued it. This usually takes a few seconds. Keep this page open.',
    );
    await waitFor(() => {
      expect(onPoll.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('says when the wait is longer than usual, and checks again on request', async () => {
    const onPoll = vi.fn(() => Promise.resolve());
    renderWithFlow(<SilentStep step={SILENT} onPoll={onPoll} />, {
      environment: { pollIntervalMs: 1, maxPolls: 2 },
    });

    expect(await screen.findByText('This is taking longer than usual.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => {
      expect(onPoll.mock.calls.length).toBeGreaterThan(2);
    });
  });

  it('speaks Spanish', () => {
    renderWithFlow(<SilentStep step={SILENT} onPoll={() => Promise.resolve()} />, {
      language: 'es',
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Comprobando los datos de tu licencia' }),
    ).toBeVisible();
  });
});
