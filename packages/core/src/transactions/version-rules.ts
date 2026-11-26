/**
 * C104.2-C104.5: the rules across a version, at publish. `fieldSchemaSchema` holds each field's own
 * members and bounds; these answer what a schema cannot: the caps, `never`, aliases, what a nested
 * field cannot be, defaults that must hold, the card guard over what a version stores in the clear,
 * statuses and relation schemas. A rule a request could never keep is refused here, not ignored
 * later: a `required` file, or a nested one, could never take a value through a JSON body.
 */
import { isCardLike } from './card-guard.js';
import type { FieldProblem, TransactionTypeVersionContent } from './engine.js';
import { fieldValueProblems } from './fields-validator.js';
import { fieldSchemaSchema, relationSchemaSchema, type FieldSchema } from './field-schemas.js';
import { childFields, configOf, escapePointerToken, isRecord } from './field-tree.js';
import {
  FIELD_TYPES_FILTERABLE,
  FIELD_TYPES_NEVER_REFUSED,
  FIELD_TYPES_SEARCHABLE,
  RELATION_TARGETS_UNSUPPORTED,
  TRANSACTION_LIMITS,
  TRANSACTION_RESERVED_STATUS,
  TRANSACTION_STATUS_PATTERN,
  type FieldSchemaType,
  type RelationSchemaTarget,
} from './field-types.js';
import { jsonSchemaKeywordProblems } from './json-schema-allowlist.js';
import { sourceKeyPathSegments } from './version-reads.js';

const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

const invalid = (pointer: string): FieldProblem => ({ code: 'field_schema_invalid', pointer });

/** What the walk of one version carries. */
interface VersionWalk {
  readonly roots: readonly FieldSchema[];
  readonly guard: boolean;
  readonly problems: FieldProblem[];
  searchable: number;
}

function issuePointer(path: readonly PropertyKey[]): string {
  return path.map((token) => `/${escapePointerToken(String(token))}`).join('');
}

/**
 * The caps on shape, before zod reads anything: `fieldSchemaSchema` recurses, so a nesting of a
 * thousand levels overflows the stack inside it. Each top-level field's answer says if it is safe.
 */
function shapeProblems(
  fieldSchemas: readonly FieldSchema[],
  problems: FieldProblem[],
): readonly boolean[] {
  let fields = 0;
  const visit = (field: FieldSchema, pointer: string, containers: number): boolean => {
    fields += 1;
    if (!isRecord(field) || (field.type !== 'array' && field.type !== 'hash')) {
      return true;
    }
    if (containers === TRANSACTION_LIMITS.nestingLevels) {
      problems.push(invalid(pointer));
      return false;
    }
    return childFields(field, pointer)
      .map((child) => visit(child.field, child.pointer, containers + 1))
      .every(Boolean);
  };
  const safe = fieldSchemas.map((field, index) =>
    visit(field, `/field-schemas/${String(index)}`, 0),
  );
  if (fields > TRANSACTION_LIMITS.fieldsPerVersion) {
    problems.push(invalid('/field-schemas'));
  }
  return safe;
}

function repeatedKeyProblems(
  fields: readonly { readonly field: FieldSchema; readonly pointer: string }[],
  problems: FieldProblem[],
): void {
  const keys = new Set<string>();
  for (const { field, pointer } of fields.filter(({ field }) => isRecord(field))) {
    if (keys.has(field.key)) {
      problems.push(invalid(`${pointer}/key`));
    }
    keys.add(field.key);
  }
}

function neverProblems(
  field: FieldSchema,
  pointer: string,
  nested: boolean,
  walk: VersionWalk,
): void {
  const config = configOf(field);
  if (config['redaction-policy'] !== 'never') {
    return;
  }
  if (nested || FIELD_TYPES_NEVER_REFUSED.includes(field.type as FieldSchemaType)) {
    walk.problems.push(invalid(`${pointer}/config/redaction-policy`));
  } else if (field.type === 'string') {
    if (config['never-redact-acknowledged'] !== true) {
      walk.problems.push(invalid(`${pointer}/config/never-redact-acknowledged`));
    }
    if (config.searchable === true) {
      walk.problems.push(invalid(`${pointer}/config/searchable`));
    }
  }
}

function searchableProblems(
  field: FieldSchema,
  pointer: string,
  nested: boolean,
  walk: VersionWalk,
): void {
  if (configOf(field).searchable !== true) {
    return;
  }
  walk.searchable += 1;
  if (
    nested ||
    !FIELD_TYPES_SEARCHABLE.includes(field.type as FieldSchemaType) ||
    walk.searchable > TRANSACTION_LIMITS.searchableFields
  ) {
    walk.problems.push(invalid(`${pointer}/config/searchable`));
  }
}

/**
 * C165.3: `filterable` on a top-level field of `FIELD_TYPES_FILTERABLE`, or on a top-level `string`
 * that is also `searchable` (a string filter reads the HMAC index and needs PII visibility).
 */
