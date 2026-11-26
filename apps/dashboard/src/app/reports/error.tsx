'use client';

import { PageError } from '../../components/page-error';

export interface ReportsErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the report pages: a plain explanation and a retry, never internals. */
export default function ReportsError({ error, retry }: ReportsErrorProps) {
  return <PageError error={error} retry={retry} title="The reports could not be loaded." />;
}
