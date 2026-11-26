'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the network sources page: a plain explanation and a retry, never internals. */
export default function NetworkSourcesError({
  error,
  retry,
}: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The network sources could not be loaded." />;
}
