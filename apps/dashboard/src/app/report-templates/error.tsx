'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the report template pages: a plain explanation and a retry, never internals. */
export default function ReportTemplatesError({
  error,
  retry,
}: Pick<PageErrorProps, 'error' | 'retry'>) {
  return (
    <PageError error={error} retry={retry} title="The report templates could not be loaded." />
  );
}
