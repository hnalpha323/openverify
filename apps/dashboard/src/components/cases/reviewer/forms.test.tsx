/**
 * The case page's client forms (C142.2 to C142.5): what each sends, what it says, and how it keeps
 * focus and announces outcomes politely (4.1.3). Server actions are stubbed to answer the way a real
 * one does, after a macrotask (`later`).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../../lib/action-state';
import { later } from '../../../testing/later';
import { REVIEWER_IDS as IDS, STATUSES } from '../../../testing/reviewer-fixtures';
import { ToastProvider } from '../../toasts';
import { AttachmentUpload } from './attachment-upload';
import { CaseActionForm } from './case-action-form';
import { AssignmentControl, CommentForm, SlaForm } from './case-forms';
import { PrintButton, PrintFooter } from './print-button';
import { StatusControl } from './status-control';

const refresh = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

/** `element`, or a failed test when it is missing. */
function present<Element>(element: Element | null | undefined): Element {
  if (element === null || element === undefined) {
    throw new Error('expected an element');
  }
  return element;
}

const ok = (): Promise<ActionResult> => later({ ok: true, data: undefined });

/**
 * The submit button named `name`, once its form is idle again. A form's toast is shown from
 * inside its action, before React ends the action's transition, so for a moment after the toast
 * every button of the control still reads its pending label ("Unassigning…") and is disabled. On
 * a loaded machine the scheduler yields inside that render, and a test that reads the toast as
 * "the action is done" finds no button by its idle name. This waits for the name itself.
 */
async function idleButton(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name });
  expect(button).toBeEnabled();
  return button;
}

function withToasts(node: React.ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

/** The fields an action received, as an object. */
const sent = (action: ReturnType<typeof vi.fn>, call = 0): Record<string, string> =>
  Object.fromEntries((action.mock.calls[call]?.[1] as FormData).entries()) as Record<
    string,
    string
  >;

describe('StatusControl', () => {
  const TRANSITIONS = { open: ['pending', 'approved', 'declined'] };

  it('asks for a resolution, a status tag and a comment only when the chosen status needs them', async () => {
    const user = userEvent.setup();
    const action = vi.fn(ok);
    withToasts(
      <StatusControl
        caseId={IDS.case}
        lockVersion={4}
        current="open"
        statuses={STATUSES}
        transitions={TRANSITIONS}
        resolutions={['Approved', 'Declined']}
        action={action}
      />,
    );

    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'New status' }), 'pending');
    expect(screen.getByText(/pauses the SLA/)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Resolution' })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'New status' }), 'declined');
    expect(screen.getByRole('combobox', { name: 'Resolution' })).toHaveValue('Declined');
    const tag = screen.getByRole('combobox', { name: 'Status tag' });
    expect(tag).toBeRequired();
    const comment = screen.getByRole('textbox', { name: 'Comment' });
    expect(comment).toBeRequired();
    await user.selectOptions(tag, 'fraud');
    await user.type(comment, 'Synthetic reason');
    await user.click(screen.getByRole('button', { name: 'Change status' }));

    expect(await screen.findByText('The status was changed.')).toBeVisible();
    expect(sent(action)).toMatchObject({
      'case-id': IDS.case,
      'lock-version': '4',
      status: 'declined',
      resolution: 'Declined',
      'status-tag': 'fraud',
      comment: 'Synthetic reason',
    });
  });

  it('says so when the version allows no move from the current status', () => {
    withToasts(
      <StatusControl
        caseId={IDS.case}
        lockVersion={4}
        current="approved"
        statuses={STATUSES}
        transitions={{ approved: [] }}
        resolutions={[]}
        action={vi.fn(ok)}
      />,
    );

    expect(screen.getByText('The version allows no move from this status.')).toBeVisible();
  });
});

