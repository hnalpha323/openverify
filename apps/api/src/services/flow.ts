/**
 * The flow API (contract C3): what the hosted flow and Android do on behalf of the end user,
 * always within the one inquiry their session is bound to. Responses show the flow and the
 * user's progress, never the template's check configuration or fraud check details.
 */
import { createHash } from 'node:crypto';
import {
  SELFIE_CAPTURE_LIMIT,
  SELFIE_CAPTURE_TTL_SECONDS,
  SELFIE_POSE_FILE_KINDS,
  detectUploadMimeType,
  maxUploadBytes,
  fileKindSchema,
  fromApiVerificationType,
  isFileKindAllowed,
  stepForVerificationType,
  stepMaxAttempts,
  toApiVerificationType,
  toTimestamp,
  verificationConfigSchema,
  type CreateFlowVerificationBody,
  type CreateSelfieCaptureBody,
  type FileKind,
  type FileResource,
  type FlowConsentBody,
  type FlowSelfieCaptureDocument,
  type FlowSessionResponse,
  type FlowSubmitVerificationBody,
  type FlowVerificationResource,
  type SupportedVerificationType,
} from '@openverify/contracts';
import {
  countSelfieCaptures,
  createSelfieCapture,
  createVerification as insertVerification,
  encryptBytes,
  getEnvironment,
  getInquiryTemplateVersion,
  getEffectiveConsent,
  listInquiryVerifications,
  listSelfieCaptures,
  listVerificationFiles,
  lockInquiry,
  lockSelfieCapture,
  lockVerification,
  recordInquirySessionConsent,
  replaceVerificationFile,
  resolveFaceTemplateSettings,
  type ConsentHolder,
  type Db,
  type EnvironmentSettings,
  type Inquiry,
  type InquiryTemplateVersion,
  type LockedSelfieCapture,
  type ReplacedVerificationFile,
  type VerificationWithChecks,
} from '@openverify/db';
import type { FileCaptureMethod, FileCaptureTrigger } from '@openverify/core';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import type { FlowSession } from '../auth/flow-session.js';
import {
  BadRequestError,
  ConflictError,
  SandboxOnlyError,
  UnauthorizedError,
  UnprocessableContentError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from '../errors.js';
import { isRunnableVerificationType } from '../jobs/types/index.js';
import { newStorageKey } from '../storage/index.js';
import { loadVerificationAttributes } from './attributes/index.js';
import { deleteRenditionsForFilesInTx } from './cases/attachments/renditions.js';
import { submitGuardFor } from './submit/index.js';
import { assertNotCreatedByServer } from './submit/stub.js';
import type { ApiDependencies } from './context.js';
import {
  assertInquiryOpenUnderLock,
  openInquiry,
  sessionVerification,
} from './flow-preconditions.js';
import { findInquiry, startInquiry, transitionInquiryInTx } from './inquiries.js';
import { flowDecisionContestRouteOf } from './decisions/contest-route.js';
import { flowSessionHandoffOf } from './handoff/flow-session.js';
import { flowSessionSignalsOf } from './signals/flow-session.js';
import { fileResource, flowVerificationResource, verificationResource } from './resources.js';
import { storedFlowView } from './stored-flow.js';
import { advanceFlowInTx, runFlowAfterCommit } from '../flow-engine/advance.js';
import { assertCurrentStepInTx } from '../flow-engine/current-step.js';
import { flowSessionMembers, prepareFlowSessionInTx } from '../flow-engine/session.js';
import { checkConsentTextsInTx } from './templates/consent-texts.js';
import { resolveCopyForSession } from './templates/copy.js';
import { resolveThemeForSession } from './themes/resolve.js';
import { integritySessionMember } from './device-integrity/session-member.js';
import { embedPolicyFor, redirectUrlFor } from './embed-origins.js';
import { countedVerifications } from './connect/cloned-results.js';
import {
  deleteObjects,
  errorOpenSelfieCaptureInTx,
  newSelfieCaptureNonce,
  nonceMatches,
  SelfieCaptureConflictError,
  selfieCaptureInvalid,
  selfieCaptureGuidance,
  selfieCapturePrompts,
  stageSelfieEvent,
  type ErroredCaptures,
} from './selfie-captures.js';
import {
  fileIdsByVerification,
  moveVerification,
  stageVerificationEvent,
} from './verifications.js';

type ConsentStep = Extract<FlowStep, { type: 'consent' }>;
type SelfieStep = Extract<FlowStep, { type: 'selfie' }>;

/** What a refused upload is told, by the family of its kind (C52.4). */
const UNSUPPORTED_CONTENT = {
  image: 'The file must be a JPEG, PNG or WebP image.',
  document: 'The file must be a JPEG, PNG or WebP image or a PDF.',
  chip: 'The file must be the data group or file the chip stores for this kind.',
} as const;

const contentFamily = (kind: FileKind): keyof typeof UNSUPPORTED_CONTENT =>
  kind === 'document' ? 'document' : kind.startsWith('chip-') ? 'chip' : 'image';

/** The file kinds of the selfie poses (C40.3). */
const SELFIE_FILE_KINDS: ReadonlySet<string> = new Set(Object.values(SELFIE_POSE_FILE_KINDS));

/** Longest user agent kept with a consent record. */
const MAX_USER_AGENT_LENGTH = 512;

/** The template version the inquiry pinned when it was created: its flow and config. */
async function pinnedVersionOf(
  { db }: ApiDependencies,
  inquiry: Inquiry,
): Promise<{ flow: Flow; verificationConfig: unknown; version: InquiryTemplateVersion }> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  return {
    flow: storedFlowView(version.flow),
    verificationConfig: version.verificationConfig,
    version,
  };
}

