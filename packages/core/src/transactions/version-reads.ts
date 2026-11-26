/**
 * What the API reads from a version once it exists: the diff that yields the two type events
 * (C104.6), the status and relation checks of a write (C104.5), the alias read (C104.2, P22) and
 * the `json` schemas it compiles (C104.3).
 */
import type { FieldProblem, JsonFieldSchema, TransactionTypeVersionDiff } from './engine.js';
import type { FieldSchema, RelationSchema } from './field-schemas.js';
import { childFields, isRecord } from './field-tree.js';
import { FIELD_KEY_PATTERN, TRANSACTION_LIMITS } from './field-types.js';

interface MutableDiff {
  readonly deletedFields: string[];
  readonly convertedFields: { key: string; from: string; to: string }[];
}

const membersOf = (field: FieldSchema): FieldSchema[] =>
  childFields(field, '').map((child) => child.field);

/** One field of `previous` against its counterpart, under the dotted `path` they share. */
function diffField(field: FieldSchema, counterpart: FieldSchema, path: string, diff: MutableDiff) {
  if (field.type !== counterpart.type) {
    // One event for a container, not one per descendant.
    diff.convertedFields.push({ key: path, from: field.type, to: counterpart.type });
    return;
  }
  if (field.type !== 'array') {
    diffMembers(membersOf(field), membersOf(counterpart), `${path}.`, diff);
    return;
  }
  // An array's item schema adds no segment: its members follow the array's own key.
  const [item] = membersOf(field);
  const [nextItem] = membersOf(counterpart);
  if (item !== undefined && nextItem !== undefined) {
    diffField(item, nextItem, path, diff);
  }
}

function diffMembers(
  previous: readonly FieldSchema[],
  next: readonly FieldSchema[],
  prefix: string,
  diff: MutableDiff,
): void {
  const byKey = new Map(next.map((field) => [field.key, field]));
  for (const field of previous) {
    const path = `${prefix}${field.key}`;
    const counterpart = byKey.get(field.key);
    if (counterpart === undefined) {
      diff.deletedFields.push(path);
    } else {
      diffField(field, counterpart, path, diff);
    }
  }
}

/**
 * C104.6: what `next` deleted and converted from `previous`, each named by its dotted path: a
 * top-level field keeps its one-segment key, so a consumer of those reads the same (owner decision
 * 2 after Workflow 7B).
 */
export function transactionTypeVersionDiff(
  previous: readonly FieldSchema[],
  next: readonly FieldSchema[],
): TransactionTypeVersionDiff {
  const diff: MutableDiff = { deletedFields: [], convertedFields: [] };
  diffMembers(previous, next, '', diff);
  return diff;
}

/** C104.5: 422 `status_does_not_exist` for a status outside the version's list. */
export function transactionStatusProblems(
  statuses: readonly string[],
  status: string,
): FieldProblem[] {
  return statuses.includes(status) ? [] : [{ code: 'status_does_not_exist', pointer: '/status' }];
}

const RELATION_ID_PREFIX = Object.freeze({ account: 'acc_', transaction: 'txn_' });

/** C104.5: 422 `relation_schema_unknown` for a relation the version does not declare. */
export function transactionRelationProblems(
  relationSchemas: readonly RelationSchema[],
  relationSchemaKey: string,
  targetObjectId: string,
): FieldProblem[] {
  const relation = relationSchemas.find(({ key }) => key === relationSchemaKey);
  if (relation === undefined) {
    return [{ code: 'relation_schema_unknown', pointer: '/relation-schema-key' }];
  }
  return targetObjectId.startsWith(RELATION_ID_PREFIX[relation.target])
    ? []
    : [{ code: 'relation_schema_unknown', pointer: '/target-object-id' }];
}

/** C104.2 (P22): the segments of a `source-key-path`, or `null` for a path that breaks its rule. */
export function sourceKeyPathSegments(path: string): readonly string[] | null {
  const segments = path.split('.');
  const lawful =
    segments.length <= TRANSACTION_LIMITS.sourceKeyPathSegments &&
    segments.every((segment) => FIELD_KEY_PATTERN.test(segment));
  return lawful ? segments : null;
}

/** C104.2 (P22): the value an alias reads, as own properties only; it never sets one. */
export function readSourceKeyPath(
  values: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  const segments = sourceKeyPathSegments(path);
  if (segments === null) {
    return undefined;
  }
  let current: unknown = values;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** C104.3: every `json` field's schema in a version, for `api-transactions` to compile. */
export function jsonFieldSchemasOf(fieldSchemas: readonly FieldSchema[]): JsonFieldSchema[] {
  const found: JsonFieldSchema[] = [];
  const walk = (field: FieldSchema, pointer: string): void => {
    const schema = field.config?.['json-schema'];
    if (field.type === 'json' && isRecord(schema)) {
      found.push({
        pointer: `${pointer}/config/json-schema`,
        schema,
        defaultValue: field['default-value'],
      });
    }
    for (const child of childFields(field, pointer)) {
      walk(child.field, child.pointer);
    }
  };
  fieldSchemas.forEach((field, index) => {
    walk(field, `/field-schemas/${String(index)}`);
  });
  return found;
}
