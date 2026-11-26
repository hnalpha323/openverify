/**
 * C149.4 (Workflow 9A, api-flow-engine): the inquiry-comparison checks (`id_inquiry_comparison`,
 * `database_inquiry_comparison`) compare with a field's initial value when one exists, else its
 * current value, and record which, so a person cannot edit an expected name to match the document
 * they hold. The initial values are the `fields` of `POST /inquiries`, sealed in `initial_fields`
 * and never changed (`getInquiryInitialFields`). The two call sites, the input builders in
 * `jobs/government-id.ts` and `jobs/types/database.ts`, were placed by `foundation-9a` (Stage 1b (S));
 * since Workflow 9B (`api-flow-carry`) both pass `sources` as the checks' `inquiryFieldSources`, and
 * the two checks record them under `comparison-source` (B47).
 *
 * A key "has an initial value" when the creation set it to anything but `null`. Nothing here is
 * logged; the values stay in memory for the check.
 */
import type { ComparisonSourceKind } from '@openverify/checks';
import { getInquiryInitialFields, type Db, type Inquiry, type InquiryFields } from '@openverify/db';

/** Where a compared field's value came from (C149.4): the checks' own kinds (Workflow 9B, (F)). */
export type { ComparisonSourceKind };

/** The fields a comparison check reads, and for each key where its value came from. */
export interface ComparisonSource {
  fields: InquiryFields;
  /** By field key: `initial` (set at creation) or `entered` (set later, by the flow or the API). */
  sources: Readonly<Record<string, ComparisonSourceKind>>;
}

/** The fields the comparison checks of `inquiry` compare with. */
export async function comparisonSourceFor(
  db: Db,
  inquiry: Pick<Inquiry, 'id' | 'environmentId' | 'fields'>,
): Promise<ComparisonSource> {
  const initial = (await getInquiryInitialFields(db, inquiry.environmentId, inquiry.id)) ?? {};
  const fields: Record<string, unknown> = {};
  const sources: Record<string, ComparisonSourceKind> = {};
  for (const [key, value] of Object.entries(inquiry.fields)) {
    fields[key] = value;
    sources[key] = 'entered';
  }
  for (const [key, value] of Object.entries(initial)) {
    if (value !== null && value !== undefined) {
      fields[key] = value;
      sources[key] = 'initial';
    }
  }
  return { fields, sources };
}
