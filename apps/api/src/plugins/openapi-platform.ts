/**
 * The C12 behaviour every server API operation shares, in the OpenAPI document (2B F026):
 * - request headers `OpenVerify-Version` (every operation) and `Idempotency-Key` (`POST` and
 *   `PATCH`);
 * - response headers `OpenVerify-Version` and `RateLimit-Limit`, `-Remaining` and `-Reset` on
 *   every response, and `Idempotent-Replayed` on the success responses of a write;
 * - 429 `rate-limited` with `Retry-After`, 400 `unsupported-api-version`, and on writes 409
 *   `idempotency-key-in-use` and 422 `idempotency-key-reused`.
 *
 * Routes do not declare any of this: the platform plugins (`rate-limit`, `api-version`,
 * `idempotency`) apply it to every server API route, so the document adds it the same way.
 * {@link markServerApiOperations} wraps the route transform and marks each server API
 * operation (a route principal auth guards with an API key or a user session: not `public`,
 * `auth` `api-key`, as the plugins decide); {@link documentServerApiPlatform} wraps the
 * document transform and replaces each mark with references to shared `components`. The flow,
 * dashboard and system routes are left as they are.
 */
import type { SwaggerTransform, SwaggerTransformObject } from '@fastify/swagger';
import {
  API_VERSIONS,
  idempotencyKeySchema,
  PROBLEM_MEDIA_TYPE,
  problemTypeUri,
} from '@openverify/contracts';
import { z } from 'zod';

/** Marks a server API operation between the two transforms; never left in the document. */
const SERVER_API_MARK = 'x-openverify-server-api';

type Json = Record<string, unknown>;

const ref = (section: 'parameters' | 'headers' | 'responses', name: string) => ({
  $ref: `#/components/${section}/${name}`,
});

/** The schema of a count of requests or seconds. */
const COUNT = { type: 'integer', minimum: 0 } as const;
const VERSION = { type: 'string', enum: [...API_VERSIONS] } as const;

/** The contract's key rule as JSON Schema, without the `$schema` an embedded schema omits. */
function idempotencyKeyJsonSchema(): Json {
  const schema: Json = { ...z.toJSONSchema(idempotencyKeySchema) };
  delete schema.$schema;
  return schema;
}

const PARAMETERS = {
  OpenVerifyVersion: {
    name: 'OpenVerify-Version',
    in: 'header',
    required: false,
    description:
      'The API version to serve. Without it the API key’s `api-version` applies, and a ' +
      'dashboard user session gets the latest version. A version the API does not support ' +
      `answers 400 \`${problemTypeUri('unsupported-api-version')}\`.`,
    schema: VERSION,
  },
  IdempotencyKey: {
    name: 'Idempotency-Key',
    in: 'header',
    required: false,
    description:
      'Makes the request safe to retry for 24 hours. The same key with the same request ' +
      'replays the stored answer, with `Idempotent-Replayed: true`. The key with another ' +
      `request answers 422 \`${problemTypeUri('idempotency-key-reused')}\`; while the first ` +
      `request still runs, 409 \`${problemTypeUri('idempotency-key-in-use')}\`. A 5xx answer ` +
      'is not stored, so a retry runs the request again.',
    schema: idempotencyKeyJsonSchema(),
  },
} as const;

const HEADERS = {
  OpenVerifyVersion: {
    description: 'The API version this answer was served with.',
    schema: VERSION,
  },
  RateLimitLimit: {
    description:
      'Requests allowed per window by the tightest rate limit that counted this request. ' +
      'The RateLimit headers are absent when the request was not authenticated, or when the ' +
      'limiter is unavailable (it fails open).',
    schema: COUNT,
  },
  RateLimitRemaining: {
    description: 'Requests left in the window of that limit.',
    schema: COUNT,
  },
  RateLimitReset: {
    description: 'Seconds until that limit’s window resets.',
    schema: COUNT,
  },
  RetryAfter: {
    description: 'Seconds to wait before sending the request again.',
    schema: COUNT,
  },
  IdempotentReplayed: {
    description:
      '`true` when this is the stored answer of an earlier request with the same ' +
      '`Idempotency-Key`.',
    schema: { type: 'string', enum: ['true'] },
  },
} as const;

/** The headers on every server API response. */
const RESPONSE_HEADERS = {
  'OpenVerify-Version': ref('headers', 'OpenVerifyVersion'),
  'RateLimit-Limit': ref('headers', 'RateLimitLimit'),
  'RateLimit-Remaining': ref('headers', 'RateLimitRemaining'),
  'RateLimit-Reset': ref('headers', 'RateLimitReset'),
} as const;

const problemResponse = (description: string, headers: Json = {}) => ({
  description,
  headers: { ...headers, ...RESPONSE_HEADERS },
  content: { [PROBLEM_MEDIA_TYPE]: { schema: { $ref: '#/components/schemas/Problem' } } },
});

