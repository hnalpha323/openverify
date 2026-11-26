/**
 * C172.2 to C172.5 on the case page's forms: the status switcher names the fields and the checklist
 * items a status needs first and shows the actions placed in it; a preset comment is inserted into
 * the comment box, edited, and posted only when the operator adds the comment.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { later } from '../../../testing/later';
import { REVIEWER_IDS as IDS, STATUSES } from '../../../testing/reviewer-fixtures';
import { checklistState } from '../../../testing/routes/cases-reports';
import { checklistViews } from '../checklists/checklist-model';
import { ToastProvider } from '../../toasts';
import { CommentForm } from './case-forms';
import { StatusControl } from './status-control';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const succeed: Action = () => later({ ok: true, data: undefined });

const CHECKLISTS = checklistViews(
  [
    {
      key: 'kyc',
      label: 'Identity review',
      items: [
        { key: 'id-seen', label: 'Document seen', 'required-for-statuses': ['approved'] },
        { key: 'address-seen', label: 'Address seen', 'required-for-statuses': ['approved'] },
      ],
    },
  ],
  checklistState([{ checklist: 'kyc', item: 'id-seen', by: IDS.me }]).data.attributes.items,
);
const WITH_FIELDS = STATUSES.map((status) =>
  status.key === 'approved' ? { ...status, 'requires-fields': ['full-name'] } : status,
);

describe('StatusControl with the version’s requirements', () => {
  it('names the fields and the unchecked items the chosen status needs first', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <StatusControl
          caseId={IDS.case}
          lockVersion={3}
          current="open"
          statuses={WITH_FIELDS}
          transitions={{ open: ['pending', 'approved'] }}
          resolutions={[]}
          action={vi.fn(succeed)}
          checklists={CHECKLISTS}
          fieldLabels={new Map([['full-name', 'Full name']])}
          placedActions={<p>Placed in the switcher</p>}
        />
      </ToastProvider>,
    );

    expect(screen.getByText('Placed in the switcher')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: /New status/ }), 'approved');

    const fields = screen.getByRole('list', { name: 'Fields this status needs filled in first' });
    expect(fields).toHaveTextContent('Full name');
    const items = screen.getByRole('list', {
      name: 'Checklist items this status needs checked first',
    });
    expect(items).toHaveTextContent('Address seen');
    expect(items).not.toHaveTextContent('Document seen');

    await user.selectOptions(screen.getByRole('combobox', { name: /New status/ }), 'pending');
    expect(screen.getByText('Nothing has to be filled in or checked first.')).toBeVisible();
  });
});

describe('CommentForm with preset comments', () => {
  it('inserts a preset into the box to be edited, and posts nothing until the comment is added', async () => {
    const user = userEvent.setup();
    const action = vi.fn(succeed);
    render(
      <ToastProvider>
        <CommentForm
          caseId={IDS.case}
          people={[]}
          action={action}
          presets={[
            { key: 'docs', label: 'Asked for documents', text: 'We asked for a document.' },
          ]}
        />
      </ToastProvider>,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Preset comment' }), 'docs');
    await user.click(screen.getByRole('button', { name: 'Insert preset comment' }));

    const box = screen.getByRole('textbox', { name: 'New comment' });
    expect(box).toHaveValue('We asked for a document.');
    expect(action).not.toHaveBeenCalled();
    await user.type(box, ' Edited.');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(action).toHaveBeenCalledTimes(1);
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('message')).toBe('We asked for a document. Edited.');
  });

  it('offers no preset control when the version has none', () => {
    render(
      <ToastProvider>
        <CommentForm caseId={IDS.case} people={[]} action={vi.fn(succeed)} />
      </ToastProvider>,
    );

    expect(screen.queryByRole('combobox', { name: 'Preset comment' })).toBeNull();
  });
});
