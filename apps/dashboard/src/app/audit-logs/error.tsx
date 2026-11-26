'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary for the audit log pages: a plain explanation and a retry, never internals. */
export default function AuditLogsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The audit log could not be loaded." />;
}
