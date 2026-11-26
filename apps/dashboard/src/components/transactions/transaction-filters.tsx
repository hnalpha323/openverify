import { Button } from '@openverify/ui';
import type { TransactionTypeResource } from '@openverify/contracts';
import { FormField, controlClassName } from '../form-field';
import type { TransactionQuery } from './transaction-query';

/** The transactions index filters (C23): a plain GET form, so the filters stay in the URL. */
/** A field schema as the type's published version holds it. */
interface FieldOfType {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly config?: { readonly filterable?: boolean; readonly searchable?: boolean };
}

/** The input of each filterable type; a string field is matched exactly (its HMAC index). */
const INPUT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  integer: 'number',
  number: 'number',
  date: 'date',
});

/**
 * C165.3: the chosen type's top-level fields its published version marks `filterable`; a string
 * field (filterable only when also searchable) only for a reader of personal data.
 */
function filterableFields(
  type: TransactionTypeResource | undefined,
  canFilterStrings: boolean,
): { fields: FieldOfType[]; stringsHidden: boolean } {
  const schemas = (type?.attributes['field-schemas'] ?? []) as readonly FieldOfType[];
  const filterable = schemas.filter((field) => field.config?.filterable === true);
  const strings = filterable.filter((field) => field.type === 'string');
  return {
    fields: canFilterStrings ? filterable : filterable.filter((field) => field.type !== 'string'),
    stringsHidden: !canFilterStrings && strings.length > 0,
  };
}

export function TransactionFilters({
  query,
  types,
  canFilterStrings = false,
}: {
  readonly query: TransactionQuery;
  readonly types: readonly TransactionTypeResource[];
  /**
   * C165.3: the reader sees personal data (`pii:view`), so a searchable string field may be
   * filtered (an equality filter is otherwise a membership oracle, Phase 8 C137.2).
   */
  readonly canFilterStrings?: boolean;
}) {
  const { values, errors } = query;
  const chosen = types.find((type) => type.id === values.type);
  const { fields, stringsHidden } = filterableFields(chosen, canFilterStrings);
  return (
    <form
      role="search"
      aria-label="Filter transactions"
      method="get"
      action="/transactions"
      className="flex flex-wrap items-end gap-4"
    >
      <FormField label="Type" error={errors.type}>
        {(control) => (
          <select
            {...control}
            name="type"
            defaultValue={values.type}
            className={controlClassName(control)}
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.attributes.name}
              </option>
            ))}
            {values.type !== '' && !types.some((type) => type.id === values.type) && (
              <option value={values.type}>{values.type}</option>
            )}
          </select>
        )}
      </FormField>
      <FormField label="Status" error={errors.status}>
        {(control) => (
          <input
            {...control}
            name="status"
            defaultValue={values.status}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField label="Reference" error={errors.reference}>
        {(control) => (
          <input
            {...control}
            name="reference"
            defaultValue={values.reference}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField label="Created from (UTC)" error={errors.from}>
        {(control) => (
          <input
            {...control}
            type="date"
            name="from"
            defaultValue={values.from}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField label="Created to (UTC, inclusive)" error={errors.to}>
        {(control) => (
          <input
            {...control}
            type="date"
            name="to"
            defaultValue={values.to}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      {values.type === '' ? (
        <p className="text-sm text-ink-muted">Choose a type to filter by its fields.</p>
      ) : (
        fields.map((field) => (
          <FormField key={field.key} label={field.label} error={errors.fields}>
            {(control) =>
              field.type === 'boolean' ? (
                <select
                  {...control}
                  name={`field.${field.key}`}
                  defaultValue={values.fields[field.key] ?? ''}
                  className={controlClassName(control)}
                >
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  {...control}
                  type={INPUT_TYPES[field.type] ?? 'text'}
                  name={`field.${field.key}`}
                  defaultValue={values.fields[field.key] ?? ''}
                  autoComplete="off"
                  className={controlClassName(control)}
                />
              )
            }
          </FormField>
        ))
      )}
      {stringsHidden && (
        <p className="text-sm text-ink-muted">
          A text field is offered only to a role that sees personal data: matching it exactly would
          tell whether a value exists.
        </p>
      )}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
