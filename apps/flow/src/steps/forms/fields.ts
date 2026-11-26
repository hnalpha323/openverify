/**
 * The fields of the forms the user fills in (C52.3, C64.1) and the checks the browser makes
 * before sending them. Each value is checked with the contract schema of its body member, the one
 * the server checks it with, so the browser never refuses a value the server would take; the
 * server's step rules (the collected and required members) still answer with JSON Pointers, which
 * the form shows at their fields.
 */
import {
  aamvaInputsSchema,
  associatedPersonInputSchema,
  businessWebsiteInputsSchema,
  databaseBusinessInputsSchema,
  databaseInputsSchema,
  isLei,
  registrationNumberAccepted,
  type AamvaInputs,
  type DatabaseBusinessInputs,
  type DatabaseInputs,
  type FlowVerificationResource,
} from '@openverify/contracts';
import { DATABASE_FIELDS, DATABASE_REQUIRED_FIELDS } from '@openverify/flow-spec';
import type { z } from 'zod';
import type { DatabaseBusinessStep, DatabaseStep } from '../../flow/flow-position';
import type { formsEn } from './locales/en';

/** A field's label and required message, under `forms.fields` and `forms.required`. */
export type FieldMessage = keyof typeof formsEn.fields;
/**
 * What a value of the wrong shape is told, under `forms.errors`; a registration number is told the
 * format of the chosen country's register (`registrationFormat`).
 */
export type FormatMessage =
  'date' | 'phone' | 'email' | 'zip' | 'url' | 'lei' | 'birthMonth' | 'registration';

export type FieldKind = 'text' | 'date' | 'tel' | 'email' | 'url' | 'country' | 'state';

export interface FieldSpec {
  /** The body member (kebab-case), also the field's key in the form state. */
  readonly name: string;
  readonly message: FieldMessage;
  readonly kind: FieldKind;
  readonly autoComplete: string;
  readonly required: boolean;
  /** Shown in the address group. */
  readonly address: boolean;
  /** The contract schema of the body member. */
  readonly schema: z.ZodType;
  /** What a value the schema refuses for its shape is told; without one, that it was refused. */
  readonly format?: FormatMessage;
  /** Help text under `forms.hints`. */
  readonly hint?: keyof typeof formsEn.hints;
}

export type FieldError =
  | { readonly key: 'required' }
  | { readonly key: 'tooLong'; readonly max: number }
  | { readonly key: 'format' }
  /** The server refused the member (a JSON Pointer named it). */
  | { readonly key: 'refused' };

type DatabaseMember = keyof DatabaseInputs;

/** A database step field's body member: `name_first` is `name-first` (C52.2, C52.3). */
export function bodyNameOf(field: (typeof DATABASE_FIELDS)[number]): DatabaseMember {
  return field.replaceAll('_', '-') as DatabaseMember;
}

const DATABASE_SPECS: Readonly<
  Record<DatabaseMember, Pick<FieldSpec, 'kind' | 'autoComplete' | 'format'>>
> = {
  'name-first': { kind: 'text', autoComplete: 'given-name' },
  'name-middle': { kind: 'text', autoComplete: 'additional-name' },
  'name-last': { kind: 'text', autoComplete: 'family-name' },
  birthdate: { kind: 'date', autoComplete: 'bday', format: 'date' },
  'address-street-1': { kind: 'text', autoComplete: 'address-line1' },
  'address-street-2': { kind: 'text', autoComplete: 'address-line2' },
  'address-city': { kind: 'text', autoComplete: 'address-level2' },
  'address-subdivision': { kind: 'text', autoComplete: 'address-level1' },
  'address-postal-code': { kind: 'text', autoComplete: 'postal-code' },
  'address-country-code': { kind: 'country', autoComplete: 'country' },
  'identification-number': { kind: 'text', autoComplete: 'off' },
  'phone-number': { kind: 'tel', autoComplete: 'tel', format: 'phone' },
  'email-address': { kind: 'email', autoComplete: 'email', format: 'email' },
};

