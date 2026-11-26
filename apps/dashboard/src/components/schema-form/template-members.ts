/**
 * C153.1, C153.3: the template version members the settings tab forms, each judged by the
 * contract's own schema (`updateInquiryTemplateVersionAttributesSchema`, the draft PATCH), never
 * by a copy of it. The 9A link, embedding and redirect members are one form ("links") whose
 * members are attributes of their own; every other member is one form. A member another page forms
 * names that page, and a test holds the two lists to the contract.
 */
import {
  TEMPLATE_SETTINGS_DEFAULTS,
  updateInquiryTemplateVersionAttributesSchema,
} from '@openverify/contracts';
import { z } from 'zod';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';

const CONTRACT = updateInquiryTemplateVersionAttributesSchema.shape;

/** The version's own link, embedding and redirect members (C154.1, C158, C162.3). */
export const LINK_MEMBERS = [
  'help-url',
  'privacy-url',
  'embed-origins',
  'redirect-uri',
  'redirect-uri-schemes',
  'redirect-include-status',
  'description',
] as const satisfies readonly (keyof typeof CONTRACT)[];

export const FORM_MEMBER_KEYS = [
  'settings',
  'links',
  'report-config',
  'signal-config',
  'list-config',
] as const;
export type FormMemberKey = (typeof FORM_MEMBER_KEYS)[number];

/** The contract's schema of each form: the member's own, or the link members as one object. */
export const FORM_MEMBER_SCHEMAS: Readonly<Record<FormMemberKey, z.ZodType>> = Object.freeze({
  settings: CONTRACT.settings.unwrap(),
  links: z.strictObject(
    Object.fromEntries(LINK_MEMBERS.map((member) => [member, CONTRACT[member]])),
  ),
  'report-config': CONTRACT['report-config'].unwrap(),
  'signal-config': CONTRACT['signal-config'].unwrap(),
  'list-config': CONTRACT['list-config'].unwrap(),
});

/** The members other pages form, with the page that forms each. */
export const MEMBERS_FORMED_ELSEWHERE: Readonly<Record<string, string>> = Object.freeze({
  flow: 'the flow builder',
  'field-schemas': "the flow builder's fields panel",
  'verification-config': 'the check panels, beside each verification step and on this page',
  copy: 'the translations tab',
  'enabled-locales': 'the translations tab',
  'default-locale': 'the translations tab',
  'theme-set-id': 'the theme tab',
});

const isLink = (name: string): boolean => (LINK_MEMBERS as readonly string[]).includes(name);

/** The attributes a draft PATCH sends for a form's value. */
export function attributesOf(
  member: FormMemberKey,
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return member === 'links' ? { ...value } : { [member]: { ...value } };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A form's value in a version's attributes; `{}` when the version has none. */
export function memberValueOf(
  member: FormMemberKey,
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (member === 'links') {
    return Object.fromEntries(
      Object.entries(attributes).filter(([name, value]) => isLink(name) && value !== undefined),
    );
  }
  const value = attributes[member];
  return isRecord(value) ? { ...value } : {};
}

/**
 * Where a pointer of a request (`/data/attributes/...`) or of the stored validation (`/...`) is
 * inside a form: `''` for the member itself, `null` when it is about another member.
 */
export function memberPointer(member: FormMemberKey, pointer: string): string | null {
  const relative = pointer.replace(/^\/data\/attributes(?=\/|$)/, '');
  if (member === 'links') {
    const name = relative.split('/')[1] ?? '';
    return isLink(name) ? relative : null;
  }
  const prefix = `/${member}`;
  if (relative === prefix) return '';
  return relative.startsWith(`${prefix}/`) ? relative.slice(prefix.length) : null;
}

/** C171.4: the windows that limit how long a person has (2.2.1), warned below 20 hours. */
const TIMED_SETTINGS = [
  'inquiry-expiration-seconds',
  'session-expiration-seconds',
  'inquiry-expiration-after-start-seconds',
  'inquiry-expiration-after-resume-seconds',
] as const;
/** WCAG 2.2.1's "20 hour exception", in seconds. */
const TWENTY_HOURS = 20 * 60 * 60;

const hoursOf = (seconds: number): string => String(Math.floor(seconds / 360) / 10);

/** Each setting's note: its default, and below 20 hours the 2.2.1 warning. */
export function settingsNotes(value: Readonly<Record<string, unknown>>): Record<string, string> {
  const notes = TEMPLATE_FORMS_COPY.notes;
  return Object.fromEntries(
    Object.entries(TEMPLATE_SETTINGS_DEFAULTS).map(([name, fallback]) => {
      const current = value[name];
      const timed =
        (TIMED_SETTINGS as readonly string[]).includes(name) &&
        typeof current === 'number' &&
        current < TWENTY_HOURS;
      const words = notes.defaultIs(
        // `null` and, since Workflow 11A, an object setting (`accept-cloned-results`) default to none.
        typeof fallback === 'object'
          ? TEMPLATE_FORMS_COPY.schemaForm.readOnlyNone
          : String(fallback),
      );
      return [name, timed ? `${notes.timing(hoursOf(current))} ${words}` : words];
    }),
  );
}
