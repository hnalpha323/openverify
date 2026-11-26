/**
 * Test support (Workflow 9A, api-flow-engine): C151.4 lets only the current step take input, so a
 * test that exercises a later step of a flow first passes the steps before it. Seeding their
 * decided attempts before the request that positions the inquiry (the session read or the consent)
 * makes the engine's replay walk past them (C151.14), exactly as an inquiry whose earlier steps the
 * person completed. Only tests import this file; every value is synthetic.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import type { VerificationStatus } from '@openverify/core';
import {
  appendInquiryFlowStepInTx,
  copyVerificationInputs,
  exitInquiryFlowStepInTx,
  getInquiry,
  getInquiryTemplateVersion,
  setInquiryFlowPositionInTx,
  transitionInquiryStatus,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import type { FlowV2 } from '@openverify/flow-spec';
import { seedVerification, type TestApi } from '../test-support/harness.js';
import { storedFlowView } from '../services/stored-flow.js';
import { isSilentStep, stepVerificationType } from './verification-state.js';

/**
 * Seeds a passed attempt of every verification step the inquiry's flow lists before the step of
 * `type`; a silent AAMVA step gets the `skipped` attempt the server would have bound to the
 * government ID seeded before it (C59.6). A flow without such a step gets nothing. Answers the
 * types seeded.
 */
export async function passStepsBefore(
  api: TestApi,
  inquiryId: string,
  type: SupportedVerificationType,
): Promise<SupportedVerificationType[]> {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  const version =
    inquiry === null
      ? null
      : await getInquiryTemplateVersion(
          api.database.db,
          api.environmentId,
          inquiry.inquiryTemplateVersionId,
        );
  if (version === null) {
    throw new Error(`Inquiry ${inquiryId} has no template version`);
  }
  const steps = storedFlowView(version.flow).steps;
  if (!steps.some((step) => stepVerificationType(step as never) === type)) {
    // A flow without the step: nothing to pass (the request is refused for its own reason).
    return [];
  }
  const seeded: SupportedVerificationType[] = [];
  let governmentId: string | null = null;
  for (const step of steps) {
    const stepType = stepVerificationType(step as never);
    if (stepType === type) {
      return seeded;
    }
    if (stepType === null) {
      continue;
    }
    const silent = isSilentStep(step as never);
    const { id } = await seedVerification(api, api.environmentId, inquiryId, {
      type: stepType,
      status: silent ? 'skipped' : 'passed',
    });
    if (silent && governmentId !== null) {
      await copyVerificationInputs(api.database.db, api.environmentId, {
        verificationId: id,
        inquiryId,
        values: {},
        sourceVerificationId: governmentId,
        at: api.clock.now(),
      });
    }
    if (stepType === 'government_id') {
      governmentId = id;
    }
    seeded.push(stepType);
  }
  return seeded;
}

/** A golden position (`contracts/fixtures/flows/v2/projection-cases.json`'s `position`). */
export interface StoredPosition {
  current: string;
  exited: readonly { stepId: string; port: string }[];
  verificationStatuses?: Readonly<Record<string, string>>;
}

/**
 * Writes the stored state of `position` for a new pending inquiry of `flow`: its step record (one
 * entry per exit, then the current step), its position, and a verification of each step in
 * `verificationStatuses` with that status. Answers the inquiry's id.
 */
export async function storeFlowPosition(
  api: TestApi,
  flow: FlowV2,
  position: StoredPosition,
): Promise<string> {
  const { db } = api.database;
  const { inquiry } = await createTestInquiry(db, api.environmentId, { flow });
  await transitionInquiryStatus(db, api.environmentId, inquiry.id, {
    from: 'created',
    to: 'pending',
  });
  const typeOf = (stepId: string) =>
    flow.steps.find((step) => step.id === stepId)?.type ?? 'unknown';
  const at = api.clock.now();
  await db.transaction(async (tx) => {
    for (const exited of position.exited) {
      const entry = await appendInquiryFlowStepInTx(tx, api.environmentId, {
        inquiryId: inquiry.id,
        stepId: exited.stepId,
        stepType: typeOf(exited.stepId),
        enteredAt: at,
      });
      await exitInquiryFlowStepInTx(tx, api.environmentId, inquiry.id, entry.seq, {
        exitedAt: at,
        exitPort: exited.port,
        outcome: null,
        sensitive: false,
        notes: [],
      });
    }
    await appendInquiryFlowStepInTx(tx, api.environmentId, {
      inquiryId: inquiry.id,
      stepId: position.current,
      stepType: typeOf(position.current),
      enteredAt: at,
    });
    const terminal = ['completion', 'failure'].includes(typeOf(position.current));
    await setInquiryFlowPositionInTx(tx, api.environmentId, inquiry.id, {
      stepId: position.current,
      state: terminal ? 'ended' : 'active',
      previousStepId: position.exited.at(-1)?.stepId ?? null,
      specVersion: 2,
    });
  });
  for (const [stepId, status] of Object.entries(position.verificationStatuses ?? {})) {
    const step = flow.steps.find((candidate) => candidate.id === stepId);
    const type = step === undefined ? null : stepVerificationType(step);
    if (type !== null) {
      await seedVerification(api, api.environmentId, inquiry.id, {
        type,
        status: status as VerificationStatus,
      });
    }
  }
  return inquiry.id;
}

/** The consent body of the default template's consent step (every Phase 1-8 template's). */
export const DEFAULT_CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
} as const;

/**
 * C151.4 for a test of a later step: seeds the steps before `type`'s as passed and records the
 * session's consent, whose exit walks the position to the step of `type`.
 */
export async function reachStep(
  api: TestApi,
  inquiryId: string,
  sessionToken: string,
  type: SupportedVerificationType,
): Promise<void> {
  await passStepsBefore(api, inquiryId, type);
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/consent',
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: DEFAULT_CONSENT_BODY,
  });
  if (response.statusCode !== 201) {
    throw new Error(`consent answered ${String(response.statusCode)}: ${response.body}`);
  }
}
