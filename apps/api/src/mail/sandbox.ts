/**
 * C126.4, decision 40: the mail sandbox, the one message kind with no provider kind of its own: a
 * sandbox environment's workflow email is recorded in its own list and sent nowhere, unless the
 * address is on `workflow-email-recipients`.
 *
 * The binding is by environment kind, as a provider's is, and a production environment reads the real
 * `Mailer` by type: nothing here can record a production message.
 */
import {
  systemClock,
  type Clock,
  type EnvironmentKind,
  type KeyValueCache,
  type MailMessage,
  type Mailer,
} from '../ports.js';
import { recordSandboxMessage } from '../workflows/actions/messaging/sandbox-messages.js';

/** Given only to the sandbox mailer: the HMAC of the recipient (C126.4), never the address. */
export interface SandboxMailContext {
  environmentId: string;
  /** The recipient's HMAC under the environment's subkey, which the search reads by. */
  recipientIndex: string;
  /** `null` for a message no run sends. */
  workflowRunId: string | null;
  stepId: string;
  messageRef: string;
}

/** Records and sends nothing. */
export interface SandboxMailer {
  readonly id: 'sandbox';
  readonly sandbox: true;
  send(message: MailMessage, context: SandboxMailContext): Promise<void>;
}

/** C126.4: what a workflow message reads, by the kind of its environment. */
export type WorkflowMailBinding = Readonly<{
  sandbox: SandboxMailer;
  production: Mailer;
}> &
  Readonly<Record<EnvironmentKind, SandboxMailer | Mailer>>;

export interface SandboxMailerOptions {
  /** The sandbox message list (C126.4). */
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

/** It records; the recipient's address is in neither the list nor its key. */
export function createSandboxMailer(options: SandboxMailerOptions = {}): SandboxMailer {
  const { cache } = options;
  const clock = options.clock ?? systemClock;
  return {
    id: 'sandbox',
    sandbox: true,
    send: ({ subject, text, html }, context) =>
      recordSandboxMessage({ cache, clock }, 'email', {
        environmentId: context.environmentId,
        workflowRunId: context.workflowRunId,
        stepId: context.stepId,
        messageRef: context.messageRef,
        recipientIndex: context.recipientIndex,
        secretId: null,
        message: { subject, text, html: html ?? null },
      }),
  };
}
