'use server';

/**
 * Saves the settings page (C15, C16, C47, C55.7, C73.6, `settings:write`): the organization's
 * `require-mfa`, the session environment's retention windows (its report retention among them),
 * its face matching settings (C42.4, C42.6) and its text message budget
 * (`otp-sms-max-per-hour`; the time it last tripped is read-only and never sent). Only the
 * settings that changed are sent, so the audit entry names exactly what the operator changed. A
 * budget above the installation's ceiling is the API's to refuse (422 at
 * `/otp-sms-max-per-hour`), which the form shows on the field.
 */
import {
  analyticsTimeZoneSchema,
  dashboardUpdateSettingsBodySchema,
  mailSenderNameSchema,
  type DashboardSettings,
} from '@openverify/contracts';
import { revalidatePath } from 'next/cache';
import {
  PLATFORM_NUMBER_FIELDS,
  BIOMETRIC_BASIS_FIELD,
  DISPLAY_NAME_FIELD,
  FACE_FIELDS,
  GRAPH_SWITCHES,
  OTP_FIELD,
  WINDOW_FIELDS,
  REPORT_RETENTION_FIELD,
  RETENTION_FIELDS,
  WORKFLOW_LIST_FIELDS,
  WORKFLOW_NUMBER_FIELDS,
  formatCount,
} from '../../components/operators/settings-fields';
import type { SettingsSaved } from '../../components/operators/settings-form';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { ActionInputError, formString, parseInput, runAction } from '../../lib/api/action';
import { getSettings, updateSettings } from '../../lib/api/settings';
import { describeVersionProblem } from '../../lib/version-problem-words';

const DAYS = /^\d{1,4}$/;
const MAX_DAYS = 3650;
/** A whole number of up to seven digits; each face field's range comes from the contracts. */
const COUNT = /^\d{1,7}$/;

/**
 * The settings the form asks for: a checked box sends `true`, an unchecked one nothing; an empty
 * inquiry retention keeps finished inquiries until they are redacted.
 * @throws {ActionInputError} with one field error per value that is not 1 to 3650 days, or not a
 * whole number in a face field's contract range.
 */
function settingsOf(formData: FormData, canPrivacy: boolean): Partial<DashboardSettings> {
  const wanted: Record<string, unknown> = {
    'require-mfa': formString(formData, 'require-mfa') === 'true',
  };
  const errors: { pointer: string; detail: string }[] = [];
  for (const field of RETENTION_FIELDS) {
    const value = formString(formData, field.name) ?? '';
    const days = DAYS.test(value) ? Number(value) : Number.NaN;
    if (value === '' && field.optional) {
      wanted[field.name] = null;
    } else if (days >= 1 && days <= MAX_DAYS) {
      wanted[field.name] = days;
    } else {
      errors.push({
        pointer: `/${field.name}`,
        detail: `Enter a whole number of days from 1 to ${String(MAX_DAYS)}${field.optional ? ', or leave it empty' : ''}.`,
      });
    }
  }
  for (const field of FACE_FIELDS) {
    const value = formString(formData, field.name) ?? '';
    const count = COUNT.test(value) ? Number(value) : Number.NaN;
    if (count >= field.min && count <= field.max) {
      wanted[field.name] = count;
    } else {
      errors.push({
        pointer: `/${field.name}`,
        detail: `Enter a whole number of ${field.unit} from ${formatCount(field.min)} to ${formatCount(field.max)}.`,
      });
    }
  }
  // C55.7: posted only where the API reported the budget; the tripped time is read-only.
  const budget = formString(formData, OTP_FIELD.name);
  if (budget !== undefined) {
    const count = COUNT.test(budget) ? Number(budget) : Number.NaN;
    if (count >= OTP_FIELD.min && count <= OTP_FIELD.max) {
      wanted[OTP_FIELD.name] = count;
    } else {
      errors.push({
        pointer: `/${OTP_FIELD.name}`,
        detail: `Enter a whole number of ${OTP_FIELD.unit} from ${formatCount(OTP_FIELD.min)} to ${formatCount(OTP_FIELD.max)}; the installation's ceiling may be lower.`,
      });
    }
  }
  // C73.6: posted only where the API reported it; empty keeps reports as long as inquiries.
  const reports = formString(formData, REPORT_RETENTION_FIELD.name);
  if (reports !== undefined) {
    const days = DAYS.test(reports) ? Number(reports) : Number.NaN;
    if (reports === '') {
      wanted[REPORT_RETENTION_FIELD.name] = null;
    } else if (days >= REPORT_RETENTION_FIELD.min && days <= REPORT_RETENTION_FIELD.max) {
      wanted[REPORT_RETENTION_FIELD.name] = days;
    } else {
      errors.push({
        pointer: `/${REPORT_RETENTION_FIELD.name}`,
        detail: `Enter a whole number of days from ${String(REPORT_RETENTION_FIELD.min)} to ${String(REPORT_RETENTION_FIELD.max)}, or leave it empty.`,
      });
    }
  }
  phase7SettingsOf(formData, wanted, errors);
  workflowSettingsOf(formData, wanted, errors, canPrivacy);
  platformSettingsOf(formData, wanted, errors);
  if (errors.length > 0) {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'Some values are not valid.',
      errors,
    });
  }
  return wanted;
}

