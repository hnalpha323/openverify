/**
 * C126.8 (V26): the one port every message goes through: Send Email, Send SMS, Send Slack Message, the
 * inquiry-link actions and case notifications. Frozen by `foundation-8a` (Stage 1b (X)) and built by
 * `api-egress` (`messenger.ts`). It applies the recipient and link rules on the rendered message, the
 * budgets, the sandbox lists, the delivery output, the at-most-once effect and token scrubbing in one
 * place, so no action reaches a `Mailer`, an `SmsSender` or a `SlackSender` itself.
 *
 * A message arrives rendered, and the action renders it last (C115.2, C125.5). A refusal rejects with
 * `ActionStepError` carrying its step error code (`recipient_not_allowed`, `message_link_refused`,
 * `rate_limited`, `provider_not_configured`); an unknown outcome is no refusal, it answers
 * `delivery: unknown` (C126.5).
 */
import type { MessageOutput } from '@openverify/workflow-engine/actions';
import type { EnvironmentKind } from '../../../ports.js';

/**
 * Why a recipient is the one a step names (C126.1, C126.2): the run object's OTP-confirmed contact, an
 * unconfirmed field of it, or a literal address that must be on the environment's allowlist.
 */
export type WorkflowMessageRecipientBasis = 'confirmed' | 'unconfirmed' | 'literal';

interface Recipient {
  to: string;
  basis: WorkflowMessageRecipientBasis;
  /**
   * The step's acknowledged `allow-unconfirmed`. An inquiry link never sets it: a one-time link opens
   * the person's own flow, so it goes only to a destination that person confirmed (V23).
   */
  allowUnconfirmed: boolean;
}

export interface WorkflowEmailMessage extends Recipient {
  kind: 'email';
  subject: string;
  text: string;
  html: string | null;
}

export interface WorkflowSmsMessage extends Recipient {
  kind: 'sms';
  text: string;
  /** C126.2: what the inquiry template's phone step accepts; `null` with no template in scope. */
  templateCountries: readonly string[] | null;
}

export interface WorkflowSlackMessage {
  kind: 'slack';
  /** The key of a secret bound to `hooks.slack.com`, resolved inside the messenger, last (C125.5). */
  secretKey: string;
  text: string;
}

export type WorkflowMessage = WorkflowEmailMessage | WorkflowSmsMessage | WorkflowSlackMessage;

/** The step a message belongs to, for its at-most-once effect (C117.5) and its sandbox record. */
export interface WorkflowMessageEffect {
  runId: string;
  stepId: string;
  /** `<wfr id>/<node id>/<iteration path>`, independent of the attempt. */
  effectKey: string;
}

export interface WorkflowMessageContext {
  environmentId: string;
  environmentKind: EnvironmentKind;
  organizationId: string;
  /** `null` only for a message no run sends: a case notification (8B). */
  effect: WorkflowMessageEffect | null;
  /** C126.2: the inquiry's own flow link, the one URL a message may hold beyond `workflow-link-hosts`. */
  flowLink: string | null;
  /** C125.5 (P32): one-time-link tokens in this message, which exist only in the outgoing message. */
  scrub: readonly string[];
  /**
   * C121.4: runs after every rule and budget passed, right before the message goes, so a marked step's
   * audit entry records a send and never a refusal, and a failed entry sends nothing.
   */
  beforeSend?: () => Promise<void>;
}

export interface WorkflowMessenger {
  /**
   * Sends, or records in a sandbox environment.
   * @throws an `ActionStepError` with the step error code of a refusal.
   */
  send(message: WorkflowMessage, context: WorkflowMessageContext): Promise<MessageOutput>;
}