function filterableProblems(
  field: FieldSchema,
  pointer: string,
  nested: boolean,
  walk: VersionWalk,
): void {
  const config = configOf(field);
  if (config.filterable !== true) {
    return;
  }
  const typed = FIELD_TYPES_FILTERABLE.includes(field.type as FieldSchemaType);
  const searchableString = field.type === 'string' && config.searchable === true;
  if (nested || !(typed || searchableString)) {
    walk.problems.push(invalid(`${pointer}/config/filterable`));
  }
}

/** The field a path names, reached through `hash` members only: a key cannot address an item. */
function aliasSource(path: string, roots: readonly FieldSchema[]): FieldSchema | null {
  let level = roots;
  let source: FieldSchema | null = null;
  for (const segment of sourceKeyPathSegments(path) ?? []) {
    source = level.find((field) => isRecord(field) && field.key === segment) ?? null;
    if (source === null) {
      return null;
    }
    level = source.type === 'hash' ? childFields(source, '').map((child) => child.field) : [];
  }
  return source;
}

function aliasProblems(
  field: FieldSchema,
  pointer: string,
  nested: boolean,
  walk: VersionWalk,
): void {
  const config = configOf(field);
  const path = config['source-key-path'];
  if (typeof path !== 'string') {
    return;
  }
  const pathPointer = `${pointer}/config/source-key-path`;
  if (nested) {
    walk.problems.push(invalid(pathPointer));
    return;
  }
  const source = aliasSource(path, walk.roots);
  if (source?.type !== field.type || typeof configOf(source)['source-key-path'] === 'string') {
    walk.problems.push(invalid(pathPointer));
  }
  for (const [written, member] of [
    [config.required === true, 'required'],
    [config.searchable === true, 'searchable'],
    [config['write-policy'] === 'write_once', 'write-policy'],
  ] as const) {
    if (written) {
      walk.problems.push(invalid(`${pointer}/config/${member}`));
    }
  }
  if (field['default-value'] !== undefined) {
    walk.problems.push(invalid(`${pointer}/default-value`));
  }
}

function nestedFieldProblems(field: FieldSchema, pointer: string, walk: VersionWalk): void {
  if (configOf(field)['write-policy'] === 'write_once') {
    walk.problems.push(invalid(`${pointer}/config/write-policy`));
  }
  if (field.type === 'file') {
    walk.problems.push(invalid(pointer));
  }
}

/** Whether a lower bound passes an upper one: both numbers, or both ISO dates. */
function isAbove(lower: unknown, upper: unknown): boolean {
  return (
    (typeof lower === 'number' && typeof upper === 'number' && lower > upper) ||
    (typeof lower === 'string' && typeof upper === 'string' && lower > upper)
  );
}

function fileProblems(field: FieldSchema, pointer: string, problems: FieldProblem[]): void {
  const config = configOf(field);
  if (config.required === true) {
    problems.push(invalid(`${pointer}/config/required`));
  }
  const minBytes = config['min-file-size-bytes'] ?? TRANSACTION_LIMITS.fileDefaultMinBytes;
  const maxBytes = config['max-file-size-bytes'] ?? TRANSACTION_LIMITS.fileDefaultMaxBytes;
  if (isAbove(minBytes, maxBytes)) {
    problems.push(invalid(`${pointer}/config/min-file-size-bytes`));
  }
  if (isAbove(config['page-count-min'], config['page-count-max'])) {
    problems.push(invalid(`${pointer}/config/page-count-min`));
  }
  const mimeTypes = (config['supported-mime-types'] ?? []) as readonly string[];
  mimeTypes.forEach((mimeType, index) => {
    if (!MIME_TYPE.test(mimeType)) {
      problems.push(invalid(`${pointer}/config/supported-mime-types/${String(index)}`));
    }
  });
}

function choiceProblems(field: FieldSchema, pointer: string, walk: VersionWalk): void {
  const config = configOf(field);
  const options = config.options as readonly string[];
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const optionPointer = `${pointer}/config/options/${String(index)}`;
    if (seen.has(option)) {
      walk.problems.push(invalid(optionPointer));
    } else if (walk.guard && isCardLike(option)) {
      walk.problems.push({ code: 'card_number_refused', pointer: optionPointer });
    }
    seen.add(option);
  });
  for (const option of Object.keys(config['option-labels'] ?? {})) {
    if (!seen.has(option)) {
      const token = escapePointerToken(option);
      walk.problems.push(invalid(`${pointer}/config/option-labels/${token}`));
    }
  }
}

