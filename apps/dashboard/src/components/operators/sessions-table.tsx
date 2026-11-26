import type { ActionResult, ActionState } from '../../lib/action-state';
import type { UserSession } from '../../lib/api/sessions';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable, type Column } from '../data-table';
import { Timestamp } from '../timestamp';

const COPY = SETTINGS_COPY.sessions;

export interface SessionsTableProps {
  readonly sessions: readonly UserSession[];
  readonly revoke: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  readonly revokeOthers: (
    state: ActionState<number>,
    formData: FormData,
  ) => Promise<ActionResult<number>>;
}

/** C168.4: the operator's sessions, each ended from its row, and every other at once. */
export function SessionsTable({ sessions, revoke, revokeOthers }: SessionsTableProps) {
  const deviceOf = (session: UserSession) => session.attributes.device ?? COPY.unknownDevice;
  const columns: Column<UserSession>[] = [
    {
      id: 'device',
      header: COPY.deviceColumn,
      rowHeader: true,
      cell: (session) => (
        <span className="flex flex-col">
          <span className="font-medium">{deviceOf(session)}</span>
          {session.attributes.current && (
            <span className="text-ink-muted">
              <span aria-hidden="true">● </span>
              {COPY.current}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'created',
      header: COPY.createdColumn,
      cell: (session) => <Timestamp value={session.attributes['created-at']} />,
    },
    {
      id: 'last-seen',
      header: COPY.lastSeenColumn,
      cell: (session) => <Timestamp value={session.attributes['last-seen-at']} />,
    },
    {
      // C248.6 (KP11-90): an SSO session's `amr` as the identity provider stated it, shown and never
      // trusted; a password sign-in, or a provider that names none, states none.
      id: 'provider-amr',
      header: COPY.amrColumn,
      cell: (session) => {
        const amr = session.attributes['provider-amr'];
        return amr === null ? (
          <span className="text-ink-muted">{COPY.amrNone}</span>
        ) : (
          <code className="font-mono text-xs">{amr.join(', ')}</code>
        );
      },
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (session) =>
        session.attributes.current ? null : (
          <ConfirmActionButton
            label={COPY.revokeLabel}
            accessibleLabel={COPY.revokeAccessible(deviceOf(session), session.id)}
            variant="secondary"
            title={COPY.revokeTitle}
            description={COPY.revokeDescription}
            confirmLabel={COPY.revokeConfirm}
            pendingLabel="Signing out…"
            action={revoke}
            fields={{ 'session-id': session.id }}
            successMessage={COPY.revoked}
          />
        ),
    },
  ];
  const others = sessions.some((session) => !session.attributes.current);
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={COPY.title}
        captionHidden
        columns={columns}
        rows={sessions}
        getRowKey={(session) => session.id}
        emptyMessage={COPY.unknownDevice}
      />
      {others && (
        <div>
          <ConfirmActionButton<number>
            label={COPY.othersLabel}
            title={COPY.othersTitle}
            description={COPY.othersDescription}
            confirmLabel={COPY.othersConfirm}
            pendingLabel="Signing out…"
            action={revokeOthers}
            successMessage={COPY.othersDone}
          />
        </div>
      )}
    </div>
  );
}
