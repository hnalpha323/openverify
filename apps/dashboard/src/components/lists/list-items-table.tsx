import type { ListItemResource } from '@openverify/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, HiddenValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { ListItemStatusBadge } from './list-badges';
import { kindOfListType } from './list-words';
import { formatCount } from './lists-table';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const MATCH_TYPE_LABELS: Readonly<Record<string, string>> = {
  email_address: 'Whole address',
  domain: 'Domain',
};

const classLabel = (idClass: string) =>
  `${idClass.charAt(0).toUpperCase()}${idClass.slice(1).replaceAll('_', ' ')}`;

const inquiryLink = (id: string | null) =>
  id === null ? (
    <EmptyValue />
  ) : (
    <Link href={`/inquiries/${id}`} className={LINK_CLASS}>
      {id}
    </Link>
  );

/** PII values in the order they read; `null` everywhere is hidden (masked) or gone (redacted). */
function piiText(values: readonly unknown[], masked: boolean): ReactNode {
  if (values.every((value) => value === null || value === undefined)) {
    return masked ? <HiddenValue /> : <EmptyValue />;
  }
  return values
    .filter((value) => value !== null && value !== undefined)
    .map(String)
    .join(' ');
}

/**
 * An item's value as the API served it (C97.6): every value but a country code is masked
 * without `pii:view`, and `null` once redacted. The console never unmasks.
 */
function ItemValue({
  item,
  masked,
}: {
  readonly item: ListItemResource;
  readonly masked: boolean;
}) {
  if (item.attributes['redacted-at'] !== null) {
    return <>Redacted</>;
  }
  const attributes = item.attributes as Readonly<Record<string, unknown>>;
  const text = (name: string) => attributes[name];
  switch (kindOfListType(item.type)) {
    case 'country': {
      const code = text('country-code');
      return typeof code === 'string' ? <>{code}</> : <EmptyValue />;
    }
    case 'email-address':
      return (
        <div className="flex flex-col">
          <span>{piiText([text('value')], masked)}</span>
          <span className="text-xs text-ink-muted">
            {MATCH_TYPE_LABELS[String(text('match-type'))]}
          </span>
        </div>
      );
    case 'face':
      return (
        <div className="flex flex-col">
          <span>From {inquiryLink(text('source-inquiry-id') as string | null)}</span>
          <span className="text-xs text-ink-muted">
            {text('model') === null ? 'Not embedded yet' : `Model ${String(text('model'))}`}
          </span>
        </div>
      );
    case 'selfie-background':
      return <span>From {inquiryLink(text('source-inquiry-id') as string | null)}</span>;
    case 'geolocation': {
      const values = [text('latitude'), text('longitude'), text('radius-meters')];
      return values.some((value) => value === null) ? (
        piiText([], masked)
      ) : (
        <>{`${String(values[0])}, ${String(values[1])} within ${String(values[2])} m`}</>
      );
    }
    case 'government-id-number':
      return (
        <div className="flex flex-col">
          <span>{piiText([text('id-number')], masked)}</span>
          <span className="text-xs text-ink-muted">
            {text('id-class') === null ? 'Any class' : classLabel(String(text('id-class')))}
          </span>
        </div>
      );
    case 'field':
      return <>{piiText([text('field-value')], masked)}</>;
    case 'name':
      return <>{piiText([text('name-first'), text('name-last')], masked)}</>;
    case 'browser-fingerprint':
    case 'device-fingerprint':
      return (
        <div className="flex flex-col">
          <span className="font-mono text-xs break-all">{piiText([text('value')], masked)}</span>
          <span className="text-xs text-ink-muted">Key {String(text('key-id'))}</span>
        </div>
      );
    default:
      return <>{piiText([text('value')], masked)}</>;
  }
}

export interface ListItemsTableProps {
  readonly items: readonly ListItemResource[];
  readonly listId: string;
  /** The API masks values for this operator (no `pii:view`). */
  readonly masked: boolean;
  /** Archive buttons, with `lists:write` on an active list. */
  readonly archive?: Action | undefined;
}

/** A list's items (C97.2, C108): value, status, match count and creation. */
export function ListItemsTable({ items, listId, masked, archive }: ListItemsTableProps) {
  return (
    <DataTable
      caption="Items"
      captionHidden
      rows={items}
      getRowKey={(item) => item.id}
      emptyMessage="No items yet."
      columns={[
        { id: 'id', header: 'Item', rowHeader: true, cell: (item) => item.id },
        { id: 'value', header: 'Value', cell: (item) => <ItemValue item={item} masked={masked} /> },
        {
          id: 'status',
          header: 'Status',
          cell: (item) => <ListItemStatusBadge status={item.attributes.status} />,
        },
        {
          id: 'matches',
          header: 'Matches',
          cell: (item) => formatCount(item.attributes['match-count']),
        },
        {
          id: 'created',
          header: 'Added (UTC)',
          cell: (item) => <Timestamp value={item.attributes['created-at']} />,
        },
        ...(archive === undefined
          ? []
          : [
              {
                id: 'actions',
                header: <span className="sr-only">Actions</span>,
                cell: (item: ListItemResource) =>
                  item.attributes.status === 'archived' ? null : (
                    <ConfirmActionButton
                      label="Archive"
                      accessibleLabel={`Archive item ${item.id}`}
                      variant="secondary"
                      title="Archive this item?"
                      description="It stops matching new inquiries, and stays readable here."
                      confirmLabel="Archive item"
                      pendingLabel="Archiving…"
                      action={archive}
                      fields={{
                        'list-id': listId,
                        kind: kindOfListType(item.type),
                        'item-id': item.id,
                      }}
                      successMessage="Archived the item."
                    />
                  ),
              },
            ]),
      ]}
    />
  );
}
