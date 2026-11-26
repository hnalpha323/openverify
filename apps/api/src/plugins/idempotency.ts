/**
 * C12 idempotency keys on server API `POST` and `PATCH` requests. A request that sends
 * `Idempotency-Key` claims the key for its environment and principal (the API key, or the
 * user across sessions) together with a fingerprint of the request:
 * - a new key runs the request, and its answer is stored for 24 hours (body encrypted);
 *   a 5xx answer is not stored and releases the key, so a retry runs again;
 * - the same key with the same fingerprint replays the stored answer with
 *   `Idempotent-Replayed: true`;
 * - the same key with another fingerprint answers 422 `idempotency-key-reused`;
 * - a key whose request is still running answers 409 `idempotency-key-in-use`.
 *
 * The fingerprint is the SHA-256 of the method, route, path, query and body in canonical JSON
 * (object members sorted). A multipart body counts by its part names, sizes and SHA-256
 * digests, so a client that re-encodes the same upload with another boundary still matches;
 * that needs the route to buffer the body (`parseAs: 'buffer'`), and a key on a multipart body
 * the route streams is refused, since it cannot be fingerprinted before the request runs.
 */
import { createHash } from 'node:crypto';
import {
  idempotencyKeySchema,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  redactKeys,
} from '@openverify/contracts';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  type ClaimIdempotencyKeyInput,
  type Db,
  type IdempotencyClaim,
  type IdempotentResponse,
  type StoredResponse,
} from '@openverify/db';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { BadRequestError, IdempotencyKeyInUseError, IdempotencyKeyReusedError } from '../errors.js';
import type { Clock, Principal } from '../ports.js';
import {
  describeMultipartBody,
  headerText,
  isRecord,
  resourceIdOf,
  responseJson,
} from '../services/api-logs.js';

/**
 * Where claims and stored answers live; the `idempotency_keys` repository by default. A claim's
 * `lockedUntil` goes back to `complete` and `release`, so a request that outlived its lease
 * cannot settle a key another request took over (Workflow 2B F014).
 */
export interface IdempotencyStore {
  claim(environmentId: string, input: ClaimIdempotencyKeyInput): Promise<IdempotencyClaim>;
  complete(
    environmentId: string,
    id: number,
    response: IdempotentResponse,
    lockedUntil?: Date,
  ): Promise<boolean>;
  release(environmentId: string, id: number, lockedUntil?: Date): Promise<boolean>;
}

export interface IdempotencyPluginOptions {
  db: Db;
  clock: Clock;
  store?: IdempotencyStore | undefined;
}

const METHODS = new Set(['POST', 'PATCH']);
const MULTIPART = /^multipart\/form-data\b/i;
/** The response headers a replay restores (C12). */
const STORED_HEADERS = ['content-type', 'location'] as const;

/** JSON with object members sorted by name at every depth; `undefined` is `null`. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** What the fingerprint takes from the body: JSON as parsed, or digests of bytes. */
async function bodyFingerprint(request: FastifyRequest): Promise<unknown> {
  const contentType = headerText(request.headers['content-type']) ?? '';
  const { body } = request;
  if (MULTIPART.test(contentType)) {
    if (!(body instanceof Uint8Array)) {
      throw new BadRequestError(
        'An Idempotency-Key cannot be used with a multipart body this route streams.',
      );
    }
    const parts = await describeMultipartBody(body, contentType);
    return parts === null
      ? { sha256: sha256(body) }
      : { parts: parts.map(({ name, size, sha256: digest }) => ({ name, size, sha256: digest })) };
  }
  // C125.5: a stored digest of a short secret could be guessed offline, so what `redactKeys` keeps
  // out of an API log stays out of a fingerprint. Two bodies that differ only there are one request.
  return body instanceof Uint8Array ? { sha256: sha256(body) } : (redactKeys(body) ?? null);
}

/**
 * @throws {BadRequestError} for a body nested too deeply to walk (the stack runs out), which
 *   no route accepts anyway, instead of a 500 (2B F034).
 */
async function fingerprintOf(request: FastifyRequest): Promise<string> {
  try {
    const body = await bodyFingerprint(request);
    return sha256(
      canonicalJson({
        method: request.method,
        route: request.routeOptions.url ?? null,
        path: request.url.split('?', 1)[0] ?? request.url,
        query: request.query,
        body,
      }),
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BadRequestError('The request body is nested too deeply.');
    }
    throw error;
  }
}

function replay(reply: FastifyReply, stored: StoredResponse): FastifyReply {
  void reply
    .code(stored.status)
    .headers(stored.headers)
    .header(IDEMPOTENT_REPLAYED_HEADER, 'true')
    // Per principal and possibly carrying a one-time secret: no cache may keep it.
    .header('cache-control', 'no-store');
  return reply.send(stored.body ?? undefined);
}

