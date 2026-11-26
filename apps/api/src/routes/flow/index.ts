import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import {
  CAPTURE_TRIGGERS,
  CLIENT_ELAPSED_MS_FIELD,
  clientElapsedMsFieldSchema,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  createFlowVerificationBodySchema,
  createSelfieCaptureBodySchema,
  flowSelfieCaptureDocumentSchema,
  extendSelfieCaptureParamsSchema,
  selfieCaptureDocumentSchema,
  flowSubmitVerificationBodySchema,
  selfieCaptureNonceSchema,
  FILE_KIND_FIELD,
  FILE_UPLOAD_FIELD,
  FLOW_SPEC_HEADER,
  fileDocumentSchema,
  fileKindSchema,
  flowConsentBodySchema,
  flowConsentResponseSchema,
  flowRedeemOneTimeLinkBodySchema,
  flowRedeemOneTimeLinkResponseSchema,
  flowSessionResponseSchema,
  flowVerificationDocumentSchema,
  idSchema,
  MAX_UPLOAD_BYTES,
  parseFlowSpecHeader,
} from '@openverify/contracts';
import { FILE_CAPTURE_METHODS } from '@openverify/core';
import type { FastifyRequest } from 'fastify';
import { validatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import flowSessionAuth, { requireFlowSession } from '../../auth/flow-session.js';
import { BadRequestError, UnsupportedMediaTypeError } from '../../errors.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import {
  createFlowSelfieCapture,
  createFlowVerification,
  getFlowSession,
  getFlowVerification,
  recordConsent,
  submitVerification,
  uploadFile,
  type Upload,
} from '../../services/flow.js';
import { redeemOneTimeLink } from '../../services/one-time-links.js';

import { cryptoWalletRoutes } from './crypto-wallet.js';
import { clientUnableRoutes } from './client-unable.js';
import { governmentIdNfcRoutes } from './government-id-nfc.js';
import { inputRoutes } from './inputs.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';
import { handoffRoutes } from './handoffs.js';
import { otpRoutes } from './otp.js';
import { signalRoutes } from './signals.js';
import { integrityRoutes } from './integrity.js';
import { shareConsentRoutes } from './share-consents.js';
import { sandboxChipRoutes } from './sandbox-chip.js';
import { screenRoutes } from './screens.js';
import { themeAssetRoutes } from './theme-assets.js';
import { extendSelfieCapture } from '../../flow-engine/selfie-extension.js';

export { SESSION_TOKEN_SECURITY } from './openapi.js';
const TAGS = FLOW_TAGS;
const verificationParams = z.object({ id: idSchema('ver') });

/**
 * Multipart limits of an upload: one image of at most 10 MiB, the `kind` field, the C40.3
 * capture fields (`capture-id`, `nonce`, `client-elapsed-ms`), `capture-method` (C153.2) and
 * `capture-trigger` (C206.2), with one spare field.
 */
export const UPLOAD_LIMITS = {
  fileSize: MAX_UPLOAD_BYTES,
  files: 1,
  fields: 7,
  parts: 8,
  fieldSize: 64,
  headerPairs: 20,
} as const;

/**
 * The upload route's validator: zod for the params; the multipart body is read and checked by
 * the handler. Fastify types `schema` as the whole route schema, but compiles each part with
 * that part's zod schema, which is what is passed on.
 */
function paramsOnlyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  if (route.httpPart === 'body') {
    return () => ({ value: undefined });
  }
  return validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
}

/** C153.2 (Workflow 9A): the client-reported capture method of an upload. */
const CAPTURE_METHOD_FIELD = 'capture-method';
const captureMethodSchema = z.enum(FILE_CAPTURE_METHODS);

/** C206.2 (Workflow 10B): the client-reported capture trigger of an upload. */
const CAPTURE_TRIGGER_FIELD = 'capture-trigger';
const captureTriggerSchema = z.enum(CAPTURE_TRIGGERS);

