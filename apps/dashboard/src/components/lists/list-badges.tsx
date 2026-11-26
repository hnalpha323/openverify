import type { ImporterStatus, ListItemStatus, ListStatus } from '@openverify/core';
import { Badge, type BadgeTone } from '../status-badge';
import { IMPORTER_STATUS_LABELS, LIST_ITEM_STATUS_LABELS, LIST_STATUS_LABELS } from './list-words';

const LIST_TONES: Readonly<Record<ListStatus, BadgeTone>> = {
  active: 'success',
  archived: 'neutral',
};
const ITEM_TONES: Readonly<Record<ListItemStatus, BadgeTone>> = {
  pending: 'attention',
  active: 'success',
  archived: 'neutral',
};
const IMPORTER_TONES: Readonly<Record<ImporterStatus, BadgeTone>> = {
  pending: 'progress',
  ready: 'success',
  errored: 'danger',
};

export function ListStatusBadge({ status }: { readonly status: ListStatus }) {
  return <Badge status={status} label={LIST_STATUS_LABELS[status]} tone={LIST_TONES[status]} />;
}

export function ListItemStatusBadge({ status }: { readonly status: ListItemStatus }) {
  return (
    <Badge status={status} label={LIST_ITEM_STATUS_LABELS[status]} tone={ITEM_TONES[status]} />
  );
}

export function ImporterStatusBadge({ status }: { readonly status: ImporterStatus }) {
  return (
    <Badge status={status} label={IMPORTER_STATUS_LABELS[status]} tone={IMPORTER_TONES[status]} />
  );
}
