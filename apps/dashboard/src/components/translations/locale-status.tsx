import type { TemplateLocale } from '@openverify/contracts';
import { COPY_COPY } from '../../lib/copy/themes-copy';
import type { LocaleReviewStatuses, LocaleReviewView } from './locale-review';

export interface LocaleStatusListProps {
  readonly enabledLocales: readonly TemplateLocale[];
  readonly defaultLocale: TemplateLocale;
  readonly reviewStatus: LocaleReviewStatuses;
}

const copy = COPY_COPY.locales;

/** No text calls a translation reviewed without a record: a missing status is machine-drafted. */
const MACHINE_DRAFTED: LocaleReviewView = { status: 'machine-drafted' };

/** A status in words, with an icon of its own so it never rests on colour (1.4.1). */
export function reviewStatusWords(view: LocaleReviewView): { icon: string; words: string } {
  switch (view.status) {
    case 'source':
      return { icon: '●', words: copy.status.source };
    case 'machine-drafted':
      return { icon: '⚠', words: copy.status['machine-drafted'] };
    case 'partially-reviewed':
      return {
        icon: '◐',
        words: copy.status['partially-reviewed'](view.unreviewedKeys.join(', ')),
      };
    case 'reviewed':
      return { icon: '✓', words: copy.status.reviewed(view.by, view.date) };
  }
}

/**
 * C161.5: every enabled locale with its base tag, the default mark and the review status of its
 * built-in texts, from `LOCALE_REVIEW_STATUS` as the server passed it; and what an unreviewed
 * locale needs at publish.
 */
export function LocaleStatusList({
  enabledLocales,
  defaultLocale,
  reviewStatus,
}: LocaleStatusListProps) {
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <caption className="mb-2 text-left font-medium text-ink">{copy.statusCaption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pe-4 font-medium">
              {copy.enabled}
            </th>
            <th scope="col" className="py-2 font-medium">
              {copy.statusHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {enabledLocales.map((locale) => {
            const { icon, words } = reviewStatusWords(reviewStatus[locale] ?? MACHINE_DRAFTED);
            return (
              <tr key={locale} className="border-b border-line align-top">
                <th scope="row" className="py-2 pe-4 font-normal">
                  <span className="font-medium text-ink">{copy.names[locale]}</span>{' '}
                  <code className="font-mono text-xs">{locale}</code>
                  {locale === defaultLocale && (
                    <span className="ms-2 rounded-full px-2 py-0.5 text-xs ring-1 ring-control ring-inset">
                      {COPY_COPY.builder.defaultMark}
                    </span>
                  )}
                </th>
                <td className="py-2 text-ink">
                  <span aria-hidden="true" className="me-1">
                    {icon}
                  </span>
                  {words}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-ink-muted">{copy.unreviewedNote}</p>
    </div>
  );
}
