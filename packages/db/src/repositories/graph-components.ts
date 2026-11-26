/**
 * C101.6 (Workflow 7B): `graph_components`, the nightly union-find over strong kinds, opt-in with
 * `graph-components`. Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signatures.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { graphComponents, type GraphComponentRow } from '../schema.js';

const BATCH = 1000;

/** Replaces the environment's components with one run's result. */
export async function replaceGraphComponents(
  tx: Db,
  environmentId: string,
  rows: readonly { accountId: string; componentId: string; size: number }[],
  computedAt: Date,
): Promise<number> {
  await tx.delete(graphComponents).where(eq(graphComponents.environmentId, environmentId));
  for (let start = 0; start < rows.length; start += BATCH) {
    await tx
      .insert(graphComponents)
      .values(
        rows.slice(start, start + BATCH).map((row) => ({ ...row, environmentId, computedAt })),
      );
  }
  return rows.length;
}

/** The account's component; `null` for an account newer than the last run ("not computed yet"). */
export async function getGraphComponent(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<GraphComponentRow | null> {
  const [row] = await db
    .select()
    .from(graphComponents)
    .where(
      and(
        eq(graphComponents.environmentId, environmentId),
        eq(graphComponents.accountId, accountId),
      ),
    );
  return row ?? null;
}

/** C101.4: an account's redaction deletes its component row. */
export async function deleteGraphComponent(
  tx: Db,
  environmentId: string,
  accountId: string,
): Promise<number> {
  const deleted = await tx
    .delete(graphComponents)
    .where(
      and(
        eq(graphComponents.environmentId, environmentId),
        eq(graphComponents.accountId, accountId),
      ),
    )
    .returning({ accountId: graphComponents.accountId });
  return deleted.length;
}
