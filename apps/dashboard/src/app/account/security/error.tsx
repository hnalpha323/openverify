'use client';

import { PageError, type PageErrorProps } from '../../../components/page-error';

export default function SecurityError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return (
    <PageError error={error} retry={retry} title="Your security settings could not be loaded." />
  );
}
