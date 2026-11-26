/**
 * C118.2 (P41, F17; C143.5): a trigger's fields against the version's inputs, shared by the API
 * trigger and the account actions. The types come from `variables/`, plain functions and never a zod
 * object built from a stored name (C113.8).
 *
 * A file value is `{ filename, data }` with base64 data, at most 10 MiB decoded, typed by its magic
 * bytes. It is in scope as a `wfrf_` id and never as bytes: this file answers the bytes apart, for the
 * caller to seal and store. A malformed one answers 400 with `source.pointer`, any other field 422
 * `trigger_input_invalid`, and no problem echoes a value.
 */
import { createHash } from 'node:crypto';
import {
  WORKFLOW_TRIGGER_LIMITS,
  detectUploadMimeType,
  workflowTriggerFileValueSchema,
  type WorkflowInput,
} from '@openverify/contracts';
import {
  ANY_TYPE,
  checkValue,
  objectType,
  parseTypeDsl,
  withMarks,
  type JsonRecord,
  type ScopeType,
} from '@openverify/workflow-engine';
import { AppError, WorkflowProblemError } from '../../errors.js';
import type { IdGenerator } from '../../ports.js';

const FIELDS_POINTER = '/data/attributes/fields';
const DEFAULT_FILENAME = 'file';
const MAX_FILENAME = 255;
const FILE_PREFIX = 'wfrf';

export interface TriggerFile {
  id: string;
  filename: string;
  bytes: Buffer;
  mimeType: string;
  sha256: string;
}

export interface TriggerFields {
  inputs: JsonRecord;
  files: readonly TriggerFile[];
}

const invalid = (pointer: string, detail: string): WorkflowProblemError =>
  new WorkflowProblemError('trigger_input_invalid', detail, { members: { source: { pointer } } });

const malformedFile = (pointer: string): AppError =>
  new AppError({
    status: 400,
    detail: 'A file value is { filename, data } with base64 data.',
    members: { source: { pointer } },
  });

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** A filename the row can hold: control characters removed, 1-255 characters. */
function cleanFilename(filename: string): string {
  const cleaned = filename.replace(CONTROL_CHARACTERS, '').trim().slice(0, MAX_FILENAME);
  return cleaned === '' ? DEFAULT_FILENAME : cleaned;
}

const isFileType = (type: ScopeType): boolean => type.kind === 'id' && type.prefix === FILE_PREFIX;

function readFile(value: unknown, pointer: string, files: TriggerFile[], ids: IdGenerator): string {
  const parsed = workflowTriggerFileValueSchema.safeParse(value);
  if (!parsed.success) {
    throw malformedFile(pointer);
  }
  const bytes = Buffer.from(parsed.data.data, 'base64');
  if (bytes.byteLength > WORKFLOW_TRIGGER_LIMITS['file-bytes'].value) {
    throw invalid(pointer, 'A file value is at most 10 MiB.');
  }
  const mimeType = detectUploadMimeType('document', bytes);
  if (mimeType === null) {
    throw invalid(pointer, 'A file value is a JPEG, PNG or WebP image or a PDF.');
  }
  const id = ids.newId(FILE_PREFIX);
  files.push({
    id,
    filename: cleanFilename(parsed.data.filename),
    bytes,
    mimeType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  return id;
}

/** `value` with each file value at a file position replaced by its id. */
function withFileIds(
  type: ScopeType,
  value: unknown,
  pointer: string,
  files: TriggerFile[],
  ids: IdGenerator,
): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (isFileType(type)) {
    return readFile(value, pointer, files, ids);
  }
  if (type.kind === 'list' && Array.isArray(value)) {
    return value.map((item, index) =>
      withFileIds(type.of, item, `${pointer}/${String(index)}`, files, ids),
    );
  }
  if (type.kind === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) => {
        const held = Object.hasOwn(type.members, name) ? type.members[name] : undefined;
        return [
          name,
          held === undefined ? member : withFileIds(held, member, `${pointer}/${name}`, files, ids),
        ];
      }),
    );
  }
  return value;
}

/** What the version's inputs declare, as one closed object. */
function declaredType(declared: readonly WorkflowInput[]): ScopeType {
  const members: Record<string, ScopeType> = {};
  for (const { name, type, required } of declared) {
    const parsed = parseTypeDsl(type);
    members[name] = withMarks(parsed.ok ? parsed.type : ANY_TYPE, { nullable: !required });
  }
  return objectType(members);
}

/** C118.3: whether values a step rendered fit the inputs. Only a request carries a file. */
export function inputsFit(
  declared: readonly WorkflowInput[],
  value: Readonly<Record<string, unknown>>,
): boolean {
  return checkValue(declaredType(declared), value as JsonRecord).length === 0;
}

/**
 * The fields as a run's inputs, and the files to store.
 * @throws {AppError} 400 for a malformed file value.
 * @throws {WorkflowProblemError} `trigger_input_invalid` with `source.pointer`.
 */
export function readTriggerFields(
  declared: readonly WorkflowInput[],
  fields: Readonly<Record<string, unknown>>,
  ids: IdGenerator,
): TriggerFields {
  const type = declaredType(declared);
  const files: TriggerFile[] = [];
  const inputs = withFileIds(type, fields, FIELDS_POINTER, files, ids) as JsonRecord;
  const [problem] = checkValue(type, inputs);
  if (problem !== undefined) {
    throw invalid(
      `${FIELDS_POINTER}${problem.pointer}`,
      'This field does not fit the version’s inputs.',
    );
  }
  return { inputs, files };
}
