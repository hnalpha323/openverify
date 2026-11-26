/**
 * C211.1, C211.3 (Workflow 10B, `api-integrity`): the integrity challenge and the token post, and
 * the one rule both routes and the session's `integrity` member share: whether the session asks for a
 * token. It does when
 * - the environment kind binds a `deviceIntegrity` provider (off by default: an unbound provider
 *   means no request, C211.1);
 * - the session may collect the session-integrity tier: its consent showed
 *   `notice.session-integrity` and the environment's setting is on (C94.6; `collectionTiersOf`, as
 *   `POST /flow/signals` decides it);
 * - that same consent showed `notice.play-integrity`, the notice that names Google as a recipient
 *   (C211.9; Workflow 10D review A001). Publish requires the notice only while a provider is bound,
 *   so a version published before the binding, and every v1 flow, can lack it: the rule is applied
 *   here on every read, and such a session is never asked;
 * - the inquiry is in progress (`created` or `pending`; a decided inquiry reads nothing about the
 *   device) and not redacted;
 * - the inquiry has no verdict and took no token yet (one request per inquiry, C211.3; decision 34).
 *
 * The challenge's `request-hash` is computed here, never by the device (base64url, unpadded, of
 * SHA-256 over `openverify/play-integrity/v1\n`, the session id and `\n`, then 16 random bytes), and
 * expires 600 s after it is drawn. A token is taken once, for the session's open challenge, under the
 * inquiry's lock, sealed for the challenge's row; the `integrity-decode` job is enqueued with ids only
 * after the commit (C211.4). Nothing here logs, echoes or serves the token.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  PLAY_INTEGRITY_NOTICE_TEXT_KEY,
  QUEUE_IN_FLIGHT_CAP,
  type FlowIntegrityChallenge,
  type FlowIntegrityTokenBody,
} from '@openverify/contracts';
import {
  createInquiryIntegrityChallengeInTx,
  getEffectiveConsent,
  getEnvironment,
  getInquiry,
  getInquiryIntegrityVerdict,
  getInquiryTemplateVersion,
  inquiryIntegrityTokenTaken,
  lockInquiry,
  storeInquiryIntegrityTokenInTx,
  type Db,
} from '@openverify/db';
import type { FlowSession } from '../../auth/flow-session.js';
import { AppError } from '../../errors.js';
import type { EnvironmentKind } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { admitEnvironment } from '../quotas/admission.js';
import { createQuotaAdmissionDeps, queueRowsOf } from '../quotas/queue-rows.js';
import { collectionTiersOf } from '../signals/flow-session.js';
import { storedFlowView } from '../stored-flow.js';

/** C211.3: a challenge's lifetime. */
export const INTEGRITY_CHALLENGE_TTL_SECONDS = 600;

/** C211.3: the domain separator the request hash starts with. */
export const INTEGRITY_REQUEST_HASH_CONTEXT = 'openverify/play-integrity/v1';

/** C211.3: the random bytes of each challenge. */
export const INTEGRITY_CHALLENGE_NONCE_BYTES = 16;

/** The inquiry statuses in which the flow still runs (the person's part is not done). */
const IN_PROGRESS: ReadonlySet<string> = new Set(['created', 'pending']);

/** C221.6: the one answer for a challenge the session may not use (golden `problems/flow/`). */
export class IntegrityChallengeInvalidError extends AppError {
  override name = 'IntegrityChallengeInvalidError';

  constructor() {
    super({
      status: 409,
      detail:
        'The integrity challenge is unknown, used or expired; the session may ask for a new one.',
      code: 'integrity_challenge_invalid',
    });
  }
}

/** C211.3: base64url (no padding) of SHA-256 over the context, the session id and the nonce. */
export function integrityRequestHash(sessionId: string, nonce: Uint8Array): string {
  return createHash('sha256')
    .update(`${INTEGRITY_REQUEST_HASH_CONTEXT}\n`)
    .update(`${sessionId}\n`)
    .update(nonce)
    .digest('base64url');
}

/** What decides whether a session asks for a token. */
export interface IntegrityRequestQuery {
  environmentId: string;
  environmentKind: EnvironmentKind;
  inquiryId: string;
  /** Whether the session may collect the session-integrity tier (C94.6). */
  sessionIntegrity: boolean;
  /** Whether the consent the session relies on showed the notice naming Google (C211.9). */
  playIntegrityNotice: boolean;
}

/** C211.9: whether a consent that showed `textKeys` told the person that Google receives a request. */
export function playIntegrityNoticeShown(textKeys: readonly string[] | null | undefined): boolean {
  return textKeys?.includes(PLAY_INTEGRITY_NOTICE_TEXT_KEY) === true;
}

/** C211.1, C211.3: whether the session asks the device for a token now (see the module comment). */
export async function integrityRequested(
  deps: Pick<ApiDependencies, 'db' | 'providers'>,
  query: IntegrityRequestQuery,
): Promise<boolean> {
  if (deps.providers[query.environmentKind].deviceIntegrity === undefined) {
    return false;
  }
  if (!query.sessionIntegrity || !query.playIntegrityNotice) {
    return false;
  }
  const inquiry = await getInquiry(deps.db, query.environmentId, query.inquiryId);
  if (inquiry?.redactedAt !== null || !IN_PROGRESS.has(inquiry.status)) {
    return false;
  }
  if (await inquiryIntegrityTokenTaken(deps.db, query.environmentId, query.inquiryId)) {
    return false;
  }
  return (await getInquiryIntegrityVerdict(deps.db, query.environmentId, query.inquiryId)) === null;
}