describe('CommentForm', () => {
  it('inserts a mention token at the caret and sends the words as typed', async () => {
    const user = userEvent.setup();
    const action = vi.fn(ok);
    withToasts(
      <CommentForm
        caseId={IDS.case}
        people={[{ id: IDS.colleague, label: 'colleague@example.test' }]}
        action={action}
      />,
    );

    const text = screen.getByRole('textbox', { name: 'New comment' });
    await user.type(text, 'Please check ');
    expect(screen.getByRole('button', { name: 'Insert mention' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mention' }), IDS.colleague);
    await user.click(screen.getByRole('button', { name: 'Insert mention' }));
    expect(text).toHaveValue(`Please check @[${IDS.colleague}] `);
    expect(text).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(await screen.findByText('The comment was added.')).toBeVisible();
    expect(sent(action).message).toBe(`Please check @[${IDS.colleague}] `);
  });
});

describe('AssignmentControl', () => {
  it('assigns to oneself, to a member with cases:assign, and unassigns', async () => {
    const user = userEvent.setup();
    const action = vi.fn(ok);
    withToasts(
      <AssignmentControl
        caseId={IDS.case}
        lockVersion={4}
        viewerId={IDS.me}
        assigneeId={IDS.colleague}
        people={[
          { id: IDS.me, label: 'You' },
          { id: IDS.colleague, label: 'colleague@example.test' },
        ]}
        canAssignOthers
        action={action}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    await screen.findByText('The assignment was saved.');
    expect(sent(action, 0)['user-id']).toBe(IDS.me);
    expect(
      within(screen.getByRole('combobox', { name: 'Assign to' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a person', 'You']);
    await user.click(await idleButton('Unassign'));
    await vi.waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
    });
    expect(sent(action, 1)['user-id']).toBe('');
  });

  it('offers only oneself without cases:assign', () => {
    withToasts(
      <AssignmentControl
        caseId={IDS.case}
        lockVersion={4}
        viewerId={IDS.me}
        assigneeId={null}
        people={[{ id: IDS.colleague, label: 'colleague@example.test' }]}
        canAssignOthers={false}
        action={vi.fn(ok)}
      />,
    );

    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Assign to' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unassign' })).toBeNull();
  });
});

describe('SlaForm', () => {
  it('sets a deadline and clears it', async () => {
    const user = userEvent.setup();
    const action = vi.fn(ok);
    withToasts(<SlaForm caseId={IDS.case} hasSla action={action} />);

    await user.type(screen.getByRole('spinbutton', { name: 'Due in' }), '3');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Unit' }), 'days');
    await user.click(screen.getByRole('button', { name: 'Set SLA' }));
    await screen.findByText('The SLA was saved.');
    expect(sent(action)).toMatchObject({ amount: '3', unit: 'days' });
    await user.click(await idleButton('Clear SLA'));
    await vi.waitFor(() => {
      expect(sent(action, 1).clear).toBe('true');
    });
  });
});

describe('CaseActionForm', () => {
  it('sends each parameter with its type, and links the run it started', async () => {
    const user = userEvent.setup();
    const action = vi.fn(() =>
      later<ActionResult<{ runId: string }>>({ ok: true, data: { runId: IDS.run } }),
    );
    render(
      <CaseActionForm
        caseId={IDS.case}
        actionId={IDS.action}
        label="Re-screen the account"
        form={[
          { name: 'reference', type: 'string', required: true, 'prefilled-value': 'Prefilled' },
          { name: 'notify', type: 'boolean', required: false, 'prefilled-value': true },
          { name: 'detail', type: 'object', required: false, 'prefilled-value': { a: 1 } },
        ]}
        action={action}
      />,
    );

    const group = screen.getByRole('group', { name: 'Re-screen the account' });
    expect(within(group).getByRole('combobox', { name: /notify/ })).toHaveValue('true');
    expect(within(group).getByRole('textbox', { name: /detail/ })).toHaveValue('{"a":1}');
    await user.click(within(group).getByRole('button', { name: 'Run Re-screen the account' }));

    const status = await within(group).findByRole('link', { name: IDS.run });
    expect(status).toHaveAttribute('href', `/workflows/runs/${IDS.run}`);
    const data = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(data.get('parameter-type.reference')).toBe('string');
    expect(data.get('parameter-type.notify')).toBe('boolean');
    expect(data.get('parameter-type.detail')).toBe('object');
    expect(data.get('parameter.reference')).toBe('Prefilled');
  });
});

describe('CaseActionForm types (R012)', () => {
  it('enters a list or an object input as JSON in a text area, typed by the C115.3 DSL', () => {
    render(
      <CaseActionForm
        caseId={IDS.case}
        actionId={IDS.action}
        label="Escalate"
        form={[
          { name: 'inquiries', type: 'list<id<inq>>', required: true, 'prefilled-value': null },
          { name: 'detail', type: 'object{a:string}', required: false, 'prefilled-value': null },
        ]}
        action={vi.fn()}
      />,
    );

    const group = screen.getByRole('group', { name: 'Escalate' });
    expect(within(group).getByRole('textbox', { name: /inquiries/ }).tagName).toBe('TEXTAREA');
    expect(within(group).getByRole('textbox', { name: /detail/ }).tagName).toBe('TEXTAREA');
  });
});

describe('AttachmentUpload', () => {
  const file = (bytes: number, type = 'image/jpeg') =>
    new File([new Uint8Array(bytes)], 'synthetic.jpg', { type });

  it('posts the file to the streaming route and refreshes the page once it is stored', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(() => later(new Response('The file was uploaded.', { status: 201 })));
    vi.stubGlobal('fetch', fetch);
    render(<AttachmentUpload caseId={IDS.case} remaining={3} />);

    expect(screen.getByRole('status')).toHaveTextContent('3 more allowed');
    await user.upload(screen.getByLabelText('File'), file(10));
    // jsdom's constraint validation does not see a file set by user-event, so the form is
    // submitted directly; a browser submits it with the button.
    fireEvent.submit(present(screen.getByRole('button', { name: 'Upload' }).closest('form')));

    expect(await screen.findByText(/The file was uploaded\. It is scanned/)).toBeVisible();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/cases/${IDS.case}/attachments`);
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('says what the route answered for a refusal', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        later(new Response('Only JPEG, PNG, WebP or PDF files are accepted.', { status: 422 })),
      ),
    );
    render(<AttachmentUpload caseId={IDS.case} remaining={3} />);

    await user.upload(screen.getByLabelText('File'), file(10));
    // jsdom's constraint validation does not see a file set by user-event, so the form is
    // submitted directly; a browser submits it with the button.
    fireEvent.submit(present(screen.getByRole('button', { name: 'Upload' }).closest('form')));

    expect(
      await screen.findByText('Only JPEG, PNG, WebP or PDF files are accepted.'),
    ).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MiB before sending anything', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<AttachmentUpload caseId={IDS.case} remaining={3} />);
    const input = screen.getByLabelText('File');
    const big = file(10 * 1_048_576 + 1);

    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.submit(present(input.closest('form')));

    expect(await screen.findByText('The file is larger than 10 MiB.')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers no upload once the template allows no more files', () => {
    render(<AttachmentUpload caseId={IDS.case} remaining={0} />);

    expect(screen.queryByLabelText('File')).toBeNull();
    expect(screen.getByText('This case holds as many files as its template allows.')).toBeVisible();
  });
});

describe('PrintButton and PrintFooter', () => {
  it('records the print first and opens the print dialog only once it is recorded (C138.3)', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const action = vi.fn(ok);
    render(<PrintButton caseId={IDS.case} action={action} />);

    await user.click(screen.getByRole('button', { name: 'Print' }));

    await vi.waitFor(() => {
      expect(print).toHaveBeenCalledOnce();
    });
    expect(action.mock.invocationCallOrder[0]).toBeLessThan(print.mock.invocationCallOrder[0] ?? 0);
  });

  it('prints nothing when the print could not be recorded', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(
      <PrintButton
        caseId={IDS.case}
        action={() => later({ ok: false, problem: { title: 'You do not have access' } })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(await screen.findByText('You do not have access')).toBeVisible();
    expect(print).not.toHaveBeenCalled();
  });

  it('opens closed details for printing, closes them after, and stamps the footer', () => {
    render(
      <>
        <PrintButton caseId={IDS.case} action={vi.fn(ok)} />
        <details>
          <summary>More</summary>
          <p>Synthetic detail</p>
        </details>
        <PrintFooter environment="sandbox" caseId={IDS.case} operatorId={IDS.me} personalData />
      </>,
    );
    const details = present(document.querySelector('details'));

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(details.open).toBe(true);
    const footer = document.querySelector('[data-case-print-footer]');
    expect(footer).toHaveTextContent(
      `Environment: sandbox. Case ${IDS.case}. Printed by ${IDS.me} at`,
    );
    expect(footer).toHaveTextContent('Contains personal data.');

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(details.open).toBe(false);
  });
});
