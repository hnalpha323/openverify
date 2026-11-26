'use client';

import { PageError } from '../../components/page-error';

export interface ListsErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the list pages: a plain explanation and a retry, never internals. */
export default function ListsError({ error, retry }: ListsErrorProps) {
  return <PageError error={error} retry={retry} title="The lists could not be loaded." />;
}
