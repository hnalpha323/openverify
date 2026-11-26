'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary for the roles list: a plain explanation and a retry, never internals. */
export default function RolesError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The roles could not be loaded." />;
}
