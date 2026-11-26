/**
 * The typed variable model (plan C115.3): what a path can hold, whether it can be null (C114.6) and
 * whether it is personal data (C115.6). Types come from two places, and both end up here:
 * - the small DSL of a definition's inputs, variables and response schemas, parsed by hand;
 * - a contract's zod schema, read through `z.toJSONSchema`.
 *
 * Nothing here builds a zod schema from a definition: zod compiles object keys into `new Function`,
 * and no name an operator writes may reach that (C113.8, outcome 14). Values are checked by plain
 * functions instead ({@link checkValue}).
 */
import { z } from 'zod';
import { isJsonRecord, pointerOf, type JsonValue } from '../expressions/json.js';

interface Marks {
  /** C114.6: a path that can read null at run time. */
  readonly nullable: boolean;
  /** C115.6: personal data, inherited by everything inside it. */
  readonly pii: boolean;
}

export type ScalarKind = 'string' | 'number' | 'integer' | 'boolean' | 'datetime';

export type ScopeType = Marks &
  (
    | { readonly kind: ScalarKind }
    | { readonly kind: 'id'; readonly prefix: string | null }
    | { readonly kind: 'enum'; readonly values: readonly string[] }
    | { readonly kind: 'list'; readonly of: ScopeType }
    | {
        readonly kind: 'object';
        readonly members: Readonly<Record<string, ScopeType>>;
        /** What any other member holds: a record's values, or `null` for a closed object. */
        readonly rest: ScopeType | null;
        /** C114.4: a trigger view, where the public `country_code` reads `country-code`. */
        readonly inflect: boolean;
      }
    | {
        readonly kind: 'any';
        /** C124.5: no path reads inside it, because no schema says what it holds. */
        readonly opaque: boolean;
      }
  );

const PLAIN: Marks = Object.freeze({ nullable: false, pii: false });

export const ANY_TYPE: ScopeType = Object.freeze({ kind: 'any', opaque: false, ...PLAIN });

export const scalarType = (kind: ScalarKind, marks: Partial<Marks> = {}): ScopeType => ({
  kind,
  ...PLAIN,
  ...marks,
});

export const objectType = (
  members: Readonly<Record<string, ScopeType>>,
  marks: Partial<Marks> = {},
): ScopeType => ({ kind: 'object', members, rest: null, inflect: false, ...PLAIN, ...marks });

export const listType = (of: ScopeType, marks: Partial<Marks> = {}): ScopeType => ({
  kind: 'list',
  of,
  ...PLAIN,
  ...marks,
});

export const enumType = (values: readonly string[], marks: Partial<Marks> = {}): ScopeType => ({
  kind: 'enum',
  values,
  ...PLAIN,
  ...marks,
});

export const idType = (prefix: string | null, marks: Partial<Marks> = {}): ScopeType => ({
  kind: 'id',
  prefix,
  ...PLAIN,
  ...marks,
});

/** A copy of `type` with `marks` added: a mark, once set, stays set. */
export function withMarks(type: ScopeType, marks: Partial<Marks>): ScopeType {
  return {
    ...type,
    nullable: type.nullable || marks.nullable === true,
    pii: type.pii || marks.pii === true,
  };
}

// ---------------------------------------------------------------------------------------------
// The DSL (C115.3)

export type TypeParse =
  { readonly ok: true; readonly type: ScopeType } | { readonly ok: false; readonly detail: string };

const SCALARS: ReadonlySet<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'datetime',
]);
const REFUSED_MEMBERS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;

const WORD = /^[a-z][a-z0-9_-]*/;
const PREFIX = /^[a-z]+$/;
const ENUM_VALUE = /^[\w.-]+$/;
const PII_SUFFIX = /^\s+pii\b/;

class DslError extends Error {
  override readonly name = 'DslError';
}

/** A recursive reader over `text`, with one cursor. */
class DslReader {
  private position = 0;

  constructor(private readonly text: string) {}

  private get rest(): string {
    return this.text.slice(this.position);
  }

  private skipSpace(): void {
    while (this.text[this.position] === ' ') {
      this.position += 1;
    }
  }

