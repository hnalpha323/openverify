/**
 * C104.3: the validator of a version, built by walking its stored schemas and cached by version id.
 * Each schema becomes a plain closure, and zod checks only the leaves it knows best. Nothing here
 * is a `z.object`: zod 4 compiles an object's keys into a `new Function`, and a field schema
 * generates no code (P22). A problem names a declared key and an index, never a value and never a
 * key the request made up, because such a key can hold a value.
 */
import { z } from 'zod';
import { isCardLike } from './card-guard.js';
import type {
  FieldProblem,
  FieldProblemCode,
  FieldReference,
  FieldsValidator,
  JsonFieldValue,
  TransactionTypeVersionContent,
} from './engine.js';
import type { FieldSchema } from './field-schemas.js';
import { configOf, isRecord, type FieldConfig } from './field-tree.js';
import { TRANSACTION_LIMITS, type RelationSchemaTarget } from './field-types.js';
import { exceedsJsonBytes, exceedsJsonDepth } from './json-caps.js';

/** Ours, provisional: a client fixes a batch at a time, and an answer stays smaller than its body. */
const MAX_FIELD_PROBLEMS = 100;
/** Ours, provisional: a version's closures are small, and a process serves few versions at once. */
const MAX_CACHED_VALIDATORS = 256;
const EMAIL_LENGTH = 254;

const ULID_BODY = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const PLATFORM_FILE_ID = new RegExp(`^file_${ULID_BODY}$`);
const VERIFICATION_ID = new RegExp(`^ver_${ULID_BODY}$`);
const CONTROL_CHARACTERS = /\p{Cc}/gu;

const EMAIL = z.email();
const ISO_DATE = z.iso.date();
const ISO_DATETIME = z.iso.datetime({ offset: true });

/** The state of one walk; the compiled closures hold none. */
interface Walk {
  readonly guard: boolean;
  readonly problems: FieldProblem[];
  readonly references: FieldReference[];
  readonly jsonValues: JsonFieldValue[];
}

type FieldWalker = (value: unknown, pointer: string, walk: Walk) => unknown;

interface Member {
  readonly key: string;
  readonly walker: FieldWalker;
  readonly writable: boolean;
  readonly required: boolean;
  readonly defaultValue: unknown;
}

function newWalk(guard: boolean): Walk {
  return { guard, problems: [], references: [], jsonValues: [] };
}

function refuse(
  walk: Walk,
  pointer: string,
  code: FieldProblemCode = 'field_schema_invalid',
): void {
  if (walk.problems.length < MAX_FIELD_PROBLEMS) {
    walk.problems.push({ code, pointer });
  }
}

function guardValue(value: string | number, pointer: string, walk: Walk): void {
  if (walk.guard && isCardLike(value)) {
    refuse(walk, pointer, 'card_number_refused');
  }
}

function numberOf(config: FieldConfig, name: string): number | undefined {
  const value = config[name];
  return typeof value === 'number' ? value : undefined;
}

function textOf(config: FieldConfig, name: string): string | undefined {
  const value = config[name];
  return typeof value === 'string' ? value : undefined;
}

function longerThan(text: string, characters: number): boolean {
  if (text.length <= characters) {
    return false;
  }
  return text.length > characters * 2 || Array.from(text).length > characters;
}

function sanitise(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '').trim();
}

function stringWalker(field: FieldSchema): FieldWalker {
  const config = configOf(field);
  const maxCharacters =
    numberOf(config, 'max-char-length') ?? TRANSACTION_LIMITS.stringDefaultLength;
  const sanitising = Array.isArray(config.sanitize) && config.sanitize.includes('html');
  const required = config.required === true;
  return (value, pointer, walk) => {
    if (typeof value !== 'string') {
      refuse(walk, pointer);
      return undefined;
    }
    const text = sanitising ? sanitise(value) : value;
    if (longerThan(text, maxCharacters) || (required && text === '')) {
      refuse(walk, pointer);
      return undefined;
    }
    guardValue(text, pointer, walk);
    return text;
  };
}

function numericWalker(field: FieldSchema, accepts: (value: number) => boolean): FieldWalker {
  const config = configOf(field);
  const min = numberOf(config, 'min') ?? Number.NEGATIVE_INFINITY;
  const max = numberOf(config, 'max') ?? Number.POSITIVE_INFINITY;
  return (value, pointer, walk) => {
    if (typeof value !== 'number' || !accepts(value) || value < min || value > max) {
      refuse(walk, pointer);
      return undefined;
    }
    guardValue(value, pointer, walk);
    return value;
  };
}

const booleanWalker: FieldWalker = (value, pointer, walk) => {
  if (typeof value !== 'boolean') {
    refuse(walk, pointer);
  }
  return value;
};

const datetimeWalker: FieldWalker = (value, pointer, walk) => {
  if (!ISO_DATETIME.safeParse(value).success) {
    refuse(walk, pointer);
  }
  return value;
};

