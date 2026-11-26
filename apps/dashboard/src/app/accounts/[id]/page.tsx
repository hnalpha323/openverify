import { idSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { AccountInquiryList } from '../../../components/lifecycle/account-inquiries';
import { AccountGraphSection } from '../../../components/graph/account-graph-section';
import { ObjectConnectSection } from '../../../components/connect/object-connect-section';
import { AccountView } from '../../../components/lifecycle/account-view';
import { inquirySummary } from '../../../components/lifecycle/inquiry-summary';
import { loadSection } from '../../../components/lifecycle/section-data';
import { AccountTransactionsSection } from '../../../components/transactions/account-transactions-section';
import { AccountActionsSection } from '../../../components/workflows/account-actions-section';
import { listInquiries } from '../../../lib/api/inquiries';
import { loadLinkedReports } from '../../../lib/api/reports';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import {
  addAccountInquiries,
  addAccountRelation,
  addAccountTag,
  consolidateAccounts,
  redactAccount,
  removeAccountInquiry,
  removeAccountRelation,
  removeAccountTag,
  setAccountTags,
  updateAccountFields,
  updateAccountStatus,
} from '../actions';
import { dismissListMatch } from '../../list-matches/actions';

export const metadata: Metadata = { title: 'Account' };

export interface AccountPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ACTIONS = {
  updateStatus: updateAccountStatus,
  addTag: addAccountTag,
  removeTag: removeAccountTag,
  setTags: setAccountTags,
  updateFields: updateAccountFields,
  addRelation: addAccountRelation,
  removeRelation: removeAccountRelation,
  consolidate: consolidateAccounts,
  addInquiries: addAccountInquiries,
  removeInquiry: removeAccountInquiry,
  redact: redactAccount,
  dismissListMatch,
};

/** List matches shown per account, newest first. */
const LIST_MATCH_PAGE_SIZE = 100;

/**
 * One account (C13, C23): the account, then its type, relations and inquiries at once. The
 * inquiries come from the dashboard list with `inquiries:read`, else as ids from the account.
 */
export default async function AccountPage({ params, searchParams }: AccountPageProps) {
  const { id } = await params;
  if (!idSchema('acc').safeParse(id).success) {
    notFound();
  }
  const after = parseCursor((await searchParams).after, 'inq');
  return renderPage({ permissions: ['accounts:read'] }, async ({ session, api }) => {
    const can = (permission: Permission) => hasPermission(session, permission);
    const { data: account } = await api.accounts.retrieve(id);
    const slotProps = { accountId: id, permissions: session.permissions };
    const [
      relations,
      accountType,
      inquiries,
      reports,
      listMatches,
      graph,
      transactions,
      workflowActions,
      connect,
    ] = await Promise.all([
      api.accounts.listRelations(id),
      api.accountTypes.retrieve(account.relationships['account-type'].data.id),
      can('inquiries:read')
        ? listInquiries({ statuses: [], tags: [], accountId: id }, after)
        : Promise.resolve(null),
      // C86: the account's reports, as home or linked account, as the masked list answers them.
      loadSection(can('reports:read'), () => loadLinkedReports({ accountId: id })),
      // C108: the account's list matches, newest first.
      loadSection(can('lists:read'), async () => {
        const page = await api.listMatches.list({
          filter: { 'account-id': id },
          page: { size: LIST_MATCH_PAGE_SIZE },
        });
        return page.data;
      }),
      // C108, F32: the slots of `dashboard-graph` and `dashboard-lists-transactions`, each called
      // only with the scope of the API route behind it.
      loadSection(can('graph:read'), () => AccountGraphSection(slotProps)),
      loadSection(can('transactions:read'), () => AccountTransactionsSection(slotProps)),
      // C118.7, C141.7, F32: the account actions, read by `GET /accounts/:id/available-actions`
      // (workflows:trigger and accounts:read).
      loadSection(can('workflows:trigger'), () => AccountActionsSection(slotProps)),
      // C242.3 (Workflow 11A console-connect, a named borrowed edit): the Connect slot.
      loadSection(true, () =>
        ObjectConnectSection({ subjectId: id, permissions: session.permissions }),
      ),
    ]);
    const list: AccountInquiryList =
      inquiries === null
        ? { kind: 'ids', ids: account.relationships.inquiries.data.map((inquiry) => inquiry.id) }
        : {
            kind: 'listed',
            items: inquiries.data.map(inquirySummary),
            nextCursor: cursorFromNextLink(inquiries.links.next, 'inq'),
          };
    return (
      <AccountView
        account={account}
        accountType={accountType.data}
        relations={relations.data}
        inquiries={list}
        inquiriesAfter={after}
        reports={reports}
        signals={inquiries === null ? { kind: 'hidden' } : { kind: 'ready', data: inquiries.data }}
        listMatches={listMatches}
        graph={graph}
        transactions={transactions}
        connect={connect}
        workflowActions={workflowActions}
        abilities={{
          write: can('accounts:write'),
          redact: can('accounts:redact'),
          piiView: can('pii:view'),
          reportTemplatesRead: can('report-templates:read'),
          listsRead: can('lists:read'),
          listsWrite: can('lists:write'),
        }}
        actions={ACTIONS}
      />
    );
  });
}
