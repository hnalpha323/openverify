import { idSchema, type TemplateLocale } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { TemplateTabs } from '../../../../components/template-tabs';
import { copyCodeWords } from '../../../../components/translations/code-words';
import {
  copyKeyCatalog,
  editorRowsOf,
  localeReviewStatuses,
} from '../../../../components/translations/copy-key-catalog';
import { CopyRules } from '../../../../components/translations/copy-rules';
import { CsvPanel } from '../../../../components/translations/csv-panel';
import { LocaleStatusList } from '../../../../components/translations/locale-status';
import { LocalesForm } from '../../../../components/translations/locales-form';
import { tabVersionOf } from '../../../../components/translations/tab-version';
import { TranslationsEditor } from '../../../../components/translations/translations-editor';
import { retrieveTemplateVersion } from '../../../../lib/api/inquiry-template-versions';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { getTranslations } from '../../../../lib/api/translations';
import { COPY_COPY } from '../../../../lib/copy/themes-copy';
import { importTranslationRows, saveTemplateLocales } from './actions';

const copy = COPY_COPY.translations;

export const metadata: Metadata = { title: copy.metadataTitle };

export interface TemplateTranslationsPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The members a version served before Phase 9 leaves out read as the API's defaults. */
const DEFAULT_LOCALES: readonly TemplateLocale[] = ['en'];

/** A draft problem the translations page explains: copy, locale and acknowledgement codes. */
const isCopyProblem = (pointer: string, code: string) =>
  pointer.startsWith('/copy') ||
  pointer.startsWith('/enabled-locales') ||
  pointer.startsWith('/default-locale') ||
  code in COPY_COPY.codes;

/**
 * The template's translations tab (C161.5, C162): the languages the flow offers with the review
 * status of each, the texts per language with their rules, saved into the draft (never published),
 * the CSV import and export, the consent-copy rule and the fallbacks. Reads the latest draft, else
 * the current version, with `inquiry-templates:read`; changes need `inquiry-templates:write`.
 */
export default async function TemplateTranslationsPage({ params }: TemplateTranslationsPageProps) {
  const { id } = await params;
  if (!idSchema('itmpl').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ session, api }) => {
    const [{ data: template }, translations] = await Promise.all([
      api.inquiryTemplates.retrieve(id),
      getTranslations(api, id),
    ]);
    const shown = await tabVersionOf(api, id, template.attributes['current-version'].id);
    const { attributes } = shown;
    const draft = attributes.status === 'draft';
    const canWrite = hasPermission(session, 'inquiry-templates:write');
    const etag = draft && canWrite ? (await retrieveTemplateVersion(shown.id)).etag : null;
    const enabledLocales = attributes['enabled-locales'] ?? DEFAULT_LOCALES;
    const defaultLocale = attributes['default-locale'] ?? 'en';
    const problems = (attributes.validation?.problems ?? []).filter((problem) =>
      isCopyProblem(problem.pointer, problem.code),
    );
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Templates', href: '/templates' },
            { label: template.attributes.name, href: `/templates/${id}` },
            { label: copy.title },
          ]}
          title={copy.title}
          description={copy.description}
        />
        <TemplateTabs templateId={id} current="translations" />
        <p className="text-sm text-ink">{copy.sourceLine(attributes['version-number'], draft)}</p>
        <PageSection
          id="translations-locales"
          title={COPY_COPY.locales.heading}
          description={COPY_COPY.locales.description}
        >
          <LocaleStatusList
            enabledLocales={enabledLocales}
            defaultLocale={defaultLocale}
            reviewStatus={localeReviewStatuses()}
          />
          {etag !== null ? (
            <LocalesForm
              templateId={id}
              versionId={shown.id}
              etag={etag}
              enabledLocales={enabledLocales}
              defaultLocale={defaultLocale}
              action={saveTemplateLocales}
            />
          ) : (
            canWrite && <p className="text-sm text-ink-muted">{COPY_COPY.locales.noDraft}</p>
          )}
        </PageSection>
        {problems.length > 0 && (
          <PageSection id="translations-problems" title={copy.validationHeading}>
            <ul className="list-disc ps-5 text-sm">
              {problems.map((problem) => (
                <li key={`${problem.pointer}:${problem.code}`}>
                  <code className="font-mono text-xs">{problem.pointer}</code>:{' '}
                  {copyCodeWords(problem.code)}
                </li>
              ))}
            </ul>
          </PageSection>
        )}
        <PageSection id="translations-texts" title={copy.tableCaption}>
          <TranslationsEditor
            templateId={id}
            keys={copyKeyCatalog(attributes.flow)}
            values={editorRowsOf(translations.data.attributes.translations)}
            enabledLocales={enabledLocales}
            {...(canWrite ? { action: importTranslationRows } : {})}
          />
        </PageSection>
        <PageSection id="translations-rules" title={COPY_COPY.rules.consentHeading}>
          <CopyRules />
        </PageSection>
        <PageSection id="translations-csv" title={COPY_COPY.csv.heading}>
          <CsvPanel templateId={id} canWrite={canWrite} />
        </PageSection>
      </PageMain>
    );
  });
}
