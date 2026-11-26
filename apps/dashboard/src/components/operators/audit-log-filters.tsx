import { Button, Field, Input } from '@openverify/ui';
import Link from 'next/link';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { LINK_CLASS } from '../link-styles';
import type { AuditLogFilterErrors, AuditLogFilters } from './audit-log-query';

export interface AuditLogFiltersProps {
  readonly filters: AuditLogFilters;
  readonly errors: AuditLogFilterErrors;
}

/**
 * The audit log filters the API supports (C15): action, actor, resource and a range of UTC
 * days. A plain GET form, so the filters live in the URL (C23).
 */
export function AuditLogFiltersForm({ filters, errors }: AuditLogFiltersProps) {
  const filtered = Object.keys(filters).length > 0;
  return (
    <form
      role="search"
      aria-label="Filter audit log entries"
      method="get"
      action="/audit-logs"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Action"
          description="For example inquiry.approved. Separate several with commas."
          error={errors.action}
        >
          <Input name="action" defaultValue={filters.action ?? ''} spellCheck={false} />
        </Field>
        <Field
          label="Actor ID"
          description="A user ID (usr_…) or an API key ID (key_…)."
          error={errors.actor}
        >
          <Input name="actor" defaultValue={filters.actor ?? ''} spellCheck={false} />
        </Field>
        <Field
          label="Resource type"
          description="For example inquiry or role."
          error={errors.resourceType}
        >
          <Input
            name="resource-type"
            defaultValue={filters.resourceType ?? ''}
            spellCheck={false}
          />
        </Field>
        <Field label="Resource ID" error={errors.resourceId}>
          <Input name="resource-id" defaultValue={filters.resourceId ?? ''} spellCheck={false} />
        </Field>
        <Field
          label={SETTINGS_COPY.audit.prefixLabel}
          description={SETTINGS_COPY.audit.prefixDescription}
          error={errors.actionPrefix}
        >
          <Input
            name="action-prefix"
            defaultValue={filters.actionPrefix ?? ''}
            spellCheck={false}
          />
        </Field>
        <Field label="From (UTC)" error={errors.from}>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} />
        </Field>
        <Field label="To (UTC)" description="Inclusive." error={errors.to}>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {filtered && (
          <Link href="/audit-logs" className={`text-sm ${LINK_CLASS}`}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
