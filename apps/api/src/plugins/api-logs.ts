/**
 * C12 API logs: every server API request, 4xx and 5xx included, is recorded after its response
 * was sent, so logging never delays or fails a request. The entry belongs to the principal's
 * environment; requests refused before a principal was established (a missing, unknown or
 * expired credential, a missing permission) have no environment and are not recorded.
 *
 * What is stored is decided in `services/api-logs.ts`: secrets redacted at any depth, bodies
 * truncated at 64 KiB, multipart bodies as part metadata only, and the address, user agent,
 * query and bodies encrypted by the repository.
 */
import {
  idempotencyKeySchema,
  IDEMPOTENCY_KEY_HEADER,
  userAgentSchema,
} from '@openverify/contracts';
import { createApiLog, type Db, type NewApiLogInput } from '@openverify/db';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { IdGenerator, Principal } from '../ports.js';
import {
  apiLogValue,
  describeMultipartBody,
  headerText,
  loggedResponseJson,
  multipartLogValue,
  withoutImporterFile,
  resourceIdOf,
} from '../services/api-logs.js';

/** Writes one entry; `createApiLog` by default. */
export type ApiLogWriter = (
  db: Db,
  environmentId: string,
  input: NewApiLogInput,
) => Promise<unknown>;

export interface ApiLogsPluginOptions {
  db: Db;
  ids: IdGenerator;
  write?: ApiLogWriter | undefined;
}

/** Contract limits of the stored strings (`apiLogAttributesSchema`). */
const MAX_PATH = 2048;
const MAX_IP = 64;
const MAX_USER_AGENT = userAgentSchema.maxLength ?? 1024;

const MULTIPART = /^multipart\/form-data\b/i;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const JSON_REQUEST = /^application\/(?:[\w.-]+\+)?json\b/i;

interface Captured {
  /** The request body as stored, read before validation changed it. */
  requestBody: unknown;
  /** The query as sent, before validation coerced it. */
  query: unknown;
  /** The response payload and its type, as sent. */
  payload?: unknown;
  contentType?: string | undefined;
}

/**
 * The request's principal. Routes in scopes created before principal auth loaded, such as
 * @fastify/swagger's, lack the decoration, so it can be `undefined` there.
 */
function principalOf(request: FastifyRequest): Principal | null {
  const principal: Principal | null | undefined = request.principal;
  return principal ?? null;
}

/** The request body as an API log stores it: JSON, multipart metadata, or nothing. */
async function requestBodyOf(request: FastifyRequest): Promise<unknown> {
  const contentType = headerText(request.headers['content-type']) ?? '';
  const { body } = request;
  if (MULTIPART.test(contentType)) {
    return body instanceof Uint8Array
      ? multipartLogValue(await describeMultipartBody(body, contentType))
      : null;
  }
  // C100.1 (F23): an importer's JSON `file` is stored as its length and SHA-256.
  return JSON_REQUEST.test(contentType) ? apiLogValue(withoutImporterFile(body)) : null;
}

function idempotencyKeyOf(request: FastifyRequest): string | null {
  const key = headerText(request.headers[IDEMPOTENCY_KEY_HEADER]);
  return idempotencyKeySchema.safeParse(key).success ? (key ?? null) : null;
}

function entryOf(
  request: FastifyRequest,
  reply: FastifyReply,
  captured: Captured | undefined,
  id: string,
): NewApiLogInput {
  const principal = principalOf(request);
  // C253.1 (amendment 48): the access export's manifest and files are never kept.
  const json = loggedResponseJson(
    request.routeOptions.url ?? null,
    captured?.payload,
    captured?.contentType,
  );
  return {
    id,
    method: request.method,
    path: (request.url.split('?', 1)[0] ?? request.url).slice(0, MAX_PATH),
    route: request.routeOptions.url ?? null,
    status: reply.statusCode,
    durationMs: Math.max(0, Math.round(reply.elapsedTime)),
    requestId: request.id,
    idempotencyKey: idempotencyKeyOf(request),
    apiKeyId: principal?.kind === 'api-key' ? principal.apiKeyId : null,
    userId: principal?.kind === 'user' ? principal.userId : null,
    resourceId: resourceIdOf(json, request.params),
    ip: request.ip.slice(0, MAX_IP),
    userAgent: headerText(request.headers['user-agent'])?.slice(0, MAX_USER_AGENT) ?? null,
    query: apiLogValue(captured?.query ?? request.query),
    requestBody: captured?.requestBody ?? null,
    responseBody: apiLogValue(json),
  };
}

const apiLogsPlugin: FastifyPluginCallback<ApiLogsPluginOptions> = (app, options, done) => {
  const { db, ids } = options;
  const write = options.write ?? createApiLog;
  const captured = new WeakMap<FastifyRequest, Captured>();

  app.addHook('preValidation', async (request) => {
    if (principalOf(request) !== null) {
      // Logging never fails a request: a body the walk cannot handle (nested too deeply for
      // the stack) is logged without it, and the route answers as it would (2B F034).
      let requestBody: unknown = null;
      try {
        requestBody = await requestBodyOf(request);
      } catch (error) {
        request.log.warn(
          { error: (error as Error).name },
          'the request body could not be kept in the API log',
        );
      }
      captured.set(request, { requestBody, query: request.query });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (principalOf(request) !== null) {
      const entry = captured.get(request) ?? { requestBody: null, query: request.query };
      entry.payload = payload;
      entry.contentType = headerText(reply.getHeader('content-type'));
      captured.set(request, entry);
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const principal = principalOf(request);
    if (principal === null) {
      return;
    }
    try {
      const entry = entryOf(request, reply, captured.get(request), ids.newId('alog'));
      await write(db, principal.environmentId, entry);
    } catch (error) {
      request.log.error({ err: error }, 'writing the API log entry failed');
    }
  });

  done();
};

/**
 * C12 API logs for every authenticated server API request. Register it after principal auth.
 */
export default fp(apiLogsPlugin, { name: 'openverify-api-logs', fastify: '5.x' });