/** A posted text, trimmed; `undefined` when the form did not post it. */
const posted = (formData: FormData, name: string) => formString(formData, name);

/** Empty is `null`; anything else is kept as typed, trimmed. */
const textOrNull = (value: string) => (value === '' ? null : value);

/**
 * C107.7: the Phase 7 settings the form posted (it posts only what the server reports, and the
 * privacy members only with `settings:privacy`), each checked against its contract range.
 */
function phase7SettingsOf(
  formData: FormData,
  wanted: Record<string, unknown>,
  errors: { pointer: string; detail: string }[],
): void {
  for (const field of WINDOW_FIELDS) {
    const value = posted(formData, field.name);
    if (value === undefined) {
      continue;
    }
    const days = DAYS.test(value) ? Number(value) : Number.NaN;
    if (value === '' && field.kept !== null) {
      wanted[field.name] = null;
    } else if (days >= field.min && days <= field.max) {
      wanted[field.name] = days;
    } else {
      errors.push({
        pointer: `/${field.name}`,
        detail: `Enter a whole number of days from ${formatCount(field.min)} to ${formatCount(field.max)}${field.kept === null ? '' : ', or leave it empty'}.`,
      });
    }
  }
  for (const name of ['expose-signals', ...GRAPH_SWITCHES.map((field) => field.name)]) {
    if (posted(formData, `${name}-shown`) === 'true') {
      wanted[name] = posted(formData, name) === 'true';
    }
  }
  const integrity = posted(formData, 'signal-collection.session-integrity');
  const recognition = posted(formData, 'signal-collection.device-recognition');
  if (integrity !== undefined && recognition !== undefined) {
    // The basis rule of `exempt` is the API's (422 `basis_required`), shown on the basis field.
    wanted['signal-collection'] = {
      'session-integrity': integrity,
      'device-recognition': recognition,
      'device-recognition-basis': textOrNull(
        posted(formData, 'signal-collection.device-recognition-basis') ?? '',
      ),
    };
  }
  const displayName = posted(formData, DISPLAY_NAME_FIELD.name);
  if (displayName !== undefined) {
    if (displayName.length > DISPLAY_NAME_FIELD.max) {
      errors.push({
        pointer: `/${DISPLAY_NAME_FIELD.name}`,
        detail: `Use at most ${String(DISPLAY_NAME_FIELD.max)} characters, or leave it empty.`,
      });
    } else {
      wanted[DISPLAY_NAME_FIELD.name] = textOrNull(displayName);
    }
  }
  const basis = posted(formData, BIOMETRIC_BASIS_FIELD.name);
  if (basis !== undefined) {
    if (basis.length > BIOMETRIC_BASIS_FIELD.max) {
      errors.push({
        pointer: `/${BIOMETRIC_BASIS_FIELD.name}`,
        detail: `Use at most ${String(BIOMETRIC_BASIS_FIELD.max)} characters, or leave it empty to clear it.`,
      });
    } else {
      wanted[BIOMETRIC_BASIS_FIELD.name] = textOrNull(basis);
    }
  }
}

/** The non-empty lines of a text area, trimmed. */
const entriesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * C143.7: the workflow settings the form posted (it posts only what the server reports). A number
 * is checked against its contract range here; a list is split one entry per line, ports checked as
 * whole numbers here and every other entry by the contract when the body is parsed, so a refusal
 * names the entry by its pointer (`/workflow-link-hosts/1`). A list with a `<name>-shown` marker is
 * `null` when its box is unticked. The private networks are posted only with `settings:privacy`,
 * whatever the form sent, because the API refuses the whole save without it (C124.3).
 */
function workflowSettingsOf(
  formData: FormData,
  wanted: Record<string, unknown>,
  errors: { pointer: string; detail: string }[],
  canPrivacy: boolean,
): void {
  for (const field of WORKFLOW_NUMBER_FIELDS) {
    const value = posted(formData, field.name);
    if (value === undefined) {
      continue;
    }
    const count = COUNT.test(value) ? Number(value) : Number.NaN;
    if (value === '' && field.kept !== null) {
      wanted[field.name] = null;
    } else if (count >= field.min && count <= field.max) {
      wanted[field.name] = count;
    } else {
      errors.push({
        pointer: `/${field.name}`,
        detail: `Enter a whole number from ${formatCount(field.min)} to ${formatCount(field.max)}${field.kept === null ? '' : ', or leave it empty'}.`,
      });
    }
  }
  for (const field of WORKFLOW_LIST_FIELDS) {
    const value = posted(formData, field.name);
    if (value === undefined || (field.privacy && !canPrivacy)) {
      continue;
    }
    if (field.toggle !== null && posted(formData, `${field.name}-shown`) === 'true') {
      if (posted(formData, `${field.name}-on`) !== 'true') {
        wanted[field.name] = null;
        continue;
      }
    }
    const entries = entriesOf(formString(formData, field.name, { trim: false }) ?? '');
    if (!field.numbers) {
      wanted[field.name] = entries;
      continue;
    }
    const ports = entries.map((entry) => (/^\d{1,5}$/.test(entry) ? Number(entry) : Number.NaN));
    ports.forEach((port, index) => {
      if (!(port >= 1 && port <= 65_535)) {
        errors.push({
          pointer: `/${field.name}/${String(index)}`,
          detail: 'Enter a port from 1 to 65,535.',
        });
      }
    });
    wanted[field.name] = ports;
  }
}

