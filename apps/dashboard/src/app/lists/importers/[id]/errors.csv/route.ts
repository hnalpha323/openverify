import { idSchema, type ImporterError } from '@openverify/contracts';
import { IMPORT_LIMITS } from '@openverify/core';
import { csvOf } from '../../../../../components/lists/csv';
import { listImporterErrors } from '../../../../../lib/api/lists';
import { classifyApiError } from '../../../../../lib/api/errors';
import { getSessionToken } from '../../../../../lib/session';
import { OpenVerifyApiError } from '@openverify/node';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;
/** API statuses passed on as they are: no session, no scope, unknown. */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404]);

const empty = (status: number): Response => new Response(null, { status, headers: NO_STORE });

/** Every stored error of the import, page after page; the API keeps at most 1,000 (C100.1). */
async function allErrors(id: string): Promise<ImporterError[]> {
  const errors: ImporterError[] = [];
  let after: number | undefined;
  for (;;) {
    const page = await listImporterErrors(id, after);
    errors.push(...page.data);
    const next =
      page.links.next === null
        ? null
        : new URL(page.links.next, 'http://api.invalid').searchParams.get('page[after]');
    if (
      next === null ||
      !/^[0-9]{1,9}$/u.test(next) ||
      errors.length >= IMPORT_LIMITS.errorsPerImport
    ) {
      return errors;
    }
    after = Number(next);
  }
}

/**
 * `GET /lists/importers/:id/errors.csv`: an import's errors (C100.4) as a CSV download, written by
 * the console's neutralising writer (C100.6). It holds codes, rows and columns, never a value. API
 * failures are reduced to a status without a body, and the answer is never stored.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!idSchema('mprt').safeParse(id).success) {
    return empty(404);
  }
  if ((await getSessionToken()) === null) {
    return empty(401);
  }
  let errors: ImporterError[];
  try {
    errors = await allErrors(id);
  } catch (error) {
    if (classifyApiError(error) === null) {
      throw error;
    }
    const status = error instanceof OpenVerifyApiError ? error.status : 502;
    return empty(PASSED_ON.has(status) ? status : 502);
  }
  const csv = csvOf([
    ['row', 'column', 'code'],
    ...errors.map((error) => [error.row, error.column, error.code]),
  ]);
  return new Response(csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${id}-errors.csv"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
