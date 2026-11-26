'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary for the chip trust store page: a plain explanation and a retry, never internals. */
export default function TrustAnchorsError({
  error,
  retry,
}: Pick<PageErrorProps, 'error' | 'retry'>) {
  return (
    <PageError error={error} retry={retry} title="The chip trust store could not be loaded." />
  );
}
