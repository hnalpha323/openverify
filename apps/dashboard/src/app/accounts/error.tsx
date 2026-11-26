'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the account pages: a plain explanation and a retry, never internals. */
export default function AccountsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The accounts could not be loaded." />;
}
