import Link from 'next/link';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable, type Column } from '../data-table';
import type { InquirySummary } from '../inquiries-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Pagination } from '../pagination';
import { InquiryStatusBadge } from '../status-badge';
import { Timestamp } from '../timestamp';
import { AddInquiriesForm } from './add-inquiries-form';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/**
 * The account's inquiries: listed through the dashboard API (`inquiries:read`), or only their ids
 * from the account's relationship (its latest 100) without that permission.
 */
export type AccountInquiryList =
  | {
      readonly kind: 'listed';
      readonly items: readonly InquirySummary[];
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'ids'; readonly ids: readonly string[] };

export interface AccountInquiriesProps {
  readonly accountId: string;
  readonly inquiries: AccountInquiryList;
  /** `accounts:write`: link and unlink inquiries (`add-objects`, `remove-objects`). */
  readonly canEdit: boolean;
  /** The inquiry this page of the list started after. */
  readonly after?: string | undefined;
  readonly add: Action;
  readonly remove: Action;
}

/** The inquiries of an account (C13), each linkable and unlinkable with `accounts:write`. */
export function AccountInquiries({
  accountId,
  inquiries,
  canEdit,
  after,
  add,
  remove,
}: AccountInquiriesProps) {
  const columns: Column<InquirySummary>[] = [
    {
      id: 'id',
      header: 'Inquiry ID',
      rowHeader: true,
      cell: (inquiry) => (
        <Link href={`/inquiries/${inquiry.id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{inquiry.id}</code>
        </Link>
      ),
    },
    {
      id: 'reference',
      header: 'Reference ID',
      cell: (inquiry) => inquiry.referenceId ?? <EmptyValue />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (inquiry) => <InquiryStatusBadge status={inquiry.status} />,
    },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (inquiry) => <Timestamp value={inquiry.createdAt} />,
    },
  ];
  if (canEdit) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (inquiry) => (
        <ConfirmActionButton
          label="Remove"
          variant="secondary"
          title="Remove this inquiry from the account?"
          description="The inquiry stays; it no longer belongs to this account."
          confirmLabel="Remove inquiry"
          pendingLabel="Removing…"
          action={remove}
          fields={{ 'account-id': accountId, 'inquiry-id': inquiry.id }}
          successMessage="Removed the inquiry from the account."
        />
      ),
    });
  }

  let list;
  if (inquiries.kind === 'ids') {
    list =
      inquiries.ids.length === 0 ? (
        <p className="text-sm text-ink-muted">No inquiries belong to this account.</p>
      ) : (
        <ul aria-label="Account inquiries" className="flex flex-col gap-1">
          {inquiries.ids.map((id) => (
            <li key={id}>
              <code className="font-mono text-xs">{id}</code>
            </li>
          ))}
        </ul>
      );
  } else {
    list =
      inquiries.items.length === 0 && after === undefined ? (
        <p className="text-sm text-ink-muted">No inquiries belong to this account.</p>
      ) : (
        <>
          <DataTable
            caption="Account inquiries"
            captionHidden
            columns={columns}
            rows={inquiries.items}
            getRowKey={(inquiry) => inquiry.id}
            emptyMessage="No more inquiries."
          />
          <Pagination
            path={`/accounts/${accountId}`}
            query={{}}
            after={after}
            nextCursor={inquiries.nextCursor}
          />
        </>
      );
  }

  return (
    <div className="flex flex-col gap-4">
      {list}
      {canEdit && <AddInquiriesForm accountId={accountId} action={add} />}
    </div>
  );
}
