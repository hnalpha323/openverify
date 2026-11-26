/**
 * C165.3 (Workflow 9B Stage 1b (X)): what a list filter hook answers. Owner: `api-exports`.
 */
import type { SQL } from 'drizzle-orm';

/** The conditions a hook adds to a list, and the filters its next link repeats. */
export interface ListFilterConditions {
  /** Conditions on the list's own table (`inquiries`, `transactions`), each ANDed with the list's. */
  where: readonly SQL[];
  /**
   * The new filters as the query gave them, repeated in `links.next` so the next page keeps them; a
   * stored API log masks the personal-data ones (`services/api-logs.ts`).
   */
  links: Readonly<Record<string, string | undefined>>;
}

/** No condition and nothing to repeat: the list as it was before 9B. */
export const NO_LIST_FILTER_CONDITIONS: ListFilterConditions = Object.freeze({
  where: Object.freeze([]),
  links: Object.freeze({}),
});
