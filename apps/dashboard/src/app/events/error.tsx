'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the events pages: a plain explanation and a retry, never internals. */
export default function EventsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The events could not be loaded." />;
}
