/**
 * C126.1, C126.2, C126.8, P32, V23: the inquiry links, each a one-time link placed only in the
 * outgoing message, sent through {@link WorkflowMessenger} to the destination the person confirmed
 * with a code. The token exists only in that message: the output holds the link's id, its expiry and
 * the delivery, and the messenger scrubs the token (C125.5). No confirmed destination is a step error,
 * never an unconfirmed address. At most once: `failed` proves nothing went out, `unknown` blocks a
 * resume (C126.5).
 */
import { buildOneTimeLinkUrl, newOneTimeLinkToken } from '@openverify/contracts';
import { getInquiry, listInquiryVerifications, type Db, type Inquiry } from '@openverify/db';
import { parseTemplate, renderTemplate, type JsonValue } from '@openverify/workflow-engine';
import { sendInquiryLinkConfigSchema } from '@openverify/workflow-engine/actions';
import { loadVerificationAttributes } from '../../../services/attributes/index.js';
import { generateOneTimeLinkInTx } from '../../../services/one-time-links.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionResult,
  type OutsideActionHandler,
} from '../../engine/action-port.js';
import { inquiryTemplateCountries } from '../messaging/confirmed.js';
import type { WorkflowMessage } from '../messaging/port.js';
import { answering, apiDepsOf } from '../shared.js';

type LinkChannel = 'email' | 'sms';

const VERIFICATION = {
  email: { type: 'email_address', member: 'email-address' },
  sms: { type: 'phone_number', member: 'phone-number' },
} as const;

/** The operator's words stay out of it, so the message carries a link and no personal data. */
const SUBJECT = 'Continue your verification';
const textOf = (link: string): string => `Continue your verification here: ${link}`;

/** An egress action renders its own config, here its id alone (C115.2). */
function renderedConfig(context: ActionContext) {
  const rendered: Record<string, JsonValue> = {};
  for (const [name, member] of Object.entries(context.config)) {
    const template = parseTemplate(member);
    const value = template.ok
      ? renderTemplate(template.template, { roots: context.scope.roots }, 'json')
      : null;
    if (value?.ok !== true) {
      throw new ActionStepError(value === null ? 'execution_error' : value.code);
    }
    rendered[name] = value.value;
  }
  const parsed = sendInquiryLinkConfigSchema.safeParse(rendered);
  if (!parsed.success) {
    throw new ActionStepError('action_input_invalid');
  }
  return parsed.data;
}

/** C126.1, V23: the destination this inquiry confirmed with a code, or `null`. */
async function confirmedDestinationOf(
  db: Db,
  inquiry: Inquiry,
  channel: LinkChannel,
): Promise<string | null> {
  const { type, member } = VERIFICATION[channel];
  const verifications = await listInquiryVerifications(db, inquiry.environmentId, inquiry.id);
  const latest = verifications
    .filter((verification) => verification.type === type && verification.status === 'passed')
    .at(-1);
  if (latest === undefined) {
    return null;
  }
  const attributes = (await loadVerificationAttributes(db, latest)) as Readonly<
    Record<string, JsonValue | undefined>
  >;
  const value = attributes[member];
  return attributes['confirmed-at'] != null && typeof value === 'string' ? value : null;
}

const messageOf = (
  channel: LinkChannel,
  to: string,
  link: string,
  templateCountries: readonly string[] | null,
): WorkflowMessage => {
  const recipient = { to, basis: 'confirmed' as const, allowUnconfirmed: false };
  return channel === 'email'
    ? { ...recipient, kind: 'email', subject: SUBJECT, text: textOf(link), html: null }
    : { ...recipient, kind: 'sms', text: textOf(link), templateCountries };
};

async function sendLink(context: ActionContext, channel: LinkChannel): Promise<ActionResult> {
  const config = renderedConfig(context);
  const deps = apiDepsOf(context);
  const { environmentId, environmentKind, organizationId } = context;
  const inquiryId = config['inquiry-id'];
  const inquiry = await getInquiry(deps.db, environmentId, inquiryId);
  if (inquiry === null) {
    return { kind: 'failed', code: 'object_not_found' };
  }
  if (inquiry.redactedAt !== null) {
    return { kind: 'failed', code: 'subject_redacted' };
  }
  const to = await confirmedDestinationOf(deps.db, inquiry, channel);
  if (to === null) {
    return { kind: 'failed', code: 'recipient_not_allowed' };
  }
  const token = newOneTimeLinkToken();
  const { expiresAt, linkId } = await deps.db.transaction((tx) =>
    generateOneTimeLinkInTx(
      tx,
      deps,
      context.acting,
      inquiryId,
      config['expires-in-seconds'],
      token,
    ),
  );
  const link = buildOneTimeLinkUrl(deps.flowPublicUrl, inquiryId, token);
  // C126.2: without a `workflow-sms-countries` setting, the phone steps of this inquiry's template.
  const countries = await inquiryTemplateCountries(deps.db, inquiry);
  const delivered = await context.services.messenger.send(messageOf(channel, to, link, countries), {
    environmentId,
    environmentKind,
    organizationId,
    effect: { runId: context.runId, stepId: context.stepId, effectKey: context.effectKey },
    flowLink: link,
    scrub: [token],
  });
  const output = {
    // The link's row holds a hash of the token alone, so this names it and opens nothing.
    'one-time-link-id': `otl_${String(linkId)}`,
    'expires-at': expiresAt.toISOString(),
    ...delivered,
  };
  return delivered.delivery === 'unknown'
    ? { kind: 'unknown', output }
    : {
        kind: 'succeeded',
        output,
        subjects: [{ subjectId: inquiryId, source: 'read' }],
      };
}

export const SEND_INQUIRY_LINK_EMAIL_HANDLER: OutsideActionHandler = {
  key: 'send_inquiry_link_email',
  version: 1,
  shape: 'outside',
  execute: (context) => answering(() => sendLink(context, 'email')),
};

export const SEND_INQUIRY_LINK_SMS_HANDLER: OutsideActionHandler = {
  key: 'send_inquiry_link_sms',
  version: 1,
  shape: 'outside',
  execute: (context) => answering(() => sendLink(context, 'sms')),
};
