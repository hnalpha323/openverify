/**
 * The transactions index query (C23, C105.2): the filters kept in the URL, checked before the API
 * is asked, so a value it would refuse is explained at its field instead.
 */
import { idSchema, referenceIdSchema, transactionStatusSchema } from '@openverify/contracts';
import type { TransactionFilters } from '../../lib/api/transactions';
import type { ListQueryValue } from '../../lib/list-query';

export interface TransactionQueryValues {
  readonly type: string;
  readonly status: string;
  readonly reference: string;
  readonly from: string;
  readonly to: string;
  /** C165.3: `field.<key>` parameters, by field key, as typed (empty ones left out). */
  readonly fields: Readonly<Record<string, string>>;
}

/** C165.3: the URL parameter of a field filter, `field.<key>`. */
const FIELD_PARAM = /^field\.([a-z][a-z0-9_]{0,63})$/;
/** C165.3 (`TRANSACTION_FIELD_FILTER_PATTERN`'s list): at most ten field filters at once. */
const MAX_FIELD_FILTERS = 10;

export interface TransactionQuery {
  readonly values: TransactionQueryValues;
  readonly filters: TransactionFilters;
  readonly errors: Partial<Record<keyof TransactionQueryValues, string>>;
  readonly after: string | undefined;
}

const first = (value: string | string[] | undefined) =>
  (typeof value === 'string' ? value : (value?.[0] ?? '')).trim();

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The UTC midnight starting `date` (`YYYY-MM-DD`), `days` later; `undefined` for no such day. */
function midnight(date: string, days = 0): string | undefined {
  if (!DATE.test(date)) {
    return undefined;
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return undefined;
  }
  return new Date(time + days * 86_400_000).toISOString();
}

export function parseTransactionQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): TransactionQuery {
  const values: TransactionQueryValues = {
    type: first(params.type),
    status: first(params.status),
    reference: first(params.reference),
    from: first(params.from),
    to: first(params.to),
    fields: Object.fromEntries(
      Object.entries(params).flatMap(([name, value]) => {
        const key = FIELD_PARAM.exec(name)?.[1];
        const typed = first(value);
        return key === undefined || typed === '' ? [] : [[key, typed]];
      }),
    ),
  };
  const errors: Partial<Record<keyof TransactionQueryValues, string>> = {};
  if (values.type !== '' && !idSchema('txntp').safeParse(values.type).success) {
    errors.type = 'Choose a transaction type from the list.';
  }
  if (values.status !== '' && !transactionStatusSchema.safeParse(values.status).success) {
    errors.status = 'A status is lower case letters, digits, spaces, _ or -.';
  }
  if (values.reference !== '' && !referenceIdSchema.safeParse(values.reference).success) {
    errors.reference = 'A reference has at most 255 characters and no control character.';
  }
  const start = values.from === '' ? undefined : midnight(values.from);
  const end = values.to === '' ? undefined : midnight(values.to, 1);
  if (values.from !== '' && start === undefined) {
    errors.from = 'Enter a date as YYYY-MM-DD.';
  }
  if (values.to !== '' && end === undefined) {
    errors.to = 'Enter a date as YYYY-MM-DD.';
  } else if (start !== undefined && end !== undefined && end <= start) {
    errors.to = 'The end must not be before the start.';
  }
  const fieldCount = Object.keys(values.fields).length;
  if (fieldCount > MAX_FIELD_FILTERS) {
    errors.fields = 'Filter by at most ten fields at once.';
  } else if (fieldCount > 0 && values.type === '') {
    errors.fields = 'Choose the transaction type whose field you filter by.';
  }
  const after = first(params.after);
  return {
    values,
    errors,
    after: idSchema('txn').safeParse(after).success ? after : undefined,
    filters: {
      typeId: values.type === '' ? undefined : values.type,
      status: values.status === '' ? undefined : values.status,
      referenceId: values.reference === '' ? undefined : values.reference,
      createdAtStart: start,
      createdAtEnd: end,
      fields: fieldCount === 0 ? undefined : values.fields,
    },
  };
}

/** The filters as the page URL keeps them. */
export function transactionFilterQuery(
  values: TransactionQueryValues,
): Readonly<Record<string, ListQueryValue>> {
  const { fields, ...rest } = values;
  return {
    ...rest,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`field.${key}`, value])),
  };
}

export const hasTransactionFilters = (filters: TransactionFilters) =>
  Object.values(filters).some((value) => value !== undefined);
