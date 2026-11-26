/**
 * C126.1, C126.2: whether a rendered recipient is one the run object's person confirmed with a code.
 * The run object is the trigger's inquiry and every inquiry the run has as a subject, so a step can
 * reach a person it found on the way. A literal in the definition is no field of anyone: it needs the
 * allowlist, whatever it says.
 */
import {
  getInquiry,
  getInquiryTemplateVersion,
  listInquiryVerifications,
  listWorkflowRunSubjectIds,
  type Db,
  type Inquiry,
} from '@openverify/db';
import type { JsonValue } from '@openverify/workflow-engine';
import { loadVerificationAttributes } from '../../../services/attributes/index.js';
import type { ActionContext } from '../../engine/action-port.js';
import type { WorkflowMessageRecipientBasis } from './port.js';

type Channel = 'email' | 'sms';

const VERIFICATION = {
  email: { type: 'email_address', member: 'email-address' },
  sms: { type: 'phone_number', member: 'phone-number' },
} as const;

async function runInquiries(context: ActionContext): Promise<Inquiry[]> {
  const { services, environmentId, runId, scope } = context;
  const { trigger } = scope.roots;
  const triggerId =
    typeof trigger === 'object' && trigger !== null && !Array.isArray(trigger)
      ? trigger.id
      : undefined;
  const subjects = await listWorkflowRunSubjectIds(services.db, environmentId, [runId]);
  const ids = new Set(
    [...(subjects.get(runId) ?? []), ...(typeof triggerId === 'string' ? [triggerId] : [])].filter(
      (id) => id.startsWith('inq_'),
    ),
  );
  const inquiries = await Promise.all(
    [...ids].map((id) => getInquiry(services.db, environmentId, id)),
  );
  return inquiries.filter((inquiry) => inquiry !== null);
}

async function confirmedOf(db: Db, inquiry: Inquiry, channel: Channel): Promise<readonly string[]> {
  const { type, member } = VERIFICATION[channel];
  const verifications = await listInquiryVerifications(db, inquiry.environmentId, inquiry.id);
  const found: string[] = [];
  for (const verification of verifications) {
    if (verification.type === type && verification.status === 'passed') {
      const attributes = (await loadVerificationAttributes(db, verification)) as Readonly<
        Record<string, JsonValue | undefined>
      >;
      const value = attributes[member];
      if (attributes['confirmed-at'] != null && typeof value === 'string') {
        found.push(value);
      }
    }
  }
  return found;
}

/** C126.1, C126.2: what a rendered recipient is to the run. */
export async function recipientBasisOf(
  context: ActionContext,
  channel: Channel,
  recipient: string,
  literal: boolean,
): Promise<WorkflowMessageRecipientBasis> {
  if (literal) {
    return 'literal';
  }
  const wanted = recipient.trim().toLowerCase();
  for (const inquiry of await runInquiries(context)) {
    const confirmed = await confirmedOf(context.services.db, inquiry, channel);
    if (confirmed.some((value) => value.toLowerCase() === wanted)) {
      return 'confirmed';
    }
  }
  return 'unconfirmed';
}

const countriesIn = (flow: unknown): readonly string[] => {
  const { steps } = (flow ?? {}) as { steps?: unknown };
  if (!Array.isArray(steps)) {
    return [];
  }
  return (steps as { type?: unknown; allowedCountries?: unknown }[]).flatMap((step) =>
    step.type === 'phone_otp' && Array.isArray(step.allowedCountries)
      ? (step.allowedCountries as string[])
      : [],
  );
};

/** C126.2: what the phone steps of an inquiry's pinned version accept. */
export async function inquiryTemplateCountries(
  db: Db,
  inquiry: Inquiry,
): Promise<readonly string[]> {
  const version = await getInquiryTemplateVersion(
    db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  return countriesIn(version?.flow);
}

/** C126.2: what the phone steps of the run's inquiries accept; `null` with none in scope. */
export async function templateCountriesOf(
  context: ActionContext,
): Promise<readonly string[] | null> {
  const inquiries = await runInquiries(context);
  if (inquiries.length === 0) {
    return null;
  }
  const countries = await Promise.all(
    inquiries.map((inquiry) => inquiryTemplateCountries(context.services.db, inquiry)),
  );
  return [...new Set(countries.flat())];
}
