/**
 * C126.5: what every message step says of its delivery, shared by the inquiry links and the three
 * messaging actions: never "sent" or "delivered". `recorded` by a sandbox provider, `accepted` when
 * the provider took it, `unknown` when the outcome is not known, which blocks a resume until it is
 * acknowledged (C120.3).
 *
 * The three messaging actions' configs are here as well. Recipients, budgets and content rules are
 * enforced by `WorkflowMessenger` on the rendered message (C126), so what a schema says of a template
 * is only what a definition itself can get wrong: a member the step does not offer, and a secret,
 * which is never allowed in a message (C125.3).
 */
import { hasSecretReference, workflowSecretReferenceSchema } from '@openverify/contracts';
import { z } from 'zod';
import { actionReferenceSchema, actionTemplateSchema, plain, provisional } from './common.js';

const KIB = 1024;

/** C126: the rendered caps of each kind. Every one provisional, ours. */
export const MESSAGE_LIMITS = Object.freeze({
  'email-subject-characters': provisional(200, 'C126.1'),
  'email-text-bytes': provisional(32 * KIB, 'C126.1'),
  'email-html-bytes': provisional(64 * KIB, 'C126.1'),
  'sms-characters': provisional(480, 'C126.2'),
  'slack-characters': provisional(3_000, 'C126.3'),
  'email-per-recipient-hour': provisional(5, 'decision 44'),
  'email-per-recipient-day': provisional(20, 'decision 44'),
  'email-per-environment-hour': provisional(1_000, 'decision 44'),
  'email-per-install-recipient-day': provisional(20, 'decision 44'),
});

/** C126.3: incoming webhooks only. Compared on the parsed URL, through `normalizeHost()`. */
export const SLACK_WEBHOOK_HOST = 'hooks.slack.com';
export const SLACK_WEBHOOK_PATH = /^\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/;

const secretFree = <Schema extends z.ZodString>(schema: Schema) =>
  schema.refine((text) => !hasSecretReference(text), 'a secret never goes in a message');

export const MESSAGE_DELIVERIES = ['recorded', 'accepted', 'unknown'] as const;
export const messageDeliverySchema = z.enum(MESSAGE_DELIVERIES);
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;

export const messageOutputShape = {
  delivery: plain(messageDeliverySchema),
  /** An adapter's name, never an address. */
  provider: plain(z.string().min(1).max(64)),
  sandbox: plain(z.boolean()),
  /** The provider's reference, `null` when nothing came back. */
  'message-ref': plain(z.string().min(1).max(256).nullable()),
};

export const messageOutputSchema = z.strictObject(messageOutputShape);
export type MessageOutput = z.infer<typeof messageOutputSchema>;

/**
 * C126.1: one recipient, no cc or bcc, no per-step server or From address and no attachments. The
 * recipient is an OTP-confirmed address of the run object unless `allow-unconfirmed` says otherwise,
 * which needs `unconfirmed:<step id>`, or a literal on `workflow-email-recipients`.
 */
export const sendEmailConfigSchema = z.strictObject({
  recipient: secretFree(actionReferenceSchema),
  subject: secretFree(actionTemplateSchema),
  text: secretFree(actionTemplateSchema),
  /** Every interpolated value is HTML-escaped by the sink (C115.2). */
  html: secretFree(z.string().min(1).max(MESSAGE_LIMITS['email-html-bytes'].value)).optional(),
  'allow-unconfirmed': z.boolean().optional(),
});
export type SendEmailConfig = z.infer<typeof sendEmailConfigSchema>;

/** C126.2: the run object's confirmed number by default; the sender is the install's. */
export const sendSmsConfigSchema = z.strictObject({
  recipient: secretFree(actionReferenceSchema),
  text: secretFree(actionTemplateSchema),
  'allow-unconfirmed': z.boolean().optional(),
});
export type SendSmsConfig = z.infer<typeof sendSmsConfigSchema>;

/**
 * C126.3: the webhook URL is a workflow secret bound to `hooks.slack.com`, so the definition holds a
 * reference and the URL exists only in the outgoing request.
 */
export const sendSlackMessageConfigSchema = z.strictObject({
  'webhook-secret': workflowSecretReferenceSchema,
  text: secretFree(actionTemplateSchema),
});
export type SendSlackMessageConfig = z.infer<typeof sendSlackMessageConfigSchema>;
