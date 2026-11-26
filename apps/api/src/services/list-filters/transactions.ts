/**
 * C165.3 (Workflow 9B; K10; contracts B16, B18): the transaction list's field filters. Owner:
 * `api-exports`; `foundation-9b` (Stage 1b (X)) calls it from `listTransactions`
 * (`services/transactions/transactions.ts`) with the whole query and the acting principal's PII
 * visibility, and ANDs the conditions it answers.
 *
 * - `filter[fields.<key>]` (equality, at most `MAX_TRANSACTION_FIELD_FILTERS`, each ANDed) on a field
 *   that a version a transaction can pin (every version but a draft; of `filter[transaction-type-id]`
 *   when given) marks `filterable`:
 *   - a choices, boolean, integer, number or date field through `transaction_filter_values`, the value
 *     read as its type reads it (`42` and `42.0` are one number; `true` or `false`; `YYYY-MM-DD`);
 *   - a searchable string field through `transaction_field_keys` under the environment's blind-index
 *     subkey, which needs PII visibility (Phase 8 C137.2's rule: an equality answer says whether a
 *     value exists) and the key (`blindIndexKey`, which the call site must pass).
 *   A key that is filterable as several types matches any of them. A key that no such version marks
 *   filterable, or a value no type of it can hold, answers 400 at the parameter, never an empty list.
 * - `filter[identifier]`: held to the same PII-visibility rule here too (B18; the route already
 *   refuses it, K7B-14), so a caller other than the route (the export job) cannot read membership.
 *
 * The filters' values are repeated in the next link; a stored API log masks them
 * (`services/api-logs.ts`).
 */
import { TRANSACTION_FIELD_FILTER_PATTERN } from '@openverify/contracts';
import { FIELD_TYPES_FILTERABLE, type FieldSchemaType } from '@openverify/core';
import { listPinnableTransactionFieldSchemas, transactions, type Db } from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';
import {
  AppError,
  NotImplementedError,
  PermissionDeniedError,
  type ProblemFieldError,
} from '../../errors.js';
import type { ListTransactionsQuery } from '../transactions/transactions.js';
import { fieldValueKey } from '../transactions/write-checks.js';
import type { ListFilterConditions } from './conditions.js';

export interface TransactionListFilterInput {
  environmentId: string;
  query: ListTransactionsQuery;
  /** The acting principal sees personal data (`pii:view`, an unmasked key). */
  piiVisible: boolean;
  /**
   * The environment's blind-index key (`OPENVERIFY_BLIND_INDEX_KEY`), which a string field's
   * equality index needs; without it a string field filter answers 501, never an unfiltered list.
   */
  blindIndexKey?: Uint8Array | undefined;
}

/** The types a key is filterable as, across the versions a listed transaction can pin. */
type FilterableTypes = ReadonlyMap<string, ReadonlySet<string>>;

function filterableTypesOf(versions: readonly unknown[][]): FilterableTypes {
  const types = new Map<string, Set<string>>();
  for (const fields of versions) {
    for (const field of fields) {
      const schema = field as {
        type?: unknown;
        key?: unknown;
        config?: { filterable?: unknown; searchable?: unknown };
      };
      if (
        typeof schema.key !== 'string' ||
        typeof schema.type !== 'string' ||
        schema.config?.filterable !== true
      ) {
        continue;
      }
      const filterable =
        FIELD_TYPES_FILTERABLE.includes(schema.type as FieldSchemaType) ||
        (schema.type === 'string' && schema.config.searchable === true);
      if (filterable) {
        types.set(schema.key, (types.get(schema.key) ?? new Set()).add(schema.type));
      }
    }
  }
  return types;
}

/** The canonical text of a filter value for a field of `type`, or `null` when it holds none. */
export function filterTextOf(type: string, value: string): string | null {
  switch (type) {
    case 'integer':
    case 'number': {
      // Linear: one digit run before an optional fraction (C260.1; `\d+\.?\d*` backtracked).
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
        return null;
      }
      const number = Number(value);
      if (!Number.isFinite(number) || (type === 'integer' && !Number.isSafeInteger(number))) {
        return null;
      }
      return String(number);
    }
    case 'boolean':
      return value === 'true' || value === 'false' ? value : null;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
    default:
      return value;
  }
}

