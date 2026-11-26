/**
 * C129.4 (P14, V08; Workflow 8B, `api-cases`): template visibility at every exit a case can leave by.
 * A user sees a case of a restricted template only through a listed role, and an API key only when
 * its `case-template-ids` lists the template; a webhook is an operator's exit and is not filtered.
 * `foundation-8b` placed the calls: `GET /events` and `GET /events/:id` (`services/events.ts`),
 * `GET /api-logs` and `GET /api-logs/:id` (`services/api-logs.ts`), the run routes
 * (`workflows/runs/service.ts`) and the notifications route. The case routes, search, exports, next
 * and bulk filter in their own queries (`caseVisibleTo`).
 *
 * Each item names the case and comment ids it carries (`caseIdsOf`); an item naming one the reader may
 * not see is left out, so a page can come back short. An id that names nothing hides nothing: there
 * is nothing to keep from anyone. `GET /workflow-trigger-deliveries` is not an exit: a delivery holds
 * an event id, a workflow and a run, never a case id, and the run it names is filtered at its own
 * route.
 */
import { hiddenCaseObjectIds, type Db } from '@openverify/db';
import type { Principal } from '../../ports.js';
import { readerOf } from './shared.js';

export interface CaseVisibilityReader {
  environmentId: string;
  principal: Principal;
}

export async function filterCaseVisibility<Item>(
  db: Db,
  reader: CaseVisibilityReader,
  items: readonly Item[],
  caseIdsOf: (item: Item) => readonly string[],
): Promise<Item[]> {
  const named = [...new Set(items.flatMap((item) => caseIdsOf(item)))];
  if (named.length === 0) {
    return [...items];
  }
  const hidden = await hiddenCaseObjectIds(
    db,
    reader.environmentId,
    readerOf(reader.principal),
    named,
  );
  return items.filter((item) => !caseIdsOf(item).some((id) => hidden.has(id)));
}

const CASE_ID = /\b(?:case|cscm)_[0-9A-HJKMNP-TV-Z]{26}\b/g;

/**
 * The case and comment ids that values name, for an exit's `caseIdsOf`: a comment counts, because
 * its case is what visibility reads.
 */
export function caseIdsIn(...values: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const [id] of text.matchAll(CASE_ID)) {
      found.add(id);
    }
  }
  return [...found];
}
