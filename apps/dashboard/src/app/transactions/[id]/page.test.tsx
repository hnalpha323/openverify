import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Permission } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { rscPayloadOf } from '../../../testing/rsc-payload';
import {
  TRANSACTIONS_PATH,
  TRANSACTION_REVIEWER,
  TRANSACTION_VIEWER,
  serveLabels,
  serveRelations,
  serveStatusChanges,
  serveTransaction,
} from '../../../testing/routes/transactions';
import {
  FILE_NAME,
  MASKED_FIELDS,
  NOTE_VALUE,
  TRANSACTION_IDS,
  statusChange,
  transaction,
  transactionLabel,
  transactionRelation,
  transactionType,
} from '../../../testing/transactions-fixtures';
import TransactionPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ID = TRANSACTION_IDS.transaction;
const PATH = `${TRANSACTIONS_PATH}/${ID}`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const as = (permissions: readonly Permission[]) => api.me({ permissions });
const element = (id: string = ID, searchParams: Record<string, string> = {}) =>
  TransactionPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });
const page = async (id?: string, searchParams?: Record<string, string>) =>
  render(<ToastProvider>{await element(id, searchParams)}</ToastProvider>);
const fields = () => screen.getByRole('table', { name: 'Fields' });
const fieldRow = (key: string) =>
  within(within(fields()).getByRole('rowheader', { name: key }).closest('tr') as HTMLElement);

const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name })).getAllByRole('row').slice(1);

const LABEL_CURSOR = 'txnl_01M5CK3190XEVBM5ZXA76E1JSN';
const RELATION_CURSOR = `2026-10-30T10:30:00.123456Z~payer~${TRANSACTION_IDS.account}`;
const OTHER_RELATION_CURSOR = `2026-10-29T10:30:00.123456Z~payer~${TRANSACTION_IDS.account}`;
const hrefOf = (query: Record<string, string>) =>
  `/transactions/${ID}?${new URLSearchParams(query).toString()}`;

describe('a transaction’s status history and labels (K7B-4, C108)', () => {
  beforeEach(() => {
    as(TRANSACTION_VIEWER);
    serveTransaction(api, transaction(), transactionType());
  });

  it('lists the status changes as served, newest first, with who moved each', async () => {
    serveStatusChanges(api, ID, [
      statusChange('42', { 'from-status': 'needs review', 'to-status': 'declined' }),
      statusChange('41', { 'from-status': null, 'to-status': 'created', 'actor-type': 'system' }),
    ]);

    await page();

    const [newest, oldest] = rowsOf('Status history');
    expect(newest).toHaveTextContent('needs review');
    expect(newest).toHaveTextContent('declined');
    expect(newest).toHaveTextContent('An API key');
    expect(newest).toHaveTextContent('Oct 30, 2026');
    expect(oldest).toHaveTextContent('The system');
  });

  it('reads a redacted row as redacted, not empty, and keeps who moved it and when', async () => {
    serveStatusChanges(api, ID, [
      statusChange('41', {
        'from-status': null,
        'to-status': null,
        'actor-type': 'user',
        'redacted-at': '2026-10-31T00:00:00.000Z',
      }),
    ]);

    await page();

    const history = screen.getByRole('table', { name: 'Status history' });
    const [row] = rowsOf('Status history');
    expect(within(history).getAllByText('Redacted')).toHaveLength(2);
    expect(row).toHaveTextContent('An operator');
    expect(row).toHaveTextContent('Oct 30, 2026');
  });

  it('lists the labels with their score and model version', async () => {
    serveLabels(api, ID, [transactionLabel()]);

    await page();

    const [row] = rowsOf('Labels');
    expect(row).toHaveTextContent('fraud');
    expect(row).toHaveTextContent('0.82');
    expect(row).toHaveTextContent('rules-7');
  });

  it('says when there is no history and no label yet', async () => {
    await page();

    expect(screen.getByRole('table', { name: 'Status history' })).toHaveTextContent(
      'No status change yet.',
    );
    expect(screen.getByRole('table', { name: 'Labels' })).toHaveTextContent('No label yet.');
  });

  it('never reads a redacted transaction’s empty label list as no label yet', async () => {
    serveTransaction(api, transaction({ redacted: true }), transactionType());

    await page();

    const labels = screen.getByRole('table', { name: 'Labels' });
    expect(labels).not.toHaveTextContent('No label yet.');
    expect(labels).toHaveTextContent('A redaction leaves no label to show.');
  });

  it('pages each list on its own, keeping the other’s cursor in the link', async () => {
    serveStatusChanges(
      api,
      ID,
      [statusChange('42')],
      `/api/v1/transactions/${ID}/status-changes?page[after]=41`,
    );
    serveLabels(
      api,
      ID,
      [transactionLabel()],
      `/api/v1/transactions/${ID}/labels?page[after]=${LABEL_CURSOR}`,
    );

    await page(ID, { 'status-after': '50', 'labels-after': LABEL_CURSOR });

    expect(
      Object.fromEntries(api.find('GET', `${PATH}/status-changes`)?.query ?? []),
    ).toMatchObject({ 'page[after]': '50' });
    expect(Object.fromEntries(api.find('GET', `${PATH}/labels`)?.query ?? [])).toMatchObject({
      'page[after]': LABEL_CURSOR,
    });
    const history = screen.getByRole('navigation', { name: 'Status history pages' });
    expect(within(history).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/transactions/${ID}?labels-after=${LABEL_CURSOR}&status-after=41`,
    );
    expect(within(history).getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      `/transactions/${ID}?labels-after=${LABEL_CURSOR}`,
    );
    const labels = screen.getByRole('navigation', { name: 'Label pages' });
    expect(within(labels).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/transactions/${ID}?status-after=50&labels-after=${LABEL_CURSOR}`,
    );
  });

  it('ignores a cursor that is no row of the list', async () => {
    await page(ID, { 'status-after': 'not-a-row', 'labels-after': 'txn_nope' });

    expect(api.find('GET', `${PATH}/status-changes`)?.query.get('page[after]')).toBeNull();
    expect(api.find('GET', `${PATH}/labels`)?.query.get('page[after]')).toBeNull();
  });
});

