'use client';

import { Alert, Button } from '@openverify/ui';
import { useEffect } from 'react';
import { PageMain } from './page-main';

export interface PageErrorProps {
  /** Next.js replaces server errors with a generic message and a `digest` for the logs. */
  readonly error: unknown;
  readonly retry: () => void;
  readonly title?: string;
}

function digestOf(error: unknown): string | undefined {
  return error instanceof Error && 'digest' in error && typeof error.digest === 'string'
    ? error.digest
    : undefined;
}

/** The error's kind (`TypeError`, ...) for the browser console, never its message. */
function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * A page's error boundary (`error.tsx`): a plain explanation, the digest to quote, and a retry.
 * Never the error's message or stack, on the page or in the browser console (KP11-80): a server
 * error reaches the browser as a generic message with its digest, but a client component's own
 * error carries its words, which can quote what the page shows. The digest finds the server log.
 */
export function PageError({
  error,
  retry,
  title = 'This page could not be loaded.',
}: PageErrorProps) {
  const digest = digestOf(error);
  useEffect(() => {
    console.error('The page could not be loaded', { error: kindOf(error), digest });
  }, [error, digest]);

  return (
    <PageMain width="narrow" className="items-start">
      <Alert tone="error" title={title}>
        The dashboard API did not answer as expected. Try again in a moment.
        {digest !== undefined && (
          <>
            {' '}
            Reference: <code className="font-mono text-xs">{digest}</code>
          </>
        )}
      </Alert>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </PageMain>
  );
}
