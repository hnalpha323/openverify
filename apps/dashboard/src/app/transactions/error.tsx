'use client';

import { PageError } from '../../components/page-error';

export interface TransactionsErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the transactions pages: a plain explanation and a retry, never internals. */
export default function TransactionsError({ error, retry }: TransactionsErrorProps) {
  return <PageError error={error} retry={retry} title="The transactions could not be loaded." />;
}
