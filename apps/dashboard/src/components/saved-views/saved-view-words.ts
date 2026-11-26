/** Saved views in words (C165.2, C165.5). */
import { ANALYTICS_COPY } from '../../lib/copy/analytics';

export const SAVED_VIEW_COPY = ANALYTICS_COPY.savedViews;

/** The personal-data refusal (C165.2, `saved_view_pii_filter`), naming the filter keys only. */
export function piiRefusalWords(keys: readonly string[]): string {
  return SAVED_VIEW_COPY.piiDetail.replace('{keys}', keys.join(', '));
}
