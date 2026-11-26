/**
 * The delivery search builder's form as the body of `POST /webhook-deliveries/search` (C165.4): rows
 * of conditions (`clause-attribute`, `clause-negate` "is" or "is-not", `clause-operator`,
 * `clause-value`, index-aligned) joined by "all of" (`and`) or "any of" (`or`), a negated row as
 * `not`: at most two levels of operators and 20 conditions, the contract's bounds. A comma list
 * with `in` is a list; a time is a `datetime-local` value read as UTC.
 */
import {
  WEBHOOK_DELIVERY_SEARCH_LIMITS,
  WEBHOOK_DELIVERY_STATUSES,
  type WebhookDeliverySearchBody,
  type WebhookDeliverySearchClause,
} from '@openverify/contracts';
import { ActionInputError } from '../../lib/api/action';
import { splitList, utcTimestamp } from './filter-values';

/** One page of the search's answer. */
export const DELIVERY_SEARCH_PAGE_SIZE = 25;

type Row = readonly [attribute: string, negate: string, operator: string, value: string];

const TIME_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte']);
const LIST_OPERATORS = new Set(['eq', 'in']);
const STATUSES: readonly string[] = WEBHOOK_DELIVERY_STATUSES;

/** One row as a clause, or the reason it is refused. */
function clauseOf([attribute, , operator, value]: Row): WebhookDeliverySearchClause | string {
  if (attribute === 'updated_at') {
    const at = utcTimestamp(value);
    if (at === undefined || !TIME_OPERATORS.has(operator)) {
      return 'enter a date and time (UTC).';
    }
    return { attribute, operator: operator as 'gt' | 'gte' | 'lt' | 'lte', value: at };
  }
  if (!LIST_OPERATORS.has(operator)) {
    return 'choose "is" or "is one of".';
  }
  const values = splitList(value.replaceAll(',', ' '));
  if (attribute === 'status' && !values.every((each) => STATUSES.includes(each))) {
    return 'choose pending, succeeded or failed.';
  }
  const single = operator === 'eq';
  if ((single && values.length !== 1) || values.length === 0 || values.length > 20) {
    return single ? 'enter one value.' : 'enter 1 to 20 values, separated by commas.';
  }
  const listed = single ? values[0] : values;
  return { attribute, operator, value: listed } as WebhookDeliverySearchClause;
}

/**
 * @throws {ActionInputError} for a search without a condition, more than 20, or a row whose value
 *   does not fit its attribute (named by its position).
 */
export function deliverySearchBodyOf(formData: FormData): WebhookDeliverySearchBody {
  const column = (name: string) =>
    formData.getAll(name).map((value) => (typeof value === 'string' ? value.trim() : ''));
  const attributes = column('clause-attribute');
  const negates = column('clause-negate');
  const operators = column('clause-operator');
  const values = column('clause-value');
  const rows: Row[] = attributes
    .map((attribute, index): Row => [
      attribute,
      negates[index] ?? 'is',
      operators[index] ?? 'eq',
      values[index] ?? '',
    ])
    .filter(([, , , value]) => value !== '');
  const refuse = (errors: { pointer: string; detail: string }[]) =>
    new ActionInputError({ title: 'Check the search', errors });
  if (rows.length === 0) {
    throw refuse([{ pointer: '/clauses', detail: 'Add at least one condition with a value.' }]);
  }
  if (rows.length > WEBHOOK_DELIVERY_SEARCH_LIMITS.clauses) {
    throw refuse([{ pointer: '/clauses', detail: 'Use at most 20 conditions.' }]);
  }
  const clauses = rows.map(clauseOf);
  const errors = clauses.flatMap((clause, index) =>
    typeof clause === 'string'
      ? [
          {
            pointer: `/clauses/${String(index)}`,
            detail: `Condition ${String(index + 1)}: ${clause}`,
          },
        ]
      : [],
  );
  if (errors.length > 0) {
    throw refuse(errors);
  }
  const nodes = (clauses as WebhookDeliverySearchClause[]).map((clause, index) =>
    rows[index]?.[1] === 'is-not' ? { not: clause } : clause,
  );
  const after = formData.get('after');
  return {
    query: formData.get('combine') === 'or' ? { or: nodes } : { and: nodes },
    page: {
      size: DELIVERY_SEARCH_PAGE_SIZE,
      ...(typeof after === 'string' && after !== '' ? { after } : {}),
    },
  };
}