describe('a transaction’s relations (K7C-2, C108)', () => {
  const account = { type: 'account', id: TRANSACTION_IDS.account } as const;
  const other = { type: 'transaction', id: TRANSACTION_IDS.otherTransaction } as const;

  beforeEach(() => {
    as(TRANSACTION_VIEWER);
    serveTransaction(api, transaction(), transactionType());
  });

  it('lists them as served, newest first, each target in words and linked to its page', async () => {
    serveRelations(api, ID, [
      transactionRelation('refund-of', other),
      transactionRelation('payer', account, '2026-10-29T09:00:00.000Z'),
    ]);

    await page();

    const [newest, oldest] = rowsOf('Relations');
    expect(newest).toHaveTextContent('refund-of');
    expect(newest).toHaveTextContent('Transaction');
    expect(newest).toHaveTextContent('Oct 30, 2026');
    expect(oldest).toHaveTextContent('payer');
    expect(oldest).toHaveTextContent('Account');
    expect(oldest).toHaveTextContent('Oct 29, 2026');
    const table = within(screen.getByRole('table', { name: 'Relations' }));
    expect(table.getByRole('link', { name: other.id })).toHaveAttribute(
      'href',
      `/transactions/${other.id}`,
    );
    expect(table.getByRole('link', { name: account.id })).toHaveAttribute(
      'href',
      `/accounts/${account.id}`,
    );
  });

  it('shows a viewer the list and no form, and no note of a missing route', async () => {
    serveRelations(api, ID, [transactionRelation('payer', account)]);

    await page();

    expect(rowsOf('Relations')).toHaveLength(1);
    expect(screen.queryByRole('form', { name: 'Relations' })).toBeNull();
    expect(screen.queryByText(/serves no list/u)).toBeNull();
  });

  it('shows an operator with transactions:write the list above the form', async () => {
    as(TRANSACTION_REVIEWER);
    serveRelations(api, ID, [transactionRelation('payer', account)]);

    await page();

    expect(rowsOf('Relations')).toHaveLength(1);
    expect(screen.getByRole('form', { name: 'Relations' })).toBeVisible();
    expect(screen.queryByText(/serves no list/u)).toBeNull();
  });

  it('keeps the relations of a redacted transaction, with no form', async () => {
    as(TRANSACTION_REVIEWER);
    serveTransaction(api, transaction({ redacted: true }), transactionType());
    serveRelations(api, ID, [transactionRelation('payer', account)]);

    await page();

    expect(rowsOf('Relations')).toHaveLength(1);
    expect(screen.queryByRole('form', { name: 'Relations' })).toBeNull();
  });

  it('says in its alert that a redacted transaction keeps its relations, by id only (K7C-2 item 5; K9-2)', async () => {
    as(TRANSACTION_REVIEWER);
    serveTransaction(api, transaction({ redacted: true }), transactionType());
    serveRelations(api, ID, [transactionRelation('payer', account)]);

    await page();

    const alert = screen.getByText(/^Its fields and files were erased/u).closest('[role]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent(
      'Its relations stay too, as the ids of the other objects: nothing of their data is copied here.',
    );
  });

  it('says when no relation is set', async () => {
    await page();

    expect(screen.getByRole('table', { name: 'Relations' })).toHaveTextContent(
      'No relation is set.',
    );
  });

  it('pages on its own cursor, and every list’s links keep it', async () => {
    serveStatusChanges(
      api,
      ID,
      [statusChange('42')],
      `/api/v1/transactions/${ID}/status-changes?page[after]=41`,
    );
    serveLabels(
      api,
      ID,
      [transactionLabel()],
      `/api/v1/transactions/${ID}/labels?page[after]=${LABEL_CURSOR}`,
    );
    serveRelations(
      api,
      ID,
      [transactionRelation('payer', account)],
      `/api/v1/transactions/${ID}/relations?page[after]=${encodeURIComponent(OTHER_RELATION_CURSOR)}`,
    );
    const others = { 'status-after': '50', 'labels-after': LABEL_CURSOR };

    await page(ID, { ...others, 'relations-after': RELATION_CURSOR });

    expect(api.find('GET', `${PATH}/relations`)?.query.get('page[after]')).toBe(RELATION_CURSOR);
    const relations = within(screen.getByRole('navigation', { name: 'Relation pages' }));
    expect(relations.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      hrefOf({ ...others, 'relations-after': OTHER_RELATION_CURSOR }),
    );
    expect(relations.getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      hrefOf(others),
    );
    const history = within(screen.getByRole('navigation', { name: 'Status history pages' }));
    expect(history.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      hrefOf({
        'labels-after': LABEL_CURSOR,
        'relations-after': RELATION_CURSOR,
        'status-after': '41',
      }),
    );
    const labels = within(screen.getByRole('navigation', { name: 'Label pages' }));
    expect(labels.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      hrefOf({
        'status-after': '50',
        'relations-after': RELATION_CURSOR,
        'labels-after': LABEL_CURSOR,
      }),
    );
  });

  it('ignores a cursor that is no position, and offers no next page past a cursor it cannot read', async () => {
    serveRelations(
      api,
      ID,
      [transactionRelation('payer', account)],
      `/api/v1/transactions/${ID}/relations?page[after]=not-a-position`,
    );

    await page(ID, { 'relations-after': 'not-a-position' });

    expect(api.find('GET', `${PATH}/relations`)?.query.get('page[after]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Relation pages' })).toBeNull();
  });
});

