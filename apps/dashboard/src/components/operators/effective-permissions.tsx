import type { Permission } from '@openverify/core';
import Link from 'next/link';
import { useId } from 'react';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { LINK_CLASS } from '../link-styles';
import { permissionLabel } from './permissions';

const COPY = SETTINGS_COPY.users;
const KIND_NAMES = { sandbox: 'Sandbox', production: 'Production' } as const;

export interface EffectivePermissionsProps {
  /** The user's name, or email when they have none yet; their id when not on this page. */
  readonly userLabel: string;
  /** `GET /dashboard/users/:id/permissions`'s attributes (K9-22). */
  readonly organization: readonly Permission[];
  readonly environments: readonly {
    readonly 'environment-id': string;
    readonly 'may-enter': boolean;
    readonly permissions: readonly Permission[];
  }[];
  /** The organisation's environments, to name each one; an unknown one shows its id. */
  readonly known: readonly { readonly id: string; readonly kind: 'sandbox' | 'production' }[];
  /** Where "Hide" leads: the list without the user chosen. */
  readonly closeHref: string;
}

function PermissionsOf({
  name,
  permissions,
}: {
  readonly name: string;
  readonly permissions: readonly Permission[];
}) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {name}
      </h3>
      {permissions.length === 0 ? (
        <p className="text-sm text-ink-muted">{COPY.effectiveNone(name)}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-1.5 text-sm">
          {permissions.map((permission) => (
            <li key={permission} className="flex flex-col">
              <span>{permissionLabel(permission)}</span>
              <code className="font-mono text-xs text-ink-muted">{permission}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * K9-22 (DS8; C167.2): what a user's roles give them now, as the API computes it: the user and role
 * permissions once, organisation-wide, and the other permissions per environment with whether the
 * user may enter it. Permission names only, no personal data.
 */
export function EffectivePermissions({
  userLabel,
  organization,
  environments,
  known,
  closeHref,
}: EffectivePermissionsProps) {
  const headingId = useId();
  const nameOf = (id: string) => {
    const kind = known.find((environment) => environment.id === id)?.kind;
    return kind === undefined ? id : KIND_NAMES[kind];
  };
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-base font-semibold text-ink">
            {COPY.effectiveTitle(userLabel)}
          </h2>
          <p className="text-sm text-ink-muted">{COPY.effectiveDescription}</p>
        </div>
        <Link href={closeHref} className={`text-sm ${LINK_CLASS}`}>
          {COPY.effectiveClose}
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PermissionsOf name={COPY.effectiveOrganisation} permissions={organization} />
        {environments.map((environment) => (
          <div key={environment['environment-id']} className="flex flex-col gap-1">
            <p className="text-sm text-ink">
              {COPY.effectiveEntry(nameOf(environment['environment-id']), environment['may-enter'])}
            </p>
            <PermissionsOf
              name={nameOf(environment['environment-id'])}
              permissions={environment.permissions}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
