'use client';

import { PageError } from '../../components/page-error';

export interface CaseTemplatesErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the case template pages: a plain explanation and a retry, never internals. */
export default function CaseTemplatesError({ error, retry }: CaseTemplatesErrorProps) {
  return <PageError error={error} retry={retry} title="The case templates could not be loaded." />;
}
