/**
 * The version the template's theme and translations tabs show (Workflow 9C): the template's
 * draft, which a save changes, else its current version, read-only.
 */
import 'server-only';
import type { InquiryTemplateVersionResource } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';

export async function tabVersionOf(
  api: OpenVerifyClient,
  templateId: string,
  currentVersionId: string,
): Promise<InquiryTemplateVersionResource> {
  const drafts = await api.inquiryTemplateVersions.list({
    filter: { 'inquiry-template-id': templateId, status: 'draft' },
    page: { size: 1 },
  });
  const draft = drafts.data[0];
  if (draft !== undefined) {
    return draft;
  }
  return (await api.inquiryTemplateVersions.retrieve(currentVersionId)).data;
}
