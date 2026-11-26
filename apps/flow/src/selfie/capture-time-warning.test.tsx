import { SELFIE_CAPTURE_TTL_SECONDS } from '@openverify/contracts';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FlowApiClient } from '../api/flow-api-client';
import { FlowApiError } from '../api/flow-api-client';
import { extendedCapture } from '../testing/flow-renderer';
import { renderWithFlow } from '../test-utils';
import { CAPTURE_WARNING_MS, CaptureTimeWarning } from './capture-time-warning';

// C171.4 (WCAG 2.2.1; review H11): 20 s before the capture's limit (180 s) the flow says so in a live
// region and offers more time in one simple action, at least ten times; the server moves the
// capture's expiry by 180 s each time, outside the cap of captures.

const CAPTURE = {
  id: 'self_01M5CK3288G5K9T8DC51K68DDZ',
  expiresAt: '2026-10-20T12:03:00.000Z',
  openedAt: 1_000,
};
const TTL_MS = SELFIE_CAPTURE_TTL_SECONDS * 1000;

function harness() {
  let now = CAPTURE.openedAt;
  let expires = Date.parse(CAPTURE.expiresAt);
  const extendSelfieCapture = vi.fn<FlowApiClient['extendSelfieCapture']>((id) => {
    expires += TTL_MS;
    return Promise.resolve(extendedCapture(id, new Date(expires).toISOString()));
  });
  renderWithFlow(<CaptureTimeWarning capture={CAPTURE} client={{ extendSelfieCapture }} />, {
    environment: { now: () => now, countdownIntervalMs: 5 },
  });
  const advanceTo = async (elapsedMs: number) => {
    now = CAPTURE.openedAt + elapsedMs;
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  };
  return { extendSelfieCapture, advanceTo };
}

describe('CaptureTimeWarning (C171.4)', () => {
  it('says nothing until 20 seconds before the limit, then warns in a live region', async () => {
    const { advanceTo } = harness();

    await advanceTo(TTL_MS - CAPTURE_WARNING_MS - 1_000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await advanceTo(TTL_MS - CAPTURE_WARNING_MS + 1_000);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'About 19 seconds left to take your photos. Need more time?',
    );
    expect(screen.getByRole('button', { name: 'More time' })).toBeVisible();
  });

  it('extends the capture in one action, at least ten times, each moving the limit', async () => {
    const { extendSelfieCapture, advanceTo } = harness();

    for (let extension = 1; extension <= 10; extension += 1) {
      // Each time, 10 seconds before the limit as moved by the extensions so far.
      await advanceTo(extension * TTL_MS - 10_000);
      await userEvent.click(screen.getByRole('button', { name: 'More time' }));
      expect(await screen.findByText('You have more time.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'More time' })).not.toBeInTheDocument();
    }

    expect(extendSelfieCapture).toHaveBeenCalledTimes(10);
    expect(extendSelfieCapture).toHaveBeenLastCalledWith(CAPTURE.id);
  });

  it('says so when the extension is refused, and keeps the person going', async () => {
    const { extendSelfieCapture, advanceTo } = harness();
    extendSelfieCapture.mockRejectedValueOnce(
      new FlowApiError('http', 'refused', { status: 409, problem: null }),
    );

    await advanceTo(TTL_MS - 5_000);
    await userEvent.click(screen.getByRole('button', { name: 'More time' }));

    expect(await screen.findByText(/We could not add more time/u)).toBeVisible();
  });
});
