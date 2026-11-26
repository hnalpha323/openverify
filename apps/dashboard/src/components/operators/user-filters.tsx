import { USER_STATUSES, type UserStatus } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { USER_STATUS_LABELS } from './user-status-badge';

const STATUS_ID = 'user-status-filter';

/**
 * The users list filter: a plain GET form, so the filter lives in the URL (C23) and works
 * before JavaScript loads.
 */
export function UserFilters({ status }: { readonly status?: UserStatus | undefined }) {
  return (
    <form
      role="search"
      aria-label="Filter users"
      method="get"
      action="/users"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={STATUS_ID} className="text-sm font-medium text-ink">
          Status
        </label>
        <select
          id={STATUS_ID}
          name="status"
          defaultValue={status ?? ''}
          className={controlClassName({})}
        >
          <option value="">All statuses</option>
          {USER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {USER_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary">
        Apply filter
      </Button>
      {status !== undefined && (
        <Link href="/users" className={`self-center text-sm ${LINK_CLASS}`}>
          Clear filter
        </Link>
      )}
    </form>
  );
}
