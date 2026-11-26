/**
 * C70.4 (F10): the C14 filter subjects of report events. `eventFilterSubjects`
 * (`events/subject.ts`) hands this hook every payload whose `data` is a `report/<type>` and marks
 * what it answers strict, so a report without the filtered attribute fails a present filter. The
 * hook resolves the report's `inquiry` relationship to that inquiry's template and its `account`
 * relationship to the account's `account_type_id`, both scoped to the environment; an attribute it
 * cannot resolve is left out.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3); the signature is frozen by `foundation-6`
 * (Stage 1b). Ids of another environment resolve to nothing.
 */
import type { WebhookFilterSubject } from '@openverify/core';
import { getAccount, getInquiry, type Db } from '@openverify/db';

export type ResolveReportFilterSubjects = (
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
) => Promise<Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'>[]>;

/** The id of a payload's `relationships.<name>.data`, if any. */
function linkedId(payload: unknown, name: 'inquiry' | 'account'): string | null {
  const data = (payload as { data?: { relationships?: Record<string, unknown> } } | null)?.data;
  const link = data?.relationships?.[name] as { data?: { id?: unknown } | null } | undefined;
  const id = link?.data?.id;
  return typeof id === 'string' ? id : null;
}

export const resolveReportFilterSubjects: ResolveReportFilterSubjects = async (
  db,
  environmentId,
  payloads,
) => {
  const subjects: Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'>[] = [];
  for (const payload of payloads) {
    const subject: Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'> = {};
    const inquiryId = linkedId(payload, 'inquiry');
    const inquiry = inquiryId === null ? null : await getInquiry(db, environmentId, inquiryId);
    if (inquiry !== null) {
      subject.inquiryTemplateId = inquiry.inquiryTemplateId;
    }
    const accountId = linkedId(payload, 'account');
    const account = accountId === null ? null : await getAccount(db, environmentId, accountId);
    if (account !== null) {
      subject.accountTypeId = account.accountTypeId;
    }
    subjects.push(subject);
  }
  return subjects;
};
