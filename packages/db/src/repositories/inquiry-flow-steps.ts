/**
 * C151.1 (Workflow 9A): the step record of the server flow engine, and the position it moves on the
 * inquiry's row. Owner: `api-flow-engine`; frozen by `foundation-9a` (S). Rows are written in the
 * transaction that moves the position, under the inquiry's row lock (the caller holds it, so the
 * next `seq` read here is the inquiry's own); the inquiry's redaction deletes them
 * (`redactInquiryRecords`). Every row holds ids, step ids and codes, never a value.
 */
import type {
  FlowRecordDeviceKind,
  FlowRecordPlatform,
  FlowRecordSpecVersion,
  FlowRecordState,
} from '@openverify/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  inquiries,
  inquiryFlowSteps,
  type InquiryFlowStepRow,
  type StoredFlowOutcome,
} from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

export type InquiryFlowStep = InquiryFlowStepRow;

/** A step entered: the next `seq` of the inquiry, open until its exit is recorded. */
export interface NewInquiryFlowStep {
  inquiryId: string;
  stepId: string;
  stepType: string;
  enteredAt: Date;
  notes?: readonly string[];
}

/** How a step was left (C151.2). */
export interface InquiryFlowStepExit {
  exitedAt: Date;
  exitPort: string;
  outcome: string | null;
  waitedMs?: number | null;
  /** C151.1 (P15): a screen button other than `next`, or a route reading a PII-marked path. */
  sensitive: boolean;
  notes?: readonly string[];
}

/** Appends the inquiry's next entry (the caller holds the inquiry's row lock). */
export async function appendInquiryFlowStepInTx(
  tx: Db,
  environmentId: string,
  input: NewInquiryFlowStep,
): Promise<InquiryFlowStep> {
  const last = firstOrNull(
    await tx
      .select({ seq: sql<number>`coalesce(max(${inquiryFlowSteps.seq}), 0)::int` })
      .from(inquiryFlowSteps)
      .where(
        and(
          eq(inquiryFlowSteps.environmentId, environmentId),
          eq(inquiryFlowSteps.inquiryId, input.inquiryId),
        ),
      ),
  );
  return inserted(
    await tx
      .insert(inquiryFlowSteps)
      .values({
        environmentId,
        inquiryId: input.inquiryId,
        seq: (last?.seq ?? 0) + 1,
        stepId: input.stepId,
        stepType: input.stepType,
        enteredAt: input.enteredAt,
        notes: [...(input.notes ?? [])],
      })
      .returning(),
    'appendInquiryFlowStepInTx',
  );
}

/** Records the exit of the entry `seq`, once; `null` when it is not open (or not this inquiry's). */
export async function exitInquiryFlowStepInTx(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  seq: number,
  exit: InquiryFlowStepExit,
): Promise<InquiryFlowStep | null> {
  const notes = [...(exit.notes ?? [])];
  return firstOrNull(
    await tx
      .update(inquiryFlowSteps)
      .set({
        exitedAt: exit.exitedAt,
        exitPort: exit.exitPort,
        outcome: exit.outcome,
        waitedMs: exit.waitedMs ?? null,
        sensitive: exit.sensitive,
        notes:
          notes.length === 0
            ? sql`${inquiryFlowSteps.notes}`
            : sql`${inquiryFlowSteps.notes} || ${sql.param(notes)}::text[]`,
      })
      .where(
        and(
          eq(inquiryFlowSteps.environmentId, environmentId),
          eq(inquiryFlowSteps.inquiryId, inquiryId),
          eq(inquiryFlowSteps.seq, seq),
          isNull(inquiryFlowSteps.exitedAt),
        ),
      )
      .returning(),
  );
}

/** C151.1: the inquiry's position as the engine moves it (the `inquiries.flow_*` columns). */
export interface InquiryFlowPosition {
  stepId: string;
  state: FlowRecordState;
  previousStepId: string | null;
  specVersion: FlowRecordSpecVersion;
}

const ofInquiry = (environmentId: string, inquiryId: string) =>
  and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, inquiryId));

/** Moves the inquiry's position (the caller holds its row lock). `false` when no row matched. */
export async function setInquiryFlowPositionInTx(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  position: InquiryFlowPosition,
): Promise<boolean> {
  const rows = await tx
    .update(inquiries)
    .set({
      flowStepId: position.stepId,
      flowState: position.state,
      flowPreviousStepId: position.previousStepId,
      flowSpecVersion: position.specVersion,
    })
    .where(ofInquiry(environmentId, inquiryId))
    .returning({ id: inquiries.id });
  return rows.length > 0;
}

/** C151.13: stores the inquiry's PII-free `flow-outcome`. */
export async function setInquiryFlowOutcomeInTx(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  outcome: StoredFlowOutcome,
): Promise<boolean> {
  const rows = await tx
    .update(inquiries)
    .set({
      flowOutcome: {
        verificationTypesOnPath: [...outcome.verificationTypesOnPath],
        fallbacksTaken: [...outcome.fallbacksTaken],
        flags: [...outcome.flags],
      },
    })
    .where(ofInquiry(environmentId, inquiryId))
    .returning({ id: inquiries.id });
  return rows.length > 0;
}

/**
 * C151.1 (reviews F14, H05): the device kind and platform of the session that served the first
 * step, written once (a later call leaves them as they are and answers `false`).
 */
export async function setInquiryFirstDeviceInTx(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  device: { deviceKind: FlowRecordDeviceKind | null; platform: FlowRecordPlatform | null },
): Promise<boolean> {
  const rows = await tx
    .update(inquiries)
    .set({ firstDeviceKind: device.deviceKind, firstPlatform: device.platform })
    .where(
      and(
        ofInquiry(environmentId, inquiryId),
        isNull(inquiries.firstDeviceKind),
        isNull(inquiries.firstPlatform),
      ),
    )
    .returning({ id: inquiries.id });
  return rows.length > 0;
}

/** C151.10: moves an open inquiry's expiry (the caller holds its row lock). */
export async function setInquiryExpiresAtInTx(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  expiresAt: Date,
): Promise<boolean> {
  const rows = await tx
    .update(inquiries)
    .set({ expiresAt })
    .where(ofInquiry(environmentId, inquiryId))
    .returning({ id: inquiries.id });
  return rows.length > 0;
}

/** The inquiry's step record, oldest first (by `seq`). */
export async function listInquiryFlowSteps(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryFlowStep[]> {
  return db
    .select()
    .from(inquiryFlowSteps)
    .where(
      and(
        eq(inquiryFlowSteps.environmentId, environmentId),
        eq(inquiryFlowSteps.inquiryId, inquiryId),
      ),
    )
    .orderBy(asc(inquiryFlowSteps.seq));
}
