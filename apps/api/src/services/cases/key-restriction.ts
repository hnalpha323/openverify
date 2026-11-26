/**
 * C129.4 (P14; Workflow 8B, `api-cases`): an API key's `case-template-ids` is never wider than its
 * creator's visibility: each id names a template of this environment that the creating principal may
 * see. `services/api-keys.ts` calls it for a new key and for a clone, which copies the restriction
 * and holds it to its new creator. An id naming nothing here, or a template the creator may not see,
 * is refused by its position (422), and the refusal never says which of the two it was.
 */
import { existingCaseTemplateIds, templateVisibleTo, caseTemplates, type Db } from '@openverify/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { UnprocessableContentError } from '../../errors.js';
import type { Principal } from '../../ports.js';
import { readerOf } from './shared.js';

export async function assertKeyTemplateRestrictionInTx(
  tx: Db,
  environmentId: string,
  creator: Principal,
  caseTemplateIds: readonly string[] | null,
): Promise<void> {
  if (caseTemplateIds === null || caseTemplateIds.length === 0) {
    return;
  }
  const ids = [...new Set(caseTemplateIds)];
  const existing = await existingCaseTemplateIds(tx, environmentId, ids);
  const visible = new Set(
    (
      await tx
        .select({ id: caseTemplates.id })
        .from(caseTemplates)
        .where(
          and(
            eq(caseTemplates.environmentId, environmentId),
            inArray(caseTemplates.id, ids),
            sql`${templateVisibleTo(readerOf(creator), caseTemplates.environmentId, caseTemplates.id)}`,
          ),
        )
    ).map(({ id }) => id),
  );
  const errors = caseTemplateIds.flatMap((id, index) =>
    existing.has(id) && visible.has(id)
      ? []
      : [
          {
            location: 'body',
            pointer: `/data/attributes/case-template-ids/${String(index)}`,
            detail: 'Names no case template of this environment that you may see.',
          },
        ],
  );
  if (errors.length > 0) {
    throw new UnprocessableContentError(
      'A key can be restricted only to case templates its creator may see.',
      errors,
    );
  }
}
