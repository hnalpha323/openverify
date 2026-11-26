'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the API key pages: a plain explanation and a retry, never internals. */
export default function ApiKeysError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The API keys could not be loaded." />;
}
