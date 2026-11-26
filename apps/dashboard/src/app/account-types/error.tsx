'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary of the account types page: a plain explanation and a retry, never internals. */
export default function AccountTypesError({
  error,
  retry,
}: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The account types could not be loaded." />;
}