function dateWalker(field: FieldSchema): FieldWalker {
  const config = configOf(field);
  const minDate = textOf(config, 'min-date');
  const maxDate = textOf(config, 'max-date');
  return (value, pointer, walk) => {
    const parsed = ISO_DATE.safeParse(value);
    if (
      !parsed.success ||
      (minDate !== undefined && parsed.data < minDate) ||
      (maxDate !== undefined && parsed.data > maxDate)
    ) {
      refuse(walk, pointer);
    }
    return value;
  };
}

const emailWalker: FieldWalker = (value, pointer, walk) => {
  if (typeof value !== 'string' || value.length > EMAIL_LENGTH || !EMAIL.safeParse(value).success) {
    refuse(walk, pointer);
    return undefined;
  }
  guardValue(value, pointer, walk);
  return value;
};

function choicesOf(config: FieldConfig): ReadonlySet<unknown> {
  return new Set(Array.isArray(config.options) ? (config.options as unknown[]) : []);
}

function choicesWalker(field: FieldSchema): FieldWalker {
  const config = configOf(field);
  const options = choicesOf(config);
  const allowEmpty = config['allow-empty'] === true;
  return (value, pointer, walk) => {
    if (value === null && allowEmpty) {
      return null;
    }
    if (typeof value !== 'string' || !options.has(value)) {
      refuse(walk, pointer);
      return undefined;
    }
    guardValue(value, pointer, walk);
    return value;
  };
}

function multiChoicesWalker(field: FieldSchema): FieldWalker {
  const config = configOf(field);
  const options = choicesOf(config);
  const allowEmpty = config['allow-empty'] === true;
  return (value, pointer, walk) => {
    if (
      !Array.isArray(value) ||
      (value.length === 0 && !allowEmpty) ||
      new Set(value).size !== value.length ||
      !value.every((choice) => options.has(choice))
    ) {
      refuse(walk, pointer);
      return undefined;
    }
    (value as string[]).forEach((choice, index) => {
      guardValue(choice, `${pointer}/${String(index)}`, walk);
    });
    return value as unknown;
  };
}

function arrayWalker(field: FieldSchema, schemaPointer: string): FieldWalker {
  const config = configOf(field);
  const item = compileField(
    config['item-schema'] as FieldSchema,
    `${schemaPointer}/config/item-schema`,
  );
  const maxItems = numberOf(config, 'max-items') ?? 0;
  const required = config.required === true;
  return (value, pointer, walk) => {
    if (!Array.isArray(value) || value.length > maxItems || (required && value.length === 0)) {
      refuse(walk, pointer);
      return undefined;
    }
    return (value as unknown[]).map((entry, index) =>
      item(entry, `${pointer}/${String(index)}`, walk),
    );
  };
}

function hashWalker(field: FieldSchema, schemaPointer: string): FieldWalker {
  const config = configOf(field);
  const members = compileMembers(
    config['item-schemas'] as readonly FieldSchema[],
    `${schemaPointer}/config/item-schemas`,
  );
  const declared = new Set(members.map(({ key }) => key));
  const strict = config['ignore-unknown-keys'] !== true;
  return (value, pointer, walk) => {
    if (!isRecord(value)) {
      refuse(walk, pointer);
      return undefined;
    }
    if (strict && Object.keys(value).some((key) => !declared.has(key))) {
      refuse(walk, pointer);
    }
    return walkMembers(members, value, pointer, walk, false);
  };
}

/** Every string, key and number of a `json` value. Its depth is checked first, so this ends. */
function jsonHoldsCard(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return isCardLike(value);
  }
  if (Array.isArray(value)) {
    return value.some(jsonHoldsCard);
  }
  return (
    isRecord(value) &&
    Object.entries(value).some(([key, member]) => isCardLike(key) || jsonHoldsCard(member))
  );
}

function jsonWalker(schemaPointer: string): FieldWalker {
  const jsonSchemaPointer = `${schemaPointer}/config/json-schema`;
  return (value, pointer, walk) => {
    if (
      value === null ||
      value === undefined ||
      exceedsJsonDepth(value, TRANSACTION_LIMITS.jsonValueDepth) ||
      exceedsJsonBytes(value, TRANSACTION_LIMITS.jsonValueBytes)
    ) {
      refuse(walk, pointer);
      return undefined;
    }
    if (walk.guard && jsonHoldsCard(value)) {
      refuse(walk, pointer, 'card_number_refused');
      return undefined;
    }
    walk.jsonValues.push({ pointer, schemaPointer: jsonSchemaPointer, value });
    return value;
  };
}

const platformFileWalker: FieldWalker = (value, pointer, walk) => {
  if (typeof value !== 'string' || !PLATFORM_FILE_ID.test(value)) {
    refuse(walk, pointer);
    return undefined;
  }
  walk.references.push({ kind: 'platform-file', pointer, id: value });
  return value;
};

function relationWalker(field: FieldSchema): FieldWalker {
  const target = textOf(configOf(field), 'target') as RelationSchemaTarget;
  return (value, pointer, walk) => {
    if (typeof value !== 'string' || !VERIFICATION_ID.test(value)) {
      refuse(walk, pointer);
      return undefined;
    }
    walk.references.push({ kind: 'relation-schema', pointer, id: value, target });
    return value;
  };
}

