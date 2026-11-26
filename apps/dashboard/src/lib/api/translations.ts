/**
 * A template's translations in the console (C162.7; Workflow 9C, `dashboard-themes-copy`): the rows
 * of its latest draft, else its latest published version; the JSON import, which writes the draft
 * (making one from the published version when none exists) and never publishes; and the CSV form,
 * streamed through the BFF. Every refusal is read by pointer and code: the API never echoes a value,
 * and neither does the console. Operator copy is not personal data, but it is never logged either.
 */
import 'server-only';
import { translationRowSchema, type TranslationRow } from '@openverify/contracts';
import { OpenVerifyApiError, type OpenVerifyClient } from '@openverify/node';
import { z } from 'zod';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { ActionInputError, formString, parseInput } from './action';
import { getBffFetch } from './client';

/** One refused cell: where, and the copy rule's code. */
export interface TranslationRefusal {
  readonly pointer: string;
  readonly code: string;
}

/** One problem of a refused CSV: its row (`null` for the header) and column, and its code. */
export interface CsvProblem {
  readonly row: number | null;
  readonly column: string | null;
  readonly code: string;
}

/** `GET /inquiry-templates/:id/translations`. */
export function getTranslations(
  api: OpenVerifyClient,
  templateId: string,
): ReturnType<OpenVerifyClient['inquiryTemplateTranslations']['retrieve']> {
  return api.inquiryTemplateTranslations.retrieve(templateId);
}

/** `POST /inquiry-templates/:id/translations`: a blank value deletes nothing (public). */
export function importTranslations(
  api: OpenVerifyClient,
  templateId: string,
  rows: readonly TranslationRow[],
): ReturnType<OpenVerifyClient['inquiryTemplateTranslations']['import']> {
  return api.inquiryTemplateTranslations.import(templateId, [...rows]);
}

const refusalSchema = z.object({ pointer: z.string(), code: z.string() });

/** The refused cells of a 422, by pointer and code; `null` for any other failure. */
export function translationRefusalsOf(error: unknown): readonly TranslationRefusal[] | null {
  if (!(error instanceof OpenVerifyApiError) || error.status !== 422) {
    return null;
  }
  const errors: unknown = error.problem.errors;
  return Array.isArray(errors)
    ? errors.flatMap((item: unknown) => {
        const parsed = refusalSchema.safeParse(item);
        return parsed.success ? [{ pointer: parsed.data.pointer, code: parsed.data.code }] : [];
      })
    : [];
}

const editorRowsSchema = z.array(translationRowSchema).min(1, 'Change at least one text.');

/**
 * The rows the editor sends, as JSON in one hidden field, parsed by the contract's row schema.
 * @throws {ActionInputError} for text that is not JSON, no rows, or a row the schema refuses.
 */
export function translationRowsFromForm(formData: FormData): TranslationRow[] {
  let rows: unknown;
  try {
    rows = JSON.parse(formString(formData, 'rows', { trim: false }) ?? '[]');
  } catch {
    throw new ActionInputError({
      title: 'Check the values you entered',
      detail: 'The texts could not be read.',
      errors: [
        { pointer: '/data/attributes/translations', detail: 'The texts could not be read.' },
      ],
    });
  }
  return parseInput(editorRowsSchema, rows);
}

/** The longest wait of a CSV transfer: 2 MiB on a slow link, then the API's import. */
const CSV_TIMEOUT_MS = 60_000;

const csvPath = (templateId: string) =>
  `${apiBaseUrl()}/api/v1/inquiry-templates/${encodeURIComponent(templateId)}/translations.csv`;

/** `GET .../translations.csv`: the raw answer, streamed on; `null` without a session. */
export async function fetchTranslationsCsv(templateId: string): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(csvPath(templateId), {
    headers: { authorization: `Bearer ${token}`, accept: 'text/csv' },
    signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
  });
}

/** `POST .../translations.csv` with the file's bytes; the raw answer; `null` without a session. */
export async function uploadTranslationsCsv(
  templateId: string,
  bytes: Uint8Array,
): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(csvPath(templateId), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'text/csv',
    },
    body: bytes.slice(),
    signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
  });
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ROW_POINTER = /^\/rows\/(header|[0-9]{1,6})(?:\/([A-Za-z-]{1,40}))?$/u;

/**
 * The problems of a refused CSV import, read from their pointers (`/rows/<n>/<column>`, or
 * `/rows/header[/<column>]`) with their codes. The detail is never shown: the code says it in words.
 */
export function csvProblemsOf(problem: unknown): CsvProblem[] {
  if (typeof problem !== 'object' || problem === null) {
    return [];
  }
  const errors: unknown = (problem as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((item: unknown) => {
    const parsed = refusalSchema.safeParse(item);
    const match = parsed.success ? ROW_POINTER.exec(parsed.data.pointer) : null;
    if (!parsed.success || match === null) {
      return [];
    }
    const [, row = 'header', column] = match;
    return [
      {
        row: row === 'header' ? null : Number(row),
        column: column ?? null,
        code: parsed.data.code,
      },
    ];
  });
}
