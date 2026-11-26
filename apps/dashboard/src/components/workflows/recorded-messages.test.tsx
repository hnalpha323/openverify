/**
 * The recorded-messages search of the test-run panel (C126.4): the recipient goes in a form post,
 * never the URL, and each record reads "Recorded (sandbox)", never "sent".
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { later } from '../../testing/later';
import { RecordedMessages, type RecordedMessageRow } from './recorded-messages';

const RUN = 'wfr_01MB0000000000000000000007';

const row = (subject: string | null, text: string | null): RecordedMessageRow => ({
  messageRef: 'ref-1',
  stepId: 'send_email',
  recordedAt: '2026-11-01T09:05:00.000Z',
  subject,
  text,
});

const answering = (records: readonly RecordedMessageRow[]) =>
  vi.fn(() =>
    later<ActionResult<{ readonly records: readonly RecordedMessageRow[] }>>({
      ok: true,
      data: { records },
    }),
  );

describe('RecordedMessages (C126.4)', () => {
  it('posts the kind and recipient with the run, and lists what was recorded in words', async () => {
    const user = userEvent.setup();
    const action = answering([row('Synthetic subject', 'Synthetic body')]);
    render(<RecordedMessages runId={RUN} action={action} />);

    const form = screen.getByRole('form', { name: 'Find recorded messages' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'email');
    await user.type(within(form).getByRole('textbox', { name: 'Recipient' }), 'person@example.com');
    await user.click(within(form).getByRole('button', { name: 'Find messages' }));

    const table = await screen.findByRole('table', { name: 'Recorded messages' });
    expect(table).toHaveTextContent('send_email');
    expect(table).toHaveTextContent('Synthetic subject');
    expect(table).toHaveTextContent('Synthetic body');
    expect(table).toHaveTextContent('Recorded (sandbox)');
    const sent = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(sent.entries())).toMatchObject({
      'run-id': RUN,
      kind: 'email',
      recipient: 'person@example.com',
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 message recorded by this run.');
  });

  it('says a withheld body is hidden without pii:view, never empty', async () => {
    const user = userEvent.setup();
    render(<RecordedMessages runId={RUN} action={answering([row(null, null)])} />);

    await user.type(screen.getByRole('textbox', { name: 'Recipient' }), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Find messages' }));

    const table = await screen.findByRole('table', { name: 'Recorded messages' });
    expect(table).toHaveTextContent('Hidden without pii:view');
  });

  it('says when the run recorded nothing for that recipient', async () => {
    const user = userEvent.setup();
    render(<RecordedMessages runId={RUN} action={answering([])} />);

    await user.type(screen.getByRole('textbox', { name: 'Recipient' }), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Find messages' }));

    expect(
      await screen.findByText('This run recorded no message for that recipient.'),
    ).toBeVisible();
  });
});