/** What the session's consent allows: the session-integrity tier (C94.6) and the notice (C211.9). */
async function sessionIntegrityConsent(
  db: Db,
  session: FlowSession,
): Promise<Pick<IntegrityRequestQuery, 'sessionIntegrity' | 'playIntegrityNotice'>> {
  const none = { sessionIntegrity: false, playIntegrityNotice: false };
  const environment = await getEnvironment(db, session.environmentId);
  const inquiry = await getInquiry(db, session.environmentId, session.inquiryId);
  if (environment === null || inquiry === null) {
    return none;
  }
  const version = await getInquiryTemplateVersion(
    db,
    session.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const consent = await getEffectiveConsent(db, {
    environmentId: session.environmentId,
    inquiryId: inquiry.id,
    sessionId: session.id,
  });
  if (version === null || consent === null) {
    return none;
  }
  const tiers = collectionTiersOf(environment.settings, storedFlowView(version.flow), {
    acceptedAt: consent.acceptedAt,
    textKeys: consent.textKeys,
    optionalTextKeys: consent.optionalTextKeys ?? [],
  });
  return {
    sessionIntegrity: tiers?.integrity === true,
    playIntegrityNotice: playIntegrityNoticeShown(consent.textKeys),
  };
}

/**
 * `POST /flow/integrity-challenges` (C211.3): a challenge for the session's token.
 * @throws {IntegrityChallengeInvalidError} 409 when the session does not ask for a token.
 */
export async function createIntegrityChallenge(
  deps: ApiDependencies,
  session: FlowSession,
): Promise<FlowIntegrityChallenge> {
  const environment = await getEnvironment(deps.db, session.environmentId);
  if (environment === null) {
    throw new IntegrityChallengeInvalidError();
  }
  const asks = await integrityRequested(deps, {
    environmentId: session.environmentId,
    environmentKind: environment.kind,
    inquiryId: session.inquiryId,
    ...(await sessionIntegrityConsent(deps.db, session)),
  });
  if (!asks) {
    throw new IntegrityChallengeInvalidError();
  }
  const createdAt = deps.clock.now();
  const challenge = await createInquiryIntegrityChallengeInTx(deps.db, session.environmentId, {
    id: deps.ids.newId('ich'),
    inquiryId: session.inquiryId,
    sessionId: session.id,
    requestHash: integrityRequestHash(session.id, randomBytes(INTEGRITY_CHALLENGE_NONCE_BYTES)),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + INTEGRITY_CHALLENGE_TTL_SECONDS * 1000),
  });
  return {
    id: challenge.id,
    'request-hash': challenge.requestHash,
    'expires-at': challenge.expiresAt.toISOString(),
  };
}

/**
 * `POST /flow/integrity-tokens` (C211.3, C211.4): takes the token for the session's open challenge,
 * then enqueues its decode (ids only) after the commit.
 * @throws {IntegrityChallengeInvalidError} 409 for a challenge unknown, used, expired or another
 *   session's, or once the inquiry took a token or was redacted.
 */
export async function acceptIntegrityToken(
  deps: ApiDependencies,
  session: FlowSession,
  body: FlowIntegrityTokenBody,
): Promise<void> {
  const { environmentId, inquiryId } = session;
  const challengeId = body['challenge-id'];
  const outcome = await deps.db.transaction(async (tx) => {
    await lockInquiry(tx, environmentId, inquiryId);
    const inquiry = await getInquiry(tx, environmentId, inquiryId);
    if (inquiry?.redactedAt !== null) {
      return 'invalid' as const;
    }
    return storeInquiryIntegrityTokenInTx(tx, environmentId, {
      challengeId,
      sessionId: session.id,
      token: body.token,
      now: deps.clock.now(),
    });
  });
  if (outcome !== 'stored') {
    throw new IntegrityChallengeInvalidError();
  }
  // KP10-27, C251.1 (Workflow 11B, quotas' named borrowed edit): the decode is admitted under the
  // environment's integrity-decode cap before it is enqueued (oldest held challenge first). At the cap,
  // or when the enqueue fails, the challenge stays held (its token kept) and the worker's quota sweep
  // admits it when a slot frees; an admitted challenge whose job was lost is enqueued again by the
  // quota recovery. The answer is 202 either way: the token is stored.
  const producer = deps.integrityDecodes;
  if (producer !== undefined) {
    await admitEnvironment(
      createQuotaAdmissionDeps({
        db: deps.db,
        clock: deps.clock,
        logger: SILENT_LOGGER,
        limits: { ceiling: deps.queueInFlightCapMax ?? QUEUE_IN_FLIGHT_CAP.ceilingDefault },
      }),
      queueRowsOf('integrity-decode'),
      (job) => producer.enqueueIntegrityDecode(job),
      environmentId,
    );
  }
}

/** The request's admission logs nothing: the worker's quota sweep logs the queue's metrics. */
const SILENT_LOGGER = { info: () => undefined, warn: () => undefined, error: () => undefined };
