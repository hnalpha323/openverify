/**
 * API logs (contract C12): every server API request, written after the response is sent.
 * Secrets in the query and bodies are replaced with `[REDACTED]` before storage
 * (`redactKeys`), bodies are truncated at 64 KiB, multipart bodies keep part metadata only,
 * and the IP address, user agent, query and bodies are encrypted at rest.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { ipAddressSchema, userAgentSchema } from './inquiry-sessions.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

export const API_LOG_MAX_BODY_BYTES = 64 * 1024;
export const API_LOG_DEFAULT_RETENTION_DAYS = 30;

/** An HTTP method as received; unmatched requests can carry any. */
export const httpMethodSchema = z.string().regex(/^[A-Z]{1,16}$/, 'must be an HTTP method');

export const apiLogAttributesSchema = z.strictObject({
  method: httpMethodSchema,
  /** Without the query string. */
  path: z.string().min(1).max(2048),
  /** The route template, such as `/api/v1/inquiries/:id`; null when no route matched. */
  route: z.string().max(512).nullable(),
  status: z.int().min(100).max(599),
  'duration-ms': z.int().min(0),
  'request-id': z.string().min(1).max(200),
  'idempotency-key': z.string().max(255).nullable(),
  'api-key-id': idSchema('key').nullable(),
  'user-id': idSchema('usr').nullable(),
  // PII by name at every resource (C15, C91.6): masked without `pii:view`.
  'ip-address': ipAddressSchema.nullable().meta({ pii: true }),
  'user-agent': userAgentSchema.nullable().meta({ pii: true }),
  /** Parsed and redacted query parameters. */
  query: z.record(z.string(), z.unknown()).nullable(),
  /** Redacted JSON, or part metadata for multipart; null when there was none. */
  'request-body': z.unknown(),
  'response-body': z.unknown(),
  'created-at': timestampSchema,
});

export const apiLogResourceSchema = resourceSchema('api-log', 'alog', apiLogAttributesSchema);
export type ApiLogResource = z.infer<typeof apiLogResourceSchema>;

export const apiLogDocumentSchema = singleDocumentSchema(apiLogResourceSchema);
export const apiLogListDocumentSchema = listDocumentSchema(apiLogResourceSchema);

/** An exact status code such as `404`, or a class such as `4xx`. */
const statusFilterItemSchema = z
  .string()
  .regex(/^[1-5](?:[0-9]{2}|xx)$/, 'must be a status code or class');

/** `GET /api/v1/api-logs` query (scope `api-logs:read`). */
export const listApiLogsQuerySchema = listQuerySchema('alog', {
  'filter[method]': filterListSchema(httpMethodSchema).optional(),
  'filter[status]': filterListSchema(statusFilterItemSchema).optional(),
  'filter[route]': z.string().min(1).max(512).optional(),
  'filter[api-key-id]': filterListSchema(idSchema('key')).optional(),
  /** C25.9 (Workflow 2E): requests made with a dashboard session of these users. */
  'filter[user-id]': filterListSchema(idSchema('usr')).optional(),
});
export type ListApiLogsQuery = z.infer<typeof listApiLogsQuerySchema>;

export interface ApiLogRecord {
  id: string;
  method: string;
  path: string;
  route: string | null;
  status: number;
  durationMs: number;
  requestId: string;
  idempotencyKey: string | null;
  apiKeyId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  query: Record<string, unknown> | null;
  requestBody: unknown;
  responseBody: unknown;
  createdAt: Date;
}

/**
 * Builds the api-log resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildApiLogResource(record: ApiLogRecord): ApiLogResource {
  return apiLogResourceSchema.parse({
    type: 'api-log',
    id: record.id,
    attributes: {
      method: record.method,
      path: record.path,
      route: record.route,
      status: record.status,
      'duration-ms': record.durationMs,
      'request-id': record.requestId,
      'idempotency-key': record.idempotencyKey,
      'api-key-id': record.apiKeyId,
      'user-id': record.userId,
      'ip-address': record.ipAddress,
      'user-agent': record.userAgent,
      query: record.query,
      'request-body': record.requestBody,
      'response-body': record.responseBody,
      'created-at': toTimestamp(record.createdAt),
    },
  });
}
