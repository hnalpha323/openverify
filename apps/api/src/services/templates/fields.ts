/**
 * C149.2, C149.3, C149.5 (Workflow 9A; verification round F04): every write of an inquiry's `fields`
 * is checked against the pinned version's `field-schemas` when it declares them: an unknown key
 * answers 422 `field_unknown` with its pointer, a write-once value that is set answers 422
 * `field_write_once`, a value of the wrong type or past its `max-length` 422 at its pointer
 * (`field_type_invalid`, `field_too_long`), and `strip-html` removes tags from the values answered.
 * On every write path, whatever the version declares, `fields` past 256 KiB answer 422
 * `fields_too_large` (with `size` and `limit`) and more than 1,000 keys 422 `fields_too_many`. A
 * refusal names its pointer and never the value. Owner: `api-templates`; the calls in the inquiry
 * create and `PATCH` paths (`services/inquiries.ts`) were placed by `foundation-9a` (Stage 1b (T));
 * `api-flow-engine`'s screen submission and `api-flow-actions`' `copy_extractions` call it too.
 */
import {
  FLOW_ENGINE_PROBLEM_STATUSES,
  MAX_INQUIRY_FIELDS,
  MAX_INQUIRY_FIELDS_BYTES,
  fieldSchemasSchema,
  type TemplateField,
} from '@openverify/contracts';
import { getInquiry, getInquiryTemplateVersion, type Db, type InquiryFields } from '@openverify/db';
import { AppError, UnprocessableContentError, type ProblemFieldError } from '../../errors.js';
import { isCalendarDate } from '../../flow-engine/calendar-date.js';

/** The write paths of `fields` (C149.3). */
export type FieldsWriteKind = 'create' | 'patch' | 'screen' | 'copy-extractions';

/** One write of an inquiry's `fields`. */
export interface FieldsWrite {
  kind: FieldsWriteKind;
  environmentId: string;
  /** The version the inquiry pins (or will pin, on create). */
  versionId: string;
  /** Absent on create. */
  inquiryId?: string | undefined;
  /** The values written, merged into the current ones by the caller. */
  fields: InquiryFields;
}

/** A field rule's refusal, with the status C174.8 freezes for its code. */
export class FieldsProblemError extends AppError {
  override name = 'FieldsProblemError';

  constructor(
    code: 'field_unknown' | 'field_write_once' | 'fields_too_large',
    detail: string,
    errors: readonly ProblemFieldError[],
    members?: { size: number; limit: number },
  ) {
    super({
      status: FLOW_ENGINE_PROBLEM_STATUSES[code],
      title: 'Unprocessable Content',
      detail,
      code,
      ...(errors.length === 0 ? {} : { errors }),
      ...(members === undefined ? {} : { members }),
    });
  }
}

const POINTER_BASE: Readonly<Record<FieldsWriteKind, string>> = {
  create: '/data/attributes/fields',
  patch: '/data/attributes/fields',
  screen: '/values',
  'copy-extractions': '/fields',
};

const LOCATION: Readonly<Record<FieldsWriteKind, string>> = {
  create: 'body',
  patch: 'body',
  screen: 'body',
  'copy-extractions': 'action',
};

const TAG = /<[^>]*>/gu;

const isSet = (value: unknown) => value !== undefined && value !== null && value !== '';