describe('one transaction (C105, C108)', () => {
  it('shows its fields with their values, types and the file link to an operator with pii:view', async () => {
    as(TRANSACTION_REVIEWER);
    serveTransaction(api, transaction(), transactionType());

    await page();

    expect(screen.getByRole('heading', { level: 1, name: `Transaction ${ID}` })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', PATH)?.query ?? [])).toEqual({
      include: 'transaction-type,transaction-label',
    });
    expect(fieldRow('note').getByText(NOTE_VALUE)).toBeVisible();
    expect(fieldRow('note').getByText('Text')).toBeVisible();
    expect(fieldRow('amount').getByText('42.5')).toBeVisible();
    expect(
      fieldRow('receipt').getByRole('link', { name: `Download ${FILE_NAME}` }),
    ).toHaveAttribute('href', `/transactions/${ID}/files/${TRANSACTION_IDS.file}/content`);
    expect(fieldRow('receipt').getByText('application/pdf, 2,048 bytes')).toBeVisible();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByRole('link', { name: 'Synthetic order' })).toHaveAttribute(
      'href',
      `/transaction-types/${TRANSACTION_IDS.type}`,
    );
    expect(within(details).getByText('order-0001')).toBeVisible();
  });

  it('masks every field value member-wise without pii:view, keeping each key and type, and the RSC payload holds none', async () => {
    as(TRANSACTION_VIEWER);
    serveTransaction(api, transaction({ fields: MASKED_FIELDS }), transactionType());

    await page();

    for (const key of ['note', 'amount', 'receipt']) {
      expect(fieldRow(key).getByText('Hidden')).toBeVisible();
    }
    expect(fieldRow('receipt').getByText('File')).toBeVisible();
    expect(within(fields()).queryByRole('link')).toBeNull();
    const payload = await rscPayloadOf(await element());
    expect(payload).not.toContain(NOTE_VALUE);
    expect(payload).not.toContain(FILE_NAME);

    // The control: the same search finds them when the API shows them.
    serveTransaction(api, transaction(), transactionType());
    const shown = await rscPayloadOf(await element());
    expect(shown).toContain(NOTE_VALUE);
    expect(shown).toContain(FILE_NAME);
  });

  it('shows the latest label, with no note of a missing route', async () => {
    as(TRANSACTION_VIEWER);
    serveTransaction(api, transaction(), transactionType());

    await page();

    const labels = screen.getByRole('region', { name: 'Status and labels' });
    expect(within(labels).getByText('created')).toBeVisible();
    expect(within(labels).getByText('fraud')).toBeVisible();
    expect(within(labels).getByText('rules-7')).toBeVisible();
    expect(within(labels).getByText('0.82')).toBeVisible();
    expect(within(labels).queryByText(/no route/)).toBeNull();
    expect(within(labels).queryByRole('form')).toBeNull();
  });

  it('lists the related objects, each linked where the console has a page', async () => {
    as(TRANSACTION_VIEWER);
    serveTransaction(api, transaction(), transactionType());

    await page();

    const objects = screen.getByRole('table', { name: 'Related objects' });
    expect(within(objects).getByRole('link', { name: TRANSACTION_IDS.account })).toHaveAttribute(
      'href',
      `/accounts/${TRANSACTION_IDS.account}`,
    );
    expect(within(objects).getByRole('link', { name: TRANSACTION_IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${TRANSACTION_IDS.inquiry}`,
    );
    expect(within(objects).getByText(TRANSACTION_IDS.verification)).toBeVisible();
    expect(within(objects).getByText('Selfie verification')).toBeVisible();
  });

  it('offers the status, label, objects, relations and tags to an operator with transactions:write', async () => {
    as(TRANSACTION_REVIEWER);
    serveTransaction(api, transaction(), transactionType());

    await page();

    const status = screen.getByRole('form', { name: 'Change the status' });
    const select = within(status).getByRole<HTMLSelectElement>('combobox', { name: 'Status' });
    expect([...select.options].map((option) => option.value)).toEqual([
      'created',
      'approved',
      'declined',
      'needs review',
    ]);
    expect(select).toHaveValue('created');
    expect(screen.getByRole('form', { name: 'Add a label' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Attach objects' })).toBeVisible();
    expect(screen.getByRole('button', { name: `Detach ${TRANSACTION_IDS.inquiry}` })).toBeVisible();
    expect(screen.queryByRole('button', { name: `Detach ${TRANSACTION_IDS.account}` })).toBeNull();
    const relation = screen.getByRole('form', { name: 'Relations' });
    expect(within(relation).getByRole('combobox', { name: 'Relation' })).toHaveValue('payer');
    expect(within(relation).getByRole('textbox', { name: /^Target ID/u })).toBeRequired();
    expect(screen.getByRole('list', { name: 'Tags' })).toHaveTextContent('priority');
  });

  it('confirms a redaction, and offers biometric redaction only with inquiries:redact too', async () => {
    const user = userEvent.setup();
    as(TRANSACTION_REVIEWER);
    serveTransaction(api, transaction(), transactionType());
    const { unmount } = await page();

    expect(screen.queryByRole('button', { name: 'Redact biometrics' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Redact' }));
    const dialog = screen.getByRole('dialog', { name: 'Redact this transaction?' });
    expect(dialog).toHaveTextContent(
      'Its fields and files are erased now, except fields marked never; its tags, reference and status stay. This cannot be undone.',
    );
    expect(
      within(dialog).getByRole('checkbox', { name: /^Also erase the fields marked never/u }),
    ).not.toBeChecked();
    unmount();

    as([...TRANSACTION_REVIEWER, 'inquiries:redact']);
    await page();
    await user.click(screen.getByRole('button', { name: 'Redact biometrics' }));
    expect(screen.getByRole('dialog', { name: 'Redact the biometric data?' })).toHaveTextContent(
      'The selfies, face templates, portraits and face or background list items of every related inquiry and verification are deleted. Other data stays. This cannot be undone.',
    );
  });

  it('says a redacted transaction is redacted, and offers no change', async () => {
    as(TRANSACTION_REVIEWER);
    serveTransaction(
      api,
      transaction({ redacted: true, biometricsRedacted: true }),
      transactionType(),
      false,
    );

    await page();

    expect(
      screen.getByText('Its fields and files were erased; its tags, reference and status stay.'),
    ).toBeVisible();
    expect(screen.getByText('The fields were redacted.')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Change the status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redact' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Details' })).getByText(
        'Biometrics redacted (UTC)',
      ),
    ).toBeVisible();
  });

  it('answers not found for an id that is not a transaction id, and the forbidden panel without transactions:read', async () => {
    as(TRANSACTION_VIEWER);
    await expect(element('nope')).rejects.toThrow();

    as(['inquiries:read']);
    await page();
    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
