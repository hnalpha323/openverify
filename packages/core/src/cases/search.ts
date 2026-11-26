/**
 * `POST /cases/search` (plan C137.2): the parser and validator that turn the public query into a
 * typed predicate tree. `api-cases` compiles the tree into parameterised SQL over plaintext columns
 * and the searchable fields' HMAC index; nothing here reads a row.
 *
 * The contract (`caseSearchQuerySchema`) already holds the shape; this re-checks it, because a pure
 * function cannot trust its caller, and adds what the shape cannot say: each attribute's operators,
 * its value's type, and which fields are searchable. A problem names a JSON Pointer and a code, never
 * the value it refused (P21): a leaf can hold a field's value.
 */
import { isValidTag, normalizeTag } from '../tags.js';
import { FIELD_KEY_PATTERN } from '../transactions/field-types.js';
import { pointerToken } from './pointer.js';
import {
  CASE_LIMITS,
  CASE_SEARCH_ATTRIBUTES,
  CASE_SEARCH_OPERATORS,
  CASE_STATUS_CATEGORIES,
  CASE_STATUS_KEY_PATTERN,
  type CaseSearchAttribute,
  type CaseSearchOperator,
  type CaseStatusCategory,
} from './vocabulary.js';

/** A leaf's value, as the contract allows it. */
export type CaseSearchScalar = string | number | boolean | null;

export type CaseSearchTimeAttribute =
  'created_at' | 'updated_at' | 'resolved_at' | 'sla_expires_at';

/** The leaves the tree holds, each typed by what it compares. */
export type CaseSearchCondition =
  /** A timestamp column compared with an instant. */
  | {
      readonly kind: 'time';
      readonly attribute: CaseSearchTimeAttribute;
      readonly operator: CaseSearchOperator;
      readonly value: Date;
    }
  /** `eq null`: the column holds nothing. */
  | {
      readonly kind: 'missing';
      readonly attribute:
        | 'resolved_at'
        | 'sla_expires_at'
        | 'resolution'
        | 'assignee'
        | 'case_queue'
        | 'case_queue_id'
        | 'resolver';
    }
  | { readonly kind: 'equals'; readonly attribute: 'case_template_id'; readonly value: string }
  /** The template's name (ours: the public meaning is not documented). */
  | { readonly kind: 'equals'; readonly attribute: 'template'; readonly value: string }
  /** A status key. */
  | { readonly kind: 'equals'; readonly attribute: 'status'; readonly value: string }
  /** The status category (the public `state`, read as the category). */
  | { readonly kind: 'equals'; readonly attribute: 'state'; readonly value: CaseStatusCategory }
  | { readonly kind: 'equals'; readonly attribute: 'resolution'; readonly value: string }
  /** A `usr_` id. */
  | { readonly kind: 'equals'; readonly attribute: 'assignee'; readonly value: string }
  /** The queue's name. */
  | { readonly kind: 'equals'; readonly attribute: 'case_queue'; readonly value: string }
  | { readonly kind: 'equals'; readonly attribute: 'case_queue_id'; readonly value: string }
  /** A `usr_`, `key_` or `wfr_` id. */
  | { readonly kind: 'equals'; readonly attribute: 'resolver'; readonly value: string }
  /** The case holds this account or inquiry. */
  | {
      readonly kind: 'holds';
      readonly attribute: 'account_id' | 'inquiry_id';
      readonly value: string;
    }
  /** The case carries the tag (a tag's name: OpenVerify's tags have no id, amendment 21). */
  | { readonly kind: 'tagged'; readonly value: string }
  /** A searchable field equals the value, through its HMAC index (C136.4). */
  | { readonly kind: 'field'; readonly key: string; readonly value: string | number | boolean };

export type CaseSearchPredicate =
  | CaseSearchCondition
  | { readonly kind: 'and'; readonly clauses: readonly CaseSearchPredicate[] }
  | { readonly kind: 'or'; readonly clauses: readonly CaseSearchPredicate[] }
  | { readonly kind: 'not'; readonly clause: CaseSearchPredicate };

