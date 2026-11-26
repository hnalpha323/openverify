/**
 * The template page's sections (C155, C153.3, C156, C160, C162; Workflow 9C): one link per page
 * under `/templates/[id]`, the current one marked. Each page renders it under its header: the
 * overview and the flow builder are `dashboard-flow-builder`'s, settings `dashboard-template-forms`',
 * translations and theme `dashboard-themes-copy`'s, the preview `dashboard-preview`'s.
 */
import { cx } from '@openverify/ui';
import Link from 'next/link';
import { CONSOLE_COPY } from '../lib/copy/console';

export const TEMPLATE_TAB_KEYS = [
  'overview',
  'flow',
  'settings',
  'translations',
  'theme',
  'preview',
] as const;
export type TemplateTabKey = (typeof TEMPLATE_TAB_KEYS)[number];

/** The page of `key` for `templateId`. */
export function templateTabHref(templateId: string, key: TemplateTabKey): string {
  const base = `/templates/${encodeURIComponent(templateId)}`;
  return key === 'overview' ? base : `${base}/${key}`;
}

export interface TemplateTabsProps {
  readonly templateId: string;
  readonly current: TemplateTabKey;
}

export function TemplateTabs({ templateId, current }: TemplateTabsProps) {
  const copy = CONSOLE_COPY.templateTabs;
  return (
    <nav aria-label={copy.label}>
      <ul className="flex flex-wrap gap-1 border-b border-line">
        {TEMPLATE_TAB_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={templateTabHref(templateId, key)}
              aria-current={key === current ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center rounded-t-md px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                key === current
                  ? 'border-b-2 border-ink font-semibold text-ink'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {copy[key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
