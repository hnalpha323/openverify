/**
 * C126.4 (F09, H16; C55.10 and C55.11 amended): what a workflow's messages record in the sandbox.
 * Each kind has its own Valkey list, one per environment, every body sealed, at most 500 entries for
 * 24 hours, beside the untouched `otp` list. A record is a record, so each says `recorded-at`, never
 * "sent". Each search takes `sandbox:read`, as the SMS search does, and exists in sandbox environments
 * only: an address goes in the body, never in a URL, and is searched by its HMAC under the
 * environment's subkey. A Slack record names its secret, never the URL.
 *
 * `POST /api/v1/sandbox/email-messages/search`, `/slack-messages/search` and
 * `/workflow-sms-messages/search` (`routes/server/sandbox-messages.ts`, `api-egress`). The bodies are
 * PII, so the members named by {@link PII_SANDBOX_MESSAGE_ATTRIBUTES} join the API-log masked set.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

export const SANDBOX_MESSAGE_KINDS = ['workflow-sms', 'email', 'slack'] as const;
export const sandboxMessageKindSchema = z.enum(SANDBOX_MESSAGE_KINDS);
export type SandboxMessageKind = z.infer<typeof sandboxMessageKindSchema>;

/** Which run and step recorded a message, so a test-run panel can show it (C126.4). */
const recordOrigin = {
  'message-ref': z.string().min(1).max(256),
  'workflow-run-id': idSchema('wfr'),
  'step-id': z.string().min(1).max(64),
  'recorded-at': timestampSchema,
};

const piiText = (limit: number) => z.string().max(limit).meta({ pii: true });

export const sandboxEmailSearchBodySchema = z.strictObject({
  'email-address': z.email().max(320),
});
export type SandboxEmailSearchBody = z.infer<typeof sandboxEmailSearchBodySchema>;

export const sandboxEmailSearchResponseSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      ...recordOrigin,
      'message-subject': piiText(200),
      'message-text': piiText(32 * 1024),
      'message-html': piiText(64 * 1024).nullable(),
    }),
  ),
});
export type SandboxEmailSearchResponse = z.infer<typeof sandboxEmailSearchResponseSchema>;

export const sandboxSlackSearchBodySchema = z.strictObject({ 'secret-id': idSchema('wsec') });
export type SandboxSlackSearchBody = z.infer<typeof sandboxSlackSearchBodySchema>;

export const sandboxSlackSearchResponseSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      ...recordOrigin,
      'secret-id': idSchema('wsec'),
      'message-text': piiText(3000),
    }),
  ),
});
export type SandboxSlackSearchResponse = z.infer<typeof sandboxSlackSearchResponseSchema>;

export const sandboxWorkflowSmsSearchBodySchema = z.strictObject({
  'phone-number': z.string().min(1).max(32),
});
export type SandboxWorkflowSmsSearchBody = z.infer<typeof sandboxWorkflowSmsSearchBodySchema>;

export const sandboxWorkflowSmsSearchResponseSchema = z.strictObject({
  data: z.array(z.strictObject({ ...recordOrigin, 'message-text': piiText(480) })),
});
export type SandboxWorkflowSmsSearchResponse = z.infer<
  typeof sandboxWorkflowSmsSearchResponseSchema
>;

/** C143.5: the members a stored API log masks. */
export const PII_SANDBOX_MESSAGE_ATTRIBUTES: readonly string[] = Object.freeze([
  'message-subject',
  'message-text',
  'message-html',
]);
