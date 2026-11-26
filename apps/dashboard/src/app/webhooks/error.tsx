'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the webhook pages: a plain explanation and a retry, never internals. */
export default function WebhooksError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The webhooks could not be loaded." />;
}
