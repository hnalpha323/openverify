/**
 * C237.6, C238.4 (Workflow 11A, `api-consent`): the `share_consent` step's three exits on the flow
 * API, under session authentication (a handed-off desktop session answers 409 `session_handed_off`,
 * Stage 1a amendment 19):
 *
 * - `POST /api/v1/flow/share-consents/:stepId/accept` (`text-sha256`, `biometric-text-sha256?`,
 *   `explicit-biometric`): only at the current position (409 `flow_step_not_current`); the view is
 *   recomposed at this position and the digests compared with what was served (422
 *   `consent_text_mismatch`), the biometric tick required when the share carries `biometric` (422
 *   `explicit_consent_required`); a `flow` record (C236.4) with the session, the time and the sealed
 *   address and user agent of the person's act; the step is left through `next`. On the destination
 *   side the `fill-inquiry` redemption into this inquiry is requested in the same transaction and its
 *   job enqueued after the commit. The step is left at once: Phase 9's waiting position until the job
 *   ends needs the job to resume the flow when it ends, a hook `api-redeem`'s job does not have yet
 *   (a contract deviation), so a clone counts on the steps the flow enters after the job commits.
 * - `POST .../decline` (`{}`): a `declined` record (C236.11), and the flow continues through `next`:
 *   declining never ends it (consent must be free).
 * - `POST .../withdraw` (`{}`): for a step listed in `withdrawable-share-consents` only (else 409
 *   `flow_step_not_current`); `withdrawn-via: flow` with the API's effects (C237.2); the one flow
 *   action on a passed step, which never moves the position (verification V02).
 *
 * Each answers 200 with the session. While the install switch is off each answers the one generic
 * 404 (C231.10). Frozen by `foundation-11a` (Stage 1b (K)); built by `api-consent` (its file).
 */
import {
  FLOW_SPEC_HEADER,
  flowSessionResponseSchema,
  flowShareConsentAcceptBodySchema,
  flowShareConsentDeclineBodySchema,
  flowShareConsentParamsSchema,
  flowShareConsentWithdrawBodySchema,
  parseFlowSpecHeader,
  type FlowShareConsentAcceptBody,
} from '@openverify/contracts';
import { getEnvironment, listSessionShareConsents, lockInquiry, type Db } from '@openverify/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireFlowSession, type FlowSession } from '../../auth/flow-session.js';
import { runFlowAfterCommit, type FlowAdvance } from '../../flow-engine/advance.js';
import {
  advanceOf,
  currentEntry,
  leaveEntry,
  loadEngine,
  moveOn,
} from '../../flow-engine/engine.js';
import { pinnedFlowOf } from '../../flow-engine/pinned-flow.js';
import { positionFlowInTx } from '../../flow-engine/position.js';
import { FlowEngineProblemError, flowStepNotCurrent } from '../../flow-engine/problems.js';
import type { StagedEvent } from '../../events/index.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ConnectRedeemJob } from '../../jobs/connect-queues.js';
import { recordFlowConsentInTx } from '../../services/connect/consent.js';
import {
  enqueueRedemption,
  redemptionCrossTenant,
  requestFillInquiryRedemptionInTx,
  type RedemptionCrossTenant,
} from '../../services/connect/redeem.js';
import { ConnectProblemError } from '../../services/connect/problems.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import { withdrawConsentRecordInTx } from '../../services/connect/withdrawal.js';
import type { ApiDependencies } from '../../services/context.js';
import { getFlowSession } from '../../services/flow.js';
import { assertInquiryOpenUnderLock } from '../../services/flow-preconditions.js';
import { findInquiry } from '../../services/inquiries.js';
import {
  shareConsentFacts,
  shareConsentSessionLocale,
  shareConsentStepOf,
  type ShareConsentFacts,
} from '../../services/flow-views/share-consent.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** What a person's act records of the request (C236.4): the address and the user agent, sealed. */
export interface ActEvidence {
  ip: string | null;
  userAgent: string | null;
}

const evidenceOf = (request: FastifyRequest): ActEvidence => ({
  ip: request.ip === '' ? null : request.ip,
  userAgent: request.headers['user-agent'] ?? null,
});

const mismatch = () =>
  new FlowEngineProblemError(
    'consent_text_mismatch',
    'The texts sent are not the texts this step shows.',
  );

/**
 * The `share_consent` step the position names, with its composed facts, under the inquiry's lock, or
 * 409 `flow_step_not_current` (one body whatever was asked).
 */
