/**
 * Step forms from the catalogue's config schemas (C141.4, C122.4, editor note 2.3): each member of
 * an action's config, as `z.toJSONSchema()` rendered it, becomes one form field typed by its schema,
 * so the console never hard-codes an action's settings. A value is a C115 template: a text field
 * may hold `{{ path }}` references, and a number field takes a number or exactly one reference,
 * which carries its JSON type. Anything the form cannot type (an object, a list, a union) is edited
 * as JSON. The action's own strict schema, on the server, stays the authority (C113.5).
 */
export type FieldKind = 'text' | 'number' | 'integer' | 'boolean' | 'enum' | 'json';

export interface FormField {
  readonly name: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** An enum's values, in the schema's order. */
  readonly options: readonly string[];
  /** What the field takes, in words. */
  readonly hint: string;
  /** Holds a workflow secret reference (C125.3), never a value. */
  readonly secret: boolean;
}

export type FieldParse =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly problem: string };

type Schema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** C115.1: a text that is exactly one `{{ path }}` reference. */
const SINGLE_REFERENCE = /^\{\{\s*[^{}\s]+\s*\}\}$/;

const range = (schema: Schema, unit: string): string => {
  const { minimum, maximum } = schema;
  if (typeof minimum === 'number' && typeof maximum === 'number') {
    return ` from ${String(minimum)} to ${String(maximum)}${unit}`;
  }
  if (typeof minimum === 'number') {
    return ` of at least ${String(minimum)}${unit}`;
  }
  return typeof maximum === 'number' ? ` of at most ${String(maximum)}${unit}` : '';
};

const defaultOf = (schema: Schema): string =>
  schema.default === undefined ? '' : `; ${JSON.stringify(schema.default)} when left out`;

function fieldOf(name: string, schema: Schema, required: boolean, references: boolean): FormField {
  const pattern = typeof schema.pattern === 'string' ? schema.pattern : '';
  // A workflow secret reference is itself a C115 template; a template member never holds one.
  const secret = references && pattern.includes('secrets');
  const base = { name, required, options: [] as readonly string[], secret };
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : schema.const === undefined
      ? null
      : [schema.const];
  if (values?.every((value) => typeof value === 'string')) {
    return {
      ...base,
      kind: 'enum',
      options: values,
      hint: `One of the listed values${defaultOf(schema)}.`,
    };
  }
  switch (schema.type) {
    case 'string': {
      const most =
        typeof schema.maxLength === 'number'
          ? `, at most ${String(schema.maxLength)} characters`
          : '';
      return {
        ...base,
        kind: 'text',
        hint: secret
          ? 'A workflow secret, written {{ secrets.<key> }}; its value is never shown.'
          : references
            ? `Text, or one {{ path }}${most}.`
            : `Text${most}.`,
      };
    }
    case 'integer':
      return {
        ...base,
        kind: 'integer',
        hint: `A whole number${range(schema, '')}${defaultOf(schema)}.`,
      };
    case 'number':
      return { ...base, kind: 'number', hint: `A number${range(schema, '')}${defaultOf(schema)}.` };
    case 'boolean':
      return { ...base, kind: 'boolean', hint: `Yes or no${defaultOf(schema)}.` };
    default:
      return {
        ...base,
        kind: 'json',
        hint: references ? 'JSON; a string inside it may hold {{ path }} references.' : 'JSON.',
      };
  }
}

/**
 * Whether values may be C115 templates (a workflow step's config, the default) or not (a template
 * member's form, C153.1: no hint mentions `{{ path }}` and no number takes one).
 */
export interface SchemaFormOptions {
  readonly references?: boolean;
}

/** One field per member of a config schema, in its order; none for a schema without members. */
export function fieldsOf(schema: unknown, options: SchemaFormOptions = {}): readonly FormField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, member]) =>
    fieldOf(name, isRecord(member) ? member : {}, required.has(name), options.references ?? true),
  );
}

/** What the field's control shows for a stored value. */
export function fieldText(field: FormField, value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (field.kind === 'json') {
    return JSON.stringify(value, null, 2);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The value a control's text stands for: `undefined` leaves the member out. */
export function parseFieldText(
  field: FormField,
  text: string,
  options: SchemaFormOptions = {},
): FieldParse {
  const references = options.references ?? true;
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: true, value: undefined };
  }
  switch (field.kind) {
    case 'text':
      return { ok: true, value: text };
    case 'integer':
    case 'number': {
      if (references && SINGLE_REFERENCE.test(trimmed)) {
        return { ok: true, value: trimmed };
      }
      const number = Number(trimmed);
      const whole = field.kind === 'integer';
      return Number.isFinite(number) && (!whole || Number.isInteger(number))
        ? { ok: true, value: number }
        : {
            ok: false,
            problem: `${whole ? 'Enter a whole number' : 'Enter a number'}${references ? ', or one {{ path }}' : ''}.`,
          };
    }
    case 'boolean':
      return trimmed === 'true' || trimmed === 'false'
        ? { ok: true, value: trimmed === 'true' }
        : { ok: false, problem: 'Choose yes or no.' };
    case 'enum':
      return field.options.includes(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, problem: 'Choose one of the listed values.' };
    case 'json':
      try {
        return { ok: true, value: JSON.parse(trimmed) as unknown };
      } catch {
        return { ok: false, problem: 'Enter JSON.' };
      }
  }
}
