import type { TransactionRelationListDocument } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Pagination } from '../pagination';
import { Timestamp } from '../timestamp';
import { RELATION_TARGET_WORDS } from './transaction-words';

type Relation = TransactionRelationListDocument['data'][number];
type Target = Relation['attributes']['target'];

/** The URL parameter of the list's cursor. */
export const RELATIONS_CURSOR_PARAM = 'relations-after';

/** A target's kind in words, and the console's page for it. */
const TARGETS: Readonly<Record<Target['type'], { readonly kind: string; readonly path: string }>> =
  Object.freeze({
    account: { kind: RELATION_TARGET_WORDS.account, path: '/accounts' },
    transaction: { kind: RELATION_TARGET_WORDS.transaction, path: '/transactions' },
  });

export interface TransactionRelationsProps {
  readonly transactionId: string;
  readonly relations: TransactionRelationListDocument;
  readonly after: string | undefined;
  /** The next page's cursor, `null` on a last page. */
  readonly nextCursor: string | null;
  /** The cursors of the page's other lists, kept in this list's links. */
  readonly otherCursors: Readonly<Record<string, string | undefined>>;
}

/**
 * K7C-2 (C105.2, C108): the relations set on a transaction, newest first, with their own cursor in
 * the URL. The API serves each target by its id, so the list shows the id and links to its page.
 */
export function TransactionRelations({
  transactionId,
  relations,
  after,
  nextCursor,
  otherCursors,
}: TransactionRelationsProps) {
  return (
    <>
      <DataTable
        caption="Relations"
        captionHidden
        rows={relations.data}
        getRowKey={(relation) => relation.id}
        emptyMessage="No relation is set."
        columns={[
          {
            id: 'target',
            header: 'Target',
            rowHeader: true,
            cell: ({ attributes: { target } }) => (
              <Link href={`${TARGETS[target.type].path}/${target.id}`} className={LINK_CLASS}>
                {target.id}
              </Link>
            ),
          },
          {
            id: 'kind',
            header: 'Kind',
            cell: (relation) => TARGETS[relation.attributes.target.type].kind,
          },
          {
            id: 'relation',
            header: 'Relation',
            cell: (relation) => relation.attributes['relation-schema-key'],
          },
          {
            id: 'when',
            header: 'Set (UTC)',
            cell: (relation) => <Timestamp value={relation.attributes['created-at']} />,
          },
        ]}
      />
      <Pagination
        path={`/transactions/${transactionId}`}
        query={otherCursors}
        param={RELATIONS_CURSOR_PARAM}
        label="Relation pages"
        after={after}
        nextCursor={nextCursor}
      />
    </>
  );
}
