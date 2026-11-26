import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, placementClearOf, useToast, type ToastInput } from './toasts';

function Trigger({ toast }: { toast: ToastInput }) {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        show(toast);
      }}
    >
      Notify
    </button>
  );
}

function renderWith(toast: ToastInput) {
  render(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('announces a success politely, in a named notifications region', async () => {
    renderWith({ tone: 'success', message: 'The inquiry was approved.' });

    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));

    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(region).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveTextContent('The inquiry was approved.');
  });

  it('announces an error assertively', async () => {
    renderWith({ tone: 'error', message: 'The webhook could not be archived.' });

    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The webhook could not be archived.');
  });

  it('can be dismissed', async () => {
    renderWith({ tone: 'info', message: 'Copied.' });
    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss: Copied.' }));

    expect(screen.queryByText('Copied.')).not.toBeInTheDocument();
  });

  it('goes away on its own after a few seconds, but not while the pointer rests on it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWith({ tone: 'success', message: 'Saved.' });
    await user.click(screen.getByRole('button', { name: 'Notify' }));

    await user.hover(screen.getByText('Saved.'));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Saved.')).toBeInTheDocument();

    await user.unhover(screen.getByText('Saved.'));
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('keeps an error until it is dismissed: its reason may be shown nowhere else (Workflow 2D F011, WCAG 2.2.1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWith({ tone: 'error', message: 'A draft already exists.' });
    await user.click(screen.getByRole('button', { name: 'Notify' }));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('A draft already exists.');

    await user.click(screen.getByRole('button', { name: 'Dismiss: A draft already exists.' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses to be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Trigger toast={{ tone: 'info', message: 'x' }} />)).toThrow(
      'useToast() needs a <ToastProvider> above it',
    );
  });
});

// WCAG 2.4.11 (C171.3; Workflow 9D, a11y-audit): the toasts never cover what has focus. The
// console's full-stack `ui-a11y-focus.spec.ts` found a field and a scroll region under a toast at
// the bottom end; jsdom lays nothing out, so the boxes are given here.
describe('toasts and the focused control (2.4.11)', () => {
  const VIEWPORT = { width: 1280, height: 720 };
  const box = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  function renderWithFields() {
    render(
      <ToastProvider>
        <Trigger toast={{ tone: 'error', message: 'The settings could not be saved.' }} />
        <input aria-label="Near the bottom" />
        <input aria-label="Near the top" />
      </ToastProvider>,
    );
    Object.assign(window, { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height });
    const region = screen.getByRole('region', { name: 'Notifications' });
    // The stack: 384 by 60 CSS px, 16 px from the end and from the bottom (or the top) edge.
    vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() =>
      region.dataset.placement === 'top' ? box(880, 16, 384, 60) : box(880, 644, 384, 60),
    );
    vi.spyOn(
      screen.getByRole('textbox', { name: 'Near the bottom' }),
      'getBoundingClientRect',
    ).mockReturnValue(box(760, 670, 327, 44));
    vi.spyOn(
      screen.getByRole('textbox', { name: 'Near the top' }),
      'getBoundingClientRect',
    ).mockReturnValue(box(760, 30, 327, 44));
    return region;
  }

  it('moves the stack to the top end while the focused control sits under it at the bottom', async () => {
    const region = renderWithFields();
    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(region.dataset.placement).toBe('bottom');

    await act(async () => {
      screen.getByRole('textbox', { name: 'Near the bottom' }).focus();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(region.dataset.placement).toBe('top');

    await act(async () => {
      screen.getByRole('textbox', { name: 'Near the top' }).focus();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(region.dataset.placement).toBe('bottom');
  });

  it('keeps the stack where it is when both edges would cover the focus, or none does', () => {
    const stack = box(880, 644, 384, 60);

    expect(placementClearOf(box(760, 0, 327, 720), stack, 'bottom', 720)).toBe('bottom');
    expect(placementClearOf(box(16, 300, 300, 44), stack, 'bottom', 720)).toBe('bottom');
    expect(placementClearOf(box(16, 300, 300, 44), box(880, 16, 384, 60), 'top', 720)).toBe('top');
  });
});
