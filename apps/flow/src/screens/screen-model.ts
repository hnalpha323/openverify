/**
 * C148 (Workflow 9A, flow-renderer): what a `screen` step's form holds and checks, pure. The client
 * checks only to help the person (C148.5: the server validates every value again); visibility runs
 * through `packages/flow-spec`'s one strict evaluator (C148.4) and patterns through its linear-time
 * matcher (C148.3, rule 18), never `RegExp`, so the client and the server always agree on a value.
 * Arabic-Indic digits are normalised as the person types in a number, date, phone or ID field
 * (C161.4).
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import {
  compilePattern,
  evaluateVisibility,
  matchPattern,
  normalizeDigits,
  PATTERN_INPUT_LIMIT,
  type Component,
  type ScreenClientView,
} from '@openverify/flow-spec';
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';

/** A value a screen field holds while the person edits it. */
export type ScreenValue = string | boolean | readonly string[];

/** What the session says a field holds (C151.5): a value, or `{ set: true }` (masked, write-once). */
type SessionValue = NonNullable<FlowSessionResponse['values']>[string];

export type FormComponent = Extract<
  Component,
  {
    kind:
      | 'text_input'
      | 'text_area'
      | 'number'
      | 'date'
      | 'email'
      | 'phone'
      | 'select'
      | 'radio_group'
      | 'checkbox'
      | 'checkbox_group'
      | 'multi_select'
      | 'country_select'
      | 'url'
      | 'masked_text';
  }
>;
export type AddressComponent = Extract<Component, { kind: 'address' }>;
export type ButtonComponent = Extract<Component, { kind: 'button' }>;

/** The address component's parts, in the order they are shown. */
export const ADDRESS_PARTS = [
  'street1',
  'street2',
  'city',
  'subdivision',
  'postalCode',
  'country',
] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];

/** One field the screen binds, with the component that shows it. */
export interface BoundField {
  readonly key: string;
  readonly component: FormComponent | AddressComponent;
  /** The address part, for a field an address component binds. */
  readonly part?: AddressPart;
}

const FORM_KINDS: ReadonlySet<string> = new Set([
  'text_input',
  'text_area',
  'number',
  'date',
  'email',
  'phone',
  'select',
  'radio_group',
  'checkbox',
  'checkbox_group',
  'multi_select',
  'country_select',
  'url',
  'masked_text',
]);

export const isFormComponent = (component: Component): component is FormComponent =>
  FORM_KINDS.has(component.kind);

/** Every component of a screen, depth first, containers and footers included. */
export function allComponents(components: readonly Component[]): Component[] {
  return components.flatMap((component) =>
    component.kind === 'container' || component.kind === 'footer'
      ? [component, ...allComponents(component.children)]
      : [component],
  );
}

/** The fields a screen binds, in the order they are shown. */
export function boundFields(step: Pick<ScreenClientView, 'components'>): BoundField[] {
  return allComponents(step.components).flatMap((component): BoundField[] => {
    if (isFormComponent(component)) {
      return [{ key: component.field, component }];
    }
    if (component.kind === 'address') {
      return ADDRESS_PARTS.flatMap((part) => {
        const key = component.fields[part];
        return key === undefined ? [] : [{ key, component, part }];
      });
    }
    return [];
  });
}

/** Holds a list of values (a multi select or a checkbox group). */
const isListKind = (kind: string): boolean => kind === 'multi_select' || kind === 'checkbox_group';

function emptyValue(field: BoundField): ScreenValue {
  if (field.component.kind === 'checkbox') return false;
  if (isListKind(field.component.kind)) return [];
  return '';
}

