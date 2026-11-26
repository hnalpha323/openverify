import { Alert, Checkbox } from '@openverify/ui';
import {
  idSchema,
  transactionRelationCursorSchema,
  transactionStatusChangeIdSchema,
  type TransactionLabelResource,
  type TransactionTypeResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { ObjectConnectSection } from '../../../components/connect/object-connect-section';
import { Detail } from '../../../components/detail';
import { SlotSection } from '../../../components/lifecycle/optional-section';
import { PageSection } from '../../../components/lifecycle/page-section';
import { loadSection } from '../../../components/lifecycle/section-data';
import { TagEditor } from '../../../components/lifecycle/tag-editor';
import { LINK_CLASS } from '../../../components/link-styles';
import { EmptyValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { RelatedObjects } from '../../../components/transactions/related-objects';
import {
  LABELS_CURSOR_PARAM,
  STATUS_CURSOR_PARAM,
  TransactionHistory,
} from '../../../components/transactions/transaction-history';
import {
  RELATIONS_CURSOR_PARAM,
  TransactionRelations,
} from '../../../components/transactions/transaction-relations';
import { TransactionFields } from '../../../components/transactions/transaction-fields';
import {
  AttachObjectsForm,
  LabelForm,
  RelationForm,
  StatusForm,
} from '../../../components/transactions/transaction-forms';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getTransaction } from '../../../lib/api/transactions';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import {
  addTransactionObjects,
  addTransactionRelation,
  addTransactionTag,
  labelTransaction,
  redactTransaction,
  redactTransactionBiometrics,
  removeTransactionObject,
  removeTransactionRelation,
  removeTransactionTag,
  setTransactionTags,
  updateTransactionStatus,
} from '../actions';

export const metadata: Metadata = { title: 'Transaction' };

export interface TransactionPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const REDACT_DESCRIPTION =
  'Its fields and files are erased now, except fields marked never; its tags, reference and status stay. This cannot be undone.';
const BIOMETRICS_DESCRIPTION =
  'The selfies, face templates, portraits and face or background list items of every related inquiry and verification are deleted. Other data stays. This cannot be undone.';
/** Rows per page of the status history, the labels and the relations. */
const HISTORY_PAGE_SIZE = 10;

/** The `page[after]` of a `links.next`, for the lists whose cursor is not an ID. */
function afterOf(next: string | null): string | null {
  return next === null ? null : new URL(next, 'http://api.invalid').searchParams.get('page[after]');
}

/**
 * One transaction (C105, C108): its fields masked member-wise by the API without `pii:view`
 * (C105.8), a file's content through the console's own route (P12), its status and latest label,
 * its status history and labels (K7B-4), related objects, relations (K7C-2) and tags, and redaction
 * and biometric redaction, each confirmed. Reads
 * `GET /transactions/:id?include=transaction-type,transaction-label`.
 */
export default async function TransactionPage({ params, searchParams }: TransactionPageProps) {
  const { id } = await params;
  if (!idSchema('txn').safeParse(id).success) {
    notFound();
  }
  const query = await searchParams;
  const statusAfter = transactionStatusChangeIdSchema.safeParse(query[STATUS_CURSOR_PARAM]).data;
  const labelsAfter = parseCursor(query[LABELS_CURSOR_PARAM], 'txnl');
  const relationsAfter = transactionRelationCursorSchema.safeParse(
    query[RELATIONS_CURSOR_PARAM],
  ).data;
  return renderPage({ permissions: ['transactions:read'] }, async ({ session, api }) => {
    const can = (...permissions: Permission[]) => hasPermission(session, ...permissions);
    const [document, statusChanges, labels, relations, connect] = await Promise.all([
      getTransaction(id),
      api.transactions.statusChanges(id, {
        page: {
          size: HISTORY_PAGE_SIZE,
          ...(statusAfter === undefined ? {} : { after: statusAfter }),
        },
      }),
      api.transactions.labels(id, {
        page: {
          size: HISTORY_PAGE_SIZE,
          ...(labelsAfter === undefined ? {} : { after: labelsAfter }),
        },
      }),
      api.transactions.relations(id, {
        page: {
          size: HISTORY_PAGE_SIZE,
          ...(relationsAfter === undefined ? {} : { after: relationsAfter }),
        },
      }),
      // C242.3 (Workflow 11A console-connect, a named borrowed edit; the page has no slot).
      loadSection(true, () =>
        ObjectConnectSection({ subjectId: id, permissions: session.permissions }),
      ),
    ]);
    const transaction = document.data;
    const included = document.included ?? [];
    const type = included.find(
      (resource): resource is TransactionTypeResource => resource.type === 'transaction-type',
    );
    const label = included.find(
      (resource): resource is TransactionLabelResource => resource.type === 'transaction-label',
    );
    const { attributes } = transaction;
    const redacted = attributes['redacted-at'] !== null;
    const canWrite = can('transactions:write') && !redacted;
    const typeId = transaction.relationships['transaction-type'].data.id;
    const ids = { 'transaction-id': transaction.id };

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Transactions', href: '/transactions' },
            { label: transaction.id },
          ]}
          title={`Transaction ${transaction.id}`}
          description={`Status: ${attributes.status}`}
          actions={
            <>
              {can('transactions:redact') && !redacted && (
                <ConfirmActionButton
                  label="Redact"
                  title="Redact this transaction?"
                  description={REDACT_DESCRIPTION}
                  confirmLabel="Redact transaction"
                  pendingLabel="Redacting…"
                  action={redactTransaction}
                  fields={ids}
                  successMessage="Redacted the transaction."
                >
                  <Checkbox
                    name="include-never"
                    label="Also erase the fields marked never (legal erasure)"
                    description="An audited override for an erasure the law requires."
                  />
                </ConfirmActionButton>
              )}
              {can('transactions:redact', 'inquiries:redact') &&
                attributes['biometrics-redacted-at'] === null && (
                  <ConfirmActionButton
                    label="Redact biometrics"
                    title="Redact the biometric data?"
                    description={BIOMETRICS_DESCRIPTION}
                    confirmLabel="Redact biometrics"
                    pendingLabel="Redacting…"
                    action={redactTransactionBiometrics}
                    fields={ids}
                    successMessage="Redacted the biometric data."
                  />
                )}
            </>
          }
        />
        {redacted && (
          <Alert tone="info" title="Redacted">
            <p>Its fields and files were erased; its tags, reference and status stay.</p>
            {/* K7C-2 item 5 (K9-2): the relation rows hold ids and keys only, and are served. */}
            <p>
              Its relations stay too, as the ids of the other objects: nothing of their data is
              copied here.
            </p>
          </Alert>
        )}

        <PageSection id="transaction-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Type">
              <Link href={`/transaction-types/${typeId}`} className={LINK_CLASS}>
                {type?.attributes.name ?? typeId}
              </Link>
            </Detail>
            <Detail term="Type version">{attributes['transaction-type-version-id']}</Detail>
            <Detail term="Reference">{attributes['reference-id'] ?? <EmptyValue />}</Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
            {attributes['redacted-at'] !== null && (
              <Detail term="Redacted (UTC)">
                <Timestamp value={attributes['redacted-at']} />
              </Detail>
            )}
            {attributes['biometrics-redacted-at'] !== null && (
              <Detail term="Biometrics redacted (UTC)">
                <Timestamp value={attributes['biometrics-redacted-at']} />
              </Detail>
            )}
          </dl>
        </PageSection>

        <PageSection
          id="transaction-fields"
          title="Fields"
          description="Personal data: each value shows only to operators with pii:view; its key and type always show."
        >
          <TransactionFields transaction={transaction} masked={!can('pii:view')} />
        </PageSection>

        <PageSection id="transaction-status" title="Status and labels">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Status">{attributes.status}</Detail>
            <Detail term="Latest label">
              {label?.attributes['model-label'] ?? <EmptyValue />}
            </Detail>
            <Detail term="Model version">
              {label?.attributes['model-version'] ?? <EmptyValue />}
            </Detail>
            <Detail term="Score">
              {label?.attributes.score === null || label === undefined ? (
                <EmptyValue />
              ) : (
                String(label.attributes.score)
              )}
            </Detail>
          </dl>
          <TransactionHistory
            transactionId={transaction.id}
            statusChanges={statusChanges}
            labels={labels}
            statusAfter={statusAfter}
            labelsAfter={labelsAfter}
            relationsAfter={relationsAfter}
            nextStatusCursor={
              transactionStatusChangeIdSchema.safeParse(afterOf(statusChanges.links.next)).data ??
              null
            }
            nextLabelsCursor={cursorFromNextLink(labels.links.next, 'txnl')}
            redacted={redacted}
          />
          {canWrite && (
            <>
              <StatusForm
                transactionId={transaction.id}
                status={attributes.status}
                statuses={type?.attributes.statuses ?? []}
                action={updateTransactionStatus}
              />
              <LabelForm transactionId={transaction.id} action={labelTransaction} />
            </>
          )}
        </PageSection>

        <PageSection id="transaction-objects" title="Related objects">
          <RelatedObjects
            transaction={transaction}
            detach={canWrite ? removeTransactionObject : undefined}
          />
          {canWrite && (
            <AttachObjectsForm transactionId={transaction.id} action={addTransactionObjects} />
          )}
        </PageSection>

        <PageSection id="transaction-relations" title="Relations">
          <TransactionRelations
            transactionId={transaction.id}
            relations={relations}
            after={relationsAfter}
            nextCursor={
              transactionRelationCursorSchema.safeParse(afterOf(relations.links.next)).data ?? null
            }
            otherCursors={{
              [STATUS_CURSOR_PARAM]: statusAfter,
              [LABELS_CURSOR_PARAM]: labelsAfter,
            }}
          />
          {canWrite &&
            ((type?.attributes['relation-schemas'] ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">
                This transaction’s type declares no relation.
              </p>
            ) : (
              <RelationForm
                transactionId={transaction.id}
                relations={type?.attributes['relation-schemas'] ?? []}
                add={addTransactionRelation}
                remove={removeTransactionRelation}
              />
            ))}
        </PageSection>

        <PageSection id="transaction-tags" title="Tags">
          <TagEditor
            tags={attributes.tags}
            fields={ids}
            canEdit={canWrite}
            addTag={addTransactionTag}
            removeTag={removeTransactionTag}
            setTags={setTransactionTags}
          />
        </PageSection>

        <SlotSection id="transaction-connect" title="Connect" data={connect} />
      </PageMain>
    );
  });
}
