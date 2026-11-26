'use client';

import { PageError } from '../../components/page-error';

export interface CaseQueuesErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the queue and assignment policy pages: a plain explanation and a retry. */
export default function CaseQueuesError({ error, retry }: CaseQueuesErrorProps) {
  return <PageError error={error} retry={retry} title="The case queues could not be loaded." />;
}
