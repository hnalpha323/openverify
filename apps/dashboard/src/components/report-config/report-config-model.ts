/**
 * C153.4: the report template forms' words, each derived from the registry: the default every key
 * of a type takes when it is left out (`reportConfigDefaultValues`, whose values are provisional
 * with their basis in `REPORT_CONFIG_DEFAULTS`), and what a custom-list template's `list-ids: null`
 * means.
 */
import { reportConfigDefaultValues, type ReportType } from '@openverify/core';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';

const COPY = TEMPLATE_FORMS_COPY;

/** Each key's note: its default, or for the source lists and `list-ids` what leaving it means. */
export function reportConfigNotes(type: ReportType): Record<string, string> {
  return Object.fromEntries(
    Object.entries(reportConfigDefaultValues(type)).map(([key, value]) => {
      if (key === 'search-lists' && value === null) {
        return [key, COPY.reportForms.searchListsDefault];
      }
      const words = COPY.notes.defaultIs(JSON.stringify(value));
      return [key, key === 'list-ids' ? `${COPY.reportForms.listIdsNull} ${words}` : words];
    }),
  );
}