/** The fields an upload takes besides the file, each at most once (C3, C40.3, C153.2, C206.2). */
const UPLOAD_FIELDS: ReadonlySet<string> = new Set([
  FILE_KIND_FIELD,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  CLIENT_ELAPSED_MS_FIELD,
  CAPTURE_METHOD_FIELD,
  CAPTURE_TRIGGER_FIELD,
]);

/**
 * C40.3: the capture fields of an upload, all three or none.
 * @throws {BadRequestError} for some but not all of them, or a malformed one.
 */
function captureFieldsOf(fields: ReadonlyMap<string, string>): Upload['capture'] {
  const id = fields.get(SELFIE_CAPTURE_ID_FIELD);
  const nonce = fields.get(SELFIE_CAPTURE_NONCE_FIELD);
  const elapsed = fields.get(CLIENT_ELAPSED_MS_FIELD);
  if (id === undefined && nonce === undefined && elapsed === undefined) {
    return undefined;
  }
  const parsed = {
    id: idSchema('self').safeParse(id),
    nonce: selfieCaptureNonceSchema.safeParse(nonce),
    elapsed: clientElapsedMsFieldSchema.safeParse(elapsed),
  };
  if (!parsed.id.success || !parsed.nonce.success || !parsed.elapsed.success) {
    throw new BadRequestError(
      `"${SELFIE_CAPTURE_ID_FIELD}", "${SELFIE_CAPTURE_NONCE_FIELD}" and ` +
        `"${CLIENT_ELAPSED_MS_FIELD}" go together: a self_ id, 22 base64url characters and ` +
        'a whole number of milliseconds from 0 to 600000.',
    );
  }
  return { id: parsed.id.data, nonce: parsed.nonce.data, clientElapsedMs: parsed.elapsed.data };
}

/**
 * Reads the `kind` field, the C40.3 capture fields and the `file` part; any other part, a
 * repeated one or a value cut by the field size limit is a 400.
 */
async function readUpload(request: FastifyRequest): Promise<Upload> {
  if (!request.isMultipart()) {
    throw new UnsupportedMediaTypeError('The request must be multipart/form-data.');
  }
  const fields = new Map<string, string>();
  let bytes: Uint8Array | undefined;
  for await (const part of request.parts({ limits: UPLOAD_LIMITS })) {
    if (part.type === 'file' && part.fieldname === FILE_UPLOAD_FIELD && bytes === undefined) {
      bytes = await part.toBuffer();
    } else if (
      part.type === 'field' &&
      UPLOAD_FIELDS.has(part.fieldname) &&
      !fields.has(part.fieldname) &&
      !part.valueTruncated
    ) {
      fields.set(part.fieldname, String(part.value));
    } else {
      throw new BadRequestError(
        `Only one "${FILE_KIND_FIELD}" field, the capture fields and one "${FILE_UPLOAD_FIELD}" ` +
          'file are accepted.',
      );
    }
  }
  const kind = fields.get(FILE_KIND_FIELD);
  if (kind === undefined) {
    throw new BadRequestError(`The "${FILE_KIND_FIELD}" field is required.`);
  }
  if (bytes === undefined) {
    throw new BadRequestError(`The "${FILE_UPLOAD_FIELD}" file is required.`);
  }
  const capture = captureFieldsOf(fields);
  const method = fields.get(CAPTURE_METHOD_FIELD);
  const captureMethod = method === undefined ? undefined : captureMethodSchema.safeParse(method);
  if (captureMethod?.success === false) {
    throw new BadRequestError(
      `"${CAPTURE_METHOD_FIELD}" is one of ${FILE_CAPTURE_METHODS.join(', ')} when present.`,
    );
  }
  const trigger = fields.get(CAPTURE_TRIGGER_FIELD);
  const captureTrigger =
    trigger === undefined ? undefined : captureTriggerSchema.safeParse(trigger);
  if (captureTrigger?.success === false) {
    throw new BadRequestError(
      `"${CAPTURE_TRIGGER_FIELD}" is one of ${CAPTURE_TRIGGERS.join(', ')} when present.`,
    );
  }
  return {
    kind,
    bytes,
    ...(capture === undefined ? {} : { capture }),
    ...(captureMethod === undefined ? {} : { captureMethod: captureMethod.data }),
    ...(captureTrigger === undefined ? {} : { captureTrigger: captureTrigger.data }),
  };
}

