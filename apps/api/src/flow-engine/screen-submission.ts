/**
 * C148.5 (Workflow 9A, api-flow-engine, checkpoint "screens"): a screen step's submission. Only the
 * current step accepts it (409 `flow_step_not_current`, C151.4); a resubmission of a screen the
 * path already left moves nothing and answers the current session (the caller's). Every value is
 * validated again on the server against the screen's own components:
 *
 * - a hidden component (`visibleWhen` false, evaluated by `packages/flow-spec`'s strict visibility
 *   evaluator over the screen's values, rule 18) is not validated and its value is discarded, as is
 *   any value the screen binds to no component;
 * - Arabic-Indic and Eastern Arabic-Indic digits are normalised first (`normalizeDigits`, C161.4);
 * - types, `required`, lengths, ranges, patterns (the linear-time matcher only, C148.3), options and
 *   countries are checked; each refusal is a 422 at `/values/<field>` (or `/button`) that never
 *   echoes the value;
 * - `fields` is merged and checked by `validateInquiryFieldsWrite` (`api-templates`: unknown keys,
 *   write-once values, the size cap) before it is written;
 * - the exit is the button's port (`button:<key>`, or `next` for the primary submit button),
 *   recorded and advanced in the same transaction (`advanceFlowInTx`).
 */
import { validateEmailDestination, validatePhoneDestination } from '@openverify/checks';
import {
  listInquiryFlowSteps,
  lockInquiry,
  updateInquiry,
  type Db,
  type InquiryFields,
} from '@openverify/db';
import {
  compilePattern,
  evaluateVisibility,
  matchPattern,
  normalizeDigits,
  VisibilityRuleError,
  type Component,
  type FlowV2Step,
} from '@openverify/flow-spec';
import type { SubmitFlowScreenBody } from '@openverify/contracts';
import type { FlowSession } from '../auth/flow-session.js';
import { UnprocessableContentError, type ProblemFieldError } from '../errors.js';
import type { ApiDependencies } from '../services/context.js';
import { assertInquiryOpenUnderLock } from '../services/flow-preconditions.js';
import { findInquiry } from '../services/inquiries.js';
import { validateInquiryFieldsWrite } from '../services/templates/fields.js';
import { advanceFlowInTx, runFlowAfterCommit, type FlowAdvance } from './advance.js';
import { assertCurrentStepInTx } from './current-step.js';
import { pinnedFlowOf } from './pinned-flow.js';
import { positionFlowInTx } from './position.js';
import { isCalendarDate } from './calendar-date.js';

type ScreenStep = Extract<FlowV2Step, { type: 'screen' }>;
type SubmittedValue = SubmitFlowScreenBody['values'][string];

/** A form component and the field it binds (an address binds one per line). */
interface Binding {
  component: Component;
  key: string;
  required: boolean;
}

const refusal = (key: string, detail: string): ProblemFieldError => ({
  location: 'body',
  pointer: `/values/${key}`,
  detail,
});

/** The components a person sees, in order: containers walked, hidden ones (and their children) out. */
function visibleComponents(
  components: readonly Component[],
  values: Readonly<Record<string, unknown>>,
): Component[] {
  const shown: Component[] = [];
  const visit = (component: Component): void => {
    let visible: boolean;
    try {
      visible = evaluateVisibility(component.visibleWhen, values);
    } catch (error) {
      // A rule outside the strict subset never shows its component (failing closed); publish
      // refuses such a rule (`visibility_rule_invalid`).
      if (error instanceof VisibilityRuleError) return;
      throw error;
    }
    if (!visible) return;
    shown.push(component);
    if ('children' in component) component.children.forEach(visit);
  };
  components.forEach(visit);
  return shown;
}

/** Every field the screen binds, whether shown or not (the visibility rules read these). */
function boundKeys(components: readonly Component[]): string[] {
  const keys: string[] = [];
  const visit = (component: Component): void => {
    if ('children' in component) component.children.forEach(visit);
    for (const binding of bindingsOf(component)) keys.push(binding.key);
  };
  components.forEach(visit);
  return keys;
}