async function currentShareConsentInTx(
  tx: Db,
  deps: ApiDependencies,
  session: FlowSession,
  stepId: string,
): Promise<{ facts: ShareConsentFacts; positioned: FlowAdvance[] }> {
  const { environmentId, inquiryId } = session;
  await lockInquiry(tx, environmentId, inquiryId);
  const locked = await assertInquiryOpenUnderLock(tx, environmentId, inquiryId);
  // C151.14: an inquiry the engine never positioned is positioned first.
  const positioned =
    locked.flowStepId === null
      ? [await positionFlowInTx(tx, deps, { environmentId, inquiryId })]
      : [];
  const inquiry = await findInquiry(tx, environmentId, inquiryId);
  const pinned = await pinnedFlowOf(tx, inquiry);
  const step = pinned?.flow.steps.find((candidate) => candidate.id === stepId);
  if (
    inquiry.flowStepId !== stepId ||
    inquiry.flowState !== 'active' ||
    step?.type !== 'share_consent'
  ) {
    throw flowStepNotCurrent();
  }
  const facts = await shareConsentFacts(tx, {
    inquiry,
    step,
    locale: await shareConsentSessionLocale(tx, inquiry, session.id),
  });
  if (facts === null) {
    throw flowStepNotCurrent();
  }
  return { facts, positioned };
}

/** Leaves the `share_consent` step through `next` with `outcome` (C238.1: both acts continue). */
async function leaveShareConsentInTx(
  tx: Db,
  deps: ApiDependencies,
  session: FlowSession,
  stepId: string,
  outcome: 'accepted' | 'declined',
): Promise<FlowAdvance> {
  const ctx = await loadEngine(tx, deps, {
    environmentId: session.environmentId,
    inquiryId: session.inquiryId,
  });
  const entry = ctx === null ? null : currentEntry(ctx);
  if (ctx === null || entry?.stepId !== stepId || ctx.inquiry.flowState !== 'active') {
    return { staged: [], after: [] };
  }
  await leaveEntry(ctx, entry, 'next', outcome);
  await moveOn(ctx, stepId, 'next');
  return advanceOf(ctx);
}

/** C238.4: the digests and the tick, against what the view at this position serves. */
function checkAcceptance(facts: ShareConsentFacts, body: FlowShareConsentAcceptBody): void {
  const { view } = facts;
  if (body['text-sha256'] !== view.text.sha256) {
    throw mismatch();
  }
  const biometricDigest = body['biometric-text-sha256'];
  if (view.biometric === undefined) {
    if (biometricDigest !== undefined) {
      throw mismatch();
    }
    return;
  }
  if (!body['explicit-biometric']) {
    throw new ConnectProblemError(
      'explicit_consent_required',
      'This share carries biometric data: tick its own box to agree, or decline.',
    );
  }
  if (biometricDigest !== view.biometric.sha256) {
    throw mismatch();
  }
}

/** Dispatches what the exit staged and runs the advances' after-commit work. */
async function afterCommit(
  deps: ApiDependencies,
  staged: readonly StagedEvent[],
  advances: readonly FlowAdvance[],
): Promise<void> {
  await deps.events.dispatch(staged);
  for (const advance of advances) {
    await deps.events.dispatch(advance.staged);
    await runFlowAfterCommit(advance);
  }
}

/** The person's act on a `share_consent` step: an accept with its body and evidence, or a decline. */
export type ShareConsentAct =
  | { outcome: 'accepted'; body: FlowShareConsentAcceptBody; evidence: ActEvidence }
  | { outcome: 'declined' };

/**
 * C236.4, C236.11, C238.4: the person's act on the current step, in one transaction. On the
 * destination side an accept also requests the `fill-inquiry` redemption into this inquiry
 * (`api-redeem`'s `requestFillInquiryRedemptionInTx`, through `redemption`, `cross-tenant.ts` by
 * default) and enqueues its job after the commit.
 */
export async function actOnShareConsent(
  deps: ApiDependencies,
  session: FlowSession,
  stepId: string,
  act: ShareConsentAct,
  redemption: RedemptionCrossTenant = redemptionCrossTenant,
): Promise<void> {
  const { staged, advances, job } = await deps.db.transaction(async (tx) => {
    const { facts, positioned } = await currentShareConsentInTx(tx, deps, session, stepId);
    if (act.outcome === 'accepted') {
      checkAcceptance(facts, act.body);
    }
    const accepted = act.outcome === 'accepted';
    const { view } = facts;
    const recorded = await recordFlowConsentInTx(tx, deps, {
      environmentId: session.environmentId,
      side: view.side,
      outcome: act.outcome,
      inquiryId: session.inquiryId,
      sessionId: session.id,
      connectionId: facts.connectionId,
      shareTokenId: facts.token?.id ?? null,
      recipientOrganizationId: facts.recipientOrganizationId,
      recipientName: view.recipientName,
      categories: view.categories,
      explicitBiometric: accepted && view.biometric !== undefined,
      text: { ...view.text, body: facts.bodies.text },
      biometric:
        view.biometric === undefined || facts.bodies.biometric === null
          ? null
          : { sha256: view.biometric.sha256, body: facts.bodies.biometric },
      ip: accepted ? act.evidence.ip : null,
      userAgent: accepted ? act.evidence.userAgent : null,
      validSeconds: facts.validSeconds,
      now: deps.clock.now(),
    });
    let job: ConnectRedeemJob | null = null;
    if (accepted && view.side === 'destination' && facts.token !== null) {
      const environment = await getEnvironment(tx, session.environmentId);
      if (environment === null) {
        throw flowStepNotCurrent();
      }
      ({ job } = await requestFillInquiryRedemptionInTx(
        tx,
        {
          deps,
          caller: {
            organizationId: environment.organizationId,
            environmentId: environment.id,
            environmentKind: environment.kind,
          },
          actor: null,
          request: {
            'share-token-id': facts.token.id,
            'inquiry-id': session.inquiryId,
            'destination-consent-record-id': recorded.record.id,
          },
          now: deps.clock.now(),
        },
        redemption,
      ));
    }
    const left = await leaveShareConsentInTx(tx, deps, session, stepId, act.outcome);
    return { staged: [recorded.staged], advances: [...positioned, left], job };
  });
  await afterCommit(deps, staged, advances);
  if (job !== null) {
    await enqueueRedemption(deps, job);
  }
}

