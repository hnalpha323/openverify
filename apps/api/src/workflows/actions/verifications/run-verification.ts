/**
 * C127.3: Run Verification: only the types that need no end-user capture, whose step the inquiry's
 * pinned flow must hold (Stage 1a amendment 8), then a wait for its terminal event within
 * `timeout-seconds` (`verification_timed_out`). The output carries no derived pass flag, and a
 * verification that ends `not_applicable` says so in its checks. `debug-forced-status` is sandbox
 * only: it ends the verification there, with no provider.
 */
import { newId, stepForVerificationType } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import {
  createVerification,
  getInquiryTemplateVersion,
  listInquiryVerifications,
  putEnteredVerificationInputs,
  type Db,
  type VerificationWithChecks,
} from '@openverify/db';
import {
  runVerificationConfigSchema,
  REPORT_ACTION_LIMITS,
} from '@openverify/workflow-engine/actions';
import type { JsonRecord } from '@openverify/workflow-engine';
import { lockedInquiry } from '../../../services/inquiries.js';
import { advanceFlowInTx } from '../../../flow-engine/advance.js';
import { storedFlowView } from '../../../services/stored-flow.js';
import { moveVerification, stageVerificationEvent } from '../../../services/verifications.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type TransactionActionHandler,
} from '../../engine/action-port.js';
import { recordCreatedObjectInTx } from '../children.js';
import { apiDepsOf, configOf, refusing } from '../shared.js';

const TERMINAL_EVENTS = ['verification.passed', 'verification.failed'];

function outputOf(context: ActionContext, verification: VerificationWithChecks): JsonRecord {
  return {
    'verification-id': verification.id,
    type: verification.type,
    status: verification.status,
    checks: verification.checks.map(({ name, status }) => {
      const definition = getCheckDefinition(name);
      return {
        name,
        status,
        tier: definition?.tier ?? 'R',
        stage: definition?.stage ?? 'ga',
      };
    }),
    provider: null,
    sandbox: context.environmentKind === 'sandbox',
  };
}

async function verificationOf(
  tx: Db,
  context: ActionContext,
  inquiryId: string,
  id: string,
): Promise<VerificationWithChecks> {
  const rows = await listInquiryVerifications(tx, context.environmentId, inquiryId);
  const found = rows.find((row) => row.id === id);
  if (found === undefined) {
    throw new ActionStepError('object_not_found');
  }
  return found;
}

export const RUN_VERIFICATION_HANDLER: TransactionActionHandler = {
  key: 'run_verification',
  version: 1,
  shape: 'transaction',
  async execute(tx, context): Promise<ActionResult> {
    const config = configOf(context, runVerificationConfigSchema);
    const deps = apiDepsOf(context);
    const { environmentId } = context;
    const forced = config['debug-forced-status'];
    if (forced !== undefined && context.environmentKind !== 'sandbox') {
      return { kind: 'failed', code: 'action_input_invalid' };
    }
    const inquiry = await refusing(() => lockedInquiry(tx, environmentId, config['inquiry-id']));
    if (inquiry.redactedAt !== null) {
      return { kind: 'failed', code: 'subject_redacted' };
    }
    const version = await getInquiryTemplateVersion(
      tx,
      environmentId,
      inquiry.inquiryTemplateVersionId,
    );
    if (
      version === null ||
      stepForVerificationType(storedFlowView(version.flow), config.type) === undefined
    ) {
      return { kind: 'failed', code: 'verification_step_missing' };
    }
    const now = context.now;
    const created = await createVerification(tx, environmentId, {
      id: newId('ver'),
      inquiryId: inquiry.id,
      type: config.type,
    });
    const verification = { ...created, checks: [] };
    await putEnteredVerificationInputs(tx, environmentId, {
      verificationId: created.id,
      inquiryId: inquiry.id,
      values: config.inputs ?? {},
      at: now,
    });
    const staged = [
      await stageVerificationEvent(tx, deps.events, 'verification.created', verification, []),
    ];
    await recordCreatedObjectInTx(tx, context, 'verifications', {
      id: created.id,
      childType: 'verification',
    });
    const submitted = await moveVerification(tx, created, 'submitted', now);
    if (submitted === null) {
      throw new ActionStepError('execution_error');
    }
    if (submitted.event != null) {
      staged.push(await stageVerificationEvent(tx, deps.events, submitted.event, verification, []));
    }
    if (forced !== undefined) {
      const moved = await moveVerification(tx, submitted.verification, forced, now);
      if (moved?.event != null) {
        staged.push(await stageVerificationEvent(tx, deps.events, moved.event, verification, []));
      }
      if (moved !== null) {
        // C151.2, C151.4 (Workflow 9A Stage 1b (S)): a forced status decides a verification this
        // workflow created, never the current step's attempt; the engine is told so and keeps the
        // position (`origin: 'workflow-action'`), so it stages nothing to run after the commit.
        const advanced = await advanceFlowInTx(
          tx,
          deps,
          { environmentId, inquiryId: inquiry.id },
          {
            kind: 'verification-decided',
            verificationId: created.id,
            verificationType: config.type,
            status: forced,
            origin: 'workflow-action',
          },
        );
        staged.push(...advanced.staged);
      }
      const ended = await verificationOf(tx, context, inquiry.id, created.id);
      return { kind: 'succeeded', output: outputOf(context, ended), staged };
    }
    return {
      kind: 'waiting',
      correlationKey: created.id,
      events: TERMINAL_EVENTS,
      timeoutSeconds: config['timeout-seconds'] ?? REPORT_ACTION_LIMITS['timeout-seconds'].value,
      timeoutCode: 'verification_timed_out',
      carry: { 'verification-id': created.id, 'inquiry-id': inquiry.id },
      staged,
      afterCommit: () =>
        deps.queue.enqueueProcessVerification({ environmentId, verificationId: created.id }),
      subjects: [{ subjectId: created.id, source: 'written' }],
    };
  },
  async resume(tx, context, { carry }) {
    const verification = await verificationOf(
      tx,
      context,
      carry['inquiry-id'] as string,
      carry['verification-id'] as string,
    );
    return { kind: 'succeeded', output: outputOf(context, verification) };
  },
};