/** Whether `value` is of the field's type; `null` always is (an unset value). */
function ofType(field: TemplateField, value: unknown): boolean {
  if (value === null) return true;
  const choices = new Set((field.choices ?? []).map((choice) => choice.value));
  switch (field.type) {
    case 'string':
    case 'email-address':
      return typeof value === 'string';
    case 'integer':
      return Number.isSafeInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && isCalendarDate(value);
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'choices':
      return typeof value === 'string' && choices.has(value);
    case 'multi-choices':
      return (
        Array.isArray(value) && value.every((item) => typeof item === 'string' && choices.has(item))
      );
    case 'array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
}

/** Whether a string, or any string of an array, is past the field's `max-length`. */
function tooLong(field: TemplateField, value: unknown): boolean {
  const limit = field['max-length'];
  if (limit === undefined) return false;
  const strings: unknown[] = Array.isArray(value) ? value : [value];
  return strings.some((item) => typeof item === 'string' && Array.from(item).length > limit);
}

function stripped(field: TemplateField, value: unknown): unknown {
  if (field['strip-html'] !== true) return value;
  if (typeof value === 'string') return value.replaceAll(TAG, '');
  if (!Array.isArray(value)) return value;
  const items: unknown[] = value;
  return items.map((item) => (typeof item === 'string' ? item.replaceAll(TAG, '') : item));
}

/**
 * Refuses a write the version's `field-schemas` do not allow, and answers the values to write
 * (`strip-html` applied). The caller writes what it answers.
 */
export async function validateInquiryFieldsWrite(
  db: Db,
  write: FieldsWrite,
): Promise<InquiryFields> {
  const current =
    write.inquiryId === undefined
      ? {}
      : ((await getInquiry(db, write.environmentId, write.inquiryId))?.fields ?? {});
  const merged = { ...current, ...write.fields };
  const size = Buffer.byteLength(JSON.stringify(merged), 'utf8');
  if (size > MAX_INQUIRY_FIELDS_BYTES) {
    throw new FieldsProblemError(
      'fields_too_large',
      'The inquiry fields would be larger than 256 KiB.',
      [],
      { size, limit: MAX_INQUIRY_FIELDS_BYTES },
    );
  }
  const base = POINTER_BASE[write.kind];
  const pointer = (key: string) => `${base}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  if (Object.keys(merged).length > MAX_INQUIRY_FIELDS) {
    throw new UnprocessableContentError('An inquiry holds at most 1,000 fields.', [
      {
        location: LOCATION[write.kind],
        pointer: base,
        detail: 'Too many fields.',
        code: 'fields_too_many',
      },
    ]);
  }
  const version = await getInquiryTemplateVersion(db, write.environmentId, write.versionId);
  const declared = fieldSchemasSchema.safeParse(version?.fieldSchemas ?? []);
  if (!declared.success || declared.data.length === 0) {
    return write.fields;
  }
  const schemas = new Map(declared.data.map((field) => [field.key, field]));
  const unknown: ProblemFieldError[] = [];
  const writeOnce: ProblemFieldError[] = [];
  const invalid: ProblemFieldError[] = [];
  const answered: InquiryFields = {};
  for (const [key, value] of Object.entries(write.fields)) {
    const location = LOCATION[write.kind];
    const field = schemas.get(key);
    if (field === undefined) {
      unknown.push({
        location,
        pointer: pointer(key),
        detail: 'The version declares no such field.',
        code: 'field_unknown',
      });
      continue;
    }
    if (
      field['write-once'] === true &&
      isSet(current[key]) &&
      JSON.stringify(current[key]) !== JSON.stringify(value)
    ) {
      writeOnce.push({
        location,
        pointer: pointer(key),
        detail: 'This field is set and is written once.',
        code: 'field_write_once',
      });
      continue;
    }
    if (tooLong(field, value)) {
      invalid.push({
        location,
        pointer: pointer(key),
        detail: `At most ${String(field['max-length'])} characters.`,
        code: 'field_too_long',
      });
      continue;
    }
    if (!ofType(field, value)) {
      invalid.push({
        location,
        pointer: pointer(key),
        detail: `The value is not of the field type ${field.type}.`,
        code: 'field_type_invalid',
      });
      continue;
    }
    answered[key] = stripped(field, value);
  }
  if (unknown.length > 0) {
    throw new FieldsProblemError(
      'field_unknown',
      'The version declares no field of this key.',
      unknown,
    );
  }
  if (writeOnce.length > 0) {
    throw new FieldsProblemError(
      'field_write_once',
      'A write-once field that is set cannot change.',
      writeOnce,
    );
  }
  if (invalid.length > 0) {
    throw new UnprocessableContentError('A field value does not meet its field rules.', invalid);
  }
  return answered;
}
