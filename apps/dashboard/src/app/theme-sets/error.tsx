'use client';

import { PageError } from '../../components/page-error';
import { THEMES_COPY } from '../../lib/copy/themes-copy';

export interface ThemeSetsErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
}

/** Error boundary for the list pages: a plain explanation and a retry, never internals. */
export default function ThemeSetsError({ error, retry }: ThemeSetsErrorProps) {
  return <PageError error={error} retry={retry} title={THEMES_COPY.list.loadError} />;
}