/** A `file` value is written only by its `PUT` route, so no JSON body holds one (P22). */
const refusingWalker: FieldWalker = (_value, pointer, walk) => {
  refuse(walk, pointer);
  return undefined;
};

function compileField(field: FieldSchema, schemaPointer: string): FieldWalker {
  switch (field.type) {
    case 'string':
      return stringWalker(field);
    case 'integer':
      return numericWalker(field, Number.isSafeInteger);
    case 'number':
      return numericWalker(field, Number.isFinite);
    case 'boolean':
      return booleanWalker;
    case 'datetime':
      return datetimeWalker;
    case 'email-address':
      return emailWalker;
    case 'date':
      return dateWalker(field);
    case 'choices':
      return choicesWalker(field);
    case 'multi-choices':
      return multiChoicesWalker(field);
    case 'array':
      return arrayWalker(field, schemaPointer);
    case 'hash':
      return hashWalker(field, schemaPointer);
    case 'json':
      return jsonWalker(schemaPointer);
    case 'platform-file':
      return platformFileWalker;
    case 'relation-schema':
      return relationWalker(field);
    default:
      return refusingWalker;
  }
}

/** A `file`, an alias and an archived or deactivated field take no write from a JSON body. */
function isWritable(field: FieldSchema): boolean {
  const config = configOf(field);
  return (
    field.type !== 'file' &&
    typeof config['source-key-path'] !== 'string' &&
    typeof config['archived-at'] !== 'string' &&
    typeof config['deactivated-at'] !== 'string'
  );
}

function compileMembers(fields: readonly FieldSchema[], schemaPointer: string): Member[] {
  return fields.map((field, index) => ({
    key: field.key,
    walker: compileField(field, `${schemaPointer}/${String(index)}`),
    writable: isWritable(field),
    required: configOf(field).required === true,
    defaultValue: field['default-value'],
  }));
}

function walkMembers(
  members: readonly Member[],
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  walk: Walk,
  partial: boolean,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const { key, walker, writable, required, defaultValue } of members) {
    const memberPointer = `${pointer}/${key}`;
    const present = Object.hasOwn(record, key);
    if (present && writable) {
      values[key] = walker(record[key], memberPointer, walk);
    } else if (present) {
      refuse(walk, memberPointer);
    } else if (writable && !partial && defaultValue !== undefined) {
      values[key] = walker(defaultValue, memberPointer, walk);
    } else if (writable && !partial && required) {
      refuse(walk, memberPointer);
    }
  }
  return values;
}

function buildValidator(content: TransactionTypeVersionContent): FieldsValidator {
  const members = compileMembers(content.fieldSchemas, '/field-schemas');
  const declared = new Set(members.map(({ key }) => key));
  return (fields, options) => {
    const walk = newWalk(!content.allowCardLikeStrings);
    if (Object.keys(fields).some((key) => !declared.has(key))) {
      refuse(walk, '');
    }
    const values = walkMembers(members, fields, '', walk, options?.partial === true);
    return walk.problems.length === 0
      ? { values, problems: [], references: walk.references, jsonValues: walk.jsonValues }
      : { values: {}, problems: walk.problems, references: [], jsonValues: [] };
  };
}

interface CachedValidator {
  readonly fieldSchemas: readonly FieldSchema[];
  readonly text: string;
  readonly allowCardLikeStrings: boolean;
  readonly validator: FieldsValidator;
}

/** In least recently used order: a `Map` keeps insertion order. */
const validators = new Map<string, CachedValidator>();

function holdsSameContent(
  cached: CachedValidator,
  content: TransactionTypeVersionContent,
): boolean {
  return (
    cached.allowCardLikeStrings === content.allowCardLikeStrings &&
    (cached.fieldSchemas === content.fieldSchemas ||
      cached.text === JSON.stringify(content.fieldSchemas))
  );
}

/**
 * C104.3: the validator of a version, built by walking its schemas, cached by version id. A
 * published version never changes; a read that holds other content under the same id (a draft, a
 * caller's slip) gets a validator of what it holds, never another version's rules.
 */
export function fieldsValidatorOf(content: TransactionTypeVersionContent): FieldsValidator {
  const cached = validators.get(content.id);
  if (cached !== undefined) {
    validators.delete(content.id);
    if (holdsSameContent(cached, content)) {
      validators.set(content.id, cached);
      return cached.validator;
    }
  }
  const validator = buildValidator(content);
  validators.set(content.id, {
    fieldSchemas: content.fieldSchemas,
    text: JSON.stringify(content.fieldSchemas),
    allowCardLikeStrings: content.allowCardLikeStrings,
    validator,
  });
  if (validators.size > MAX_CACHED_VALIDATORS) {
    const oldest = validators.keys().next();
    if (oldest.done !== true) {
      validators.delete(oldest.value);
    }
  }
  return validator;
}

/** The problems of one value against one field: how publish reads a `default-value`. */
export function fieldValueProblems(
  field: FieldSchema,
  value: unknown,
  pointer: string,
  guard: boolean,
): readonly FieldProblem[] {
  const walk = newWalk(guard);
  compileField(field, '')(value, pointer, walk);
  return walk.problems;
}
