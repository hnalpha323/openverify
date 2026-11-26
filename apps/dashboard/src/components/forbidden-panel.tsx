import type { Permission } from '@openverify/core';
import { useId } from 'react';

export interface ForbiddenPanelProps {
  /** The permissions that were missing, when known; named so an administrator can grant them. */
  readonly permissions?: readonly Permission[];
  /** 1 when the panel is the whole page, 2 (the default) inside a page section. */
  readonly headingLevel?: 1 | 2 | 3;
}

/**
 * Shown in place of a page or section the operator's role does not allow (C21: a 403 renders
 * this inline panel, not the error boundary).
 */
export function ForbiddenPanel({ permissions = [], headingLevel = 2 }: ForbiddenPanelProps) {
  const headingId = useId();
  const Heading = `h${String(headingLevel)}` as 'h1' | 'h2' | 'h3';

  return (
    <section
      aria-labelledby={headingId}
      data-testid="forbidden-panel"
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-6"
    >
      <Heading id={headingId} className="text-lg font-semibold text-ink">
        You do not have access
      </Heading>
      <p className="text-sm text-ink-muted">
        Your role does not allow this. Ask an administrator if you need it.
      </p>
      {permissions.length > 0 && (
        <p className="text-sm text-ink-muted">
          {permissions.length === 1 ? 'Permission needed: ' : 'Permissions needed: '}
          {permissions.map((permission, index) => (
            <span key={permission}>
              {index > 0 && ', '}
              <code className="font-mono text-xs">{permission}</code>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
