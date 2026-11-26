import type { ThemeSetRevisionResource } from '@openverify/contracts';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable, type Column } from '../data-table';
import { Timestamp } from '../timestamp';

const copy = THEMES_COPY.revisions;

export interface RevisionsTableProps {
  readonly themeSetId: string;
  readonly revisions: readonly ThemeSetRevisionResource[];
  /** The set's saved revision, which flows render: not offered for restore. */
  readonly current: number;
  /** Without it (a reader, an archived set) no restore is offered. */
  readonly restoreAction?: (
    state: ActionState<{ revision: number }>,
    formData: FormData,
  ) => Promise<ActionResult<{ revision: number }>>;
}

/** C160.5: a set's revisions newest first, as the API orders them, each restorable but the current. */
export function RevisionsTable({
  themeSetId,
  revisions,
  current,
  restoreAction,
}: RevisionsTableProps) {
  const columns: Column<ThemeSetRevisionResource>[] = [
    {
      id: 'revision',
      header: copy.revision,
      rowHeader: true,
      cell: (revision) => String(revision.attributes.revision),
    },
    {
      id: 'created',
      header: copy.created,
      cell: (revision) => <Timestamp value={revision.attributes['created-at']} />,
    },
    {
      id: 'by',
      header: copy.by,
      cell: (revision) => (
        <code className="font-mono text-xs">{revision.attributes.creator.id}</code>
      ),
    },
    {
      id: 'origin',
      header: copy.origin,
      cell: (revision) => {
        const from = revision.attributes['restored-from'];
        return from === null ? copy.edit : copy.restoredFrom(from);
      },
    },
    {
      id: 'action',
      header: copy.restore,
      cell: (revision) => {
        const number = revision.attributes.revision;
        if (number === current) {
          return copy.current;
        }
        return restoreAction === undefined ? null : (
          <ConfirmActionButton
            label={copy.restore}
            accessibleLabel={`${copy.restore} ${String(number)}`}
            variant="secondary"
            tone="primary"
            title={copy.restoreTitle(number)}
            description={copy.restoreBody}
            confirmLabel={copy.restore}
            action={restoreAction}
            fields={{ 'theme-set-id': themeSetId, revision: String(number) }}
          />
        );
      },
    },
  ];
  return (
    <DataTable
      caption={copy.caption}
      captionHidden
      columns={columns}
      rows={revisions}
      getRowKey={(revision) => revision.id}
      emptyMessage={copy.older}
    />
  );
}