export const CASE_SEARCH_PROBLEMS = [
  'search_shape_invalid',
  'search_depth_exceeded',
  'search_clauses_exceeded',
  'search_attribute_unknown',
  'search_operator_refused',
  'search_value_invalid',
  'search_field_not_searchable',
] as const;
export type CaseSearchProblemCode = (typeof CASE_SEARCH_PROBLEMS)[number];

export interface CaseSearchProblem {
  readonly code: CaseSearchProblemCode;
  /** A JSON Pointer into the request body. */
  readonly pointer: string;
}

export interface CaseSearchContext {
  /** Whether `fields.<key>` is marked `searchable` on a template the reader can see (C136.4). */
  readonly isSearchableField: (key: string) => boolean;
}

export type CaseSearchParse =
  | {
      readonly ok: true;
      /** `null` when the body has no query: every case the reader can see. */
      readonly predicate: CaseSearchPredicate | null;
      /** The field keys the query reads, distinct and sorted: any one needs PII visibility (P25). */
      readonly fieldKeys: readonly string[];
    }
  | { readonly ok: false; readonly problems: readonly CaseSearchProblem[] };

const MAX_PROBLEMS = 20;
const DEPTH = CASE_LIMITS['search-depth'].value;
const CLAUSES = CASE_LIMITS['search-clauses'].value;
/** The contract's longest string value. */
const VALUE_CHARACTERS = 1024;
const NAME_CHARACTERS = Math.max(
  CASE_LIMITS['template-name-characters'].value,
  CASE_LIMITS['config-name-characters'].value,
);
const FIELDS = 'fields.';

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const idOf = (...prefixes: string[]) => new RegExp(`^(?:${prefixes.join('|')})_${ULID}$`);
const ID = {
  template: idOf('ctmpl'),
  queue: idOf('cqueue'),
  user: idOf('usr'),
  resolver: idOf('usr', 'key', 'wfr'),
  account: idOf('acc'),
  inquiry: idOf('inq'),
} as const;

/** RFC 3339 with an offset: `T` and `Z` upper case, no leap second, a year of four digits. */
const TIMESTAMP =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?(?:Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;

/** The instant `text` names, or `null` when it is not an RFC 3339 date-time with an offset. */
function instantOf(text: string): Date | null {
  const groups = TIMESTAMP.exec(text)?.groups;
  if (groups === undefined) {
    return null;
  }
  const number = (name: string): number => Number(groups[name] ?? '0');
  const [year, month, day] = [number('year'), number('month'), number('day')];
  const [hour, minute, second] = [number('hour'), number('minute'), number('second')];
  const [offsetHour, offsetMinute] = [number('offsetHour'), number('offsetMinute')];
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }
  const milliseconds = Number((groups.fraction ?? '').padEnd(3, '0').slice(0, 3));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const date = new Date(wall);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (groups.sign === '-' ? -1 : 1);
  return new Date(wall - offset);
}

const SEARCH_ATTRIBUTES: ReadonlySet<string> = new Set(CASE_SEARCH_ATTRIBUTES);
const OPERATORS: ReadonlySet<string> = new Set(CASE_SEARCH_OPERATORS);
const CATEGORIES: ReadonlySet<string> = new Set(CASE_STATUS_CATEGORIES);

type TimeAttribute = CaseSearchTimeAttribute;
type MissingAttribute = Extract<CaseSearchCondition, { kind: 'missing' }>['attribute'];

const TIME_ATTRIBUTES: ReadonlySet<string> = new Set<TimeAttribute>([
  'created_at',
  'updated_at',
  'resolved_at',
  'sla_expires_at',
]);
const NULLABLE: ReadonlySet<string> = new Set<MissingAttribute>([
  'resolved_at',
  'sla_expires_at',
  'resolution',
  'assignee',
  'case_queue',
  'case_queue_id',
  'resolver',
]);

const textUpTo = (value: string, characters: number): boolean =>
  value.length >= 1 && value.length <= characters;

