import type { AccountStatus, AccountTypeResource } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import type { AccountSelections, AccountTextFilter } from './account-query';

export interface AccountFiltersProps {
  /** The status and type chosen in the URL (Workflow 2D F003: kept while a typed value errs). */
  readonly selected: AccountSelections;
  /** The text filters as typed. */
  readonly values: Partial<Record<AccountTextFilter, string>>;
  readonly errors: Partial<Record<AccountTextFilter, string>>;
  /** The environment's account types, for the type filter. */
  readonly accountTypes: readonly AccountTypeResource[];
}

const STATUSES: readonly { readonly value: AccountStatus; readonly label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const TEXT_FIELDS: readonly {
  readonly name: AccountTextFilter;
  readonly label: string;
  readonly type: 'text' | 'date';
  readonly description?: string;
}[] = [
  {
    name: 'tag',
    label: 'Tags',
    type: 'text',
    description: 'Separate several with commas; an account with any of them matches.',
  },
  { name: 'reference-id', label: 'Reference ID', type: 'text' },
  { name: 'created-from', label: 'Created from (UTC)', type: 'date' },
  { name: 'created-to', label: 'Created to (UTC)', type: 'date' },
];

/** The account filters: a plain GET form, so every filter lives in the URL (C23). */
export function AccountFilters({ selected, values, errors, accountTypes }: AccountFiltersProps) {
  const active =
    selected.status !== undefined ||
    selected.accountTypeId !== undefined ||
    Object.values(values).some((value) => value.trim() !== '');
  return (
    <form
      role="search"
      aria-label="Filter accounts"
      method="get"
      action="/accounts"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Status">
          {(control) => (
            <select
              {...control}
              name="status"
              defaultValue={selected.status ?? ''}
              className={controlClassName(control)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Account type">
          {(control) => (
            <select
              {...control}
              name="account-type-id"
              defaultValue={selected.accountTypeId ?? ''}
              className={controlClassName(control)}
            >
              <option value="">All types</option>
              {accountTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.attributes.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {TEXT_FIELDS.map((field) => (
          <FormField
            key={field.name}
            label={field.label}
            {...(field.description === undefined ? {} : { description: field.description })}
            error={errors[field.name]}
          >
            {(control) => (
              <input
                {...control}
                type={field.type}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
                spellCheck={false}
                autoComplete="off"
                className={controlClassName(control)}
              />
            )}
          </FormField>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {active && (
          <Link href="/accounts" className={LINK_CLASS}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