/** The flow the inquiry pinned when it was created (its template version). */
async function flowOf(deps: ApiDependencies, inquiry: Inquiry): Promise<Flow> {
  return (await pinnedVersionOf(deps, inquiry)).flow;
}

/**
 * The flow view of `row` (C52.2): its type's guidance from the inquiry's pinned step and
 * configuration, read with `db` (the request's database or the answering transaction).
 */
async function flowViewOf(
  deps: ApiDependencies,
  db: Db,
  pinned: { flow: Flow; verificationConfig: unknown },
  row: VerificationWithChecks,
): Promise<FlowVerificationResource> {
  const config = verificationConfigSchema.safeParse(pinned.verificationConfig);
  return flowVerificationResource(
    deps,
    db,
    row,
    stepForVerificationType(pinned.flow, row.type),
    config.success ? config.data[toApiVerificationType(row.type)] : undefined,
  );
}

/** The flow view of `row`, of the inquiry the session is bound to. */
async function flowViewFor(
  deps: ApiDependencies,
  inquiry: Inquiry,
  row: VerificationWithChecks,
): Promise<FlowVerificationResource> {
  return flowViewOf(deps, deps.db, await pinnedVersionOf(deps, inquiry), row);
}

const label = (type: SupportedVerificationType) => toApiVerificationType(type);

/** C94.6 (Workflow 7A, V03): the inquiry and the flow session a consent gate asks about. */
export const consentHolderOf = (session: FlowSession): ConsentHolder => ({
  environmentId: session.environmentId,
  inquiryId: session.inquiryId,
  sessionId: session.id,
});

/** C151.7: what the request declared; the session is the same otherwise. */
export interface FlowSessionOptions {
  /** The flow-spec versions of `OpenVerify-Flow-Spec` (`parseFlowSpecHeader`); `[1]` when absent. */
  specVersions?: readonly number[] | undefined;
}

/**
 * `GET /flow/session`. The first call moves the inquiry to `pending` (`inquiry.started`).
 * `environment.kind` (C19) lets the flow show its sandbox banner and upload fallback.
 */