/**
 * The flow API (contract C3), registered under `/api/v1/flow`. Every route authenticates with
 * the session token of `POST /inquiries/:id/resume` (never an API key) and acts on that
 * session's inquiry only. Browsers may call it from the configured flow origins (CORS); every
 * response is `Cache-Control: no-store`.
 */
export const flowRoutes: FastifyPluginAsyncZod<ApiDependencies> = async (app, options) => {
  const deps = dependenciesOf(options);

  // Flow routes take session tokens, so the app-wide API key hook skips them. The CORS
  // preflight carries no credentials at all and is answered by the CORS hook.
  app.addHook('onRoute', (route) => {
    route.config =
      route.method === 'OPTIONS'
        ? { ...route.config, public: true }
        : { ...route.config, auth: 'session-token' };
  });
  await app.register(cors, {
    origin: [...deps.flowCorsOrigins],
    methods: ['GET', 'POST'],
    // C151.7 (Workflow 9A): the web flow declares the versions it renders in
    // OpenVerify-Flow-Spec, and reads back the version served.
    allowedHeaders: ['authorization', 'content-type', 'x-request-id', 'openverify-flow-spec'],
    exposedHeaders: ['x-request-id', 'openverify-flow-spec'],
    maxAge: 600,
  });
  await app.register(multipart, { limits: UPLOAD_LIMITS });
  await app.register(flowSessionAuth, {
    db: deps.db,
    clock: deps.clock,
    events: deps.events,
    network: deps.network,
  });
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('cache-control', NO_STORE);
  });

  app.post(
    '/one-time-links/redeem',
    {
      config: { public: true },
      schema: {
        summary: 'Redeem a one-time link for a session token',
        description:
          'No credentials: the single-use token from the link fragment is the credential. It ' +
          'succeeds once; any failure answers the same 401. Rate-limited per client address ' +
          '(`one-time-link-redeem`).',
        tags: TAGS,
        security: [],
        body: flowRedeemOneTimeLinkBodySchema,
        response: {
          200: flowRedeemOneTimeLinkResponseSchema,
          ...problemResponses(400, 401, 429),
        },
      },
    },
    (request) => redeemOneTimeLink(deps, request.body),
  );

  app.get(
    '/session',
    {
      schema: {
        summary: 'Fetch the flow session',
        description:
          'The inquiry status, the server position, the flow, every verification attempt with ' +
          'retry hints, and the consent. The first call moves the inquiry from `created` to ' +
          '`pending`. `OpenVerify-Flow-Spec` lists the flow-spec versions the client renders ' +
          '(absent: `1`); the response header names the version served, and only a client ' +
          'that declared `2` receives `step` and `values` (C151.7).',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        response: { 200: flowSessionResponseSchema, ...problemResponses(401) },
      },
    },
    async (request, reply) => {
      const declared = request.headers[FLOW_SPEC_HEADER.toLowerCase()];
      const answer = await getFlowSession(deps, requireFlowSession(request), {
        specVersions: parseFlowSpecHeader(typeof declared === 'string' ? declared : undefined),
      });
      void reply.header(FLOW_SPEC_HEADER, String(answer['spec-version'] ?? 1));
      return answer;
    },
  );

  app.post(
    '/consent',
    {
      schema: {
        summary: 'Record the end user consent',
        description: 'Required before any file upload. Stores the client address and user agent.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: flowConsentBodySchema,
        response: {
          201: flowConsentResponseSchema,
          ...problemResponses(400, 401, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const consent = await recordConsent(deps, requireFlowSession(request), request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.code(201).send(consent);
    },
  );

  app.post(
    '/verifications',
    {
      schema: {
        summary: 'Start a verification',
        description: 'A new attempt in status `initiated`; a retry after a failure is a new one.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: createFlowVerificationBodySchema,
        response: {
          201: flowVerificationDocumentSchema,
          ...problemResponses(400, 401, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const verification = await createFlowVerification(
        deps,
        requireFlowSession(request),
        request.body,
      );
      return reply.code(201).send({ data: verification });
    },
  );

  app.post(
    '/verifications/:id/files',
    {
      validatorCompiler: paramsOnlyValidator,
      schema: {
        summary: 'Upload a file to a verification',
        description:
          'Multipart fields `kind` and `file`, typed by content, never by the client (C52.4): an ' +
          'image kind is JPEG, PNG or WebP; a `document` also a PDF; a chip kind one DER TLV of ' +
          'its data group or file (415 otherwise). At most 10 MiB, a `chip-dg2` 1 MiB and any ' +
          'other chip file 64 KiB (413). A server-written kind is refused (422). Requires ' +
          'consent. C40.3: a selfie pose also sends ' +
          '`capture-id`, `nonce` and `client-elapsed-ms`, before the file; they are required ' +
          'for a selfie verification created since Phase 4 (409 `selfie_capture_required` ' +
          'without them) and refused for the other kinds (400). The pose must be one the ' +
          'capture prompts (422) and the capture `initiated` and unexpired (409 ' +
          '`selfie_capture_invalid`, the same body for a wrong nonce, a foreign, superseded or ' +
          'expired capture). A pose uploaded again replaces the earlier file.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        consumes: ['multipart/form-data'],
        params: verificationParams,
        body: z.object({
          [FILE_KIND_FIELD]: fileKindSchema,
          [FILE_UPLOAD_FIELD]: z.string().meta({ format: 'binary' }),
          // C40.3: required for the selfie kinds of a verification created since Phase 4.
          [SELFIE_CAPTURE_ID_FIELD]: idSchema('self').optional(),
          [SELFIE_CAPTURE_NONCE_FIELD]: selfieCaptureNonceSchema.optional(),
          [CLIENT_ELAPSED_MS_FIELD]: z
            .string()
            .regex(/^(?:0|[1-9][0-9]{0,5})$/)
            .optional()
            .meta({ description: 'Milliseconds since the capture was created, 0-600000.' }),
        }),
        response: {
          201: fileDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 413, 415, 422),
        },
      },
    },
    async (request, reply) => {
      const file = await uploadFile(deps, requireFlowSession(request), request.params.id, () =>
        readUpload(request),
      );
      return reply.code(201).send({ data: file });
    },
  );

  app.post(
    '/verifications/:id/submit',
    {
      schema: {
        summary: 'Submit a verification for processing',
        description:
          'Checks the files the flow step requires, then queues the checks. Repeating it while ' +
          'the verification is `submitted` only queues it again. C40.4: a selfie names its ' +
          'capture (`{ "capture": { "id", "nonce", "device"? } }`), and one created since ' +
          'Phase 4 must (409 `selfie_capture_required`). Every prompted pose needs a file under ' +
          'the capture (409 `selfie_capture_incomplete`); a wrong nonce or a foreign, ' +
          'superseded, consumed or expired capture answers one 409 `selfie_capture_invalid`. ' +
          'The capture is consumed once, with the device snapshot (bounded; the label cleaned ' +
          'and cut to 200 characters) sealed; a repeat must name the capture that submitted the ' +
          'verification. A government ID sends no body or `{}`.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: verificationParams,
        // C40.4: a selfie names its capture; a government ID sends nothing.
        body: flowSubmitVerificationBodySchema.nullish(),
        response: {
          202: flowVerificationDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const verification = await submitVerification(
        deps,
        requireFlowSession(request),
        request.params.id,
        request.body,
      );
      return reply.code(202).send({ data: verification });
    },
  );

  app.post(
    '/verifications/:id/selfies',
    {
      schema: {
        summary: 'Start a selfie capture',
        description:
          'C40.2: a capture with a nonce (returned here once), an expiry ' +
          '(`SELFIE_CAPTURE_TTL_SECONDS` after creation) and the ordered pose prompts, `center` ' +
          'first, the side poses in a random order for active liveness; `guidance` gives the ' +
          'pose thresholds and the hold time. Needs consent and an `initiated` selfie ' +
          'verification; `upload` exists in sandbox environments only (403 `sandbox-only`). A ' +
          'new capture errors the open one (`superseded`, or `expired` past its expiry) and ' +
          'deletes its files. The 11th capture of a verification cancels it instead: 409 ' +
          '`selfie_capture_limit`, after which a new attempt starts (or, with no attempt left, ' +
          'the inquiry has failed).',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: verificationParams,
        body: createSelfieCaptureBodySchema,
        response: {
          201: flowSelfieCaptureDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const capture = await createFlowSelfieCapture(
        deps,
        requireFlowSession(request),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(capture);
    },
  );

  app.get(
    '/verifications/:id',
    {
      schema: {
        summary: 'Poll a verification',
        description: 'Status and user-facing retry hints only, never fraud check details.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: verificationParams,
        response: { 200: flowVerificationDocumentSchema, ...problemResponses(400, 401, 404) },
      },
    },
    async (request) => ({
      data: await getFlowVerification(deps, requireFlowSession(request), request.params.id),
    }),
  );

  // C171.4 (Workflow 9A Stage 1b (S)): the 2.2.1 extension of a selfie capture; frozen here, built
  // by `api-flow-engine` behind `extendSelfieCapture` (501 until then).
  app.post(
    '/selfie-captures/:id/extend',
    {
      schema: {
        summary: 'Extend a selfie capture',
        description:
          "C171.4 (WCAG 2.2.1): moves the open capture's expiry by 180 s. Allowed at least ten " +
          'times per capture, never counted towards the cap of captures, and refused once the ' +
          'selfie is submitted (409 `selfie_capture_not_extendable`). It answers the capture, ' +
          'without its nonce.',
        tags: TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: extendSelfieCaptureParamsSchema,
        response: {
          200: selfieCaptureDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 501),
        },
      },
    },
    (request) => extendSelfieCapture(deps, requireFlowSession(request), request.params.id),
  );

  // C52.3, C55, C57.2, C62.5: the Phase 5 type routes, each in its builder's file (C54.2).
  await app.register(inputRoutes, deps);
  await app.register(otpRoutes, deps);
  await app.register(cryptoWalletRoutes, deps);
  await app.register(governmentIdNfcRoutes, deps);
  // C207.9, C208.1 (Workflow 10C Stage 1a (N)): the client-unable report and the sandbox test chip
  // (`api-nfc`), frozen at 501.
  await app.register(clientUnableRoutes, deps);
  await app.register(sandboxChipRoutes, deps);
  // C94.2 (Workflow 7A): the signal bodies, in their owner's file.
  await app.register(signalRoutes, deps);
  // C211.3 (Workflow 10B Stage 1b (I)): the integrity challenge and token routes (`api-integrity`).
  await app.register(integrityRoutes, deps);
  // C237.6, C238.4 (Workflow 11A Stage 1b (K)): frozen by `foundation-11a`, built by `api-consent`.
  await app.register(shareConsentRoutes, deps);
  // C96.3 (Workflow 7A): device handoff, in its owner's file.
  await app.register(handoffRoutes, deps);
  // C148.5 (Workflow 9A Stage 1b (S)): screen submissions, in their owner's file (`api-flow-engine`).
  await app.register(screenRoutes, deps);
  // C160.6 (Workflow 9A Stage 1b (H)): frozen at 501 for api-themes (Workflow 9B).
  await app.register(themeAssetRoutes, deps);
};
