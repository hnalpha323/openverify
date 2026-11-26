/**
 * C161.5 (Workflow 9C, `dashboard-themes-copy`): a built-in locale's review status as the console
 * shows it. Structurally a supertype of `LocaleReviewStatus` (`@openverify/flow-spec`), so its
 * `LOCALE_REVIEW_STATUS` can be passed as it is; client components receive it as plain data.
 */
import type { TemplateLocale } from '@openverify/contracts';

export type LocaleReviewView =
  | { readonly status: 'source' }
  | { readonly status: 'machine-drafted' }
  | {
      readonly status: 'partially-reviewed';
      readonly unreviewedKeys: readonly string[];
      readonly by?: string;
      readonly date?: string;
    }
  | {
      readonly status: 'reviewed';
      readonly by: string;
      readonly date: string;
      readonly catalogSha256?: string;
    };

/** The review status of each locale; a locale left out is shown as machine-drafted. */
export type LocaleReviewStatuses = Readonly<Partial<Record<TemplateLocale, LocaleReviewView>>>;
