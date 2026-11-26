/**
 * The account page's transactions slot (C108, F32). `dashboard-signals` created this stub with its
 * props frozen; `dashboard-lists-transactions` owns the file from then on and fills the body: the
 * account's transactions, which only `GET /accounts/:id?include=transactions` serves.
 *
 * The account page calls it as a function and awaits it, so it may be async and read the API
 * itself (`getApiClient()`); it is called only for a principal holding `transactions:read`. The
 * page puts what it returns inside its "Transactions" section, shows that section's forbidden panel
 * when the call throws the API's 403, and leaves the section out when it returns `null`.
 */
import type { TransactionResource } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { ReactNode } from 'react';
import { getApiClient } from '../../lib/api/client';
import { TransactionsTable } from './transactions-table';

export interface AccountTransactionsSectionProps {
  /** The account, `acc_…`. */
  readonly accountId: string;
  /** The principal's permissions, as `GET /dashboard/me` answered them. */
  readonly permissions: ReadonlySet<Permission>;
}

/**
 * The section's content, or `null` for none: the transactions the account read includes (C105.1:
 * those whose reference names the account, and those related to it), newest first as the API
 * answers them. `GET /transactions` has no account filter, so this is the only read of them. No
 * field value is shown here, masked or not: each transaction's page shows them.
 */
export const AccountTransactionsSection: (
  props: AccountTransactionsSectionProps,
) => Promise<ReactNode> = async ({ accountId, permissions }) => {
  if (!permissions.has('transactions:read')) {
    return null;
  }
  const api = await getApiClient();
  const document = await api.accounts.retrieve(accountId, { include: 'transactions' });
  const transactions = (document.included ?? []).filter(
    (resource): resource is TransactionResource => resource.type === 'transaction',
  );
  return (
    <TransactionsTable
      caption="Transactions of this account"
      transactions={transactions.map(withoutFields)}
      emptyMessage="No transaction names this account."
    />
  );
};

/** The row's transaction with no field value, so none reaches the page whatever the API showed. */
function withoutFields(transaction: TransactionResource): TransactionResource {
  return { ...transaction, attributes: { ...transaction.attributes, fields: null } };
}