function bindingsOf(component: Component): Binding[] {
  if (component.kind === 'address') {
    const { fields } = component;
    const required = component.required === true;
    return [
      { component, key: fields.street1, required },
      ...(fields.street2 === undefined
        ? []
        : [{ component, key: fields.street2, required: false }]),
      { component, key: fields.city, required },
      ...(fields.subdivision === undefined
        ? []
        : [{ component, key: fields.subdivision, required: false }]),
      { component, key: fields.postalCode, required },
      { component, key: fields.country, required },
    ];
  }
  if ('field' in component && typeof component.field === 'string') {
    return [{ component, key: component.field, required: component.required === true }];
  }
  return [];
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const normalized = (value: SubmittedValue): SubmittedValue =>
  typeof value === 'string'
    ? normalizeDigits(value)
    : Array.isArray(value)
      ? value.map(normalizeDigits)
      : value;

/** A text's length in code points, as the pattern matcher and the clients count it. */
function codePoints(text: string): number {
  return Array.from(text).length;
}

const COUNTRY = /^[A-Z]{2}$/;

/** The string rules shared by the text components (C148.2, C148.3). */
function checkText(
  component: {
    minLength?: number | undefined;
    maxLength?: number | undefined;
    pattern?: string | undefined;
  },
  text: string,
): string | null {
  const length = codePoints(text);
  if (component.minLength !== undefined && length < component.minLength) {
    return 'The value is too short.';
  }
  if (component.maxLength !== undefined && length > component.maxLength) {
    return 'The value is too long.';
  }
  if (component.pattern !== undefined) {
    const compiled = compilePattern(component.pattern);
    if (!compiled.ok || !matchPattern(compiled.pattern, text)) {
      return 'The value does not have the expected form.';
    }
  }
  return null;
}

/**
 * The value to write for `binding`, or a refusal's detail. `value` is already normalised and not
 * empty.
 */
function checkValue(
  binding: Binding,
  value: SubmittedValue,
): { ok: true; value: string | number | boolean | string[] } | { ok: false; detail: string } {
  const { component } = binding;
  const text = typeof value === 'string' ? value : null;
  const refuse = (detail: string) => ({ ok: false as const, detail });
  switch (component.kind) {
    case 'text_input':
    case 'text_area':
    case 'masked_text': {
      if (text === null) return refuse('The value must be text.');
      const problem = checkText(component, text);
      return problem === null ? { ok: true, value: text } : refuse(problem);
    }
    case 'email': {
      if (text === null || !validateEmailDestination(text).ok) {
        return refuse('The value must be an email address.');
      }
      return { ok: true, value: text.trim() };
    }
    case 'phone': {
      if (text === null) return refuse('The value must be a phone number.');
      // Without allowed countries any region is taken: the validator's own region check is the
      // only refusal set aside then, and the number is kept in E.164 (`+` and its digits).
      const allowed = component.allowedCountries;
      const phone = validatePhoneDestination(text, {
        allowedCountries: allowed ?? [],
        allowVoip: true,
      });
      if (phone.ok) return { ok: true, value: phone.e164 };
      return allowed === undefined && phone.refusal === 'country_not_allowed'
        ? { ok: true, value: `+${text.replace(/\D/g, '')}` }
        : refuse('The phone number is not accepted.');
    }
    case 'url': {
      if (text === null || !URL.canParse(text) || new URL(text).protocol !== 'https:') {
        return refuse('The value must be an https address.');
      }
      return { ok: true, value: text };
    }
    case 'number': {
      const number = typeof value === 'number' ? value : text === null ? NaN : Number(text.trim());
      if (!Number.isFinite(number) || (text !== null && text.trim() === '')) {
        return refuse('The value must be a number.');
      }
      if (component.min !== undefined && number < component.min)
        return refuse('The number is too small.');
      if (component.max !== undefined && number > component.max)
        return refuse('The number is too large.');
      return { ok: true, value: number };
    }
    case 'date': {
      if (text === null || !isCalendarDate(text)) {
        return refuse('The value must be a date.');
      }
      if (component.min !== undefined && text < component.min)
        return refuse('The date is too early.');
      if (component.max !== undefined && text > component.max)
        return refuse('The date is too late.');
      return { ok: true, value: text };
    }
    case 'checkbox':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : refuse('The value must be yes or no.');
    case 'select':
    case 'radio_group':
      return text !== null && component.options.some((option) => option.value === text)
        ? { ok: true, value: text }
        : refuse('The value is not one of the choices.');
    case 'multi_select':
    case 'checkbox_group': {
      if (!Array.isArray(value) || new Set(value).size !== value.length) {
        return refuse('The values must be distinct choices.');
      }
      const allowed = new Set(component.options.map((option) => option.value));
      return value.every((member) => allowed.has(member))
        ? { ok: true, value: [...value] }
        : refuse('A value is not one of the choices.');
    }
    case 'country_select':
      return text !== null &&
        COUNTRY.test(text) &&
        (component.allowedCountries === undefined || component.allowedCountries.includes(text))
        ? { ok: true, value: text }
        : refuse('The country is not accepted.');
    case 'address': {
      if (text === null) return refuse('The value must be text.');
      if (binding.key === component.fields.country) {
        return COUNTRY.test(text) &&
          (component.allowedCountries === undefined || component.allowedCountries.includes(text))
          ? { ok: true, value: text }
          : refuse('The country is not accepted.');
      }
      return codePoints(text) <= 500 ? { ok: true, value: text } : refuse('The value is too long.');
    }
    default:
      return refuse('The value cannot be set here.');
  }
}

/** The submit buttons of the visible components: key (`null` for the primary one) to port. */
function exitPort(shown: readonly Component[], button: string | undefined): string | null {
  for (const component of shown) {
    if (component.kind !== 'button' || component.action !== 'submit') continue;
    if (button === undefined && component.port === undefined) return 'next';
    if (button !== undefined && component.port === button) return `button:${button}`;
  }
  return null;
}

/** What one submission writes: the fields and the exit, or the refusals. */
export function validateScreenSubmission(
  step: ScreenStep,
  current: InquiryFields,
  body: SubmitFlowScreenBody,
): { fields: Record<string, string | number | boolean | string[]>; port: string } {
  const submitted: Record<string, SubmittedValue> = {};
  for (const [key, value] of Object.entries(body.values)) {
    submitted[key] = normalized(value);
  }
  const screenValues: Record<string, unknown> = {};
  for (const key of boundKeys(step.components)) {
    screenValues[key] = Object.hasOwn(submitted, key)
      ? submitted[key]
      : ((current as Record<string, unknown>)[key] ?? null);
  }
  const shown = visibleComponents(step.components, screenValues);
  const errors: ProblemFieldError[] = [];
  const fields: Record<string, string | number | boolean | string[]> = {};
  for (const binding of shown.flatMap(bindingsOf)) {
    const value = submitted[binding.key];
    if (value === undefined || isEmpty(value)) {
      if (binding.required) errors.push(refusal(binding.key, 'A value is required.'));
      continue;
    }
    const checked = checkValue(binding, value);
    if (checked.ok) {
      fields[binding.key] = checked.value;
    } else {
      errors.push(refusal(binding.key, checked.detail));
    }
  }
  const port = exitPort(shown, body.button);
  if (port === null) {
    errors.push({ location: 'body', pointer: '/button', detail: 'The screen has no such button.' });
  }
  if (errors.length > 0 || port === null) {
    throw new UnprocessableContentError('Some values of the screen are not valid.', errors);
  }
  return { fields, port };
}

/**
 * Submits the session's screen `stepId` (C148.5). Answers nothing; the route answers the session.
 * @throws {FlowEngineProblemError} 409 `flow_step_not_current` for another step.
 * @throws {UnprocessableContentError} 422 with the refusals.
 */
export async function submitFlowScreen(
  deps: ApiDependencies,
  session: FlowSession,
  stepId: string,
  body: SubmitFlowScreenBody,
): Promise<void> {
  const { environmentId, inquiryId } = session;
  const ref = { environmentId, inquiryId };
  const advances = await deps.db.transaction(async (tx): Promise<FlowAdvance[]> => {
    await lockInquiry(tx, environmentId, inquiryId);
    const before = await findInquiry(tx, environmentId, inquiryId);
    if (
      before.redactedAt === null &&
      before.flowStepId !== null &&
      before.flowStepId !== stepId &&
      (await leftBefore(tx, ref, stepId))
    ) {
      // A resubmission (a second tab), also once the flow has ended: the session answers it.
      return [];
    }
    const locked = await assertInquiryOpenUnderLock(tx, environmentId, inquiryId);
    // C151.14: an inquiry the engine never positioned is positioned first, so the check below
    // reads the server's position, never today's rules.
    const positioned = locked.flowStepId === null ? [await positionFlowInTx(tx, deps, ref)] : [];
    const inquiry = await findInquiry(tx, environmentId, inquiryId);
    if (inquiry.flowStepId !== stepId && (await leftBefore(tx, ref, stepId))) {
      return positioned;
    }
    await assertCurrentStepInTx(tx, ref, { kind: 'screen', stepId });
    const pinned = await pinnedFlowOf(tx, inquiry);
    const step = pinned?.flow.steps.find((candidate) => candidate.id === stepId);
    if (pinned === null || step?.type !== 'screen') {
      // assertCurrentStepInTx accepts only a screen step the position names.
      return positioned;
    }
    const { fields, port } = validateScreenSubmission(step, inquiry.fields, body);
    if (Object.keys(fields).length > 0) {
      // C149.5: the values written are the ones the field rules answer, `strip-html` applied.
      const written = await validateInquiryFieldsWrite(tx, {
        kind: 'screen',
        environmentId,
        versionId: inquiry.inquiryTemplateVersionId,
        inquiryId,
        fields: { ...inquiry.fields, ...fields },
      });
      await updateInquiry(tx, environmentId, inquiryId, { fields: written });
    }
    return [
      ...positioned,
      await advanceFlowInTx(tx, deps, ref, { kind: 'screen-submitted', stepId, port }),
    ];
  });
  for (const advance of advances) {
    await deps.events.dispatch(advance.staged);
    await runFlowAfterCommit(advance);
  }
}

/** Whether the path already left the step `stepId` (a resubmission, C148.5). */
async function leftBefore(
  tx: Db,
  ref: { environmentId: string; inquiryId: string },
  stepId: string,
): Promise<boolean> {
  return (await listInquiryFlowSteps(tx, ref.environmentId, ref.inquiryId)).some(
    (entry) => entry.stepId === stepId && entry.exitPort !== null,
  );
}
