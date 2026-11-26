import { Button } from '@openverify/ui';
import { LIST_KINDS, LIST_STATUSES, type ListKind, type ListStatus } from '@openverify/core';
import { FormField, controlClassName } from '../form-field';
import { LIST_KIND_LABELS, LIST_STATUS_LABELS } from './list-words';

/** The lists index filters (C23): a plain GET form, so the filters stay in the URL. */
export function ListFilters({
  type,
  status,
}: {
  readonly type: ListKind | undefined;
  readonly status: ListStatus | undefined;
}) {
  return (
    <form
      role="search"
      aria-label="Filter lists"
      method="get"
      action="/lists"
      className="flex flex-wrap items-end gap-4"
    >
      <FormField label="Type">
        {(control) => (
          <select
            {...control}
            name="type"
            defaultValue={type ?? ''}
            className={controlClassName(control)}
          >
            <option value="">All types</option>
            {LIST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LIST_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label="Status">
        {(control) => (
          <select
            {...control}
            name="status"
            defaultValue={status ?? ''}
            className={controlClassName(control)}
          >
            <option value="">Any status</option>
            {LIST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LIST_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
