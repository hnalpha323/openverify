import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { usePolling, type PollingOptions } from './use-polling';

function Poller({
  poll,
  options,
}: {
  poll: (signal: AbortSignal) => Promise<boolean>;
  options: PollingOptions;
}) {
  const { status, error, restart } = usePolling(poll, options);
  return (
    <div>
      <output aria-label="status">{status}</output>
      <output aria-label="error">{error instanceof Error ? error.message : ''}</output>
      <button type="button" onClick={restart}>
        restart
      </button>
    </div>
  );
}

const FAST = { intervalMs: 1, maxPolls: 5 };

function status(): string | null {
  return screen.getByRole('status', { name: 'status' }).textContent;
}

describe('usePolling', () => {
  it('polls straight away and stops once the poll reports it is done', async () => {
    const poll = vi
      .fn<(signal: AbortSignal) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    render(<Poller poll={poll} options={FAST} />);

    await waitFor(() => {
      expect(poll).toHaveBeenCalledTimes(3);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(poll).toHaveBeenCalledTimes(3);
    expect(status()).toBe('polling');
  });

  it('waits the interval between polls', async () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn<(signal: AbortSignal) => Promise<boolean>>().mockResolvedValue(false);
      render(<Poller poll={poll} options={{ intervalMs: 1000, maxPolls: 10 }} />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(poll).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(999));
      expect(poll).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(poll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out after the maximum number of polls, and can start over', async () => {
    const poll = vi.fn<(signal: AbortSignal) => Promise<boolean>>().mockResolvedValue(false);
    render(<Poller poll={poll} options={{ intervalMs: 1, maxPolls: 3 }} />);

    await waitFor(() => {
      expect(status()).toBe('timed-out');
    });
    expect(poll).toHaveBeenCalledTimes(3);

    await userEvent.click(screen.getByRole('button', { name: 'restart' }));

    await waitFor(() => {
      expect(poll).toHaveBeenCalledTimes(6);
    });
  });

  it('keeps polling through a failure, but gives up after consecutive ones', async () => {
    const poll = vi
      .fn<(signal: AbortSignal) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(false)
      .mockRejectedValue(new Error('down'));
    render(<Poller poll={poll} options={{ intervalMs: 1, maxPolls: 20, maxErrors: 2 }} />);

    await waitFor(() => {
      expect(status()).toBe('failed');
    });
    expect(poll).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('status', { name: 'error' })).toHaveTextContent('down');
  });

  it('gives up after three consecutive failures by default', async () => {
    const poll = vi
      .fn<(signal: AbortSignal) => Promise<boolean>>()
      .mockRejectedValue(new Error('x'));
    render(<Poller poll={poll} options={FAST} />);

    await waitFor(() => {
      expect(status()).toBe('failed');
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('always calls the latest poll function', async () => {
    const first = vi.fn<(signal: AbortSignal) => Promise<boolean>>().mockResolvedValue(false);
    const second = vi.fn<(signal: AbortSignal) => Promise<boolean>>().mockResolvedValue(true);
    const { rerender } = render(<Poller poll={first} options={{ intervalMs: 5, maxPolls: 50 }} />);
    await waitFor(() => {
      expect(first).toHaveBeenCalled();
    });

    rerender(<Poller poll={second} options={{ intervalMs: 5, maxPolls: 50 }} />);

    await waitFor(() => {
      expect(second).toHaveBeenCalled();
    });
  });

  it('aborts the poll in flight and stops when unmounted', async () => {
    let signal: AbortSignal | undefined;
    const poll = vi.fn((received: AbortSignal) => {
      signal = received;
      return new Promise<boolean>(() => undefined);
    });
    const { unmount } = render(<Poller poll={poll} options={FAST} />);
    await waitFor(() => {
      expect(poll).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('does not report an aborted poll as a failure', async () => {
    const poll = vi.fn(
      (signal: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const { unmount } = render(<Poller poll={poll} options={FAST} />);
    await waitFor(() => {
      expect(poll).toHaveBeenCalledTimes(1);
    });

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(poll).toHaveBeenCalledTimes(1);
  });
});