const RESPONSES = {
  RateLimited: problemResponse(
    `Too Many Requests: 429 \`${problemTypeUri('rate-limited')}\`, over the \`api\` rate ` +
      'limit of the API key or user session. Retry after `Retry-After` seconds.',
    { 'Retry-After': ref('headers', 'RetryAfter') },
  ),
  UnsupportedApiVersion: problemResponse(
    `Bad Request, including 400 \`${problemTypeUri('unsupported-api-version')}\` when ` +
      '`OpenVerify-Version` names a version the API does not support.',
  ),
  IdempotencyKeyInUse: problemResponse(
    `Conflict: 409 \`${problemTypeUri('idempotency-key-in-use')}\` while a request with the ` +
      'same `Idempotency-Key` still runs.',
  ),
  IdempotencyKeyReused: problemResponse(
    `Unprocessable Content: 422 \`${problemTypeUri('idempotency-key-reused')}\` when the ` +
      '`Idempotency-Key` was used with another request.',
  ),
} as const;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const OPERATION_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** The route transform, which also marks each server API operation for the document one. */
export function markServerApiOperations(transform: SwaggerTransform): SwaggerTransform {
  return (input) => {
    const result = transform(input);
    const { config } = input.route;
    const serverApi = config?.public !== true && (config?.auth ?? 'api-key') === 'api-key';
    return serverApi
      ? { ...result, schema: { ...result.schema, [SERVER_API_MARK]: true } }
      : result;
  };
}

/** A response with the platform headers; `Idempotent-Replayed` too when it can be replayed. */
function withPlatformHeaders(response: unknown, replayable: boolean): unknown {
  if (!isRecord(response) || '$ref' in response) {
    return response;
  }
  const { description, headers, ...rest } = response;
  return {
    description,
    headers: {
      ...(isRecord(headers) ? headers : {}),
      ...RESPONSE_HEADERS,
      ...(replayable ? { 'Idempotent-Replayed': ref('headers', 'IdempotentReplayed') } : {}),
    },
    ...rest,
  };
}

function platformOperation(method: string, operation: Json): Json {
  const { parameters, responses } = operation;
  const rest = Object.fromEntries(
    Object.entries(operation).filter(
      ([key]) => key !== SERVER_API_MARK && key !== 'parameters' && key !== 'responses',
    ),
  );
  const write = method === 'post' || method === 'patch';
  const documented: Json = {};
  for (const [status, response] of Object.entries(isRecord(responses) ? responses : {})) {
    documented[status] = withPlatformHeaders(response, write && status.startsWith('2'));
  }
  documented['400'] ??= ref('responses', 'UnsupportedApiVersion');
  documented['429'] = ref('responses', 'RateLimited');
  if (write) {
    documented['409'] ??= ref('responses', 'IdempotencyKeyInUse');
    documented['422'] ??= ref('responses', 'IdempotencyKeyReused');
  }
  const statuses = Object.keys(documented).sort();
  return {
    ...rest,
    parameters: [
      ...(Array.isArray(parameters) ? (parameters as unknown[]) : []),
      ref('parameters', 'OpenVerifyVersion'),
      ...(write ? [ref('parameters', 'IdempotencyKey')] : []),
    ],
    responses: Object.fromEntries(statuses.map((status) => [status, documented[status]])),
  };
}

/**
 * The document with the C12 behaviour on every operation the route transform marked, and the
 * shared parameters, headers and responses it references. A document without server API
 * operations (no `api` dependencies) is returned as it is.
 */
export function documentServerApiPlatform<D extends object>(document: D): D {
  const { paths } = document as { paths?: unknown };
  if (!isRecord(paths)) {
    return document;
  }
  let marked = false;
  const documentedPaths: Json = {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      documentedPaths[path] = item;
      continue;
    }
    const documentedItem: Json = { ...item };
    for (const method of OPERATION_METHODS) {
      const operation = item[method];
      if (isRecord(operation) && operation[SERVER_API_MARK] === true) {
        marked = true;
        documentedItem[method] = platformOperation(method, operation);
      }
    }
    documentedPaths[path] = documentedItem;
  }
  if (!marked) {
    return document;
  }
  const { components } = document as { components?: Json };
  const section = (name: string): Json => {
    const existing = components?.[name];
    return isRecord(existing) ? existing : {};
  };
  return {
    ...document,
    paths: documentedPaths,
    components: {
      ...components,
      parameters: { ...section('parameters'), ...PARAMETERS },
      headers: { ...section('headers'), ...HEADERS },
      responses: { ...section('responses'), ...RESPONSES },
    },
  };
}

/** The document transform, followed by {@link documentServerApiPlatform}. */
export function withServerApiPlatform(transform: SwaggerTransformObject): SwaggerTransformObject {
  return (input) => documentServerApiPlatform(transform(input));
}
