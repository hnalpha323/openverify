'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the template pages: a plain explanation and a retry, never internals. */
export default function TemplatesError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The templates could not be loaded." />;
}