/**
 * The members a database body must carry: the server's guidance once a verification exists,
 * else the step's `requiredFields` and the three every database step requires (C52.3:
 * `DATABASE_REQUIRED_FIELDS`, without which no source can be asked).
 */
export function databaseRequiredMembers(
  step: DatabaseStep,
  verification: FlowVerificationResource | undefined,
): ReadonlySet<string> {
  if (verification?.type === 'verification/database') {
    const guided = verification.attributes.guidance?.['required-fields'];
    if (guided !== undefined) {
      return new Set(guided);
    }
  }
  return new Set(
    [...DATABASE_REQUIRED_FIELDS, ...(step.requiredFields ?? [])].map((field) => bodyNameOf(field)),
  );
}

/** The fields a database step collects, in the order of `DATABASE_FIELDS`. */
export function databaseFields(step: DatabaseStep, required: ReadonlySet<string>): FieldSpec[] {
  const collected = new Set<string>(step.fields);
  return DATABASE_FIELDS.filter((field) => collected.has(field)).map((field) => {
    const name = bodyNameOf(field);
    return {
      name,
      message: name,
      ...DATABASE_SPECS[name],
      required: required.has(name),
      address: name.startsWith('address-'),
      schema: databaseInputsSchema.shape[name],
      ...(name === 'phone-number' ? { hint: 'phone-number' as const } : {}),
    };
  });
}

type AamvaMember = keyof AamvaInputs;

const AAMVA_SPECS: readonly (Pick<FieldSpec, 'kind' | 'autoComplete' | 'format' | 'message'> & {
  readonly name: AamvaMember;
})[] = [
  { name: 'name-first', message: 'name-first', kind: 'text', autoComplete: 'given-name' },
  { name: 'name-last', message: 'name-last', kind: 'text', autoComplete: 'family-name' },
  { name: 'birthdate', message: 'birthdate', kind: 'date', autoComplete: 'bday', format: 'date' },
  {
    name: 'identification-number',
    message: 'licenseNumber',
    kind: 'text',
    autoComplete: 'off',
  },
  {
    name: 'issuing-authority',
    message: 'issuingAuthority',
    kind: 'state',
    autoComplete: 'off',
  },
  { name: 'issue-date', message: 'issueDate', kind: 'date', autoComplete: 'off', format: 'date' },
  {
    name: 'expiration-date',
    message: 'expirationDate',
    kind: 'date',
    autoComplete: 'off',
    format: 'date',
  },
  {
    name: 'address-postal-code',
    message: 'zip',
    kind: 'text',
    autoComplete: 'postal-code',
    format: 'zip',
  },
];

/** The AAMVA form (`source: form`): a US license or ID card as printed (C52.3). */
export function aamvaFields(): FieldSpec[] {
  return AAMVA_SPECS.map((spec) => {
    const schema = aamvaInputsSchema.shape[spec.name];
    return { ...spec, required: !schema.safeParse(undefined).success, address: false, schema };
  });
}

type BusinessMember = Exclude<keyof DatabaseBusinessInputs, 'associated-persons'>;

const BUSINESS_SPECS: readonly (Pick<
  FieldSpec,
  'kind' | 'autoComplete' | 'format' | 'message' | 'hint'
> & { readonly name: BusinessMember })[] = [
  { name: 'business-name', message: 'business-name', kind: 'text', autoComplete: 'organization' },
  // The business's own details, not the user's: the browser offers none of the user's own.
  { name: 'country-code', message: 'country-code', kind: 'country', autoComplete: 'off' },
  {
    name: 'registration-number',
    message: 'registration-number',
    kind: 'text',
    autoComplete: 'off',
    format: 'registration',
  },
  { name: 'lei', message: 'lei', kind: 'text', autoComplete: 'off', format: 'lei', hint: 'lei' },
  { name: 'address-street-1', message: 'businessStreet1', kind: 'text', autoComplete: 'off' },
  { name: 'address-street-2', message: 'businessStreet2', kind: 'text', autoComplete: 'off' },
  { name: 'address-city', message: 'businessCity', kind: 'text', autoComplete: 'off' },
  {
    name: 'address-subdivision',
    message: 'businessSubdivision',
    kind: 'text',
    autoComplete: 'off',
  },
  { name: 'address-postal-code', message: 'businessPostalCode', kind: 'text', autoComplete: 'off' },
];

