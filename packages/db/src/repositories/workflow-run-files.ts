/**
 * C118.2 (Workflow 8A): `workflow_run_files`, a trigger's file inputs. Owner: `api-engine`, reached
 * from `api-triggers`' API trigger.
 *
 * The object is sealed with `encryptBytes`, the row's id as its context, and `filename` for its row
 * (`SEALED.workflowRunFileFilename`).
 */
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { sealValue } from '../sealed.js';
import { workflowRunFiles, type WorkflowRunFileRow } from '../schema.js';

export interface NewWorkflowRunFile {
  id: string;
  runId: string;
  storageKey: string;
  wrappedDek: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export async function createWorkflowRunFile(
  tx: Db,
  environmentId: string,
  input: NewWorkflowRunFile,
): Promise<WorkflowRunFileRow> {
  const [row] = await tx
    .insert(workflowRunFiles)
    .values({
      id: input.id,
      environmentId,
      runId: input.runId,
      storageKey: input.storageKey,
      wrappedDek: input.wrappedDek,
      filenameSealed: sealValue(SEALED.workflowRunFileFilename, input.id, input.filename),
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
    })
    .returning();
  if (row === undefined) {
    throw new Error('a run file was not written');
  }
  return row;
}

export async function listWorkflowRunFiles(
  db: Db,
  environmentId: string,
  runId: string,
): Promise<WorkflowRunFileRow[]> {
  return db
    .select()
    .from(workflowRunFiles)
    .where(
      and(eq(workflowRunFiles.environmentId, environmentId), eq(workflowRunFiles.runId, runId)),
    )
    .orderBy(asc(workflowRunFiles.createdAt), asc(workflowRunFiles.id));
}

/** C120.8, C120.9: drops the key and the name, in the redaction's transaction. */
export async function redactWorkflowRunFiles(
  tx: Db,
  environmentId: string,
  runId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(workflowRunFiles)
    .set({ wrappedDek: null, filenameSealed: null, redactedAt: at })
    .where(
      and(
        eq(workflowRunFiles.environmentId, environmentId),
        eq(workflowRunFiles.runId, runId),
        isNull(workflowRunFiles.redactedAt),
      ),
    );
}

/** The C16 pass: redacted files whose object is still in storage, oldest first. */
export async function listRedactedWorkflowRunFiles(
  db: Db,
  options: { limit: number },
): Promise<WorkflowRunFileRow[]> {
  return db
    .select()
    .from(workflowRunFiles)
    .where(and(isNotNull(workflowRunFiles.redactedAt), isNull(workflowRunFiles.deletedAt)))
    .orderBy(asc(workflowRunFiles.redactedAt))
    .limit(options.limit);
}

/** The C16 pass: stamps `deleted_at` once the object is gone. */
export async function markWorkflowRunFilesDeleted(
  db: Db,
  ids: readonly string[],
  at: Date,
): Promise<void> {
  if (ids.length > 0) {
    await db
      .update(workflowRunFiles)
      .set({ deletedAt: at })
      .where(inArray(workflowRunFiles.id, [...ids]));
  }
}
