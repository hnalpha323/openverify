/**
 * User audit logs (contract C15): every state-changing call by any principal, plus file views,
 * logins, logouts, MFA changes and environment switches. Served by the server API
 * (`GET /user-audit-logs`) and the dashboard API (`GET /dashboard/audit-logs`), both with the
 * permission `audit-logs:read`. `ip-address` and `user-agent` are encrypted at rest.
 */
import { z } from 'zod';
import { anyIdSchema, idSchema } from './ids.js';
import { ipAddressSchema, userAgentSchema } from './inquiry-sessions.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, filterTimestampSchema, listQuerySchema } from './list-filters.js';

export const AUDIT_ACTOR_TYPES = ['user', 'api-key', 'system', 'workflow-run'] as const;
export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;

/** A dotted, kebab-case action such as `inquiry.approved` or `webhook.secret-rotated`. */
export const auditActionSchema = z
  .string()
  .max(100)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/, 'must be a dotted kebab-case action');

/**
 * Who acted: a user (`usr_...`), an API key (`key_...`), a workflow run (`wfr_...`, C121.1), or the
 * system, for an entry no principal wrote (a handoff step, an import or an asynchronous graph query
 * finishing, a C16 command), which has no id to name.
 */
export const auditActorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user'), id: idSchema('usr') }),
  z.strictObject({ type: z.literal('api-key'), id: idSchema('key') }),
  z.strictObject({ type: z.literal('workflow-run'), id: idSchema('wfr') }),
  z.strictObject({ type: z.literal('system'), id: z.null() }),
]);
/** An actor as an audit entry serves it: {@link AuditActor}, or the system. */
export type ServedAuditActor = z.infer<typeof auditActorSchema>;
/**
 * Who a change acts as: a request's principal or a workflow run, never the system. Every reader
 * of it in the API goes through one exhaustive switch (`storedActorOf`, owner decision 5 after
 * Workflow 7B), so a new member fails typecheck rather than read as another kind.
 */
export type AuditActor = Exclude<ServedAuditActor, { type: 'system' }>;

export const userAuditLogAttributesSchema = z.strictObject({
  action: auditActionSchema,
  actor: auditActorSchema,
  /** The kind of resource acted on, such as `inquiry` or `environment`; null when none. */
  'resource-type': z
    .string()
    .max(64)
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/, 'must be a resource type')
    .nullable(),
  'resource-id': anyIdSchema.nullable(),
  // PII by name at every resource (C15, C91.6): masked without `pii:view`.
  'ip-address': ipAddressSchema.nullable().meta({ pii: true }),
  'user-agent': userAgentSchema.nullable().meta({ pii: true }),
  /** Action details; never PII. */
  metadata: z.record(z.string(), z.unknown()),
  'created-at': timestampSchema,
});

export const userAuditLogResourceSchema = resourceSchema(
  'user-audit-log',
  'aud',
  userAuditLogAttributesSchema,
);
export type UserAuditLogResource = z.infer<typeof userAuditLogResourceSchema>;

export const userAuditLogDocumentSchema = singleDocumentSchema(userAuditLogResourceSchema);
export const userAuditLogListDocumentSchema = listDocumentSchema(userAuditLogResourceSchema);

const actorIdSchema = z.union([idSchema('usr'), idSchema('key'), idSchema('wfr')]);

/** `GET /api/v1/user-audit-logs` and `GET /api/v1/dashboard/audit-logs` query. */
export const listUserAuditLogsQuerySchema = listQuerySchema('aud', {
  'filter[action]': filterListSchema(auditActionSchema).optional(),
  'filter[actor-id]': filterListSchema(actorIdSchema).optional(),
  'filter[resource-type]': z.string().min(1).max(64).optional(),
  'filter[resource-id]': filterListSchema(anyIdSchema).optional(),
  /** C168.6 (Workflow 9B): every action starting with this, such as `inquiry.` or `settings.`. */
  'filter[action-prefix]': z
    .string()
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]*)*$/, 'must be the start of an action name')
    .max(64)
    .optional(),
  /** C168.6: entries from this instant (included) to `filter[to]` (excluded). */
  'filter[from]': filterTimestampSchema.optional(),
  'filter[to]': filterTimestampSchema.optional(),
  /**
   * C168.6 (review P23): an exact address, matched through `audit_log_ip_index` (an HMAC under the
   * environment's blind-index subkey, `AUDIT_IP_INDEX_LABEL`); needs `pii:view`, and is personal
   * data in a saved view.
   */
  'filter[ip]': z.union([z.ipv4(), z.ipv6()]).optional(),
}).refine(
  (query) =>
    query['filter[from]'] === undefined ||
    query['filter[to]'] === undefined ||
    Date.parse(query['filter[from]']) < Date.parse(query['filter[to]']),
  { message: 'filter[to] must be after filter[from]', path: ['filter[to]'] },
);
export type ListUserAuditLogsQuery = z.infer<typeof listUserAuditLogsQuerySchema>;

export interface UserAuditLogRecord {
  id: string;
  action: string;
  actor: ServedAuditActor;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Builds the user-audit-log resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildUserAuditLogResource(record: UserAuditLogRecord): UserAuditLogResource {
  return userAuditLogResourceSchema.parse({
    type: 'user-audit-log',
    id: record.id,
    attributes: {
      action: record.action,
      actor: { type: record.actor.type, id: record.actor.id },
      'resource-type': record.resourceType,
      'resource-id': record.resourceId,
      'ip-address': record.ipAddress,
      'user-agent': record.userAgent,
      metadata: record.metadata,
      'created-at': toTimestamp(record.createdAt),
    },
  });
}