  private expect(token: string): void {
    this.skipSpace();
    if (!this.rest.startsWith(token)) {
      throw new DslError('This type is not in the type grammar');
    }
    this.position += token.length;
  }

  private accept(token: string): boolean {
    this.skipSpace();
    if (this.rest.startsWith(token)) {
      this.position += token.length;
      return true;
    }
    return false;
  }

  private word(): string {
    this.skipSpace();
    const [found] = WORD.exec(this.rest) ?? [];
    if (found === undefined) {
      throw new DslError('This type is not in the type grammar');
    }
    this.position += found.length;
    return found;
  }

  private delimited(close: string): string {
    const end = this.text.indexOf(close, this.position);
    if (end === -1) {
      throw new DslError('This type is not in the type grammar');
    }
    const inner = this.text.slice(this.position, end);
    this.position = end + close.length;
    return inner;
  }

  private readId(): ScopeType {
    this.expect('<');
    const prefix = this.delimited('>');
    if (!PREFIX.test(prefix)) {
      throw new DslError('An id type names a lower-case prefix');
    }
    return idType(prefix);
  }

  private readEnum(): ScopeType {
    this.expect('<');
    const values = this.delimited('>')
      .split(',')
      .map((value) => value.trim());
    if (!values.every((value) => ENUM_VALUE.test(value))) {
      throw new DslError('An enum type lists its values');
    }
    return enumType(values);
  }

  private readObject(depth: number): ScopeType {
    this.expect('{');
    const members: Record<string, ScopeType> = {};
    do {
      const name = this.word();
      if (REFUSED_MEMBERS.has(name) || Object.hasOwn(members, name)) {
        throw new DslError('An object type names each member once');
      }
      const optional = this.accept('?');
      this.expect(':');
      members[name] = withMarks(this.readType(depth + 1), { nullable: optional });
    } while (this.accept(','));
    this.expect('}');
    return objectType(members);
  }

  private readBase(depth: number): ScopeType {
    const name = this.word();
    if (depth > MAX_DEPTH) {
      throw new DslError('This type is nested too deep');
    }
    if (SCALARS.has(name)) {
      return scalarType(name as ScalarKind);
    }
    switch (name) {
      case 'file':
        // C118.2: a file value is in scope as its id, never as bytes.
        return idType('wfrf');
      case 'id':
        return this.readId();
      case 'enum':
        return this.readEnum();
      case 'list': {
        this.expect('<');
        const of = this.readType(depth + 1);
        this.expect('>');
        return listType(of);
      }
      case 'object':
        return this.readObject(depth);
      default:
        throw new DslError('This type is not in the type grammar');
    }
  }

  private readType(depth: number): ScopeType {
    const type = this.readBase(depth);
    const [suffix] = PII_SUFFIX.exec(this.rest) ?? [];
    if (suffix === undefined) {
      return type;
    }
    this.position += suffix.length;
    return withMarks(type, { pii: true });
  }

  read(): ScopeType {
    const type = this.readType(0);
    this.skipSpace();
    if (this.position !== this.text.length) {
      throw new DslError('This type is not in the type grammar');
    }
    return type;
  }
}

