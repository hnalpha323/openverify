import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { CONSENT_EVIDENCE, consentRecord } from './connect-fixtures';
import { ConsentRecordsList } from './consent-records';

const action = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
const show = (records: Parameters<typeof ConsentRecordsList>[0]['records'], canWithdraw = true) =>
  render(
    <ToastProvider>
      <ConsentRecordsList records={records} canWithdraw={canWithdraw} withdraw={action} />
    </ToastProvider>,
  );
const record = (id: string) => screen.getByRole('article', { name: new RegExp(id) });
const detail = (scope: HTMLElement, term: string) =>
  within(scope).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('ConsentRecordsList (C242.3)', () => {
  it('shows a flow record: side, method, recipient, categories, the text by digest, expiry', () => {
    const flow = consentRecord('source-flow');
    show([flow]);

    const card = record(flow.id);
    expect(within(card).getByRole('heading')).toHaveTextContent('Source: consent to disclose');
    expect(detail(card, 'Method')).toHaveTextContent('Witnessed in the flow');
    expect(detail(card, 'Recipient')).toHaveTextContent('Example Partner');
    expect(detail(card, 'Status')).toHaveTextContent('Active');
    expect(detail(card, 'Text digest (SHA-256)')).toHaveTextContent(flow.attributes.text.sha256);
    expect(detail(card, 'Expires (UTC)')).toHaveTextContent(/2026/);
    expect(within(card).getByRole('button', { name: /Withdraw/ })).toBeInTheDocument();
  });

  it('labels an attested record "not witnessed" (C236.5, C236.9)', () => {
    const attested = consentRecord('destination-attested');
    show([attested]);

    expect(detail(record(attested.id), 'Method')).toHaveTextContent(
      'Attested by the operator, not witnessed',
    );
  });

  it('shows a decline as declined, with nothing to withdraw (C236.11)', () => {
    const declined = consentRecord('declined');
    show([declined]);

    const card = record(declined.id);
    expect(detail(card, 'Status')).toHaveTextContent('Declined');
    expect(card).toHaveTextContent('The person declined this share in the flow');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('shows who withdrew a record, how and why, with nothing more to withdraw', () => {
    const withdrawn = consentRecord('withdrawn', {
      'withdrawn-at': '2026-10-22T08:00:00.000Z',
      'withdrawal-reason': 'subject-request',
    });
    show([withdrawn]);

    const card = record(withdrawn.id);
    expect(detail(card, 'Withdrawn')).toHaveTextContent('Through the API');
    expect(detail(card, 'Withdrawn')).toHaveTextContent('The person asked');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('shows the stored text and the evidence only when the API served them (pii:view)', () => {
    const plain = consentRecord('source-flow');
    const { unmount } = show([plain]);
    expect(screen.queryByText(CONSENT_EVIDENCE['text-body'])).toBeNull();
    expect(screen.queryByText('Address')).toBeNull();
    unmount();

    const served = consentRecord('source-flow', CONSENT_EVIDENCE);
    show([served]);
    expect(screen.getByText(CONSENT_EVIDENCE['text-body'])).toBeInTheDocument();
    expect(detail(record(served.id), 'Address')).toHaveTextContent(CONSENT_EVIDENCE['ip-address']);
  });

  it('offers no withdrawal without connect-share-tokens:write', () => {
    show([consentRecord('source-flow')], false);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('confirms a withdrawal before posting it, with an optional reason', async () => {
    action.mockClear();
    const flow = consentRecord('source-flow');
    show([flow]);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Withdraw/ }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw this consent' });
    expect(dialog).toHaveTextContent('A copy already made is not recalled');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Reason/ }),
      'subject-request',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get('consent-record-id')).toBe(flow.id);
    expect(form.get('withdrawal-reason')).toBe('subject-request');
  });

  it('says when an object has no consent record', () => {
    show([]);

    expect(screen.getByText('No consent record names this object.')).toBeInTheDocument();
  });
});