/** Each equality attribute's check of a string value. */
const EQUALITY: Readonly<
  Record<
    Exclude<CaseSearchAttribute, TimeAttribute | 'account_id' | 'inquiry_id' | 'tag_id'>,
    (value: string) => boolean
  >
> = {
  case_template_id: (value) => ID.template.test(value),
  template: (value) => textUpTo(value, NAME_CHARACTERS),
  status: (value) =>
    textUpTo(value, CASE_LIMITS['status-key-characters'].value) &&
    CASE_STATUS_KEY_PATTERN.test(value),
  state: (value) => CATEGORIES.has(value),
  resolution: (value) => textUpTo(value, CASE_LIMITS['resolution-characters'].value),
  assignee: (value) => ID.user.test(value),
  case_queue: (value) => textUpTo(value, NAME_CHARACTERS),
  case_queue_id: (value) => ID.queue.test(value),
  resolver: (value) => ID.resolver.test(value),
};

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: CaseSearchProblemCode;
      readonly member: 'attribute' | 'operator' | 'value';
    };

const fault = (
  code: CaseSearchProblemCode,
  member: 'attribute' | 'operator' | 'value',
): Outcome<never> => ({ ok: false, code, member });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

function fieldCondition(
  key: string,
  operator: CaseSearchOperator,
  value: CaseSearchScalar,
  context: CaseSearchContext,
): Outcome<CaseSearchCondition> {
  if (!FIELD_KEY_PATTERN.test(key)) {
    return fault('search_attribute_unknown', 'attribute');
  }
  if (!context.isSearchableField(key)) {
    return fault('search_field_not_searchable', 'attribute');
  }
  if (operator !== 'eq') {
    return fault('search_operator_refused', 'operator');
  }
  if (
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= VALUE_CHARACTERS)
  ) {
    return done({ kind: 'field', key, value });
  }
  return fault('search_value_invalid', 'value');
}

