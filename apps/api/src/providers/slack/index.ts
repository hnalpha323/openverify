/**
 * C126.3, C126.4: the Slack senders, bound by `OPENVERIFY_PROVIDER_SLACK_{SANDBOX,PRODUCTION}` in the
 * worker: `incoming-webhook` (through the outbound policy client) or `sandbox` (sandbox kind only:
 * records the message in its own list and posts nothing).
 *
 * C126.5: `retryable` is proof of non-delivery, nothing less: a 429 with its `Retry-After`, or a
 * connection refused or a name that did not resolve, before anything was sent. A 4xx is Slack
 * refusing the message, so it failed and no retry can change that. Everything else, a timeout or a
 * 5xx after the request left, is {@link SLACK_OUTCOME_UNKNOWN}. An error holds a code, never the URL,
 * Slack's body or the message (C53.8).
 */
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpPolicyClient,
} from '../../http/index.js';
import {
  SlackSendError,
  systemClock,
  type Clock,
  type KeyValueCache,
  type SandboxSlackSender,
  type SlackSender,
} from '../../ports.js';
import { recordSandboxMessage } from '../../workflows/actions/messaging/sandbox-messages.js';

/** The message may or may not have gone out, so a resume stops here (C120.3). */
export const SLACK_OUTCOME_UNKNOWN = 'slack_outcome_unknown';

export interface SlackSenderOptions {
  outboundHttp?: OutboundHttp | undefined;
  /** The sandbox message list (C126.4). */
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

const MAX_RESPONSE_BYTES = 4 * 1024;
const ERROR_BODY_BYTES = 256;
const TIMEOUT_MS = 10_000;
const HTTPS_PORT = 443;

/** C126.3: the codes Slack's incoming webhooks publish; anything else reads `slack_rejected`. */
const SLACK_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_payload',
  'user_not_found',
  'channel_not_found',
  'channel_is_archived',
  'action_prohibited',
  'posting_to_general_channel_denied',
  'too_many_attachments',
  'no_service',
  'no_service_id',
  'no_team',
  'team_disabled',
  'invalid_token',
]);

function rejection(body: Uint8Array): SlackSendError {
  const word = new TextDecoder().decode(body).trim();
  return new SlackSendError(SLACK_ERROR_CODES.has(word) ? `slack_${word}` : 'slack_rejected', {
    retryable: false,
  });
}

function outcomeOf(status: number, retryAfter: string | undefined, body: Uint8Array): void {
  if (status >= 200 && status <= 299) {
    return;
  }
  if (status === 429) {
    const seconds = Number(retryAfter);
    throw new SlackSendError('slack_rate_limited', {
      retryable: true,
      ...(Number.isFinite(seconds) && retryAfter !== undefined
        ? { retryAfterSeconds: seconds }
        : {}),
    });
  }
  if (status >= 400 && status <= 499) {
    throw rejection(body);
  }
  // A 5xx, or a redirect, which nothing follows: Slack may have taken it.
  throw new SlackSendError(SLACK_OUTCOME_UNKNOWN, { retryable: false });
}

function failureOf(error: unknown): SlackSendError {
  if (error instanceof SlackSendError) {
    return error;
  }
  if (error instanceof OutboundHttpError) {
    if (error.code === 'connection_refused' || error.code === 'dns') {
      return new SlackSendError('slack_unreachable', { retryable: true });
    }
    if (error.code === 'blocked' || error.code === 'invalid_url') {
      return new SlackSendError('slack_rejected', { retryable: false });
    }
  }
  return new SlackSendError(SLACK_OUTCOME_UNKNOWN, { retryable: false });
}

function createIncomingWebhookSender(outboundHttp: OutboundHttp | undefined): SlackSender {
  let client: OutboundHttpPolicyClient | undefined;
  return {
    id: 'incoming-webhook',
    sandbox: false,
    async send({ webhookUrl, text }) {
      if (outboundHttp?.policyClient === undefined) {
        throw new SlackSendError('slack_not_configured', { retryable: false });
      }
      client ??= outboundHttp.policyClient({
        name: 'slack',
        contentTypes: ['text/plain', 'text/html', 'application/json'],
        maxResponseBytes: MAX_RESPONSE_BYTES,
        timeoutMs: TIMEOUT_MS,
        methods: ['POST'],
        portPolicy: { allowed: [HTTPS_PORT] },
        headerPolicy: { refused: [], refusedPrefixes: [] },
        refuseContentEncoding: false,
        exposeHeaders: ['retry-after'],
      });
      try {
        const answer = await client.request({
          method: 'POST',
          url: webhookUrl,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
          captureErrorBodyBytes: ERROR_BODY_BYTES,
        });
        outcomeOf(answer.status, answer.headers['retry-after'], answer.body);
        return {};
      } catch (error) {
        throw failureOf(error);
      }
    },
  };
}

function createSandboxSlackSender(options: SlackSenderOptions): SandboxSlackSender {
  const { cache } = options;
  const clock = options.clock ?? systemClock;
  return {
    id: 'sandbox',
    sandbox: true,
    async send({ text }, context) {
      await recordSandboxMessage({ cache, clock }, 'slack', {
        environmentId: context.environmentId,
        workflowRunId: context.workflowRunId,
        stepId: context.stepId,
        messageRef: context.messageRef,
        recipientIndex: null,
        secretId: context.secretId,
        message: { text },
      });
      return {};
    },
  };
}

/** The sender `name` binds. */
export function createSlackSender(
  name: 'incoming-webhook' | 'sandbox',
  options: SlackSenderOptions = {},
): SlackSender | SandboxSlackSender {
  return name === 'sandbox'
    ? createSandboxSlackSender(options)
    : createIncomingWebhookSender(options.outboundHttp);
}
