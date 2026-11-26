/**
 * C90.8, C107.7, C108: the audit trail of the environment's collection tier changes, from the
 * `settings.updated` entries whose metadata names `signal-collection`, newest first. Each says
 * when, who, and the tiers the change set.
 */
import {
  signalCollectionSettingBodySchema,
  type UserAuditLogResource,
} from '@openverify/contracts';
import Link from 'next/link';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import { AuditActorValue } from './audit-actor';
import { DEVICE_RECOGNITION_LABELS, SESSION_INTEGRITY_LABELS } from './settings-fields';

const collectionOf = (entry: UserAuditLogResource) =>
  signalCollectionSettingBodySchema.safeParse(entry.attributes.metadata['signal-collection']);

const UNREADABLE = <span className="text-ink-muted">Not readable</span>;

const COLUMNS: readonly Column<UserAuditLogResource>[] = [
  {
    id: 'entry',
    header: 'Entry',
    rowHeader: true,
    cell: (entry) => (
      <Link href={`/audit-logs/${entry.id}`} className={LINK_CLASS}>
        <code className="font-mono text-xs">{entry.id}</code>
      </Link>
    ),
  },
  {
    id: 'when',
    header: 'When (UTC)',
    cell: (entry) => <Timestamp value={entry.attributes['created-at']} />,
  },
  {
    id: 'actor',
    header: 'Who',
    cell: (entry) => <AuditActorValue actor={entry.attributes.actor} directory={null} compact />,
  },
  {
    id: 'integrity',
    header: 'Session integrity',
    cell: (entry) => {
      const parsed = collectionOf(entry);
      return parsed.success
        ? SESSION_INTEGRITY_LABELS[parsed.data['session-integrity']]
        : UNREADABLE;
    },
  },
  {
    id: 'recognition',
    header: 'Device recognition',
    cell: (entry) => {
      const parsed = collectionOf(entry);
      return parsed.success ? (
        <span className="flex flex-col">
          <span>{DEVICE_RECOGNITION_LABELS[parsed.data['device-recognition']]}</span>
          {parsed.data['device-recognition-basis'] !== null && (
            <span className="text-xs break-words text-ink-muted">
              {parsed.data['device-recognition-basis']}
            </span>
          )}
        </span>
      ) : (
        UNREADABLE
      );
    },
  },
];

export function CollectionChanges({
  entries,
}: {
  readonly entries: readonly UserAuditLogResource[];
}) {
  const changes = entries.filter((entry) =>
    Object.hasOwn(entry.attributes.metadata, 'signal-collection'),
  );
  return (
    <DataTable
      caption="Collection tier changes"
      columns={COLUMNS}
      rows={changes}
      getRowKey={(entry) => entry.id}
      emptyMessage="No collection tier change among the latest settings changes."
    />
  );
}
