'use client';

import { PageError } from '../../../components/page-error';

export interface AccountTypeErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary of one account type: a plain explanation and a retry, never internals. */
export default function AccountTypeError({ error, retry }: AccountTypeErrorProps) {
  return <PageError error={error} retry={retry} title="The account type could not be loaded." />;
}