export async function getFlowSession(
  deps: ApiDependencies,
  session: FlowSession,
  options: FlowSessionOptions = {},
): Promise<FlowSessionResponse> {
  const { db } = deps;
  // C151.14, C150.5 (Workflow 9A): under the inquiry's lock, the position starts (`created ->
  // pending` included) or is replayed for an inquiry the engine never positioned, and a wait the
  // poll finds over ends; `startInquiry` then starts an inquiry whose flow cannot be walked.
  const prepared = await db.transaction(async (tx) => {
    await lockInquiry(tx, session.environmentId, session.inquiryId);
    return prepareFlowSessionInTx(
      tx,
      deps,
      { environmentId: session.environmentId, inquiryId: session.inquiryId },
      session.id,
    );
  });
  await deps.events.dispatch(prepared.staged);
  await runFlowAfterCommit(prepared);
  const inquiry = await startInquiry(
    deps,
    await findInquiry(db, session.environmentId, session.inquiryId),
  );
  const verifications = await listInquiryVerifications(db, session.environmentId, inquiry.id);
  // C94.6 (Workflow 7A, V03): the session's own consent where a handoff created it.
  const consent = await getEffectiveConsent(db, consentHolderOf(session));
  const environment = await getEnvironment(db, session.environmentId);
  if (environment === null) {
    throw new Error(`Environment ${session.environmentId} of a flow session is missing`);
  }
  const pinned = await pinnedVersionOf(deps, inquiry);
  const views: FlowVerificationResource[] = [];
  for (const verification of verifications) {
    views.push(await flowViewOf(deps, db, pinned, verification));
  }
  // C94.6 (Workflow 7A, P14): the collection tiers, `null` until the session may collect.
  const signals = await flowSessionSignalsOf({
    db,
    session,
    inquiry,
    flow: pinned.flow,
    environment,
    consent:
      consent === null
        ? null
        : {
            acceptedAt: consent.acceptedAt,
            textKeys: consent.textKeys,
            optionalTextKeys: consent.optionalTextKeys ?? [],
          },
  });
  // C96.3 (Workflow 7A; F01, F30): the handoff step's state and a redeemed session's context.
  const { handoff, handoffContext } = await flowSessionHandoffOf({
    db,
    session,
    inquiry,
    flow: pinned.flow,
    environment,
    now: deps.clock.now(),
  });
  // C162.6, C160.7 (Workflow 9A Stage 1b (T)): the operator copy (`api-templates`) and the theme
  // (`api-themes`, 9B) the session carries; each member is left out while its hook answers `null`.
  const copy = await resolveCopyForSession(db, {
    inquiry,
    version: pinned.version,
    stepId: inquiry.flowStepId,
  });
  const theme = await resolveThemeForSession(db, { inquiry, version: pinned.version });
  // C211.3 (Workflow 10B Stage 1b (I)): whether the SDK takes a challenge and posts a token
  // (`api-integrity`'s); left out while the hook answers `null`.
  const integrity = await integritySessionMember(deps, {
    environmentId: inquiry.environmentId,
    environmentKind: environment.kind,
    inquiryId: inquiry.id,
    sessionId: session.id,
    signals,
    consentTextKeys: consent?.textKeys ?? null,
  });
  // C128.7 (P40): how the person contests a decline. Left out of everything else.
  const contestRoute =
    inquiry.status === 'declined'
      ? await flowDecisionContestRouteOf(db, inquiry.environmentId, inquiry.id)
      : null;
  // C151.5-C151.7 (Workflow 9A): the server's position and the v1 projection; an inquiry the
  // engine never positioned (a decided one from before Phase 9) keeps its version's v1 view.
  const members = await flowSessionMembers(db, {
    inquiry,
    specVersions: options.specVersions ?? [1],
    consentRecorded: consent !== null,
    // C207.2, C208.2 (Workflow 10C): for an `nfc` step's members (`services/flow-views/nfc.ts`).
    sessionId: session.id,
    environmentKind: environment.kind,
    // Workflow 11A Stage 1b (R): the time a cloned verification is judged at (C235.4).
    now: deps.clock.now(),
  });
  // C159.4: the origins the embed bridge accepts a hello from, the flow server's own list (C157.2);
  // C158.5: the completion redirect, checked against the current lists on every read.
  const embedOrigins = (await embedPolicyFor(db, inquiry.id))?.['frame-ancestors'] ?? [];
  const redirectUrl = await redirectUrlFor(db, {
    inquiry,
    environmentKind: environment.kind,
    status: inquiry.status,
  });
  return {
    inquiry: { id: inquiry.id, status: inquiry.status },
    ...(members ?? { flow: pinned.flow }),
    verifications: views,
    consent: consent === null ? null : { 'accepted-at': toTimestamp(consent.acceptedAt) },
    environment: { kind: environment.kind },
    signals,
    handoff,
    'handoff-context': handoffContext,
    ...(contestRoute === null ? {} : { 'decision-contest-route': contestRoute }),
    ...(theme === null ? {} : { theme }),
    ...(integrity === null ? {} : { integrity }),
    ...(copy === null ? {} : { copy }),
    embed: { 'allowed-origins': [...embedOrigins] },
    completion: { 'redirect-url': redirectUrl },
    // C42.3, C42.6: fills `{{days}}` in the optional matching consent text.
    'face-template-retention-days': resolveFaceTemplateSettings(environment.settings)[
      'face-template-retention-days'
    ],
    // C200.2, C221.12 (Workflow 10A): fills `{organization}`, NFC-normalised, `null` until set.
    'organization-display-name': servedOrganizationDisplayName(environment.settings),
  };
}

/** C200.2: the environment's display name as a client fills it into copy: NFC, or `null`. */
function servedOrganizationDisplayName(settings: EnvironmentSettings): string | null {
  const name = settings['organization-display-name'];
  return typeof name === 'string' ? name.normalize('NFC') : null;
}

export interface ClientDetails {
  ip: string;
  userAgent: string | undefined;
}

/**
 * C42.3: the keys of `body` that the pinned consent step does not list, required texts against
 * its `textKeys` and optional ones against its `optionalTextKeys`. Without a consent step, any
 * required key is accepted (as before Phase 4) and no optional key is.
 */
function unlistedConsentKeys(step: ConsentStep | undefined, body: FlowConsentBody): string[] {
  const optional = new Set(step?.optionalTextKeys ?? []);
  const required = new Set(step?.textKeys ?? []);
  return [
    ...(step === undefined ? [] : body['text-keys'].filter((key) => !required.has(key))),
    ...(body['optional-text-keys'] ?? []).filter((key) => !optional.has(key)),
  ];
}

/**
 * `POST /flow/consent`: records the consent on the session with the client address and user
 * agent (both encrypted at rest). The texts shown must include every consent text of the flow,
 * and every key, required or optional, must be one the pinned consent step lists (C42.3); the
 * optional texts ticked are recorded with it.
 */