function storedHeaders(reply: FastifyReply): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of STORED_HEADERS) {
    const value = headerText(reply.getHeader(name));
    if (value !== undefined) {
      headers[name] = value;
    }
  }
  return headers;
}

/** The payload as stored text, or `undefined` for one that cannot be stored (a stream). */
function storableBody(payload: unknown): string | null | undefined {
  if (payload === null || payload === undefined || typeof payload === 'string') {
    return payload ?? null;
  }
  return Buffer.isBuffer(payload) ? payload.toString('utf8') : undefined;
}

/**
 * The request's principal. Routes in scopes created before principal auth loaded, such as
 * @fastify/swagger's, lack the decoration, so it can be `undefined` there.
 */
function principalOf(request: FastifyRequest): Principal | null {
  const principal: Principal | null | undefined = request.principal;
  return principal ?? null;
}

interface HeldKey {
  environmentId: string;
  id: number;
  /** The claim's lease, which only this request may settle. */
  lockedUntil?: Date | undefined;
}

const idempotencyPlugin: FastifyPluginCallback<IdempotencyPluginOptions> = (app, options, done) => {
  const { db, clock } = options;
  const store: IdempotencyStore = options.store ?? {
    claim: (environmentId, input) => claimIdempotencyKey(db, environmentId, input),
    complete: (environmentId, id, response, lockedUntil) =>
      completeIdempotencyKey(db, environmentId, id, response, { lockedUntil }),
    release: (environmentId, id, lockedUntil) =>
      releaseIdempotencyKey(db, environmentId, id, { lockedUntil }),
  };
  const held = new WeakMap<FastifyRequest, HeldKey>();

  // After the body is parsed and before validation, so the fingerprint is of what was sent.
  app.addHook('preValidation', async (request, reply) => {
    const principal = principalOf(request);
    const header = headerText(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (principal === null || header === undefined || !METHODS.has(request.method)) {
      return;
    }
    if (!idempotencyKeySchema.safeParse(header).success) {
      throw new BadRequestError(
        'The Idempotency-Key header must be 1 to 255 printable ASCII characters, without ' +
          'leading or trailing spaces.',
      );
    }
    const claim = await store.claim(principal.environmentId, {
      principalType: principal.kind === 'api-key' ? 'api_key' : 'user',
      principalId: principal.kind === 'api-key' ? principal.apiKeyId : principal.userId,
      key: header,
      fingerprint: await fingerprintOf(request),
      now: clock.now(),
    });
    switch (claim.outcome) {
      case 'claimed':
        held.set(request, {
          environmentId: principal.environmentId,
          id: claim.id,
          lockedUntil: claim.lockedUntil,
        });
        return;
      case 'replay':
        return replay(reply, claim.response);
      case 'mismatch':
        throw new IdempotencyKeyReusedError(
          'This Idempotency-Key was already used with a different request. Use a new key ' +
            'for a new request.',
        );
      case 'in_progress':
        throw new IdempotencyKeyInUseError(
          'A request with this Idempotency-Key is still in progress. Retry once it finished.',
        );
    }
  });

  // Settled before the answer leaves, so a retry that follows it always finds it stored.
  app.addHook('onSend', async (request, reply, payload) => {
    const key = held.get(request);
    if (key === undefined) {
      return payload;
    }
    held.delete(request);
    const body = storableBody(payload);
    // Only the key's row id is logged: the key is the client's text, and the body may hold PII.
    const lostLease = (outcome: string) => {
      request.log.warn(
        { idempotencyKeyId: key.id },
        `the idempotency key's lease ended before this request finished, so its answer was ${outcome}; ` +
          'a retry with the key may run the request again (2B F014, F035)',
      );
    };
    try {
      if (reply.statusCode >= 500 || body === undefined) {
        if (body === undefined) {
          request.log.warn('a streamed answer cannot be stored for idempotent replay');
        }
        if (!(await store.release(key.environmentId, key.id, key.lockedUntil))) {
          lostLease('not released');
        }
      } else {
        const contentType = headerText(reply.getHeader('content-type'));
        const stored = await store.complete(
          key.environmentId,
          key.id,
          {
            status: reply.statusCode,
            headers: storedHeaders(reply),
            body,
            resourceId: resourceIdOf(responseJson(body, contentType), request.params),
          },
          key.lockedUntil,
        );
        if (!stored) {
          lostLease('not stored');
        }
      }
    } catch (error) {
      request.log.error(
        { err: error },
        'settling the idempotency key failed; it stays held until its lease ends',
      );
    }
    return payload;
  });

  done();
};

/**
 * C12 `Idempotency-Key` handling for server API `POST` and `PATCH`. Register it after
 * principal auth.
 */
export default fp(idempotencyPlugin, { name: 'openverify-idempotency', fastify: '5.x' });
