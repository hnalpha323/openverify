import type { TemplateCopy, TemplateLocale } from '@openverify/contracts';
import Link from 'next/link';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import { LINK_CLASS } from '../link-styles';
import type { LocaleReviewStatuses } from './locale-review';
import { reviewStatusWords } from './locale-status';

export interface BuilderCopyPanelProps {
  readonly templateId: string;
  /** The version's `enabled-locales` (base tags only). */
  readonly enabledLocales: readonly TemplateLocale[];
  readonly defaultLocale: TemplateLocale;
  /** The version's `copy`; absent on a version served before Phase 9. */
  readonly copy?: TemplateCopy | undefined;
  /** `LOCALE_REVIEW_STATUS` of `@openverify/flow-spec`, as plain data. */
  readonly reviewStatus: LocaleReviewStatuses;
}

/**
 * C155.8, C161.5, C162 (`dashboard-themes-copy`; mounted by `dashboard-flow-builder`): the
 * builder's languages and copy panel. Every enabled locale shows its review status and how many
 * texts the version rewords in it; the texts themselves are edited on the translations page.
 */
export function BuilderCopyPanel({
  templateId,
  enabledLocales,
  defaultLocale,
  copy,
  reviewStatus,
}: BuilderCopyPanelProps) {
  const words = COPY_COPY.builder;
  return (
    <section aria-labelledby="builder-copy-heading" className="flex flex-col gap-3">
      <h2 id="builder-copy-heading" className="text-base font-semibold text-ink">
        {words.copyHeading}
      </h2>
      <p className="text-sm text-ink-muted">{words.copyHint}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {enabledLocales.map((locale) => {
          const status = reviewStatusWords(reviewStatus[locale] ?? { status: 'machine-drafted' });
          return (
            <li key={locale} className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">
                {COPY_COPY.locales.names[locale]}{' '}
                <code className="font-mono text-xs">{locale}</code>
                {locale === defaultLocale && ` (${words.defaultMark})`}
              </span>
              <span>{words.overrides(Object.keys(copy?.messages[locale] ?? {}).length)}</span>
              <span className="text-ink-muted">
                <span aria-hidden="true" className="me-1">
                  {status.icon}
                </span>
                {status.words}
              </span>
            </li>
          );
        })}
      </ul>
      <Link
        href={`/templates/${encodeURIComponent(templateId)}/translations`}
        className={LINK_CLASS}
      >
        {words.openTranslations}
      </Link>
    </section>
  );
}