/** C237.6: the withdraw exit, for a step this session accepted and has not withdrawn. */
async function withdrawInFlow(
  deps: ApiDependencies,
  session: FlowSession,
  stepId: string,
): Promise<void> {
  const staged = await deps.db.transaction(async (tx) => {
    const inquiry = await findInquiry(tx, session.environmentId, session.inquiryId);
    const pinned = await pinnedFlowOf(tx, inquiry);
    const records = (
      await listSessionShareConsents(tx, session.environmentId, session.id, 20)
    ).filter((record) => record.subjectType === 'inquiry' && record.subjectId === inquiry.id);
    const record = records.find(
      (candidate) => shareConsentStepOf(pinned?.flow.steps ?? [], candidate)?.id === stepId,
    );
    if (record === undefined) {
      throw flowStepNotCurrent();
    }
    return (
      await withdrawConsentRecordInTx(tx, deps, {
        environmentId: session.environmentId,
        id: record.id,
        via: 'flow',
        reason: null,
        actor: { kind: 'flow' },
      })
    ).staged;
  });
  await deps.events.dispatch(staged);
}

/** The session after an exit, in the spec version the client declared (C151.7). */
async function answer(
  deps: ApiDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
  session: FlowSession,
) {
  const declared = request.headers[FLOW_SPEC_HEADER.toLowerCase()];
  const served = await getFlowSession(deps, session, {
    specVersions: parseFlowSpecHeader(typeof declared === 'string' ? declared : undefined),
  });
  void reply.header(FLOW_SPEC_HEADER, String(served['spec-version'] ?? 1));
  return served;
}

/** C237.6, C238.4 share-consent exits, under `/api/v1/flow`. */
export const shareConsentRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.addHook('onRequest', connectSwitchHook(deps.connect));

  app.post(
    '/share-consents/:stepId/accept',
    {
      schema: {
        summary: 'Accept a share consent',
        description:
          'C238.4: the person’s affirmative act on the `share_consent` step at this position, ' +
          'with the digests of the texts shown (422 `consent_text_mismatch`) and the separate ' +
          'biometric tick when the share carries it (422 `explicit_consent_required`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: flowShareConsentParamsSchema,
        body: flowShareConsentAcceptBodySchema,
        response: {
          200: flowSessionResponseSchema,
          ...problemResponses(400, 401, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const session = requireFlowSession(request);
      await actOnShareConsent(deps, session, request.params.stepId, {
        outcome: 'accepted',
        body: request.body,
        evidence: evidenceOf(request),
      });
      return answer(deps, request, reply, session);
    },
  );

  app.post(
    '/share-consents/:stepId/decline',
    {
      schema: {
        summary: 'Decline a share consent',
        description:
          'C238.1, C236.11: a declined record; the flow continues on the step’s next port.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: flowShareConsentParamsSchema,
        body: flowShareConsentDeclineBodySchema,
        response: {
          200: flowSessionResponseSchema,
          ...problemResponses(400, 401, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const session = requireFlowSession(request);
      await actOnShareConsent(deps, session, request.params.stepId, { outcome: 'declined' });
      return answer(deps, request, reply, session);
    },
  );

  app.post(
    '/share-consents/:stepId/withdraw',
    {
      schema: {
        summary: 'Withdraw a share consent',
        description:
          'C237.6: a step listed in `withdrawable-share-consents` (else 409 ' +
          '`flow_step_not_current`); `withdrawn-via: flow`, the same effects as the API’s ' +
          'withdrawal, and the position does not move.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: flowShareConsentParamsSchema,
        body: flowShareConsentWithdrawBodySchema,
        response: {
          200: flowSessionResponseSchema,
          ...problemResponses(400, 401, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const session = requireFlowSession(request);
      await withdrawInFlow(deps, session, request.params.stepId);
      return answer(deps, request, reply, session);
    },
  );

  done();
};