const PLATFORM_COPY = SETTINGS_COPY.platform;

/**
 * C174.6: the 9A and 9B settings the form posted (it posts only what the server reports). The
 * origins are one per line, the grammar the API's (422 `embed_origin_invalid` at each entry); the
 * redirect origins are `null` (the embed origins) unless their own box is ticked; each number is
 * checked against its contract bounds, the zone and the sender name against their contract schemas.
 */
function platformSettingsOf(
  formData: FormData,
  wanted: Record<string, unknown>,
  errors: { pointer: string; detail: string }[],
): void {
  const embed = formString(formData, 'allowed-embed-origins', { trim: false });
  if (embed !== undefined) {
    wanted['allowed-embed-origins'] = entriesOf(embed);
  }
  if (posted(formData, 'allowed-redirect-origins-shown') === 'true') {
    wanted['allowed-redirect-origins'] =
      posted(formData, 'allowed-redirect-origins-own') === 'true'
        ? entriesOf(formString(formData, 'allowed-redirect-origins', { trim: false }) ?? '')
        : null;
  }
  for (const field of PLATFORM_NUMBER_FIELDS) {
    const value = posted(formData, field.name);
    if (value === undefined) {
      continue;
    }
    const count = COUNT.test(value) ? Number(value) : Number.NaN;
    if (value === '' && field.bounds.default === null) {
      wanted[field.name] = null;
    } else if (count >= field.bounds.min && count <= field.bounds.max) {
      wanted[field.name] = count;
    } else {
      errors.push({ pointer: `/${field.name}`, detail: PLATFORM_COPY.invalid[field.name] });
    }
  }
  const zone = posted(formData, 'analytics-time-zone');
  if (zone !== undefined) {
    if (analyticsTimeZoneSchema.safeParse(zone).success) {
      wanted['analytics-time-zone'] = zone;
    } else {
      errors.push({
        pointer: '/analytics-time-zone',
        detail: PLATFORM_COPY.invalid['analytics-time-zone'],
      });
    }
  }
  const sender = posted(formData, 'mail-sender-name');
  if (sender !== undefined) {
    if (sender === '') {
      wanted['mail-sender-name'] = null;
    } else if (mailSenderNameSchema.safeParse(sender).success) {
      wanted['mail-sender-name'] = sender;
    } else {
      errors.push({
        pointer: '/mail-sender-name',
        detail: PLATFORM_COPY.invalid['mail-sender-name'],
      });
    }
  }
}

/** The origin refusals of the API in words (C158.1, V17); the entries keep their pointers. */
function describeOriginProblem(problem: DisplayProblem): DisplayProblem {
  const code = problem.code;
  return code === 'embed_wildcard_unacknowledged' || code === 'embed_origin_invalid'
    ? { ...problem, title: PLATFORM_COPY.refusals[code] }
    : problem;
}

/**
 * Whether two setting values are the same: by value, so an object such as `signal-collection`
 * is equal whatever the order of its members (a `!==` would send it on every save, and a
 * principal without `settings:privacy` would be refused).
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/** Saves the settings that differ from the API's current ones. */
export async function saveSettings(
  _previous: ActionState<SettingsSaved>,
  formData: FormData,
): Promise<ActionResult<SettingsSaved>> {
  const result = await runAction(
    { permissions: ['settings:write'], environmentForm: formData },
    async ({ session }) => {
      const wanted = settingsOf(formData, session.permissions.has('settings:privacy'));
      const current = await getSettings();
      const changes = Object.fromEntries(
        Object.entries(wanted).filter(
          ([name, value]) => !sameValue(current[name as keyof DashboardSettings], value),
        ),
      );
      if (Object.keys(changes).length === 0) {
        return { changed: false };
      }
      // C158.1 (V17): the production wildcard acknowledgement goes with a change of the origins.
      const originsChanged =
        'allowed-embed-origins' in changes || 'allowed-redirect-origins' in changes;
      const acknowledged = originsChanged && posted(formData, 'acknowledge-wildcards') === 'true';
      await updateSettings(
        parseInput(dashboardUpdateSettingsBodySchema, {
          ...changes,
          ...(acknowledged ? { meta: { 'acknowledge-wildcards': true } } : {}),
        }),
      );
      revalidatePath('/settings');
      return { changed: true };
    },
  );
  // C90.8: a refusal such as 422 `basis_required` titled in words, on its field by pointer.
  return result.ok
    ? result
    : { ok: false, problem: describeOriginProblem(describeVersionProblem(result.problem)) };
}
