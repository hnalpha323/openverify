import { Button } from '@openverify/ui';
import Link from 'next/link';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterFieldSpec {
  /** The URL query parameter. */
  readonly name: string;
  readonly label: string;
  readonly type: 'select' | 'text' | 'datetime-local';
  /** For a select: its options, after an "all" option labelled `allLabel`. */
  readonly options?: readonly FilterOption[];
  readonly allLabel?: string;
  readonly placeholder?: string;
}

export interface FilterFormProps {
  /** Names the search landmark, such as "Filter deliveries". */
  readonly label: string;
  /** The list page the filters apply to. */
  readonly action: string;
  readonly fields: readonly FilterFieldSpec[];
  /** The URL's values, to fill the form. */
  readonly values: Readonly<Partial<Record<string, string>>>;
  /** Why a URL value was not applied, by parameter. */
  readonly errors: Readonly<Partial<Record<string, string>>>;
}

/**
 * A list's filters as a plain GET form (C23): the filters live in the URL, so a filtered list
 * can be bookmarked and reloaded, and the form works before any script runs. A value the page
 * could not apply shows why next to its control.
 */
export function FilterForm({ label, action, fields, values, errors }: FilterFormProps) {
  const filtered = Object.values(values).some((value) => value !== undefined && value !== '');
  return (
    <form
      role="search"
      aria-label={label}
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-3"
    >
      {fields.map((field) => (
        <FormField
          key={field.name}
          label={field.label}
          error={errors[field.name]}
          className="min-w-44"
        >
          {(control) =>
            field.type === 'select' ? (
              <select
                {...control}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
                className={controlClassName(control)}
              >
                <option value="">{field.allLabel ?? 'All'}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...control}
                type={field.type}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
                spellCheck={false}
                autoComplete="off"
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
                className={controlClassName(control)}
              />
            )
          }
        </FormField>
      ))}
      <div className="flex min-h-11 items-center gap-4">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {filtered && (
          <Link href={action} className={LINK_CLASS}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
