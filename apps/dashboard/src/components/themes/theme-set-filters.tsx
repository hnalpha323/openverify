import { THEME_SET_STATUSES, type ThemeSetStatus } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { FormField, controlClassName } from '../form-field';

const copy = THEMES_COPY.list;

/** The theme sets index filter (C23): a plain GET form, so the filter stays in the URL. */
export function ThemeSetFilters({ status }: { readonly status: ThemeSetStatus | undefined }) {
  return (
    <form
      role="search"
      aria-label={copy.filterLabel}
      method="get"
      action="/theme-sets"
      className="flex flex-wrap items-end gap-4"
    >
      <FormField label={copy.statusLabel}>
        {(control) => (
          <select
            {...control}
            name="status"
            defaultValue={status ?? ''}
            className={controlClassName(control)}
          >
            <option value="">{copy.statusAny}</option>
            {THEME_SET_STATUSES.map((value) => (
              <option key={value} value={value}>
                {THEMES_COPY.status[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <Button type="submit" variant="secondary">
        {copy.apply}
      </Button>
    </form>
  );
}