/**
 * The members a business body must carry: its name and country (the body schema's), and every
 * input each configured match group names (guidance `required-inputs`, C52.2) once known.
 */
export function businessRequiredMembers(
  verification: FlowVerificationResource | undefined,
): ReadonlySet<string> {
  const guided =
    verification?.type === 'verification/database-business'
      ? (verification.attributes.guidance?.['required-inputs'] ?? [])
      : [];
  return new Set(['business-name', 'country-code', ...guided]);
}

/** Whether a business step asks for associated persons: its guidance, else the step (C52.2). */
export function collectsPersons(
  step: DatabaseBusinessStep,
  verification: FlowVerificationResource | undefined,
): boolean {
  const guided =
    verification?.type === 'verification/database-business'
      ? verification.attributes.guidance?.['collect-associated-persons']
      : undefined;
  return guided ?? step.collectAssociatedPersons ?? false;
}

/** The business registry form (C52.3): the business, its identifiers and its registered address. */
export function businessFields(required: ReadonlySet<string>): FieldSpec[] {
  return BUSINESS_SPECS.map((spec) => ({
    ...spec,
    required: required.has(spec.name),
    address: spec.name.startsWith('address-'),
    schema: databaseBusinessInputsSchema.shape[spec.name],
  }));
}

/** The form state's key of a person's member: `person:<id>:<member>`, stable while others go. */
export function personKey(id: number, member: string): string {
  return `person:${String(id)}:${member}`;
}

/** One associated person's fields (C52.3): their names, and their birth month or date. */
export function personFields(id: number): FieldSpec[] {
  const { shape } = associatedPersonInputSchema;
  return [
    {
      name: personKey(id, 'name-first'),
      message: 'person-name-first',
      kind: 'text',
      // Another person's name: the browser must not offer the user's own.
      autoComplete: 'off',
      required: true,
      address: false,
      schema: shape['name-first'],
    },
    {
      name: personKey(id, 'name-last'),
      message: 'person-name-last',
      kind: 'text',
      autoComplete: 'off',
      required: true,
      address: false,
      schema: shape['name-last'],
    },
    {
      name: personKey(id, 'birthdate'),
      message: 'person-birthdate',
      kind: 'text',
      autoComplete: 'off',
      required: false,
      address: false,
      schema: shape.birthdate,
      format: 'birthMonth',
      hint: 'person-birthdate',
    },
  ];
}

/**
 * The business body: the members that passed, and the people in their order, each with their own
 * members (C52.3); no `associated-persons` without a person.
 */
export function businessBody(
  body: Readonly<Record<string, string>>,
  personIds: readonly number[],
): Record<string, unknown> {
  const members = Object.fromEntries(
    Object.entries(body).filter(([name]) => !name.startsWith('person:')),
  );
  const persons = personIds.map((id) =>
    Object.fromEntries(
      ['name-first', 'name-last', 'birthdate'].flatMap((member) => {
        const value = body[personKey(id, member)];
        return value === undefined ? [] : [[member, value]];
      }),
    ),
  );
  return persons.length === 0 ? members : { ...members, 'associated-persons': persons };
}

/**
 * The business body's rules across members (C52.3): a registration number in the format of the
 * register of the chosen country, and an LEI whose check digits hold (ISO 17442).
 */
export function businessCrossErrors(
  values: Readonly<Record<string, string>>,
): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  const country = (values['country-code'] ?? '').trim();
  const number = (values['registration-number'] ?? '').trim();
  if (country !== '' && number !== '' && !registrationNumberAccepted(country, number)) {
    errors['registration-number'] = { key: 'format' };
  }
  const lei = (values.lei ?? '').trim();
  if (lei.length === 20 && !isLei(lei)) {
    errors.lei = { key: 'format' };
  }
  return errors;
}

