'use client';

import { Alert } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, type SubmitEvent } from 'react';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { LINK_CLASS } from '../link-styles';
import { FormField, controlClassName } from '../form-field';
import { SubmitButton } from '../submit-button';
import { csvCodeWords } from './code-words';

const copy = COPY_COPY.csv;

interface CsvProblem {
  readonly row: number | null;
  readonly column: string | null;
  readonly code: string;
}

type Outcome =
  | { readonly kind: 'imported'; readonly count: number }
  | { readonly kind: 'refused'; readonly problems: readonly CsvProblem[] }
  | { readonly kind: 'failed'; readonly status: number };

type StatusKey = keyof typeof copy.status;
const statusWords = (status: number) =>
  status in copy.status ? copy.status[status as StatusKey] : copy.status[502];

function where(problem: CsvProblem): string {
  const row = problem.row === null ? copy.header : copy.row(problem.row);
  return problem.column === null ? row : `${row}, ${copy.column(problem.column)}`;
}

/**
 * C162.7: the translations as CSV. The download is the API's file, whose cells a spreadsheet would
 * run as formulas are neutralised; the upload sends the file's bytes to the console's CSV route,
 * which imports them into the draft. A refused file lists each problem by row and column in words,
 * never a value.
 */
export function CsvPanel({
  templateId,
  canWrite,
}: {
  readonly templateId: string;
  readonly canWrite: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const path = `/templates/${encodeURIComponent(templateId)}/translations/csv`;

  const upload = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!(file instanceof File) || file.size === 0) {
      setOutcome({ kind: 'failed', status: 400 });
      return;
    }
    setPending(true);
    setOutcome(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        imported?: number;
        problems?: CsvProblem[];
      };
      if (response.status === 200) {
        setOutcome({ kind: 'imported', count: body.imported ?? 0 });
        router.refresh();
      } else if (response.status === 422 && Array.isArray(body.problems)) {
        setOutcome({ kind: 'refused', problems: body.problems });
      } else {
        setOutcome({ kind: 'failed', status: response.status });
      }
    } catch {
      setOutcome({ kind: 'failed', status: 502 });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{copy.description}</p>
      <a href={path} download className={LINK_CLASS}>
        {copy.download}
      </a>
      {canWrite && (
        <form
          aria-label={copy.upload}
          onSubmit={(event) => {
            void upload(event);
          }}
          className="flex max-w-xl flex-col gap-3"
        >
          <FormField label={copy.file}>
            {(control) => (
              <input
                {...control}
                type="file"
                name="file"
                accept=".csv,text/csv"
                className={controlClassName(control)}
              />
            )}
          </FormField>
          <div>
            <SubmitButton pending={pending} pendingLabel={copy.uploading}>
              {copy.upload}
            </SubmitButton>
          </div>
        </form>
      )}
      <div role="status" aria-live="polite" id={`${id}-status`}>
        {outcome?.kind === 'imported' && (
          <Alert tone="success">{copy.imported(outcome.count)}</Alert>
        )}
        {outcome?.kind === 'failed' && <Alert tone="error">{statusWords(outcome.status)}</Alert>}
        {outcome?.kind === 'refused' && (
          <Alert tone="error" title={copy.refusedHeading}>
            <ul className="list-disc ps-5">
              {outcome.problems.map((problem, index) => (
                <li key={`${String(index)}-${problem.code}`}>
                  {copy.problem(where(problem), csvCodeWords(problem.code))}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
    </div>
  );
}
