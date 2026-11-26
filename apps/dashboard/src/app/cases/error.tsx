'use client';

import { PageError } from '../../components/page-error';

export interface CasesErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the case pages: a plain explanation and a retry, never internals. */
export default function CasesError({ error, retry }: CasesErrorProps) {
  return <PageError error={error} retry={retry} title="The cases could not be loaded." />;
}