export async function recordConsent(
  deps: ApiDependencies,
  session: FlowSession,
  body: FlowConsentBody,
  client: ClientDetails,
): Promise<{ consent: { 'accepted-at': string } }> {
  const inquiry = await openInquiry(deps, session);
  const consentStep = (await flowOf(deps, inquiry)).steps.find(
    (step): step is ConsentStep => step.type === 'consent',
  );
  const missing = (consentStep?.textKeys ?? []).filter((key) => !body['text-keys'].includes(key));
  if (missing.length > 0) {
    throw new UnprocessableContentError(
      `text-keys must include every consent text of the flow; missing: ${missing.join(', ')}.`,
    );
  }
  const unlisted = unlistedConsentKeys(consentStep, body);
  if (unlisted.length > 0) {
    throw new UnprocessableContentError(
      `The flow's consent step does not list these texts: ${unlisted.join(', ')}.`,
    );
  }
  const acceptedAt = deps.clock.now();
  const ref = { environmentId: session.environmentId, inquiryId: inquiry.id };
  // Workflow 9A Stage 1b (S): under the inquiry's row lock, so the flow engine's position is read and
  // moved by one writer: only the current step accepts consent (C151.4), and recorded consent is
  // that step's exit (C151.2).
  const recorded = await deps.db.transaction(async (tx) => {
    await lockInquiry(tx, session.environmentId, inquiry.id);
    await assertCurrentStepInTx(tx, ref, { kind: 'consent', stepId: consentStep?.id ?? null });
    // C162.9 (Workflow 9A Stage 1b (T)): the texts' digests against the stored texts (`api-templates`).
    await checkConsentTextsInTx(tx, { ...ref, sessionId: session.id }, body);
    const written = await recordInquirySessionConsent(tx, session.environmentId, session.id, {
      acceptedAt,
      textKeys: body['text-keys'],
      optionalTextKeys: body['optional-text-keys'] ?? [],
      locale: body.locale,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    });
    if (written === null) {
      return null;
    }
    return advanceFlowInTx(tx, deps, ref, { kind: 'consent-recorded', sessionId: session.id });
  });
  if (recorded === null) {
    throw new UnauthorizedError('The session token is not valid or has expired.', {
      error: 'invalid_token',
    });
  }
  await deps.events.dispatch(recorded.staged);
  await runFlowAfterCommit(recorded);
  return { consent: { 'accepted-at': toTimestamp(acceptedAt) } };
}

/**
 * `POST /flow/verifications`: a new attempt for a verification step of the flow, in status
 * `initiated`, written in one transaction with its `verification.created` event. A retry is allowed after a failure while
 * attempts remain; never while one is processing or has passed. While an attempt of the type
 * is still `initiated`, that one is returned instead of a new one, so a client that lost the
 * response, or a second tab, never leaves a stray attempt behind.
 *
 * The rules are read and applied under the inquiry's row lock (`lockInquiry`), so parallel
 * requests cannot together exceed `maxAttempts` or start two attempts.
 */
export async function createFlowVerification(
  deps: ApiDependencies,
  session: FlowSession,
  body: CreateFlowVerificationBody,
): Promise<FlowVerificationResource> {
  const inquiry = await openInquiry(deps, session);
  const type = fromApiVerificationType(body.type);
  const step = stepForVerificationType(await flowOf(deps, inquiry), type);
  if (step === undefined) {
    throw new UnprocessableContentError(`The flow has no ${body.type} step.`);
  }
  // C52.2, C59.6: the server creates the attempts of a silent AAMVA step.
  assertNotCreatedByServer(step);
  if (!isRunnableVerificationType(type)) {
    throw new UnprocessableContentError(`This server does not run ${body.type} verifications yet.`);
  }
  const country = body.type === 'government-id' ? body.country : undefined;
  const idClass = body.type === 'government-id' ? body['id-class'] : undefined;
  if (step.type === 'government_id') {
    if (country !== undefined && step.allowedCountries?.includes(country) === false) {
      throw new UnprocessableContentError('The flow does not accept IDs from this country.');
    }
    if (idClass !== undefined && step.allowedIdClasses?.includes(idClass) === false) {
      throw new UnprocessableContentError('The flow does not accept this ID class.');
    }
  }

  const { environmentId } = session;
  const { verification, staged } = await deps.db.transaction(async (tx) => {
    const status = await lockInquiry(tx, environmentId, inquiry.id);
    if (status !== 'created' && status !== 'pending') {
      throw new ConflictError(`The inquiry is already ${String(status)}.`);
    }
    // C151.4 (Workflow 9A Stage 1b (S)): only the current step's verification is created or reused.
    await assertCurrentStepInTx(
      tx,
      { environmentId, inquiryId: inquiry.id },
      { kind: 'verification', stepId: step.id, verificationType: type },
    );
    // C235.4, review H01 (integration-11a): a clone that does not count is not an attempt of this
    // step, so the step runs live beside it; one that counts stands for the step.
    const attempts = (
      await countedVerifications(
        tx,
        inquiry,
        await listInquiryVerifications(tx, environmentId, inquiry.id),
        deps.clock.now(),
      )
    ).filter((attempt) => attempt.type === type);
    if (attempts.some((attempt) => attempt.status === 'passed')) {
      throw new ConflictError(`The ${body.type} verification has already passed.`);
    }
    // C52.2: a skipped latest attempt is done, as a passed one is.
    if (attempts.at(-1)?.status === 'skipped') {
      throw new ConflictError(`The ${body.type} verification was skipped.`);
    }
    if (attempts.some((attempt) => attempt.status === 'submitted')) {
      throw new ConflictError(`A ${body.type} verification is still being processed.`);
    }
    // C50.7: an open attempt, `initiated` or (phone and email) `confirmed`, is returned.
    const open = attempts.find(
      (attempt) => attempt.status === 'initiated' || attempt.status === 'confirmed',
    );
    if (open !== undefined) {
      return { verification: open, staged: null };
    }
    if (attempts.length >= stepMaxAttempts(step)) {
      throw new ConflictError(`No ${body.type} attempts are left.`);
    }
    const inserted = await insertVerification(tx, environmentId, {
      id: deps.ids.newId('ver'),
      inquiryId: inquiry.id,
      type,
      country: country ?? null,
      idClass: idClass ?? null,
      // V02 (Workflow 7A): a rejected handoff finds what its phone session created.
      createdBySessionId: session.id,
    });
    const created: VerificationWithChecks = { ...inserted, checks: [] };
    const event = await deps.events.stage(tx, {
      environmentId,
      name: 'verification.created',
      payload: {
        data: verificationResource(created, [], {
          attributes: await loadVerificationAttributes(tx, created),
        }),
      },
    });
    return { verification: created, staged: event };
  });
  if (staged !== null) {
    await deps.events.dispatch([staged]);
  }
  return flowViewFor(deps, inquiry, verification);
}

