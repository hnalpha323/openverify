'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the API logs pages: a plain explanation and a retry, never internals. */
export default function ApiLogsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The API logs could not be loaded." />;
}
