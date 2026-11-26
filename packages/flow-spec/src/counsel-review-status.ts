/**
 * C238.10 (Phase 11, Workflow 11A; reviews P14, H08): the counsel review status of the built-in
 * texts with legal weight that Connect added, beside Phase 9's locale review status
 * (`locale-review-status.ts`), which records the fluent review of each locale. Until Q7 records
 * counsel's review, every built-in `share.consent.*` text is `counsel-unreviewed`: the template
 * editor shows it as "not reviewed by counsel", and publishing a version whose `share_consent` step
 * uses it needs the acknowledgement `share-consent-default-text:<step id>`. Only a commit that
 * records counsel's review changes a value here.
 */
import { COPY_KEYS } from './v2/copy-keys.js';

export const COUNSEL_REVIEW_STATUSES = ['counsel-unreviewed', 'counsel-reviewed'] as const;
export type CounselReviewStatus = (typeof COUNSEL_REVIEW_STATUSES)[number];

export const COUNSEL_REVIEW_STATUS: Readonly<Record<string, CounselReviewStatus>> = Object.freeze(
  Object.fromEntries(
    Object.keys(COPY_KEYS)
      .filter((key) => key.startsWith('share.consent.'))
      .map((key): [string, CounselReviewStatus] => [key, 'counsel-unreviewed']),
  ),
);

/** Whether the built-in text of `key` still waits for counsel's review. */
export function counselUnreviewed(key: string): boolean {
  return COUNSEL_REVIEW_STATUS[key] === 'counsel-unreviewed';
}