/** A value the session sent, as the control holds it; `null` when it cannot hold it. */
function fromSession(field: BoundField, value: SessionValue): ScreenValue | null {
  if (value === null || (typeof value === 'object' && !Array.isArray(value))) return null;
  const { kind } = field.component;
  if (kind === 'checkbox') return typeof value === 'boolean' ? value : null;
  if (isListKind(kind)) return Array.isArray(value) ? value : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** The screen's state on arrival. */
export interface ScreenState {
  /** Each field's value, by field key. */
  readonly values: Readonly<Record<string, ScreenValue>>;
  /**
   * The fields the server holds but never sends back (a masked or write-once value, C151.5):
   * shown as set, never re-sent unless the person types a new value.
   */
  readonly set: ReadonlySet<string>;
}

/**
 * C148.7, C151.5 (3.3.7): a field that already holds a value (prefilled, entered earlier, copied
 * from an extraction) is shown filled; one the server will not send back is shown as set.
 */
export function initialScreenState(
  step: Pick<ScreenClientView, 'components'>,
  sessionValues: FlowSessionResponse['values'] = {},
): ScreenState {
  const values: Record<string, ScreenValue> = {};
  const set = new Set<string>();
  for (const field of boundFields(step)) {
    const sent = Object.hasOwn(sessionValues, field.key) ? sessionValues[field.key] : undefined;
    if (sent !== undefined && typeof sent === 'object' && sent !== null && !Array.isArray(sent)) {
      set.add(field.key);
    }
    values[field.key] = (sent === undefined ? null : fromSession(field, sent)) ?? emptyValue(field);
  }
  return { values, set };
}

/** The kinds whose typed digits are normalised (C161.4): numbers, dates, phones and IDs. */
const DIGIT_KINDS: ReadonlySet<string> = new Set([
  'number',
  'date',
  'phone',
  'text_input',
  'masked_text',
]);

/** A typed value, as the field keeps it: Arabic-Indic digits become ASCII where they mean digits. */
export function normalizeTyped(field: BoundField, value: string): string {
  return DIGIT_KINDS.has(field.component.kind) || field.part === 'postalCode'
    ? normalizeDigits(value)
    : value;
}

/** The values a visibility rule reads: every field of the screen, an empty one read as `null`. */
export function visibilityValues(
  values: Readonly<Record<string, ScreenValue>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === '' ? null : value]),
  );
}

export type Visibility = 'visible' | 'hidden' | 'disabled';

/**
 * C148.4: whether a component is shown and usable, through the shared strict evaluator. A rule
 * outside the subset throws `VisibilityRuleError`, which the screen shows as unsupported (never a
 * guess).
 */
export function visibilityOf(
  component: Component,
  values: Readonly<Record<string, ScreenValue>>,
): Visibility {
  const scope = visibilityValues(values);
  if (!evaluateVisibility(component.visibleWhen, scope)) return 'hidden';
  return evaluateVisibility(component.enabledWhen, scope) ? 'visible' : 'disabled';
}

/** The components shown, with their state; a hidden container hides its children too. */
export function visibleComponentIds(
  components: readonly Component[],
  values: Readonly<Record<string, ScreenValue>>,
  inherited: Visibility = 'visible',
): Map<string, Visibility> {
  const states = new Map<string, Visibility>();
  for (const component of components) {
    const own = inherited === 'hidden' ? 'hidden' : visibilityOf(component, values);
    const state = own === 'visible' && inherited === 'disabled' ? 'disabled' : own;
    states.set(component.id, state);
    if (component.kind === 'container' || component.kind === 'footer') {
      for (const [id, child] of visibleComponentIds(component.children, values, state)) {
        states.set(id, child);
      }
    }
  }
  return states;
}

/** Why a field's value is refused, keyed for the `screen.errors.*` messages. */
export type FieldErrorCode =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'pattern'
  | 'number'
  | 'tooSmall'
  | 'tooLarge'
  | 'date'
  | 'dateTooEarly'
  | 'dateTooLate'
  | 'email'
  | 'phone'
  | 'url'
  | 'option'
  | 'country'
  /** The server refused the value (a 422 named its field). */
  | 'refused';

