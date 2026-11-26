'use client';

import { PageError } from '../../components/page-error';

export interface CaseSettingsErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the SLA policy and calendar pages: a plain explanation and a retry. */
export default function CaseSettingsError({ error, retry }: CaseSettingsErrorProps) {
  return <PageError error={error} retry={retry} title="The case settings could not be loaded." />;
}