/** The register's format a registration number is told, by the chosen country (C52.3). */
export function registrationFormat(
  country: string | undefined,
): 'registrationGb' | 'registrationUs' | 'registration' {
  if (country === 'GB') {
    return 'registrationGb';
  }
  return country === 'US' ? 'registrationUs' : 'registration';
}

/** The business website form (C52.3): its URL and, if the user likes, the business's name. */
export function websiteFields(): FieldSpec[] {
  const { shape } = businessWebsiteInputsSchema;
  return [
    {
      name: 'website-url',
      message: 'website-url',
      kind: 'url',
      autoComplete: 'url',
      required: true,
      address: false,
      schema: shape['website-url'],
      format: 'url',
      hint: 'website-url',
    },
    {
      name: 'business-name',
      message: 'business-name',
      kind: 'text',
      autoComplete: 'organization',
      required: false,
      address: false,
      schema: shape['business-name'],
    },
  ];
}

/** Spaces, parentheses, dots and dashes a user may type inside a phone number. */
const PHONE_SEPARATORS = /[\s().-]/gu;

/** The value as it is sent: trimmed; a phone number without its separators (E.164). */
export function sentValue(field: FieldSpec, raw: string): string {
  const value = raw.trim();
  return field.kind === 'tel' ? value.replace(PHONE_SEPARATORS, '') : value;
}

/** What is wrong with one value, as the contract schema of its member says, or `null`. */
export function fieldError(field: FieldSpec, raw: string): FieldError | null {
  const value = sentValue(field, raw);
  if (value === '') {
    return field.required ? { key: 'required' } : null;
  }
  const parsed = field.schema.safeParse(value);
  if (parsed.success) {
    return null;
  }
  const [issue] = parsed.error.issues;
  if (issue?.code === 'too_big' && typeof issue.maximum === 'number') {
    return { key: 'tooLong', max: issue.maximum };
  }
  return { key: 'format' };
}

/** Every field's error, by member, and the body of the values that passed (empty ones left out). */
export function checkFields(
  fields: readonly FieldSpec[],
  values: Readonly<Record<string, string>>,
): { readonly errors: Record<string, FieldError>; readonly body: Record<string, string> } {
  const errors: Record<string, FieldError> = {};
  const body: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name] ?? '';
    const error = fieldError(field, raw);
    if (error !== null) {
      errors[field.name] = error;
    } else if (sentValue(field, raw) !== '') {
      body[field.name] = sentValue(field, raw);
    }
  }
  return { errors, body };
}

/** A refusal's JSON Pointer as its unescaped segments (RFC 6901), below `/data/attributes`. */
function pointerSegments(pointer: string): string[] {
  const path = pointer.startsWith('/data/attributes/')
    ? pointer.slice('/data/attributes'.length)
    : pointer;
  return path
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/**
 * The body member a refusal's JSON Pointer names: `/birthdate`, or `/data/attributes/birthdate`
 * from a route-level 400 (C52.3), unescaped as RFC 6901 says.
 */
export function memberOfPointer(pointer: string): string | null {
  const [member] = pointerSegments(pointer);
  return member === undefined || member === '' ? null : member;
}

/**
 * The form state's key a business refusal's pointer names: a top-level member, or a person's
 * member (`/associated-persons/1/name-last`) by that person's place in `personIds`; `null` for the
 * list as a whole or a person not on the screen.
 */
export function fieldKeyOfPointer(pointer: string, personIds: readonly number[]): string | null {
  const [member, index, personMember] = pointerSegments(pointer);
  if (member !== 'associated-persons') {
    return member === undefined || member === '' ? null : member;
  }
  const id = index === undefined ? undefined : personIds[Number(index)];
  return id === undefined || personMember === undefined || personMember === ''
    ? null
    : personKey(id, personMember);
}