export interface FieldError {
  readonly code: FieldErrorCode;
  /** The bound the message names (a length, a number or a date), when it names one. */
  readonly limit?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isEmpty(value: ScreenValue): boolean {
  return value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

function isDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function lengthError(
  value: string,
  component: { readonly minLength?: number | undefined; readonly maxLength?: number | undefined },
): FieldError | null {
  // Code points, so a character outside the BMP counts once.
  const length = Array.from(value).length;
  if (component.minLength !== undefined && length < component.minLength) {
    return { code: 'tooShort', limit: String(component.minLength) };
  }
  if (component.maxLength !== undefined && length > component.maxLength) {
    return { code: 'tooLong', limit: String(component.maxLength) };
  }
  if (length > PATTERN_INPUT_LIMIT) {
    return { code: 'tooLong', limit: String(PATTERN_INPUT_LIMIT) };
  }
  return null;
}

function patternError(value: string, source: string | undefined): FieldError | null {
  if (source === undefined) return null;
  const compiled = compilePattern(source);
  // A pattern the matcher refuses fails closed, as the server's does (`pattern_refused` at publish).
  return compiled.ok && matchPattern(compiled.pattern, value) ? null : { code: 'pattern' };
}

/** The error of one non-empty value, by its component's kind. */
function valueError(field: BoundField, value: ScreenValue): FieldError | null {
  const { component } = field;
  if (component.kind === 'address') {
    if (typeof value !== 'string') return null;
    if (field.part === 'country') {
      const allowed = component.allowedCountries;
      return allowed === undefined || allowed.includes(value) ? null : { code: 'country' };
    }
    return lengthError(value, {});
  }
  switch (component.kind) {
    case 'text_input':
    case 'text_area':
    case 'masked_text':
      if (typeof value !== 'string') return null;
      return lengthError(value, component) ?? patternError(value, component.pattern);
    case 'number': {
      if (typeof value !== 'string') return null;
      const number = Number(value);
      if (value.trim() === '' || !Number.isFinite(number)) return { code: 'number' };
      if (component.min !== undefined && number < component.min) {
        return { code: 'tooSmall', limit: String(component.min) };
      }
      if (component.max !== undefined && number > component.max) {
        return { code: 'tooLarge', limit: String(component.max) };
      }
      return null;
    }
    case 'date':
      if (typeof value !== 'string' || !isDate(value)) return { code: 'date' };
      if (component.min !== undefined && value < component.min) {
        return { code: 'dateTooEarly', limit: component.min };
      }
      if (component.max !== undefined && value > component.max) {
        return { code: 'dateTooLate', limit: component.max };
      }
      return null;
    case 'email':
      return typeof value === 'string' && EMAIL.test(value) && value.length <= 254
        ? null
        : { code: 'email' };
    case 'url':
      return typeof value === 'string' && isHttpUrl(value) && value.length <= 2048
        ? null
        : { code: 'url' };
    case 'phone': {
      if (typeof value !== 'string') return { code: 'phone' };
      const allowed = component.allowedCountries;
      const valid =
        allowed === undefined
          ? isValidPhoneNumber(value)
          : allowed.some((country) => isValidPhoneNumber(value, country as CountryCode));
      return valid ? null : { code: 'phone' };
    }
    case 'select':
    case 'radio_group':
      return component.options.some((option) => option.value === value) ? null : { code: 'option' };
    case 'multi_select':
    case 'checkbox_group':
      return Array.isArray(value) &&
        value.every((item) => component.options.some((option) => option.value === item))
        ? null
        : { code: 'option' };
    case 'country_select': {
      const allowed = component.allowedCountries;
      return typeof value === 'string' && (allowed === undefined || allowed.includes(value))
        ? null
        : { code: 'country' };
    }
    case 'checkbox':
      return null;
  }
}

/** Whether the field must hold a value: the component's own `required`, an address's for its parts. */
function isRequired(field: BoundField): boolean {
  if (field.component.required !== true) return false;
  // An address's second street line and subdivision are never required (C148.2).
  return field.part !== 'street2' && field.part !== 'subdivision';
}

/**
 * C148.5, C148.7: the visible fields' errors, by field key. A hidden component's value is
 * discarded and its `required` ignored; a field shown as set (a masked or write-once value the
 * server holds) is not required again.
 */
export function screenErrors(
  step: Pick<ScreenClientView, 'components'>,
  state: ScreenState,
  visibility: ReadonlyMap<string, Visibility>,
): Map<string, FieldError> {
  const errors = new Map<string, FieldError>();
  for (const field of boundFields(step)) {
    if (visibility.get(field.component.id) !== 'visible' || errors.has(field.key)) continue;
    const value = state.values[field.key] ?? emptyValue(field);
    if (isEmpty(value)) {
      if (isRequired(field) && !state.set.has(field.key))
        errors.set(field.key, { code: 'required' });
      continue;
    }
    const error = valueError(field, value);
    if (error !== null) errors.set(field.key, error);
  }
  return errors;
}

/** A submitted value, as `submitFlowScreenBodySchema` takes it. */
export type SubmittedValue = string | number | boolean | null | string[];

/**
 * C148.5: the body's `values`: only visible, enabled fields; digits normalised (C161.4); a number
 * as a number; an empty value as `null`; a field shown as set and left empty is not sent, so the
 * server keeps what it holds.
 */
export function submissionValues(
  step: Pick<ScreenClientView, 'components'>,
  state: ScreenState,
  visibility: ReadonlyMap<string, Visibility>,
): Record<string, SubmittedValue> {
  const values: Record<string, SubmittedValue> = {};
  for (const field of boundFields(step)) {
    if (visibility.get(field.component.id) !== 'visible' || Object.hasOwn(values, field.key)) {
      continue;
    }
    const value = state.values[field.key] ?? emptyValue(field);
    if (isEmpty(value) && field.component.kind !== 'checkbox') {
      if (!state.set.has(field.key)) values[field.key] = null;
      continue;
    }
    if (typeof value === 'string') {
      const typed = normalizeTyped(field, value);
      values[field.key] = field.component.kind === 'number' ? Number(typed) : typed;
    } else if (typeof value === 'boolean') {
      values[field.key] = value;
    } else {
      values[field.key] = [...value];
    }
  }
  return values;
}
