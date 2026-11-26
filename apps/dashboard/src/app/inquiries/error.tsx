'use client';

import { PageError } from '../../components/page-error';

export interface InquiriesErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the inquiry pages: a plain explanation and a retry, never internals. */
export default function InquiriesError({ error, retry }: InquiriesErrorProps) {
  return <PageError error={error} retry={retry} title="The inquiries could not be loaded." />;
}