/** A projected value of the transaction. */
function projected(fieldKey: string, text: string): SQL {
  return sql`exists (select 1 from transaction_filter_values f
    where f.environment_id = ${transactions.environmentId} and f.transaction_id = ${transactions.id}
      and f.field_key = ${fieldKey} and f.value = ${text})`;
}

/** A keyed string value of the transaction. */
function keyed(fieldKey: string, valueKey: string): SQL {
  return sql`exists (select 1 from transaction_field_keys k
    where k.environment_id = ${transactions.environmentId} and k.transaction_id = ${transactions.id}
      and k.field_key = ${fieldKey} and k.value_key = ${valueKey})`;
}

const badFilter = (parameter: string, detail: string): ProblemFieldError => ({
  location: 'querystring',
  pointer: `/${parameter}`,
  detail,
});

/** The transaction type ids of `filter[transaction-type-id]`, or every type. */
function typeIdsOf(query: ListTransactionsQuery): string[] | undefined {
  const value = query['filter[transaction-type-id]'];
  if (value === undefined) {
    return undefined;
  }
  return value.split(',').map((id) => id.trim());
}

export async function transactionListFilters(
  db: Db,
  input: TransactionListFilterInput,
): Promise<ListFilterConditions> {
  const { environmentId, query, piiVisible } = input;
  if (query['filter[identifier][value]'] !== undefined && !piiVisible) {
    throw new PermissionDeniedError(
      'filter[identifier] searches by a value, which needs pii:view.',
      ['pii:view'],
    );
  }
  const asked = Object.entries(query as Readonly<Record<string, unknown>>)
    .map(([parameter, value]) => ({
      parameter,
      key: TRANSACTION_FIELD_FILTER_PATTERN.exec(parameter)?.[1],
      value,
    }))
    .filter(
      (entry): entry is { parameter: string; key: string; value: string } =>
        entry.key !== undefined && typeof entry.value === 'string',
    );
  if (asked.length === 0) {
    return { where: [], links: {} };
  }
  const types = filterableTypesOf(
    await listPinnableTransactionFieldSchemas(db, environmentId, typeIdsOf(query)),
  );
  const where: SQL[] = [];
  const links: Record<string, string> = {};
  const errors: ProblemFieldError[] = [];
  for (const { parameter, key, value } of asked) {
    const fieldTypes = types.get(key);
    if (fieldTypes === undefined) {
      errors.push(badFilter(parameter, 'names no field a transaction type marks filterable'));
      continue;
    }
    const branches: SQL[] = [];
    for (const type of fieldTypes) {
      if (type === 'string') {
        if (!piiVisible) {
          throw new PermissionDeniedError(
            `${parameter} searches a string field by its value, which needs pii:view.`,
            ['pii:view'],
          );
        }
        if (input.blindIndexKey === undefined) {
          throw new NotImplementedError(
            'A string field filter needs the blind-index key at the list call (integration-9b).',
          );
        }
        branches.push(keyed(key, fieldValueKey(input.blindIndexKey, environmentId, key, value)));
        continue;
      }
      const text = filterTextOf(type, value);
      if (text !== null) {
        branches.push(projected(key, text));
      }
    }
    if (branches.length === 0) {
      errors.push(badFilter(parameter, 'is no value the field can hold'));
      continue;
    }
    const [only] = branches;
    where.push(
      branches.length === 1 && only !== undefined ? only : sql`(${sql.join(branches, sql` or `)})`,
    );
    links[parameter] = value;
  }
  if (errors.length > 0) {
    throw new AppError({
      status: 400,
      title: 'Bad Request',
      detail: 'A field filter names no filterable field, or a value its field cannot hold.',
      errors,
    });
  }
  return { where, links };
}
