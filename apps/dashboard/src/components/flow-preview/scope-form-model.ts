/**
 * C156.4 (Workflow 9C, `dashboard-preview`): the simulated scope form's model. Each fact is left
 * unset (the API's default: an unsimulated verification or workflow stops the path there, an
 * enabled check left out counts passed), set to a value, or set to `null`, an unknown fact that a
 * route meets through its `onNull`. Only the flow-provisional signals are offered (C150.9). The
 * values are the operator's synthetic ones and travel only in the simulate body (C174.5).
 */
import type { SimulatedScope } from '@openverify/contracts';
import { PREVIEW_COPY } from '../../lib/copy/preview';

export interface ScopeSubjects {
  readonly verifications: readonly { readonly id: string; readonly type: string }[];
  readonly workflows: readonly { readonly id: string }[];
  readonly signals: readonly { readonly name: string; readonly valueType: string }[];
  readonly lists: readonly string[];
}

export interface VerificationForm {
  status: string;
  checks: string;
  extractions: string;
}
export interface WorkflowForm {
  status: string;
  errorType: string;
  outputs: string;
}
export interface SignalForm {
  mode: '' | 'null' | 'set';
  value: string;
}
export interface ScopeForm {
  verifications: Record<string, VerificationForm>;
  workflows: Record<string, WorkflowForm>;
  signals: Record<string, SignalForm>;
  lists: Record<string, '' | 'matched' | 'none' | 'null'>;
  device: { kind: string; platform: string };
  tags: string;
  fields: string;
  /** Each offered signal's value type, from the registry, to parse what is typed. */
  signalTypes: Record<string, string>;
}

export interface ScopeFormError {
  readonly message: string;
}
export type ScopeResult =
  | { readonly ok: true; readonly scope: SimulatedScope }
  | { readonly ok: false; readonly errors: readonly ScopeFormError[] };

/** A value of `JSON.parse`, or `undefined` when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const CHECK_STATUSES = ['passed', 'failed', 'not_applicable', 'null'] as const;
type CheckStatus = 'passed' | 'failed' | 'not_applicable' | null;

/** An empty form: every fact left to the API's default, nothing sent. */
export function emptyScopeForm(subjects: ScopeSubjects): ScopeForm {
  return {
    verifications: Object.fromEntries(
      subjects.verifications.map(({ id }) => [id, { status: '', checks: '', extractions: '' }]),
    ),
    workflows: Object.fromEntries(
      subjects.workflows.map(({ id }) => [id, { status: '', errorType: '', outputs: '' }]),
    ),
    signals: Object.fromEntries(
      subjects.signals.map(({ name }) => [name, { mode: '', value: '' }]),
    ),
    lists: Object.fromEntries(subjects.lists.map((list) => [list, ''])),
    device: { kind: '', platform: '' },
    tags: '',
    fields: '',
    signalTypes: Object.fromEntries(
      subjects.signals.map(({ name, valueType }) => [name, valueType]),
    ),
  };
}

/** A JSON object member: `undefined` when blank, the object, or an error. */
function jsonObject(
  text: string,
  label: string,
  errors: ScopeFormError[],
  prefix = '',
): Record<string, unknown> | undefined {
  if (text.trim() === '') {
    return undefined;
  }
  const value = parseJson(text);
  if (!isRecord(value)) {
    errors.push({ message: `${prefix}${PREVIEW_COPY.simulate.jsonInvalid(label)}` });
    return undefined;
  }
  return value;
}

/** `name, status` lines into check overrides. */
function checksOf(
  text: string,
  stepId: string,
  errors: ScopeFormError[],
): Record<string, CheckStatus> | undefined {
  const checks: Record<string, CheckStatus> = {};
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') {
      continue;
    }
    const [name, status, ...rest] = line.split(',').map((part) => part.trim());
    if (
      name === undefined ||
      name === '' ||
      status === undefined ||
      rest.length > 0 ||
      !(CHECK_STATUSES as readonly string[]).includes(status)
    ) {
      errors.push({
        message: `${stepId}: ${PREVIEW_COPY.simulate.checkLineInvalid(index + 1)}`,
      });
      continue;
    }
    checks[name] = status === 'null' ? null : (status as CheckStatus);
  }
  return Object.keys(checks).length > 0 ? checks : undefined;
}

/** A signal's simulated value, parsed by its value type. */
function signalValueOf(
  name: string,
  valueType: string,
  text: string,
  errors: ScopeFormError[],
): unknown {
  const value = text.trim();
  const expected = PREVIEW_COPY.simulate.valueExpected;
  if (valueType === 'integer' || valueType === 'number') {
    const number = value === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(number) || (valueType === 'integer' && !Number.isInteger(number))) {
      errors.push({ message: `${name}: ${expected[valueType]}` });
      return undefined;
    }
    return number;
  }
  if (valueType === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      errors.push({ message: `${name}: ${expected.boolean}` });
      return undefined;
    }
    return value === 'true';
  }
  return value;
}

