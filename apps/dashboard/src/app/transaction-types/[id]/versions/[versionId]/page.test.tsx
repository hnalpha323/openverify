import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import {
  TRANSACTION_DEVELOPER,
  TRANSACTION_REVIEWER,
  serveTransactionType,
  serveTransactionTypeVersion,
} from '../../../../../testing/routes/transactions';
import {
  FIELD_SCHEMAS,
  TRANSACTION_IDS,
  transactionType,
  transactionTypeVersion,
} from '../../../../../testing/transactions-fixtures';
import TransactionTypeVersionPage from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveTransactionType(api, transactionType());
});

afterEach(() => {
  api.restore();
});

const element = (versionId: string = TRANSACTION_IDS.draft, id: string = TRANSACTION_IDS.type) =>
  TransactionTypeVersionPage({ params: Promise.resolve({ id, versionId }) });
const page = async (versionId?: string) =>
  render(<ToastProvider>{await element(versionId)}</ToastProvider>);

describe('one transaction type version (C104, C108)', () => {
  it('edits a draft as JSON documents with transaction-types:write, and offers to publish it', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionTypeVersion(api, transactionTypeVersion());

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Version 3' })).toBeVisible();
    const editor = screen.getByRole('form', { name: 'Edit the draft' });
    expect(
      JSON.parse(
        within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Fields' }).value,
      ),
    ).toEqual(FIELD_SCHEMAS);
    expect(
      JSON.parse(
        within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Statuses' }).value,
      ),
    ).toEqual(['created', 'approved', 'declined', 'needs review']);
    expect(within(editor).getByRole('textbox', { name: 'Relations' })).toBeVisible();
    expect(
      within(editor).getByRole('checkbox', { name: /^Allow card-like values in fields/u }),
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  it('shows a published version read-only, and a draft read-only without transaction-types:write', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });
    serveTransactionTypeVersion(
      api,
      transactionTypeVersion({ id: TRANSACTION_IDS.version, number: 2, status: 'published' }),
    );

    await page(TRANSACTION_IDS.version);

    expect(screen.queryByRole('form', { name: 'Edit the draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Fields' })).toHaveTextContent('receipt');
    expect(screen.getByText('Published')).toBeVisible();
  });

  it('answers not found for a version of another type', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });
    serveTransactionTypeVersion(api, transactionTypeVersion({ typeId: TRANSACTION_IDS.otherType }));

    await expect(element()).rejects.toThrow();
  });
});
