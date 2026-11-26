'use client';

/**
 * The bulk report upload (C166.5): a report template and one CSV file, sent as the browser's own
 * multipart body to the console's streaming route (`app/exports/bulk-reports/upload/route.ts`),
 * never through a server action (which stops at 1 MB) and never read in the browser. Its answer is
 * said in a polite live region; once the job is accepted, the page shows it.
 */
import { idSchema } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ANALYTICS_COPY } from '../../lib/copy/analytics';
import { FormField, controlClassName } from '../form-field';

const COPY = ANALYTICS_COPY.bulk;
export const BULK_UPLOAD_PATH = '/exports/bulk-reports/upload';

export interface BulkReportFormProps {
  /**
   * The active report templates, or `null` when the reader cannot list them (no
   * `report-templates:read`): the form then takes a template ID (K9-20), as the API needs only
   * `reports:write`.
   */
  readonly templates: readonly { readonly id: string; readonly name: string }[] | null;
}

const TEMPLATE_ID = idSchema('rptp');

export function BulkReportForm({ templates }: BulkReportFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState('');
  if (templates !== null && templates.length === 0) {
    return <p className="text-sm text-ink-muted">{COPY.noTemplates}</p>;
  }
  return (
    <form
      aria-label={COPY.formLabel}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget);
        const templateId = body.get('report-template-id');
        if (typeof templateId !== 'string' || !TEMPLATE_ID.safeParse(templateId.trim()).success) {
          setSaid(COPY.templateIdInvalid);
          return;
        }
        body.set('report-template-id', templateId.trim());
        setPending(true);
        setSaid(COPY.uploading);
        void fetch(BULK_UPLOAD_PATH, { method: 'POST', body })
          .then(async (response) => {
            const answer = (await response.json().catch(() => ({}))) as {
              message?: string;
              'job-id'?: string;
            };
            setSaid(answer.message ?? COPY.answers.failed);
            if (response.status === 202 && answer['job-id'] !== undefined) {
              router.push(`/exports/bulk-reports?job=${encodeURIComponent(answer['job-id'])}`);
            }
          })
          .catch(() => {
            setSaid(COPY.answers.failed);
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {templates === null ? (
          <FormField label={COPY.templateId} description={COPY.templateIdHint}>
            {(control) => (
              <input
                {...control}
                name="report-template-id"
                required
                autoComplete="off"
                spellCheck={false}
                className={`${controlClassName(control)} font-mono`}
              />
            )}
          </FormField>
        ) : (
          <FormField label={COPY.template}>
            {(control) => (
              <select
                {...control}
                name="report-template-id"
                required
                className={controlClassName(control)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        <FormField label={COPY.file} description={COPY.fileHint}>
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
      </div>
      <p className="text-sm text-ink-muted">{COPY.personalData}</p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? COPY.uploading : COPY.upload}
        </Button>
      </div>
      <p role="status" className="text-sm">
        {said}
      </p>
    </form>
  );
}
