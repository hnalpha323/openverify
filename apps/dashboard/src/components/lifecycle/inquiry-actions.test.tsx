import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { InquiryActions, inquiryActionsFor } from './inquiry-actions';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const INQUIRY = 'inq_01JB0000000000000000000001';

describe('inquiryActionsFor', () => {
  it.each([
    ['created', ['expire']],
    ['pending', ['expire']],
    ['completed', ['approve', 'decline', 'mark-for-review']],
    ['failed', ['approve', 'decline', 'mark-for-review']],
    ['needs_review', ['approve', 'decline']],
    ['approved', []],
    ['declined', []],
    ['expired', []],
  ] as const)('offers what C10 allows from %s', (status, actions) => {
    expect(inquiryActionsFor(status)).toEqual(actions);
  });
});

function renderActions(
  actions: Parameters<typeof InquiryActions>[0]['actions'],
  overrides: Partial<Parameters<typeof InquiryActions>[0]> = {},
) {
  const transition = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
  const redact = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
  render(
    <ToastProvider>
      <InquiryActions
        inquiryId={INQUIRY}
        actions={actions}
        canRedact={false}
        transition={transition}
        redact={redact}
        {...overrides}
      />
    </ToastProvider>,
  );
  return { transition, redact };
}

describe('InquiryActions', () => {
  it('shows one button per allowed action', () => {
    renderActions(['approve', 'decline', 'mark-for-review']);

    const group = screen.getByRole('group', { name: 'Inquiry actions' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Approve', 'Decline', 'Mark for review']);
  });

  it('approves after confirmation', async () => {
    const { transition } = renderActions(['approve', 'decline']);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('dialog', { name: 'Approve this inquiry?' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Approve inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was approved.');
    const sent = transition.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(INQUIRY);
    expect(sent?.get('action')).toBe('approve');
  });

  it('expires after confirmation', async () => {
    const { transition } = renderActions(['expire']);

    await userEvent.click(screen.getByRole('button', { name: 'Expire' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expire inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was expired.');
    expect(transition.mock.calls[0]?.[1].get('action')).toBe('expire');
  });

  it('offers redaction with a typed confirmation to an operator who may redact', async () => {
    const { redact } = renderActions([], { canRedact: true });

    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Type redact to confirm' }), 'redact');
    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was redacted.');
    expect(redact.mock.calls[0]?.[1].get('inquiry-id')).toBe(INQUIRY);
  });

  it('renders nothing when no action is allowed', () => {
    const { container } = render(
      <ToastProvider>
        <div data-testid="host">
          <InquiryActions
            inquiryId={INQUIRY}
            actions={[]}
            canRedact={false}
            transition={vi.fn<Action>()}
            redact={vi.fn<Action>()}
          />
        </div>
      </ToastProvider>,
    );

    expect(within(container).getByTestId('host')).toBeEmptyDOMElement();
  });
});
