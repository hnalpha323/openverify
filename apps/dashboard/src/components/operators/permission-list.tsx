import type { Permission } from '@openverify/core';
import { useId } from 'react';
import { permissionAreas, permissionLabel, type PermissionArea } from './permissions';

function AreaList({ area }: { readonly area: PermissionArea }) {
  const headingId = useId();
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {area.label}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1.5 text-sm">
        {area.permissions.map((permission) => (
          <li key={permission} className="flex flex-col">
            <span>{permissionLabel(permission)}</span>
            <code className="font-mono text-xs text-ink-muted">{permission}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A role's permissions, read-only, grouped by area (built-in roles, read-only operators). */
export function PermissionList({ permissions }: { readonly permissions: readonly Permission[] }) {
  const areas = permissionAreas(permissions);
  if (areas.length === 0) {
    return <p className="text-sm text-ink-muted">This role grants no permissions.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {areas.map((area) => (
        <AreaList key={area.id} area={area} />
      ))}
    </div>
  );
}
