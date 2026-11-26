import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import type { SupportedLanguage } from '../i18n/languages';
import { FlowLanguagesContext } from './flow-languages';
import {
  FLOW_LINK_NAMES,
  FlowLinksContext,
  NO_FLOW_LINKS,
  ReportFlowLinksContext,
  sameFlowLinks,
  type FlowLinkName,
  type FlowLinks,
} from './flow-links';
import { ThemeBranding } from '../theme/branding';
import { LanguageSelect } from './language-select';

/** C162.3: each link's copy key (`COPY_KEYS`), which the operator may word. */
const LINK_COPY_KEYS = {
  'help-url': 'screen.helpLink',
  'privacy-url': 'screen.privacyLink',
} as const satisfies Readonly<Record<FlowLinkName, string>>;

/**
 * Page chrome for every step. Spacing uses logical properties (`ps-*`, `ms-*`,
 * `text-start`) only, so the layout mirrors itself when `<html dir="rtl">`.
 *
 * C161.2, C162.3 (Workflow 9A; WCAG 3.2.6): the language selector sits in one fixed slot after
 * every step's content, the same place on every screen, offering only the version's enabled locales
 * once the session names them. C162.3 (Workflow 9B, api-flow-carry): the same slot shows the
 * version's help and privacy links once a session names them (`https:` only), each opened in a new
 * browsing context with `rel="noopener noreferrer"`; the screens' `link` buttons read them too.
 */
export function FlowLayout() {
  const { t, i18n } = useTranslation();
  // C160.6: a logo's alt text is an operator copy key; one with no text reads as the flow's name.
  const logoText = useCallback(
    (key: string): string => {
      const text: unknown = i18n.getResource(
        i18n.resolvedLanguage ?? i18n.language,
        'translation',
        key,
      );
      return typeof text === 'string' && text !== '' ? text : t('app.name');
    },
    [i18n, t],
  );
  const [available, setAvailable] = useState<readonly SupportedLanguage[] | null>(null);
  const [links, setLinks] = useState<FlowLinks>(NO_FLOW_LINKS);
  const reportLinks = useCallback((next: FlowLinks) => {
    setLinks((current) => (sameFlowLinks(current, next) ? current : next));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4 px-4 py-2">
          <ThemeBranding fallback={t('app.name')} translate={logoText} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 text-start">
        <FlowLanguagesContext value={setAvailable}>
          <ReportFlowLinksContext value={reportLinks}>
            <FlowLinksContext value={links}>
              <Outlet />
            </FlowLinksContext>
          </ReportFlowLinksContext>
        </FlowLanguagesContext>
      </main>
      <footer className="border-t border-line bg-surface" data-slot="help">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-end gap-4 px-4 py-2">
          {FLOW_LINK_NAMES.map((name) => {
            const url = links[name];
            return url === undefined ? null : (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {t(LINK_COPY_KEYS[name])}
              </a>
            );
          })}
          <LanguageSelect {...(available === null ? {} : { available })} />
        </div>
      </footer>
    </div>
  );
}
