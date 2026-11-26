'use client';

import { PageError } from '../../components/page-error';

export interface TransactionTypesErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the transaction types pages: a plain explanation and a retry, never internals. */
export default function TransactionTypesError({ error, retry }: TransactionTypesErrorProps) {
  return (
    <PageError error={error} retry={retry} title="The transaction types could not be loaded." />
  );
}