/** One upload, as read from the multipart body. */
export interface Upload {
  kind: string;
  bytes: Uint8Array;
  /** C40.3: the capture a selfie pose belongs to, its nonce and the client's elapsed time. */
  capture?: { id: string; nonce: string; clientElapsedMs: number };
  /**
   * C153.2 (Workflow 9A): how the client reports it captured the file (`capture-method`); stored
   * as `files.capture_method`, client-reported and never a check's evidence. The multipart route
   * (`routes/flow/index.ts`, shared) does not read the field yet.
   */
  captureMethod?: FileCaptureMethod | undefined;
  /**
   * C206.2 (Workflow 10B): whether the shutter or the auto-capture took the photo
   * (`capture-trigger`), as received; stored as `files.capture_trigger`, client-reported (C206.3).
   */
  captureTrigger?: FileCaptureTrigger | undefined;
}

/**
 * C40.3: whether `capture` (read with its nonce digest, or `null` when the scoped lookup found
 * none) takes a pose of `kind` at `now`.
 * @throws {SelfieCaptureConflictError} `selfie_capture_invalid` for a wrong nonce or a foreign,
 *   superseded, consumed or expired capture, one body for all.
 * @throws {UnprocessableContentError} for a pose the capture did not prompt.
 */
function assertCaptureTakesPose(
  capture: LockedSelfieCapture | null,
  presented: { nonce: string },
  kind: FileKind,
  now: Date,
): void {
  const nonceOk = nonceMatches(capture?.nonceSha256 ?? null, presented.nonce);
  if (
    capture === null ||
    !nonceOk ||
    capture.status !== 'initiated' ||
    capture.expiresAt.getTime() <= now.getTime()
  ) {
    throw selfieCaptureInvalid();
  }
  if (!capture.prompts.some((pose) => SELFIE_POSE_FILE_KINDS[pose] === kind)) {
    throw new UnprocessableContentError(`The capture does not prompt for a ${kind} file.`);
  }
}

/**
 * `POST /flow/verifications/:id/files`. The state is checked first (the verification is the
 * session's and still `initiated`, the inquiry open, consent given); only then is the body
 * read with `read`. The image is typed by its magic bytes, sealed with its own data key
 * (`encryptBytes`, the file id as context) and stored under a random key.
 *
 * C40.3: a selfie pose of a verification that needs a capture (C40.7) names it with its nonce
 * and the client's elapsed time; the fields are refused for the other kinds. The capture is
 * checked before the object is stored and again when the row is written.
 *
 * The row is written in one transaction under the C40.6 lock order: the inquiry (re-checked
 * open and not redacted), the verification (re-checked `initiated`), then the capture (re-checked
 * `initiated` and unexpired at the server clock, so an upload racing a supersede is refused),
 * with `received_at` from the server clock inside it. While the verification is `initiated`, a
 * new file of a kind replaces the earlier one (last write wins), so a client that lost track of
 * its uploads, after a reload for example, can upload again.
 */
