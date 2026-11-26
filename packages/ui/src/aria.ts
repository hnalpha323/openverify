import type { ReactNode } from 'react';

/** True when a node would render something (so it may be referenced by an ARIA id). */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** Joins element ids for `aria-describedby`; undefined when there are none. */
export function joinIds(...ids: readonly (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}
