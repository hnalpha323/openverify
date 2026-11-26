import type {
  TransactionLabelListDocument,
  TransactionStatusChangeListDocument,
  TransactionStatusChangeResource,
} from '@openverify/contracts';
import { DataTable } from '../data-table';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue } from '../masked-value';
import { Pagination } from '../pagination';
import { Timestamp } from '../timestamp';
import { RELATIONS_CURSOR_PARAM } from './transaction-relations';
import { STATUS_CHANGE_ACTOR_WORDS } from './transaction-words';

/** The URL parameters of the two lists' cursors. */
export const STATUS_CURSOR_PARAM = 'status-after';
export const LABELS_CURSOR_PARAM = 'labels-after';

export interface TransactionHistoryProps {
  readonly transactionId: string;
  readonly statusChanges: TransactionStatusChangeListDocument;
  readonly labels: TransactionLabelListDocument;
  readonly statusAfter: string | undefined;
  readonly labelsAfter: string | undefined;
  /** The relation list's cursor, kept in these lists' links. */
  readonly relationsAfter: string | undefined;
  /** The next pages' cursors, `null` on a last page. */
  readonly nextStatusCursor: string | null;
  readonly nextLabelsCursor: string | null;
  /** A redaction leaves out the labels, so an empty list is not "no label yet". */
  readonly redacted: boolean;
}

/** One end of a status change: a redacted one is "Redacted", a first status has no `from`. */
function statusCell(status: string | null, change: TransactionStatusChangeResource) {
  if (status !== null) {
    return status;
  }
  return change.attributes['redacted-at'] === null ? <EmptyValue /> : <RedactedValue />;
}

/**
 * Owner decision 8 after Workflow 7B (K7B-4-console, C108): the transaction's append-only status
 * history and its labels, newest first, each with its own cursor in the URL so that paging one
 * keeps the other. A redacted status reads "Redacted", and who moved it and when stay.
 */
export function TransactionHistory({
  transactionId,
  statusChanges,
  labels,
  statusAfter,
  labelsAfter,
  relationsAfter,
  nextStatusCursor,
  nextLabelsCursor,
  redacted,
}: TransactionHistoryProps) {
  const path = `/transactions/${transactionId}`;
  return (
    <>
      <DataTable
        caption="Status history"
        columns={[
          {
            id: 'when',
            header: 'When (UTC)',
            rowHeader: true,
            cell: (change) => <Timestamp value={change.attributes['created-at']} />,
          },
          {
            id: 'from',
            header: 'From',
            cell: (change) => statusCell(change.attributes['from-status'], change),
          },
          {
            id: 'to',
            header: 'To',
            cell: (change) => statusCell(change.attributes['to-status'], change),
          },
          {
            id: 'actor',
            header: 'By',
            cell: (change) => STATUS_CHANGE_ACTOR_WORDS[change.attributes['actor-type']],
          },
        ]}
        rows={statusChanges.data}
        getRowKey={(change) => change.id}
        emptyMessage="No status change yet."
      />
      <Pagination
        path={path}
        query={{ [LABELS_CURSOR_PARAM]: labelsAfter, [RELATIONS_CURSOR_PARAM]: relationsAfter }}
        param={STATUS_CURSOR_PARAM}
        label="Status history pages"
        after={statusAfter}
        nextCursor={nextStatusCursor}
      />
      <DataTable
        caption="Labels"
        columns={[
          {
            id: 'label',
            header: 'Label',
            rowHeader: true,
            cell: (label) => label.attributes['model-label'],
          },
          {
            id: 'score',
            header: 'Score',
            cell: (label) =>
              label.attributes.score === null ? <EmptyValue /> : String(label.attributes.score),
          },
          {
            id: 'model',
            header: 'Model version',
            cell: (label) => label.attributes['model-version'] ?? <EmptyValue />,
          },
          {
            id: 'when',
            header: 'When (UTC)',
            cell: (label) => <Timestamp value={label.attributes['created-at']} />,
          },
        ]}
        rows={labels.data}
        getRowKey={(label) => label.id}
        emptyMessage={redacted ? 'A redaction leaves no label to show.' : 'No label yet.'}
      />
      <Pagination
        path={path}
        query={{ [STATUS_CURSOR_PARAM]: statusAfter, [RELATIONS_CURSOR_PARAM]: relationsAfter }}
        param={LABELS_CURSOR_PARAM}
        label="Label pages"
        after={labelsAfter}
        nextCursor={nextLabelsCursor}
      />
    </>
  );
}
