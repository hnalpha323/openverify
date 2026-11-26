import type { ServedAuditActor } from '@openverify/contracts';
import Link from 'next/link';
import { listHref } from '../../lib/list-query';
import { LINK_CLASS } from '../link-styles';

/** The list of entries by `actor`, or `null` for the system, which has no id to filter by. */
export function actorEntriesHref(actor: ServedAuditActor): string | null {
  return actor.type === 'system' ? null : listHref('/audit-logs', { actor: actor.id });
}

/** An operator's name and email, by user ID (`userDirectory`). */
export type OperatorDirectory = ReadonlyMap<
  string,
  { readonly name: string | null; readonly email: string }
>;

export interface AuditActorProps {
  readonly actor: ServedAuditActor;
  /** Names users when the operator may read them (`users:read`); null otherwise. */
  readonly directory: OperatorDirectory | null;
  /** In a table cell: the name alone, without the email. */
  readonly compact?: boolean;
}

function labelOf({ actor, directory, compact = false }: AuditActorProps): string {
  if (actor.type === 'system') {
    return 'System';
  }
  if (actor.type === 'api-key') {
    return 'API key';
  }
  if (actor.type === 'workflow-run') {
    return 'Workflow run';
  }
  const operator = directory?.get(actor.id);
  if (operator === undefined) {
    return 'User';
  }
  if (operator.name === null || compact) {
    return operator.name ?? operator.email;
  }
  return `${operator.name} (${operator.email})`;
}

/** Who acted: a user, named when known, an API key or a workflow run, with the ID; or the system. */
export function AuditActorValue(props: AuditActorProps) {
  return (
    <span className="flex flex-col">
      <span>{labelOf(props)}</span>
      {props.actor.type === 'workflow-run' ? (
        // C141.6: a run's entry links the run page.
        <Link href={`/workflows/runs/${props.actor.id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{props.actor.id}</code>
        </Link>
      ) : (
        props.actor.id !== null && (
          <code className="font-mono text-xs text-ink-muted">{props.actor.id}</code>
        )
      )}
    </span>
  );
}
