'use client';

import { PageError, type PageErrorProps } from '../../../components/page-error';

/** Error boundary for one role: a plain explanation and a retry, never internals. */
export default function RoleError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The role could not be loaded." />;
}
