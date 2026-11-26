/**
 * C117.5 (Workflow 8A): `workflow_step_effects`. Owner: `api-engine`.
 *
 * `result` is sealed for the row (`SEALED.workflowEffectResult`).
 */
import { and, arrayOverlaps, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealOptionalJson } from '../sealed.js';
import { workflowStepEffects, type WorkflowStepEffectRow } from '../schema.js';

export interface NewWorkflowEffect {
  id: string;
  runId: string;
  stepId: string;
  /** `<wfr id>/<node id>/<iteration path>`, independent of the attempt. */
  effectKey: string;
  kind: string;
}

/** C120.9 (P20): a PII-to-PII copy, recorded for redaction. */
export interface WorkflowEffectCopy {
  targetId: string;
  sourceSubjectIds: readonly string[];
}

/** The row, and whether this call claimed it or found an earlier attempt's. */
export interface WorkflowEffectClaim {
  effect: WorkflowStepEffectRow;
  claimed: boolean;
}

const effectIn = (environmentId: string, effectKey: string) =>
  and(
    eq(workflowStepEffects.environmentId, environmentId),
    eq(workflowStepEffects.effectKey, effectKey),
  );

/** An effect's sealed result, so a repeated attempt returns the first (C117.5). */
export const openWorkflowEffectResult = (
  effect: WorkflowStepEffectRow,
): Record<string, unknown> | null =>
  openOptionalJson(SEALED.workflowEffectResult, effect.id, effect.resultSealed) as Record<
    string,
    unknown
  > | null;

/** C117.5: one row per key, whatever the attempt; a repeat finds the first. */
export async function claimWorkflowEffect(
  tx: Db,
  environmentId: string,
  input: NewWorkflowEffect,
): Promise<WorkflowEffectClaim> {
  const [created] = await tx
    .insert(workflowStepEffects)
    .values({
      id: input.id,
      environmentId,
      runId: input.runId,
      stepId: input.stepId,
      effectKey: input.effectKey,
      kind: input.kind,
    })
    .onConflictDoNothing()
    .returning();
  if (created !== undefined) {
    return { effect: created, claimed: true };
  }
  const [found] = await tx
    .select()
    .from(workflowStepEffects)
    .where(effectIn(environmentId, input.effectKey))
    .limit(1);
  if (found === undefined) {
    throw new Error('an effect conflicted with no key');
  }
  return { effect: found, claimed: false };
}

/** `done`, with the sealed result and, for a PII-to-PII copy, where it went (C120.9). */
export async function completeWorkflowEffect(
  tx: Db,
  environmentId: string,
  effectKey: string,
  result: Readonly<Record<string, unknown>> | null,
  copy?: WorkflowEffectCopy,
): Promise<WorkflowStepEffectRow | null> {
  const [found] = await tx
    .select({ id: workflowStepEffects.id })
    .from(workflowStepEffects)
    .where(effectIn(environmentId, effectKey))
    .limit(1);
  if (found === undefined) {
    return null;
  }
  const [row] = await tx
    .update(workflowStepEffects)
    .set({
      status: 'done',
      resultSealed: sealOptionalJson(SEALED.workflowEffectResult, found.id, result),
      ...(copy === undefined
        ? {}
        : { copyTargetId: copy.targetId, copySourceSubjectIds: [...copy.sourceSubjectIds] }),
    })
    .where(effectIn(environmentId, effectKey))
    .returning();
  return row ?? null;
}

/** C126.5: proof of non-delivery: nothing went out, so a retry may claim it again. */
export async function releaseWorkflowEffect(
  tx: Db,
  environmentId: string,
  effectKey: string,
): Promise<void> {
  await tx
    .delete(workflowStepEffects)
    .where(and(effectIn(environmentId, effectKey), eq(workflowStepEffects.status, 'claimed')));
}

/** C126.1: a crash between `claimed` and `done`; a resume reports it and does not resend. */
export async function markWorkflowEffectUnknown(
  tx: Db,
  environmentId: string,
  effectKey: string,
): Promise<WorkflowStepEffectRow | null> {
  const [row] = await tx
    .update(workflowStepEffects)
    .set({ status: 'unknown' })
    .where(and(effectIn(environmentId, effectKey), eq(workflowStepEffects.status, 'claimed')))
    .returning();
  return row ?? null;
}

/** C120.3: an acknowledged `unknown` effect stays what it is, and the run moves on. */
export async function listWorkflowRunEffects(
  db: Db,
  environmentId: string,
  runId: string,
): Promise<WorkflowStepEffectRow[]> {
  return db
    .select()
    .from(workflowStepEffects)
    .where(
      and(
        eq(workflowStepEffects.environmentId, environmentId),
        eq(workflowStepEffects.runId, runId),
      ),
    );
}

/** C120.9 (P20): the copies a run made from these subjects. */
export async function listWorkflowEffectCopiesOf(
  tx: Db,
  environmentId: string,
  subjectIds: readonly string[],
): Promise<WorkflowStepEffectRow[]> {
  if (subjectIds.length === 0) {
    return [];
  }
  return tx
    .select()
    .from(workflowStepEffects)
    .where(
      and(
        eq(workflowStepEffects.environmentId, environmentId),
        isNotNull(workflowStepEffects.copyTargetId),
        arrayOverlaps(workflowStepEffects.copySourceSubjectIds, [...subjectIds]),
      ),
    );
}
