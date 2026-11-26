import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { REPORT_IDS } from '../../testing/report-fixtures';
import { ToastProvider } from '../toasts';
import { DismissMatchesButton, ReviewMatchesButton } from './match-dialogs';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const REASON_ERROR = {
  ok: false,
  problem: {
    title: 'Check the values you entered',
    detail: 'Some values are not valid.',
    errors: [
      {
        pointer: '/data/attributes/reason',
        detail: 'Too small: expected string to have >=1 characters',
      },
    ],
  },
} as const;

describe('DismissMatchesButton (C75.2)', () => {
  it('asks for a required reason in a dialog, ties its error to it, and sends the entry it names', async () => {
    const action = vi
      .fn<Action>()
      .mockReturnValueOnce(later(REASON_ERROR))
      .mockReturnValueOnce(later({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <DismissMatchesButton
          reportId={REPORT_IDS.report}
          label="Dismiss"
          accessibleLabel={`Dismiss match ${REPORT_IDS.match}`}
          title="Dismiss this match?"
          entityId="openverify-sandbox:SBX-1001"
          action={action}
        />
      </ToastProvider>,
    );
    const opener = screen.getByRole('button', { name: `Dismiss match ${REPORT_IDS.match}` });

    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Dismiss this match?' });
    const reason = within(dialog).getByRole('textbox', { name: /Reason/ });
    expect(reason).toHaveFocus();
    expect(reason).toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(
      await within(dialog).findByText('Too small: expected string to have >=1 characters'),
    ).toBeVisible();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription(/Too small: expected string to have >=1 characters/);
    expect(within(dialog).getByRole('alert')).not.toHaveTextContent('/data/attributes/reason');

    await userEvent.type(reason, 'Synthetic: a different person');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Dismissed.');
    expect(screen.queryByRole('dialog')).toBeNull();
    const sent = action.mock.calls[1]?.[1];
    expect(sent?.get('report-id')).toBe(REPORT_IDS.report);
    expect(sent?.get('reason')).toBe('Synthetic: a different person');
    expect(sent?.get('entity-id')).toBe('openverify-sandbox:SBX-1001');
    expect(sent?.has('dismiss-type')).toBe(false);
    expect(opener).toHaveFocus();
  });

  it('dismisses every open match when it names no entry, and one article as media', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <DismissMatchesButton
          reportId={REPORT_IDS.report}
          label="Dismiss all open matches"
          title="Dismiss every open match?"
          action={action}
        />
        <DismissMatchesButton
          reportId={REPORT_IDS.report}
          label="Dismiss"
          accessibleLabel="Dismiss article"
          title="Dismiss this article?"
          entityId="article:dd15433ebeadb6f6209c13d9381ca685"
          dismissType="media"
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all open matches' }));
    await userEvent.type(screen.getByRole('textbox', { name: /Reason/ }), 'Synthetic: all others');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss' }),
    );
    await screen.findByRole('status');
    expect(action.mock.calls[0]?.[1].has('entity-id')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss article' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /Reason/ }),
      'Synthetic: another person',
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss' }),
    );
    await vi.waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
    });
    expect(action.mock.calls[1]?.[1].get('dismiss-type')).toBe('media');
  });

  it('closes on Cancel without running the action, focus back on its button', async () => {
    const action = vi.fn<Action>();
    render(
      <ToastProvider>
        <DismissMatchesButton
          reportId={REPORT_IDS.report}
          label="Dismiss all open matches"
          title="Dismiss every open match?"
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss all open matches' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dismiss all open matches' })).toHaveFocus();
  });
});

describe('ReviewMatchesButton (C75.5)', () => {
  it('reviews one match with a status, a risk level, notify-on-change and a comment', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <ReviewMatchesButton
          reportId={REPORT_IDS.report}
          label="Review"
          accessibleLabel={`Review match ${REPORT_IDS.match}`}
          title="Review this match"
          recordToken={REPORT_IDS.match}
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: `Review match ${REPORT_IDS.match}` }));
    const dialog = screen.getByRole('dialog', { name: 'Review this match' });
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Review status' }),
      'true_positive',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Risk level' }),
      'material',
    );
    await userEvent.click(
      within(dialog).getByRole('checkbox', {
        name: /Alert me again when the entry or its risk data changes/,
      }),
    );
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Comment/ }),
      'Synthetic: the listed party',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save review' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Review saved.');
    const sent = action.mock.calls[0]?.[1];
    expect(Object.fromEntries(sent?.entries() ?? [])).toEqual({
      'report-id': REPORT_IDS.report,
      'review-type': 'record',
      'record-token': REPORT_IDS.match,
      'review-status': 'true_positive',
      'risk-level': 'material',
      'notify-on-change': 'true',
      comment: 'Synthetic: the listed party',
    });
  });

  it('says a false positive needs a comment, and shows the refusal on the comment', async () => {
    const action = vi.fn<Action>(() =>
      later({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            {
              pointer: '/data/attributes/comment',
              detail: 'a false_positive review is a dismissal and needs a comment',
            },
          ],
        },
      }),
    );
    render(
      <ToastProvider>
        <ReviewMatchesButton
          reportId={REPORT_IDS.report}
          label="Review all open matches"
          title="Review every open match"
          action={action}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Review all open matches' }));
    const dialog = screen.getByRole('dialog', { name: 'Review every open match' });
    const comment = within(dialog).getByRole('textbox', { name: /Comment/ });
    expect(comment).toBeRequired();
    expect(comment).toHaveAccessibleDescription(/Why you decided this/);
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Review status' }),
      'false_positive',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save review' }));

    expect(
      await within(dialog).findByText('a false_positive review is a dismissal and needs a comment'),
    ).toBeVisible();
    expect(comment).toHaveAttribute('aria-invalid', 'true');
    expect(action.mock.calls[0]?.[1].get('review-type')).toBe('all_records');
    expect(action.mock.calls[0]?.[1].has('record-token')).toBe(false);
  });
});