function attributeCondition(
  attribute: CaseSearchAttribute,
  operator: CaseSearchOperator,
  value: CaseSearchScalar,
): Outcome<CaseSearchCondition> {
  if (operator !== 'eq' && !TIME_ATTRIBUTES.has(attribute)) {
    return fault('search_operator_refused', 'operator');
  }
  if (value === null) {
    return operator === 'eq' && NULLABLE.has(attribute)
      ? done({ kind: 'missing', attribute: attribute as MissingAttribute })
      : fault('search_value_invalid', 'value');
  }
  if (typeof value !== 'string') {
    return fault('search_value_invalid', 'value');
  }
  if (TIME_ATTRIBUTES.has(attribute)) {
    const instant = instantOf(value);
    return instant === null
      ? fault('search_value_invalid', 'value')
      : done({ kind: 'time', attribute: attribute as TimeAttribute, operator, value: instant });
  }
  switch (attribute) {
    case 'account_id':
      return ID.account.test(value)
        ? done({ kind: 'holds', attribute, value })
        : fault('search_value_invalid', 'value');
    case 'inquiry_id':
      return ID.inquiry.test(value)
        ? done({ kind: 'holds', attribute, value })
        : fault('search_value_invalid', 'value');
    case 'tag_id':
      return isValidTag(value)
        ? done({ kind: 'tagged', value: normalizeTag(value) })
        : fault('search_value_invalid', 'value');
    default: {
      const equality = attribute as keyof typeof EQUALITY;
      return EQUALITY[equality](value)
        ? done({ kind: 'equals', attribute: equality, value } as CaseSearchCondition)
        : fault('search_value_invalid', 'value');
    }
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is CaseSearchScalar =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

const LEAF_KEYS = ['attribute', 'operator', 'value'] as const;
const GROUP_KEYS: ReadonlySet<string> = new Set(['and', 'or', 'not']);

class Reader {
  readonly problems: CaseSearchProblem[] = [];
  readonly fieldKeys = new Set<string>();

  constructor(private readonly context: CaseSearchContext) {}

  problem(code: CaseSearchProblemCode, pointer: string): null {
    if (this.problems.length < MAX_PROBLEMS) {
      this.problems.push({ code, pointer });
    }
    return null;
  }

  /** A node at `depth` groups from the top; a group past the limit is never walked into. */
  node(node: unknown, pointer: string, depth: number): CaseSearchPredicate | null {
    if (!isRecord(node)) {
      return this.problem('search_shape_invalid', pointer);
    }
    const keys = Object.keys(node);
    if (keys.length === LEAF_KEYS.length && LEAF_KEYS.every((key) => Object.hasOwn(node, key))) {
      return this.leaf(node, pointer);
    }
    const [key] = keys;
    if (keys.length !== 1 || key === undefined || !GROUP_KEYS.has(key)) {
      return this.problem('search_shape_invalid', pointer);
    }
    if (depth >= DEPTH) {
      return this.problem('search_depth_exceeded', pointer);
    }
    const inner = `${pointer}/${key}`;
    const child = node[key];
    if (key === 'not') {
      const clause = this.node(child, inner, depth + 1);
      return clause === null ? null : { kind: 'not', clause };
    }
    if (!Array.isArray(child) || child.length === 0) {
      return this.problem('search_shape_invalid', inner);
    }
    if (child.length > CLAUSES) {
      return this.problem('search_clauses_exceeded', inner);
    }
    const clauses = child.map((item: unknown, index) =>
      this.node(item, `${inner}/${pointerToken(index)}`, depth + 1),
    );
    return clauses.every((clause) => clause !== null)
      ? { kind: key === 'and' ? 'and' : 'or', clauses }
      : null;
  }

  leaf(node: Readonly<Record<string, unknown>>, pointer: string): CaseSearchPredicate | null {
    const { attribute, operator, value } = node;
    if (typeof attribute !== 'string') {
      return this.problem('search_shape_invalid', `${pointer}/attribute`);
    }
    if (typeof operator !== 'string') {
      return this.problem('search_shape_invalid', `${pointer}/operator`);
    }
    if (!isScalar(value)) {
      return this.problem('search_shape_invalid', `${pointer}/value`);
    }
    const isField = attribute.startsWith(FIELDS);
    if (!isField && !SEARCH_ATTRIBUTES.has(attribute)) {
      return this.problem('search_attribute_unknown', `${pointer}/attribute`);
    }
    if (!OPERATORS.has(operator)) {
      return this.problem('search_operator_refused', `${pointer}/operator`);
    }
    const comparison = operator as CaseSearchOperator;
    const outcome = isField
      ? fieldCondition(attribute.slice(FIELDS.length), comparison, value, this.context)
      : attributeCondition(attribute as CaseSearchAttribute, comparison, value);
    if (!outcome.ok) {
      return this.problem(outcome.code, `${pointer}/${outcome.member}`);
    }
    if (outcome.value.kind === 'field') {
      this.fieldKeys.add(outcome.value.key);
    }
    return outcome.value;
  }
}

/**
 * Parses and validates `query` (C137.2). `pointer` is where the query sits in the body. Every leaf is
 * read, so a body learns each of its faults at once (up to twenty); a group nested past the depth or
 * holding too many clauses is refused without reading what it holds.
 *
 * Ours, where the public product does not say: `template` and `case_queue` compare names, `state`
 * the status category, `tag_id` a tag's name; `eq null` reads "holds nothing" on the seven nullable
 * attributes; timestamps are RFC 3339 with an offset; ids are OpenVerify ids, never email addresses
 * (decision 64); a field compares by equality only, through its keyed index.
 */
export function parseCaseSearchQuery(
  query: unknown,
  context: CaseSearchContext,
  pointer = '/query',
): CaseSearchParse {
  if (query === undefined) {
    return { ok: true, predicate: null, fieldKeys: [] };
  }
  const reader = new Reader(context);
  const predicate = reader.node(query, pointer, 0);
  if (predicate === null || reader.problems.length > 0) {
    return { ok: false, problems: reader.problems };
  }
  return { ok: true, predicate, fieldKeys: [...reader.fieldKeys].sort() };
}