const nullable = (value: string): string | null => (value === 'null' ? null : value);

/**
 * The simulated scope the form describes: only the members the operator set, `null` where they
 * chose "unknown", or the errors that keep it from being sent.
 */
export function scopeOfForm(form: ScopeForm): ScopeResult {
  const errors: ScopeFormError[] = [];
  const scope: Record<string, unknown> = {};

  const verifications: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(form.verifications)) {
    const checks = checksOf(entry.checks, id, errors);
    const extractions = jsonObject(
      entry.extractions,
      PREVIEW_COPY.simulate.extractions,
      errors,
      `${id}: `,
    );
    const member = {
      ...(entry.status === '' ? {} : { status: nullable(entry.status) }),
      ...(checks === undefined ? {} : { checks }),
      ...(extractions === undefined ? {} : { extractions }),
    };
    if (Object.keys(member).length > 0) {
      verifications[id] = member;
    }
  }
  if (Object.keys(verifications).length > 0) {
    scope.verifications = verifications;
  }

  const signals: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(form.signals)) {
    if (entry.mode === 'null') {
      signals[name] = null;
    } else if (entry.mode === 'set') {
      const value = signalValueOf(name, form.signalTypes[name] ?? 'string', entry.value, errors);
      if (value !== undefined) {
        signals[name] = value;
      }
    }
  }
  if (Object.keys(signals).length > 0) {
    scope.signals = signals;
  }

  const lists: Record<string, { matched: boolean | null }> = {};
  for (const [list, choice] of Object.entries(form.lists)) {
    if (choice !== '') {
      lists[list] = { matched: choice === 'null' ? null : choice === 'matched' };
    }
  }
  if (Object.keys(lists).length > 0) {
    scope.lists = lists;
  }

  const device = {
    ...(form.device.kind === '' ? {} : { kind: nullable(form.device.kind) }),
    ...(form.device.platform === '' ? {} : { platform: nullable(form.device.platform) }),
  };
  if (Object.keys(device).length > 0) {
    scope.device = device;
  }

  const workflows: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(form.workflows)) {
    const outputs = jsonObject(
      entry.outputs,
      PREVIEW_COPY.simulate.workflowOutputs,
      errors,
      `${id}: `,
    );
    if (entry.status === '') {
      continue;
    }
    workflows[id] = {
      status: entry.status,
      ...(entry.errorType.trim() === '' ? {} : { 'error-type': entry.errorType.trim() }),
      ...(outputs === undefined ? {} : { outputs }),
    };
  }
  if (Object.keys(workflows).length > 0) {
    scope.workflows = workflows;
  }

  const tags = form.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  if (tags.length > 0) {
    scope.inquiry = { tags };
  }

  const fields = jsonObject(form.fields, PREVIEW_COPY.simulate.fields, errors);
  if (fields !== undefined) {
    scope.fields = fields;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, scope: scope };
}

const jsonText = (value: unknown): string =>
  value === undefined ? '' : JSON.stringify(value, null, 2);

/** A preset's scope back in the form, for a preset whose values the operator may see. */
export function formOfScope(scope: SimulatedScope, subjects: ScopeSubjects): ScopeForm {
  const form = emptyScopeForm(subjects);
  for (const [id, entry] of Object.entries(scope.verifications ?? {})) {
    form.verifications[id] = {
      status: entry.status === undefined ? '' : (entry.status ?? 'null'),
      checks: Object.entries(entry.checks ?? {})
        .map(([name, status]) => `${name}, ${status ?? 'null'}`)
        .join('\n'),
      extractions: jsonText(entry.extractions),
    };
  }
  for (const [name, value] of Object.entries(scope.signals ?? {})) {
    form.signals[name] =
      value === null
        ? { mode: 'null', value: '' }
        : { mode: 'set', value: typeof value === 'string' ? value : JSON.stringify(value) };
  }
  for (const [list, { matched }] of Object.entries(scope.lists ?? {})) {
    form.lists[list] = matched === null ? 'null' : matched ? 'matched' : 'none';
  }
  const kind = scope.device?.kind;
  const platform = scope.device?.platform;
  form.device = {
    kind: kind === undefined ? '' : (kind ?? 'null'),
    platform: platform === undefined ? '' : (platform ?? 'null'),
  };
  for (const [id, entry] of Object.entries(scope.workflows ?? {})) {
    form.workflows[id] = {
      status: entry.status,
      errorType: entry['error-type'] ?? '',
      outputs: jsonText(entry.outputs),
    };
  }
  form.tags = (scope.inquiry?.tags ?? []).join(', ');
  form.fields = jsonText(scope.fields);
  return form;
}
