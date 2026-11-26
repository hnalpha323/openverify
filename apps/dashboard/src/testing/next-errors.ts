/**
 * Reads the control-flow errors that `redirect()` and `notFound()` from `next/navigation`
 * throw, so tests can assert where a server component or action sent the user.
 */
function digestOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'digest' in error) {
    const { digest } = error;
    return typeof digest === 'string' ? digest : undefined;
  }
  return undefined;
}

/** Resolves to the URL `promise` redirected to; rejects when it did not redirect. */
export async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const [code, , url] = digestOf(error)?.split(';') ?? [];
    if (code === 'NEXT_REDIRECT' && url !== undefined) {
      return url;
    }
    throw error;
  }
  throw new Error('Expected a redirect, but the call completed');
}

/** Resolves when `promise` called `notFound()`; rejects otherwise. */
export async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (digestOf(error) === 'NEXT_HTTP_ERROR_FALLBACK;404') {
      return;
    }
    throw error;
  }
  throw new Error('Expected notFound(), but the call completed');
}
