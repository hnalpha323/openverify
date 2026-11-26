/**
 * C107.4 (Workflow 7B; V14): the strict webhook filter subject of a `list-match` event, which
 * resolves through its inquiry to the inquiry's template and its account's type. Owner: `api-lists`.
 * `eventFilterSubjects` marks what it answers strict, so a match it cannot resolve fails any filter
 * that is present and never reaches a template-scoped webhook. Ids of another environment resolve
 * to nothing.
 */
import type { WebhookFilterSubject } from '@openverify/core';
import { getAccount, getInquiry, type Db } from '@openverify/db';

export type ResolveListMatchFilterSubjects = (
  db: Db,
  environmentId: string,
  payloads: readonly unknown[],
) => Promise<Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'>[]>;

/** The id of a payload's `relationships.inquiry.data`, if any. */
function inquiryIdOf(payload: unknown): string | null {
  const data = (payload as { data?: { relationships?: Record<string, unknown> } } | null)?.data;
  const link = data?.relationships?.inquiry as { data?: { id?: unknown } | null } | undefined;
  const id = link?.data?.id;
  return typeof id === 'string' ? id : null;
}

export const resolveListMatchFilterSubjects: ResolveListMatchFilterSubjects = async (
  db,
  environmentId,
  payloads,
) => {
  const subjects: Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'>[] = [];
  for (const payload of payloads) {
    const subject: Pick<WebhookFilterSubject, 'inquiryTemplateId' | 'accountTypeId'> = {};
    const inquiryId = inquiryIdOf(payload);
    const inquiry = inquiryId === null ? null : await getInquiry(db, environmentId, inquiryId);
    if (inquiry !== null) {
      subject.inquiryTemplateId = inquiry.inquiryTemplateId;
      const account = await getAccount(db, environmentId, inquiry.accountId);
      if (account !== null) {
        subject.accountTypeId = account.accountTypeId;
      }
    }
    subjects.push(subject);
  }
  return subjects;
};
