'use client';

import { PageError, type PageErrorProps } from '../../components/page-error';

/** Error boundary for the settings page: a plain explanation and a retry, never internals. */
export default function SettingsError({ error, retry }: Pick<PageErrorProps, 'error' | 'retry'>) {
  return <PageError error={error} retry={retry} title="The settings could not be loaded." />;
}
