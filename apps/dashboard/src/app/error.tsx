'use client';

import { PageError, type PageErrorProps } from '../components/page-error';

/** The error boundary of every page without a closer one. */
export default function RootError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} />;
}
