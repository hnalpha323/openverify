import type { ReportType } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { later } from '../../testing/later';
import { REPORT_IDS } from '../../testing/report-fixtures';
import { ToastProvider } from '../toasts';
import { CreateReportForm } from './create-report-form';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

interface Created {
  readonly id: string;
}
type Action = (state: ActionState<Created>, formData: FormData) => Promise<ActionResult<Created>>;

beforeEach(() => {
  router.push.mockReset();
});

function show(action: Action, type: ReportType = 'watchlist', canLinkAccounts = false) {
  render(
    <ToastProvider>
      <CreateReportForm
        type={type}
        templateId={REPORT_IDS.template}
        environmentId={ENVIRONMENTS.sandbox.id}
        canLinkAccounts={canLinkAccounts}
        action={action}
      />
    </ToastProvider>,
  );
}

const form = () => screen.getByRole('form', { name: 'Create report' });

describe('CreateReportForm (C72.1, C86)', () => {
  it('asks for every member of the type’s query, sends it under query/ and opens the new report', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: { id: REPORT_IDS.report } }));
    show(action, 'watchlist', true);

    await userEvent.type(within(form()).getByRole('textbox', { name: 'First name' }), 'Avery');
    await userEvent.type(
      within(form()).getByRole('textbox', { name: 'Last name' }),
      'Quillfeather',
    );
    await userEvent.selectOptions(
      within(form()).getByRole('combobox', { name: 'Gender' }),
      'female',
    );
    const extra = within(form()).getByRole('group', { name: 'Additional name 1' });
    await userEvent.type(
      within(extra).getByRole('textbox', { name: 'First name of additional name 1' }),
      'Ava',
    );
    await userEvent.type(
      within(form()).getByRole('textbox', { name: 'Account ID (optional)' }),
      REPORT_IDS.account,
    );
    await userEvent.click(within(form()).getByRole('button', { name: 'Create report' }));

    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/reports/${REPORT_IDS.report}`);
    });
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('type')).toBe('report/watchlist');
    expect(sent?.get('report-template-id')).toBe(REPORT_IDS.template);
    expect(sent?.get('environment-id')).toBe(ENVIRONMENTS.sandbox.id);
    expect(sent?.get('query/name-first')).toBe('Avery');
    expect(sent?.get('query/name-last')).toBe('Quillfeather');
    expect(sent?.get('query/gender')).toBe('female');
    expect(sent?.get('query/additional-names/0/name-first')).toBe('Ava');
    expect(sent?.get('account-id')).toBe(REPORT_IDS.account);
    expect(sent?.has('auto-create-account')).toBe(false);
  });

  it('shows the API’s 422 on its field by JSON Pointer, tied to it, and the summary without repeating it', async () => {
    const action = vi.fn<Action>(() =>
      later({
        ok: false,
        problem: {
          title: 'The query does not fit this report type.',
          detail: 'The query does not fit the report type.',
          code: 'report_query_invalid',
          errors: [
            { pointer: '/data/attributes/query/name-last', detail: 'must contain a letter' },
            {
              pointer: '/data/attributes/query/additional-names/0/name-first',
              detail: 'must contain a letter',
            },
          ],
        },
      }),
    );
    show(action);

    await userEvent.type(within(form()).getByRole('textbox', { name: 'Last name' }), '1234');
    await userEvent.click(within(form()).getByRole('button', { name: 'Create report' }));

    const last = within(form()).getByRole('textbox', { name: 'Last name' });
    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      'The query does not fit this report type.',
    );
    expect(last).toHaveAttribute('aria-invalid', 'true');
    expect(last).toHaveAccessibleDescription(/must contain a letter/);
    expect(last).toHaveValue('1234');
    const extra = within(form()).getByRole('group', { name: 'Additional name 1' });
    expect(
      within(extra).getByRole('textbox', { name: 'First name of additional name 1' }),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(within(form()).getByRole('alert')).not.toHaveTextContent('/data/attributes/query');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('takes a 500-character business website whole, the website member’s own limit (owner decision 24, R014)', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: { id: REPORT_IDS.report } }));
    show(action, 'business-watchlist');
    const website = `https://${'a'.repeat(480)}.example/abc`;
    expect(website).toHaveLength(500);

    const field = within(form()).getByRole('textbox', { name: 'Website' });
    expect(field).toHaveAttribute('maxlength', '500');
    await userEvent.type(
      within(form()).getByRole('textbox', { name: 'Company name' }),
      'Synthetic Holdings Ltd',
    );
    await userEvent.click(field);
    await userEvent.paste(website);
    expect(field).toHaveValue(website);
    await userEvent.click(within(form()).getByRole('button', { name: 'Create report' }));

    await vi.waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    expect(action.mock.calls[0]?.[1].get('query/website')).toBe(website);
  });

  it.each([
    ['business-watchlist', 'Company name', '300'],
    ['business-watchlist', 'Registration number', '100'],
    ['business-watchlist', 'Aircraft serial number', '50'],
    ['watchlist', 'Identification number', '100'],
    ['watchlist', 'First name of additional name 1', '300'],
    ['crypto-address-watchlist', 'Crypto address', '256'],
    ['crypto-address-watchlist', 'Chain (CAIP-2)', '64'],
    ['email-address', 'Email address', '254'],
    ['address-lookup', 'Addressee', '200'],
    ['address-lookup', 'City', '100'],
    ['address-lookup', 'Postal code', '20'],
  ] as const)(
    'gives the %s field %s the length limit its contract member states, %s (owner decision 24)',
    (type, name, limit) => {
      show(vi.fn<Action>(), type);

      expect(within(form()).getByRole('textbox', { name })).toHaveAttribute('maxlength', limit);
    },
  );

  it.each([
    ['business-watchlist', 'LEI'],
    ['business-watchlist', 'IMO number'],
    ['phone-number', 'Phone number (E.164)'],
    ['watchlist', 'Date of birth'],
  ] as const)(
    'sets no length limit on the %s field %s, whose contract member states none (its pattern decides; the API checks it)',
    (type, name) => {
      show(vi.fn<Action>(), type);

      expect(within(form()).getByRole('textbox', { name })).not.toHaveAttribute('maxlength');
    },
  );

  it('asks only what the type takes, and creates an account only when asked', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: { id: REPORT_IDS.report } }));
    show(action, 'email-address');

    expect(
      within(form())
        .getAllByRole('textbox')
        .map((box) => box.getAttribute('name')),
    ).toEqual(['query/email-address']);
    expect(within(form()).queryByRole('textbox', { name: 'Account ID (optional)' })).toBeNull();
    await userEvent.type(
      within(form()).getByRole('textbox', { name: 'Email address' }),
      'avery@example.test',
    );
    await userEvent.click(
      within(form()).getByRole('checkbox', { name: /Create a new account for this report/ }),
    );
    await userEvent.click(within(form()).getByRole('button', { name: 'Create report' }));

    await vi.waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    expect(action.mock.calls[0]?.[1].get('auto-create-account')).toBe('true');
  });
});
