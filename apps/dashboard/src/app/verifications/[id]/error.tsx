'use client';

import { PageError } from '../../../components/page-error';

export interface VerificationErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary of the verification page: a plain explanation and a retry, never internals. */
export default function VerificationError({ error, retry }: VerificationErrorProps) {
  return <PageError error={error} retry={retry} title="The verification could not be loaded." />;
}