/** C115.3: a declared type. The answer quotes nothing it was given. */
export function parseTypeDsl(text: string): TypeParse {
  try {
    return { ok: true, type: new DslReader(text).read() };
  } catch (error) {
    if (error instanceof DslError) {
      return { ok: false, detail: error.message };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Merges

const mergeMarks = (left: Marks, right: Marks): Marks => ({
  nullable: left.nullable || right.nullable,
  pii: left.pii || right.pii,
});

const isNumeric = (type: ScopeType): boolean => type.kind === 'number' || type.kind === 'integer';

/** What two types of the same shape merge to, or `null` when they have no shape in common. */
function mergeScalars(left: ScopeType, right: ScopeType, marks: Marks): ScopeType | null {
  if (left.kind === 'enum' && right.kind === 'enum') {
    return { ...left, values: [...new Set([...left.values, ...right.values])], ...marks };
  }
  if (left.kind === 'id' && right.kind === 'id') {
    return { ...left, prefix: left.prefix === right.prefix ? left.prefix : null, ...marks };
  }
  if (isNumeric(left) && isNumeric(right)) {
    return {
      ...scalarType(left.kind === right.kind ? (left.kind as ScalarKind) : 'number'),
      ...marks,
    };
  }
  return left.kind === right.kind && SCALARS.has(left.kind) ? { ...left, ...marks } : null;
}

function mergeRest(
  left: ScopeType | null,
  right: ScopeType | null,
  merge: (left: ScopeType, right: ScopeType) => ScopeType,
): ScopeType | null {
  return left === null || right === null ? (left ?? right) : merge(left, right);
}

/** C122.1: the variants of an output: a member of one variant may be absent in another. */
export function unionTypes(left: ScopeType, right: ScopeType): ScopeType {
  const marks = mergeMarks(left, right);
  if (left.kind === 'list' && right.kind === 'list') {
    return { ...left, of: unionTypes(left.of, right.of), ...marks };
  }
  if (left.kind === 'object' && right.kind === 'object') {
    const members: Record<string, ScopeType> = {};
    for (const name of new Set([...Object.keys(left.members), ...Object.keys(right.members)])) {
      const [one, other] = [left.members[name], right.members[name]];
      const merged =
        one === undefined || other === undefined ? (one ?? other) : unionTypes(one, other);
      if (merged !== undefined) {
        members[name] =
          one === undefined || other === undefined ? withMarks(merged, { nullable: true }) : merged;
      }
    }
    return { ...left, members, rest: mergeRest(left.rest, right.rest, unionTypes), ...marks };
  }
  return mergeScalars(left, right, marks) ?? { ...ANY_TYPE, ...marks };
}

/** C114.5: the events of one trigger: a path must hold in every one of them. */
export function commonType(left: ScopeType, right: ScopeType): ScopeType {
  const marks = mergeMarks(left, right);
  if (left.kind === 'list' && right.kind === 'list') {
    return { ...left, of: commonType(left.of, right.of), ...marks };
  }
  if (left.kind === 'object' && right.kind === 'object') {
    const members: Record<string, ScopeType> = {};
    for (const [name, one] of Object.entries(left.members)) {
      const other = right.members[name];
      if (Object.hasOwn(right.members, name) && other !== undefined) {
        members[name] = commonType(one, other);
      }
    }
    return {
      ...left,
      members,
      rest: left.rest === null || right.rest === null ? null : commonType(left.rest, right.rest),
      ...marks,
    };
  }
  return mergeScalars(left, right, marks) ?? { ...ANY_TYPE, ...marks };
}

// ---------------------------------------------------------------------------------------------
// Zod contracts (C115.3)

export interface FromZodOptions {
  /** C15: attributes every exit masks by name, so they are PII whatever their schema says. */
  readonly piiNames?: ReadonlySet<string>;
}

type JsonSchema = Readonly<Record<string, unknown>>;

const ID_PATTERN = /^\^([a-z]+)_/;

const isSchema = (value: unknown): value is JsonSchema => isJsonRecord(value);

function fromString(schema: JsonSchema): ScopeType {
  const { format, pattern } = schema;
  if (format === 'date-time') {
    return scalarType('datetime');
  }
  const [, prefix] = (typeof pattern === 'string' ? ID_PATTERN.exec(pattern) : null) ?? [];
  return prefix === undefined ? scalarType('string') : idType(prefix);
}

function fromObject(schema: JsonSchema, names: ReadonlySet<string>): ScopeType {
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const members: Record<string, ScopeType> = {};
  for (const [name, member] of Object.entries(properties)) {
    const type = isSchema(member) ? fromJsonSchema(member, names) : ANY_TYPE;
    members[name] = withMarks(type, { nullable: !required.has(name), pii: names.has(name) });
  }
  const { additionalProperties } = schema;
  const rest = isSchema(additionalProperties)
    ? withMarks(fromJsonSchema(additionalProperties, names), { nullable: true })
    : additionalProperties === true
      ? withMarks(ANY_TYPE, { nullable: true })
      : null;
  return { kind: 'object', members, rest, inflect: false, ...PLAIN };
}

function fromVariants(variants: readonly unknown[], names: ReadonlySet<string>): ScopeType {
  const schemas = variants.filter(isSchema);
  const present = schemas.filter(({ type }) => type !== 'null');
  const [first, ...others] = present.map((variant) => fromJsonSchema(variant, names));
  const merged = others.reduce(unionTypes, first ?? ANY_TYPE);
  return withMarks(merged, { nullable: present.length < schemas.length || first === undefined });
}

function fromTyped(schema: JsonSchema, names: ReadonlySet<string>): ScopeType {
  switch (schema.type) {
    case 'string':
      return fromString(schema);
    case 'number':
      return scalarType('number');
    case 'integer':
      return scalarType('integer');
    case 'boolean':
      return scalarType('boolean');
    case 'array':
      return listType(isSchema(schema.items) ? fromJsonSchema(schema.items, names) : ANY_TYPE);
    case 'object':
      return fromObject(schema, names);
    default:
      return ANY_TYPE;
  }
}

function fromLiterals(schema: JsonSchema): ScopeType | null {
  const values = schema.const === undefined ? schema.enum : [schema.const];
  return Array.isArray(values) && values.every((value) => typeof value === 'string')
    ? enumType(values)
    : null;
}

/** Zod writes a nullable scalar as `type: ['number', 'null']`. */
function fromTypeList(
  schema: JsonSchema,
  types: readonly unknown[],
  names: ReadonlySet<string>,
): ScopeType {
  const present = types.filter((type) => type !== 'null');
  const [only] = present;
  const type = present.length === 1 ? fromTyped({ ...schema, type: only }, names) : ANY_TYPE;
  return withMarks(type, { nullable: present.length < types.length });
}

function fromJsonSchema(schema: JsonSchema, names: ReadonlySet<string>): ScopeType {
  const variants = schema.anyOf ?? schema.oneOf;
  const fromType = (): ScopeType =>
    Array.isArray(schema.type)
      ? fromTypeList(schema, schema.type as readonly unknown[], names)
      : (fromLiterals(schema) ?? fromTyped(schema, names));
  const type = Array.isArray(variants)
    ? fromVariants(variants as readonly unknown[], names)
    : fromType();
  return withMarks(type, { pii: schema.pii === true });
}

/** C115.3: a contract's schema as a type, with `.meta({ pii: true })` read as its PII mark. */
export function typeFromZod(schema: z.ZodType, options: FromZodOptions = {}): ScopeType {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' });
  return fromJsonSchema(json, options.piiNames ?? new Set());
}

/**
 * C115.3: the JSON Schema of a type, for the editor's variable picker. It is written out here rather
 * than through `z.toJSONSchema`, because a zod schema is never built from what an operator wrote.
 */
export function typeToJsonSchema(type: ScopeType): JsonValue {
  const marks = {
    ...(type.pii ? { pii: true } : {}),
    ...(type.nullable ? { nullable: true } : {}),
  };
  const of = (name: string): string | readonly string[] => (type.nullable ? [name, 'null'] : name);
  switch (type.kind) {
    case 'any':
      return marks;
    case 'datetime':
      return { type: of('string'), format: 'date-time', ...marks } as JsonValue;
    case 'id':
      return {
        type: of('string'),
        ...(type.prefix === null ? {} : { pattern: `^${type.prefix}_` }),
        ...marks,
      } as JsonValue;
    case 'enum':
      return { type: of('string'), enum: [...type.values], ...marks } as JsonValue;
    case 'list':
      return { type: of('array'), items: typeToJsonSchema(type.of), ...marks } as JsonValue;
    case 'object': {
      const entries = Object.entries(type.members);
      return {
        type: of('object'),
        properties: Object.fromEntries(
          entries.map(([name, member]) => [name, typeToJsonSchema(member)]),
        ),
        required: entries.filter(([, member]) => !member.nullable).map(([name]) => name),
        additionalProperties: type.rest === null ? false : typeToJsonSchema(type.rest),
        ...marks,
      } as JsonValue;
    }
    default:
      return { type: of(type.kind), ...marks } as JsonValue;
  }
}

// ---------------------------------------------------------------------------------------------
// Values (C118.2, C115.4)

export interface ValueProblem {
  readonly pointer: string;
  readonly code: 'value_missing' | 'value_type' | 'value_member';
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function scalarFits(type: ScopeType, value: JsonValue): boolean {
  switch (type.kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'datetime':
      return typeof value === 'string' && INSTANT.test(value);
    case 'id':
      return (
        typeof value === 'string' &&
        (type.prefix === null ? value.includes('_') : value.startsWith(`${type.prefix}_`))
      );
    case 'enum':
      return typeof value === 'string' && type.values.includes(value);
    default:
      return true;
  }
}

function checkObject(
  type: Extract<ScopeType, { kind: 'object' }>,
  value: JsonValue,
  pointer: string,
): readonly ValueProblem[] {
  if (!isJsonRecord(value)) {
    return [{ pointer, code: 'value_type' }];
  }
  const known = Object.entries(type.members).flatMap(([name, member]) =>
    check(member, Object.hasOwn(value, name) ? value[name] : undefined, pointerOf(pointer, name)),
  );
  const others = Object.entries(value)
    .filter(([name]) => !Object.hasOwn(type.members, name))
    .flatMap(([name, member]): readonly ValueProblem[] =>
      type.rest === null
        ? [{ pointer: pointerOf(pointer, name), code: 'value_member' }]
        : check(type.rest, member, pointerOf(pointer, name)),
    );
  return [...known, ...others];
}

function check(
  type: ScopeType,
  value: JsonValue | undefined,
  pointer: string,
): readonly ValueProblem[] {
  if (value === undefined || value === null) {
    return type.nullable ? [] : [{ pointer, code: 'value_missing' }];
  }
  if (type.kind === 'object') {
    return checkObject(type, value, pointer);
  }
  if (type.kind === 'list') {
    return Array.isArray(value)
      ? value.flatMap((item, index) => check(type.of, item, pointerOf(pointer, index)))
      : [{ pointer, code: 'value_type' }];
  }
  return scalarFits(type, value) ? [] : [{ pointer, code: 'value_type' }];
}

/**
 * C118.2, C115.4: where `value` leaves `type`. The answer holds pointers and codes, never a value, so
 * it can reach a problem body (C143.5).
 */
export function checkValue(type: ScopeType, value: JsonValue | undefined): readonly ValueProblem[] {
  return check(type, value, '');
}

// ---------------------------------------------------------------------------------------------
// Paths (C114.5)

export type Resolution =
  | {
      readonly ok: true;
      readonly type: ScopeType;
      readonly nullable: boolean;
      readonly pii: boolean;
    }
  | { readonly ok: false; readonly at: number; readonly reason: 'unknown' | 'untyped' };

function memberOf(type: ScopeType, segment: string): ScopeType | undefined {
  if (type.kind !== 'object') {
    return undefined;
  }
  if (Object.hasOwn(type.members, segment)) {
    return type.members[segment];
  }
  const inflected = segment.replaceAll('_', '-');
  if (type.inflect && Object.hasOwn(type.members, inflected)) {
    return type.members[inflected];
  }
  return type.rest ?? undefined;
}

const SOMETHING_INSIDE = withMarks(ANY_TYPE, { nullable: true });

function step(type: ScopeType, segment: string | number): ScopeType | undefined {
  if (type.kind === 'any') {
    return type.opaque ? undefined : SOMETHING_INSIDE;
  }
  if (typeof segment === 'number') {
    return type.kind === 'list' ? withMarks(type.of, { nullable: true }) : undefined;
  }
  return memberOf(type, segment);
}

/** C114.5: the type at a path, with every mark met on the way. */
export function resolvePath(root: ScopeType, segments: readonly (string | number)[]): Resolution {
  let type = root;
  let { nullable, pii } = root;
  for (const [index, segment] of segments.entries()) {
    const next = step(type, segment);
    if (next === undefined) {
      const untyped = type.kind === 'any';
      return { ok: false, at: index, reason: untyped ? 'untyped' : 'unknown' };
    }
    type = next;
    nullable ||= next.nullable;
    pii ||= next.pii;
  }
  return { ok: true, type, nullable, pii };
}
