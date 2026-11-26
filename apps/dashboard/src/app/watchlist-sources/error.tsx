'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the watchlist sources page: a plain explanation and a retry, never internals. */
export default function WatchlistSourcesError({
  error,
  retry,
}: Pick<PageErrorProps, 'error' | 'retry'>) {
  return (
    <PageError error={error} retry={retry} title="The watchlist sources could not be loaded." />
  );
}
