'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary for the users page: a plain explanation and a retry, never internals. */
export default function UsersError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The users could not be loaded." />;
}
