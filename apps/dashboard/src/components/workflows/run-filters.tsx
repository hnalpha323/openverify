/**
 * The runs table's filters (C141.6), from the contract's list (`listWorkflowRunsQuerySchema`):
 * status, version, subject id and step errors. They travel in the page URL (C23) as a plain GET
 * form, so a filtered view can be bookmarked. Each value is checked before the API is asked: a
 * value that is not well formed is left out and the page says so, never sent as typed.
 */
import { anyIdSchema, idSchema } from '@openverify/contracts';
import { WORKFLOW_RUN_STATUSES, workflowRunStatusSchema } from '@openverify/core';
import Link from 'next/link';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { WORKFLOW_RUN_STATUS_WORDS, wordOf } from './workflow-words';

/** The URL parameters of the runs table's filters and cursor. */
export const RUN_FILTER_PARAMS = {
  status: 'run-status',
  version: 'run-version',
  subject: 'run-subject',
  stepErrors: 'step-errors',
} as const;

/** The filters as read from the URL: what is sent, and which ones were left out. */
export interface RunFilters {
  readonly status: string | undefined;
  readonly versionId: string | undefined;
  readonly subjectId: string | undefined;
  readonly stepErrors: boolean;
  /** The names of the filters given but not well formed, in words. */
  readonly refused: readonly string[];
  /** The URL query that keeps these filters, for links that change something else. */
  readonly query: Readonly<Record<string, string>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text === undefined || text.trim() === '' ? undefined : text.trim();
}

/** The runs filters of a page's search params, each checked by the contract's own schema. */
export function runFiltersOf(params: Record<string, string | string[] | undefined>): RunFilters {
  const refused: string[] = [];
  const query: Record<string, string> = {};
  const read = (
    param: string,
    words: string,
    check: (value: string) => boolean,
  ): string | undefined => {
    const value = single(params[param]);
    if (value === undefined) {
      return undefined;
    }
    if (!check(value)) {
      refused.push(words);
      return undefined;
    }
    query[param] = value;
    return value;
  };
  const status = read(
    RUN_FILTER_PARAMS.status,
    'status',
    (value) => workflowRunStatusSchema.safeParse(value).success,
  );
  const versionId = read(
    RUN_FILTER_PARAMS.version,
    'version',
    (value) => idSchema('wfv').safeParse(value).success,
  );
  const subjectId = read(
    RUN_FILTER_PARAMS.subject,
    'subject id',
    (value) => anyIdSchema.safeParse(value).success,
  );
  const stepErrors = single(params[RUN_FILTER_PARAMS.stepErrors]) === 'true';
  if (stepErrors) {
    query[RUN_FILTER_PARAMS.stepErrors] = 'true';
  }
  return { status, versionId, subjectId, stepErrors, refused, query };
}

/** The filter form above the runs table, with a polite note of what was left out. */
export function RunFilterForm({
  path,
  filters,
  versions,
}: {
  readonly path: string;
  readonly filters: RunFilters;
  readonly versions: readonly { readonly id: string; readonly number: number }[];
}) {
  const filtered = Object.keys(filters.query).length > 0;
  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        aria-label="Filter runs"
        method="get"
        action={path}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField label="Status" className="w-44">
          {(control) => (
            <select
              {...control}
              name={RUN_FILTER_PARAMS.status}
              defaultValue={filters.status ?? ''}
              className={controlClassName(control)}
            >
              <option value="">Any status</option>
              {WORKFLOW_RUN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {wordOf(WORKFLOW_RUN_STATUS_WORDS, status)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Version" className="w-44">
          {(control) => (
            <select
              {...control}
              name={RUN_FILTER_PARAMS.version}
              defaultValue={filters.versionId ?? ''}
              className={controlClassName(control)}
            >
              <option value="">Any version</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {`Version ${String(version.number)}`}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          label="Subject id"
          description="An inquiry, account, case or other object id."
          className="min-w-64"
        >
          {(control) => (
            <input
              {...control}
              name={RUN_FILTER_PARAMS.subject}
              defaultValue={filters.subjectId ?? ''}
              spellCheck={false}
              autoComplete="off"
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={RUN_FILTER_PARAMS.stepErrors}
            value="true"
            defaultChecked={filters.stepErrors}
            className="size-6"
          />
          Only runs with step errors
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold"
        >
          Filter
        </button>
        {filtered && (
          <Link href={path} className={LINK_CLASS}>
            Show every run
          </Link>
        )}
      </form>
      <p role="status" aria-label="Run filters" className="text-sm">
        {filters.refused.length > 0
          ? `A filter that is not well formed was left out: ${filters.refused.join(', ')}.`
          : ''}
      </p>
    </div>
  );
}