function ownTypeProblems(field: FieldSchema, pointer: string, walk: VersionWalk): void {
  const config = configOf(field);
  switch (field.type) {
    case 'integer':
    case 'number':
      if (isAbove(config.min, config.max)) {
        walk.problems.push(invalid(`${pointer}/config/min`));
      }
      break;
    case 'date':
      if (isAbove(config['min-date'], config['max-date'])) {
        walk.problems.push(invalid(`${pointer}/config/min-date`));
      }
      break;
    case 'choices':
    case 'multi-choices':
      choiceProblems(field, pointer, walk);
      break;
    case 'file':
      fileProblems(field, pointer, walk.problems);
      break;
    case 'json':
      for (const problem of jsonSchemaKeywordProblems(config['json-schema'])) {
        walk.problems.push(invalid(`${pointer}/config/json-schema${problem.pointer}`));
      }
      break;
    case 'relation-schema':
      if (RELATION_TARGETS_UNSUPPORTED.includes(config.target as RelationSchemaTarget)) {
        walk.problems.push({
          code: 'relation_target_unsupported',
          pointer: `${pointer}/config/target`,
        });
      }
      break;
    default:
      break;
  }
}

function fieldProblems(
  field: FieldSchema,
  pointer: string,
  nested: boolean,
  walk: VersionWalk,
): void {
  neverProblems(field, pointer, nested, walk);
  searchableProblems(field, pointer, nested, walk);
  filterableProblems(field, pointer, nested, walk);
  aliasProblems(field, pointer, nested, walk);
  if (nested) {
    nestedFieldProblems(field, pointer, walk);
  }
  ownTypeProblems(field, pointer, walk);
  const defaultValue = field['default-value'];
  if (defaultValue !== undefined && typeof configOf(field)['source-key-path'] !== 'string') {
    walk.problems.push(
      ...fieldValueProblems(field, defaultValue, `${pointer}/default-value`, walk.guard),
    );
  }
  const children = childFields(field, pointer);
  repeatedKeyProblems(children, walk.problems);
  for (const child of children) {
    fieldProblems(child.field, child.pointer, true, walk);
  }
}

/** The field half of a version's rules; a case version has no status or relation rule here. */
export function fieldSchemaProblems(
  fieldSchemas: readonly FieldSchema[],
  guard: boolean,
  problems: FieldProblem[],
): void {
  const safe = shapeProblems(fieldSchemas, problems);
  const fields = fieldSchemas.map((field, index) => ({
    field,
    pointer: `/field-schemas/${String(index)}`,
  }));
  repeatedKeyProblems(fields, problems);
  const walk: VersionWalk = { roots: fieldSchemas, guard, problems, searchable: 0 };
  fields.forEach(({ field, pointer }, index) => {
    if (safe[index] !== true) {
      return;
    }
    const parsed = fieldSchemaSchema.safeParse(field);
    if (parsed.success) {
      fieldProblems(field, pointer, false, walk);
    } else {
      for (const issue of parsed.error.issues) {
        problems.push(invalid(`${pointer}${issuePointer(issue.path)}`));
      }
    }
  });
}

function statusListProblems(statuses: readonly string[], problems: FieldProblem[]): void {
  if (statuses.length === 0 || statuses.length > TRANSACTION_LIMITS.statuses) {
    problems.push(invalid('/statuses'));
    return;
  }
  const seen = new Set<string>();
  statuses.forEach((status, index) => {
    if (
      typeof status !== 'string' ||
      status.length > TRANSACTION_LIMITS.statusLength ||
      !TRANSACTION_STATUS_PATTERN.test(status) ||
      seen.has(status) ||
      (index === 0 && status !== TRANSACTION_RESERVED_STATUS)
    ) {
      problems.push(invalid(`/statuses/${String(index)}`));
    }
    seen.add(status);
  });
}

function relationListProblems(
  relationSchemas: TransactionTypeVersionContent['relationSchemas'],
  problems: FieldProblem[],
): void {
  if (relationSchemas.length > TRANSACTION_LIMITS.relationSchemas) {
    problems.push(invalid('/relation-schemas'));
    return;
  }
  const keys = new Set<string>();
  relationSchemas.forEach((relation, index) => {
    const pointer = `/relation-schemas/${String(index)}`;
    const parsed = relationSchemaSchema.safeParse(relation);
    for (const issue of parsed.error?.issues ?? []) {
      problems.push(invalid(`${pointer}${issuePointer(issue.path)}`));
    }
    if (parsed.data !== undefined) {
      if (keys.has(parsed.data.key)) {
        problems.push(invalid(`${pointer}/key`));
      }
      keys.add(parsed.data.key);
    }
  });
}

/** C104.2-C104.5: the problems of a version's content, at publish. */
export function transactionTypeVersionProblems(
  content: Omit<TransactionTypeVersionContent, 'id'>,
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  fieldSchemaProblems(content.fieldSchemas, !content.allowCardLikeStrings, problems);
  statusListProblems(content.statuses, problems);
  relationListProblems(content.relationSchemas, problems);
  return problems;
}