export async function uploadFile(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  read: () => Promise<Upload>,
): Promise<FileResource> {
  const { db, storage, clock } = deps;
  const environmentId = session.environmentId;
  const verification = await sessionVerification(deps, session, verificationId);
  const inquiry = await openInquiry(deps, session);
  if (verification.status !== 'initiated') {
    throw new ConflictError(
      `The verification is ${verification.status}; files can only be added before submitting.`,
    );
  }
  if ((await getEffectiveConsent(db, consentHolderOf(session))) === null) {
    throw new ConflictError('Consent is required before uploading files.');
  }

  const upload = await read();
  const type = verification.type;
  const kind = fileKindSchema.safeParse(upload.kind);
  if (!kind.success) {
    throw new BadRequestError('The kind field is not a known file kind.');
  }
  if (!isFileKindAllowed(type, kind.data)) {
    throw new UnprocessableContentError(
      `A ${label(type)} verification does not take ${kind.data} files.`,
    );
  }
  const isPose = SELFIE_FILE_KINDS.has(kind.data);
  if (upload.capture !== undefined && !isPose) {
    throw new BadRequestError('The capture fields belong to selfie poses only.');
  }
  if (upload.capture === undefined && isPose && verification.selfieCaptureRequired) {
    throw new SelfieCaptureConflictError(
      'selfie_capture_required',
      'A selfie pose names its capture: create one, then upload each pose with its id and nonce.',
    );
  }
  const capture = upload.capture;
  if (capture !== undefined) {
    assertCaptureTakesPose(
      await lockSelfieCapture(db, environmentId, verification.id, capture.id),
      capture,
      kind.data,
      clock.now(),
    );
  }
  // C52.4: typed per kind by its content, never by the client, and capped per kind.
  if (upload.bytes.byteLength > maxUploadBytes(kind.data)) {
    throw new PayloadTooLargeError(
      `A ${kind.data} file is at most ${String(maxUploadBytes(kind.data))} bytes.`,
    );
  }
  const mimeType = detectUploadMimeType(kind.data, upload.bytes);
  if (mimeType === null) {
    throw new UnsupportedMediaTypeError(UNSUPPORTED_CONTENT[contentFamily(kind.data)]);
  }

  const id = deps.ids.newId('file');
  const storageKey = newStorageKey(environmentId);
  const sealed = encryptBytes(upload.bytes, deps.keyring, { context: id });
  await storage.put(storageKey, sealed.ciphertext);
  let stored: (ReplacedVerificationFile & { renditionKeys: string[] }) | null;
  try {
    stored = await db.transaction(async (tx) => {
      await assertInquiryOpenUnderLock(tx, environmentId, inquiry.id);
      // C151.4 (Workflow 9A Stage 1b (S)): an upload only for the current step's verification.
      await assertCurrentStepInTx(
        tx,
        { environmentId, inquiryId: inquiry.id },
        { kind: 'upload', verificationId: verification.id, verificationType: verification.type },
      );
      if ((await lockVerification(tx, environmentId, verification.id))?.status !== 'initiated') {
        return null;
      }
      if (capture !== undefined) {
        assertCaptureTakesPose(
          await lockSelfieCapture(tx, environmentId, verification.id, capture.id),
          capture,
          kind.data,
          clock.now(),
        );
      }
      const replaced = await replaceVerificationFile(tx, environmentId, {
        id,
        verificationId: verification.id,
        kind: kind.data,
        storageKey,
        mimeType,
        byteSize: upload.bytes.byteLength,
        sha256: createHash('sha256').update(upload.bytes).digest('hex'),
        wrappedDek: sealed.wrappedDek,
        // C153.2 (Workflow 9A): client-reported, `null` when the client named none.
        captureMethod: upload.captureMethod ?? null,
        // C206.2 (Workflow 10B): client-reported, `null` when the client named none.
        captureTrigger: upload.captureTrigger ?? null,
        ...(capture === undefined
          ? {}
          : {
              selfieCaptureId: capture.id,
              clientElapsedMs: capture.clientElapsedMs,
              receivedAt: clock.now(),
            }),
      });
      if (replaced === null) {
        return null;
      }
      // C135.3 (Stage 1a amendment 9; `api-case-files`): the replaced file's rendition pages go
      // with it, their objects after the commit.
      const renditionKeys = await deleteRenditionsForFilesInTx(tx, {
        environmentId,
        fileIds: replaced.replaced.map((file) => file.id),
      });
      return { ...replaced, renditionKeys };
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  if (stored === null) {
    await storage.delete(storageKey).catch(() => undefined);
    throw new ConflictError(
      'The verification is no longer initiated; files can only be added before submitting.',
    );
  }
  // Best effort: a replaced object is unreadable anyway once its row (and data key) is gone.
  await deleteObjects(storage, [
    ...stored.replaced.map((replaced) => replaced.storageKey),
    ...stored.renditionKeys,
  ]);
  return fileResource(stored.file, verification, { clientReported: false });
}

/**
 * `POST /flow/verifications/:id/submit`: checks the files the flow step requires, moves the
 * verification to `submitted` and writes `verification.submitted` in one transaction, then
 * enqueues processing.
 *
 * C40.4: a selfie names its capture (`{ capture: { id, nonce, device? } }`), and one created
 * since Phase 4 must (409 `selfie_capture_required`, C40.7). In the same transaction, under the
 * C40.6 lock order (the inquiry, the verification, then the capture), the capture is checked
 * (`selfie_capture_invalid` for a wrong nonce or a foreign, superseded, consumed or expired
 * capture, one body for all) and complete (`selfie_capture_incomplete`), then consumed once
 * (`consumeSelfieCapture`, `status = 'initiated' AND expires_at > now`) with its device snapshot
 * sealed, and `selfie.submitted` is staged before `verification.submitted`.
 *
 * A repeated submit of a `submitted` verification only enqueues again (the queue is idempotent
 * per verification), so a client can retry after a failure without a second event; for a selfie
 * it must name the capture that submitted it. A verification whose type already passed is
 * refused: the inquiry is judged on its latest result.
 */
export async function submitVerification(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body?: FlowSubmitVerificationBody | null,
): Promise<FlowVerificationResource> {
  const { db, queue, events, clock } = deps;
  const environmentId = session.environmentId;
  let verification = await sessionVerification(deps, session, verificationId);
  const inquiry = await openInquiry(deps, session);
  const job = { environmentId, verificationId: verification.id };
  const type = verification.type;
  const guard = submitGuardFor(type);
  const step = stepForVerificationType(await flowOf(deps, inquiry), type);
  guard.checkBody({ verification, body: body ?? null, step });

  if (guard.submittableStatuses.includes(verification.status)) {
    if (step === undefined) {
      throw new UnprocessableContentError(`The flow has no ${label(type)} step.`);
    }
    const id = verification.id;
    const outcome = await db.transaction(async (tx) => {
      // The inquiry first, as verification creation and the inquiry's transitions take it
      // (2B F015): an inquiry that closed since `openInquiry` read it is refused.
      const current = await assertInquiryOpenUnderLock(tx, environmentId, inquiry.id);
      // C151.4 (Workflow 9A Stage 1b (S)): a submission only for the current step's verification.
      await assertCurrentStepInTx(
        tx,
        { environmentId, inquiryId: inquiry.id },
        { kind: 'submission', verificationId: id, verificationType: type },
      );
      const locked = await lockVerification(tx, environmentId, id);
      if (locked === null || !guard.submittableStatuses.includes(locked.status)) {
        return null;
      }
      // C235.4, H01 (integration-11a): only the verifications that count stand for the step.
      const siblings = await countedVerifications(
        tx,
        inquiry,
        await listInquiryVerifications(tx, environmentId, inquiry.id),
        clock.now(),
      );
      if (siblings.some((other) => other.type === type && other.status === 'passed')) {
        throw new ConflictError(`The ${label(type)} verification has already passed.`);
      }
      const now = clock.now();
      const prepared = await guard.inTransaction({
        deps,
        tx,
        session,
        inquiry: current,
        verification: { ...locked, checks: verification.checks },
        step,
        body: body ?? null,
        files: await listVerificationFiles(tx, environmentId, [id]),
        now,
      });
      const moved = await moveVerification(tx, locked, 'submitted', now);
      if (moved === null) {
        return null;
      }
      const updated: VerificationWithChecks = {
        ...moved.verification,
        checks: verification.checks,
      };
      const staged = [...prepared.staged];
      staged.push(
        await events.stage(tx, {
          environmentId,
          name: 'verification.submitted',
          payload: {
            data: verificationResource(
              updated,
              prepared.files.map((file) => file.id),
              { attributes: await loadVerificationAttributes(tx, updated) },
            ),
          },
        }),
      );
      return { updated, staged };
    });
    if (outcome !== null) {
      verification = outcome.updated;
      await events.dispatch(outcome.staged);
      await queue.enqueueProcessVerification(job);
      return flowViewFor(deps, inquiry, verification);
    }
    // Someone else submitted it meanwhile: answer as for a repeated submit.
    verification = await sessionVerification(deps, session, verificationId);
  }

  if (verification.status !== 'submitted') {
    throw new ConflictError(`The verification is already ${verification.status}.`);
  }
  await guard.repeat({ deps, verification, body: body ?? null });
  await queue.enqueueProcessVerification(job);
  return flowViewFor(deps, inquiry, verification);
}

/** `GET /flow/verifications/:id`: status and user-facing retry hints only. */
export async function getFlowVerification(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
): Promise<FlowVerificationResource> {
  const verification = await sessionVerification(deps, session, verificationId);
  const inquiry = await findInquiry(deps.db, session.environmentId, session.inquiryId);
  return flowViewFor(deps, inquiry, verification);
}

/**
 * C40.2 at the capture cap: errors the open capture (`canceled`), cancels the verification with
 * `verification.canceled`, and, when the step has no attempt left, fails the inquiry (C30.5,
 * `inquiry.failed`), all in `tx`. Returns what to dispatch and delete after commit.
 */
async function cancelAtCaptureLimit(
  tx: Db,
  deps: ApiDependencies,
  verification: VerificationWithChecks,
  inquiry: Inquiry,
  step: SelfieStep,
  now: Date,
): Promise<ErroredCaptures> {
  const { events } = deps;
  const { environmentId } = inquiry;
  const errored = await errorOpenSelfieCaptureInTx(
    tx,
    events,
    environmentId,
    verification.id,
    'canceled',
  );
  const staged = [...errored.staged];
  const moved = await moveVerification(tx, verification, 'canceled', now);
  if (moved === null) {
    // The verification row is locked, so only a change before the lock gets here.
    throw new ConflictError('The verification is no longer initiated.');
  }
  if (moved.event !== null) {
    const files = await fileIdsByVerification(tx, environmentId, [verification.id]);
    staged.push(
      await stageVerificationEvent(
        tx,
        events,
        moved.event,
        { ...moved.verification, checks: verification.checks },
        files.get(verification.id) ?? [],
      ),
    );
  }
  const attempts = (await listInquiryVerifications(tx, environmentId, inquiry.id)).filter(
    (attempt) => attempt.type === 'selfie',
  );
  if (attempts.length >= step.maxAttempts) {
    const failed = await transitionInquiryInTx(tx, deps, inquiry, 'failed');
    staged.push(...(failed?.staged ?? []));
  }
  return { staged, storageKeys: errored.storageKeys };
}

/**
 * `POST /flow/verifications/:id/selfies` (C40.2): a new selfie capture of the session's selfie
 * verification, with its prompts, a nonce (returned here once, stored as SHA-256), an expiry
 * `SELFIE_CAPTURE_TTL_SECONDS` from the injected clock and the guidance.
 *
 * Preconditions: consent recorded, the inquiry open (not redacted, not decided), the
 * verification a selfie in `initiated`; `upload` only in a sandbox (403 `sandbox-only`).
 *
 * In one transaction under the C40.6 lock order (the inquiry, re-checked, then the
 * verification): the open capture is errored (`superseded`, or `expired` once past its expiry)
 * with its file rows deleted and `selfie.errored`, then the new capture is written with
 * `selfie.created`. The deleted rows' objects are deleted after commit. The 11th create cancels
 * the verification instead (`cancelAtCaptureLimit`) and answers 409 `selfie_capture_limit`.
 */
export async function createFlowSelfieCapture(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body: CreateSelfieCaptureBody,
): Promise<FlowSelfieCaptureDocument> {
  const { db, events, clock, storage, ids } = deps;
  const { environmentId } = session;
  const verification = await sessionVerification(deps, session, verificationId);
  const inquiry = await openInquiry(deps, session);
  if (verification.type !== 'selfie') {
    throw new UnprocessableContentError('Only a selfie verification takes a selfie capture.');
  }
  if (verification.status !== 'initiated') {
    throw new ConflictError(
      `The verification is ${verification.status}; a capture can only start before submitting.`,
    );
  }
  if ((await getEffectiveConsent(db, consentHolderOf(session))) === null) {
    throw new ConflictError('Consent is required before a selfie capture.');
  }
  if (body.method === 'upload' && (await getEnvironment(db, environmentId))?.kind !== 'sandbox') {
    throw new SandboxOnlyError('An upload capture is available in sandbox environments only.');
  }
  const version = await pinnedVersionOf(deps, inquiry);
  const step = stepForVerificationType(version.flow, 'selfie');
  if (step?.type !== 'selfie') {
    throw new UnprocessableContentError('The flow has no selfie step.');
  }
  const prompts = selfieCapturePrompts(step);
  const { nonce, digest } = newSelfieCaptureNonce();

  const outcome = await db.transaction(async (tx) => {
    const current = await assertInquiryOpenUnderLock(tx, environmentId, inquiry.id);
    const locked = await lockVerification(tx, environmentId, verification.id);
    if (locked?.status !== 'initiated') {
      throw new ConflictError('The verification is no longer initiated.');
    }
    const now = clock.now();
    const lockedVerification = { ...locked, checks: verification.checks };
    if ((await countSelfieCaptures(tx, environmentId, locked.id)) >= SELFIE_CAPTURE_LIMIT) {
      return {
        capture: null,
        ...(await cancelAtCaptureLimit(tx, deps, lockedVerification, current, step, now)),
      };
    }
    const open = (await listSelfieCaptures(tx, environmentId, { verificationId: locked.id })).find(
      (capture) => capture.status === 'initiated',
    );
    const errored =
      open === undefined
        ? { staged: [], storageKeys: [] }
        : await errorOpenSelfieCaptureInTx(
            tx,
            events,
            environmentId,
            locked.id,
            open.expiresAt.getTime() <= now.getTime() ? 'expired' : 'superseded',
          );
    const capture = await createSelfieCapture(tx, environmentId, {
      id: ids.newId('self'),
      verificationId: locked.id,
      inquiryId: current.id,
      method: body.method,
      liveness: step.liveness,
      prompts,
      nonceSha256: digest,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SELFIE_CAPTURE_TTL_SECONDS * 1000),
      // C94.6, V02 (Workflow 7A): the matching gate reads this session's consent.
      createdBySessionId: session.id,
    });
    return {
      capture,
      staged: [...errored.staged, await stageSelfieEvent(tx, events, 'selfie.created', capture)],
      storageKeys: errored.storageKeys,
    };
  });
  await events.dispatch(outcome.staged);
  await deleteObjects(storage, outcome.storageKeys);
  if (outcome.capture === null) {
    throw new SelfieCaptureConflictError(
      'selfie_capture_limit',
      `The verification reached its ${String(SELFIE_CAPTURE_LIMIT)} captures and was canceled; start a new attempt.`,
    );
  }
  return {
    data: {
      type: 'selfie',
      id: outcome.capture.id,
      attributes: {
        prompts: outcome.capture.prompts,
        'expires-at': toTimestamp(outcome.capture.expiresAt),
        nonce,
        guidance: selfieCaptureGuidance(version.verificationConfig),
      },
    },
  };
}
