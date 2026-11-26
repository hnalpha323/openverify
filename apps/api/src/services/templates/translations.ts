/**
 * C162.7 (Workflow 9A, `api-templates`): a template's translations, from its latest draft, else its
 * latest published version. One row per text of the version's `copy`: a built-in key (`COPY_KEYS`,
 * no step or component) or a component text (`<step id>.<component id>.<attribute>`), with its value
 * in each enabled locale. An import writes into the draft (creating one from the latest published
 * version), partially: a blank value deletes nothing, nothing is published, and a text that breaks a
 * copy rule refuses the import at its row and column, never echoing the value. The CSV form is
 * `step,component,attribute,<locale>…`, written by Phase 7's formula-neutralising writer (every cell
 * quoted, every string neutralised) and read by Phase 8's `readCsv`, so one neutraliser is stripped
 * per cell and a text that starts with `=` or `-` round-trips unchanged.
 */
import {
  TRANSLATIONS_CSV_FIXED_COLUMNS,
  TRANSLATIONS_CSV_LIMITS,
  templateLocaleSchema,
  type InquiryTemplateTranslationsDocument,
  type TranslationRow,
} from '@openverify/contracts';
import { readCsv, stripNeutraliser, writeCsv, type CsvProblem } from '@openverify/checks';
import {
  createDraftInquiryTemplateVersion,
  findLatestTemplateVersion,
  findTemplateDraft,
  getInquiryTemplateRow,
  updateDraftInquiryTemplateVersion,
  type Db,
  type InquiryTemplateVersion,
} from '@openverify/db';
import { COPY_KEYS, isFlowV2, safeParseAnyFlow } from '@openverify/flow-spec';
import { NotFoundError, UnprocessableContentError, type ProblemFieldError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { audit, validateDraftInTx, type TemplateActing } from '../inquiry-templates.js';
import { copyRuleProblems, normaliseCopy } from './copy-rules.js';
import { contentOf } from './operations.js';
import { storedCopy } from './versions.js';

/** The version a template's translations are read from: its draft, else its published version. */
async function sourceVersion(
  db: Db,
  environmentId: string,
  templateId: string,
): Promise<InquiryTemplateVersion> {
  if ((await getInquiryTemplateRow(db, environmentId, templateId)) === null) {
    throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
  }
  const version =
    (await findTemplateDraft(db, environmentId, templateId)) ??
    (await findLatestTemplateVersion(db, environmentId, templateId, ['published']));
  if (version === null) {
    throw new NotFoundError(`Inquiry template ${templateId} has no version to translate.`);
  }
  return version;
}

const keyOf = (row: Pick<TranslationRow, 'step' | 'component' | 'attribute-name'>) =>
  row.step === null || row.component === null
    ? row['attribute-name']
    : `${row.step}.${row.component}.${row['attribute-name']}`;

/** The rows of a version's copy, in key order, with each enabled locale's value. */
function rowsOf(version: InquiryTemplateVersion): TranslationRow[] {
  const copy = storedCopy(version);
  const locales = version.enabledLocales;
  const flow = safeParseAnyFlow(version.flow);
  const stepNames = new Map(
    flow.success && isFlowV2(flow.data)
      ? flow.data.steps.map((step) => [step.id, 'name' in step ? (step.name ?? null) : null])
      : [],
  );
  const keys = [
    ...new Set(Object.values(copy.messages).flatMap((texts) => Object.keys(texts))),
  ].sort();
  return keys.map((key) => {
    const builtIn = COPY_KEYS[key] !== undefined;
    const [step = null, component = null, ...attribute] = builtIn ? [] : key.split('.');
    return {
      step: builtIn ? null : step,
      'step-display-name': builtIn || step === null ? null : (stepNames.get(step) ?? null),
      component: builtIn ? null : component,
      'attribute-name': builtIn ? key : attribute.join('.'),
      'locale-values': locales.flatMap((locale) => {
        const value = copy.messages[locale]?.[key];
        return value === undefined ? [] : [{ locale, value }];
      }),
    };
  });
}

function documentOf(
  templateId: string,
  version: InquiryTemplateVersion,
): InquiryTemplateTranslationsDocument {
  return {
    data: {
      type: 'inquiry-template-translations',
      id: templateId,
      attributes: { 'inquiry-template-version-id': version.id, translations: rowsOf(version) },
    },
  };
}

/** `GET /inquiry-templates/:id/translations`. */
export async function readTranslations(
  { db }: ApiDependencies,
  environmentId: string,
  templateId: string,
): Promise<InquiryTemplateTranslationsDocument> {
  return documentOf(templateId, await sourceVersion(db, environmentId, templateId));
}

/** One imported value and where the request holds it. */
interface ImportedCell {
  locale: string;
  key: string;
  value: string;
  pointer: string;
}

/** Writes the cells into the template's draft (made from the published version when none). */
async function importCells(
  deps: ApiDependencies,
  acting: TemplateActing,
  templateId: string,
  cells: readonly ImportedCell[],
): Promise<InquiryTemplateTranslationsDocument> {
  const { environmentId } = acting.ctx;
  const stored = await deps.db.transaction(async (tx) => {
    const source = await sourceVersion(tx, environmentId, templateId);
    const draft =
      source.status === 'draft'
        ? source
        : await createDraftInquiryTemplateVersion(
            tx,
            environmentId,
            templateId,
            contentOf(source, deps.ids.newId('itmplv')),
          );
    if (draft === null) {
      throw new NotFoundError(`Inquiry template ${templateId} was not found.`);
    }
    const enabled = new Set<string>(draft.enabledLocales);
    const messages = structuredClone(storedCopy(draft).messages) as Record<
      string,
      Record<string, string>
    >;
    const refused: ProblemFieldError[] = [];
    const written = new Map<string, string>();
    for (const cell of cells) {
      if (cell.value === '') continue;
      if (!enabled.has(cell.locale)) {
        refused.push({
          location: 'body',
          pointer: cell.pointer,
          detail: 'The draft does not enable this locale.',
          code: 'locale_unsupported',
        });
        continue;
      }
      (messages[cell.locale] ??= {})[cell.key] = cell.value;
      written.set(
        `/copy/messages/${cell.locale}/${cell.key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        cell.pointer,
      );
    }
    const copy = normaliseCopy({ messages });
    const flow = safeParseAnyFlow(draft.flow);
    if (flow.success) {
      for (const problem of copyRuleProblems(copy, {
        flow: flow.data,
        enabledLocales: draft.enabledLocales,
        environmentKind: acting.environmentKind,
      }).problems) {
        const pointer = written.get(problem.pointer);
        if (problem.severity === 'error' && pointer !== undefined) {
          refused.push({ location: 'body', pointer, detail: problem.detail, code: problem.code });
        }
      }
    }
    if (refused.length > 0) {
      throw new UnprocessableContentError(
        'A translation breaks a copy rule; each is named by its place.',
        refused,
      );
    }
    const updated = await updateDraftInquiryTemplateVersion(tx, environmentId, draft.id, {
      members: { copy },
    });
    if (updated === null) {
      throw new NotFoundError(`Inquiry template ${templateId} has no draft to import into.`);
    }
    const validated = await validateDraftInTx(tx, acting, updated, true);
    await audit(deps, tx, acting, {
      action: 'inquiry-template-version.updated',
      resourceType: 'inquiry-template-version',
      resourceId: draft.id,
      metadata: { attributes: ['copy'], 'translations-imported': written.size },
    });
    return validated;
  });
  return documentOf(templateId, stored);
}

/** `POST /inquiry-templates/:id/translations` (JSON rows). */
export function importTranslations(
  deps: ApiDependencies,
  acting: TemplateActing,
  templateId: string,
  rows: readonly TranslationRow[],
): Promise<InquiryTemplateTranslationsDocument> {
  return importCells(
    deps,
    acting,
    templateId,
    rows.flatMap((row, index) =>
      row['locale-values'].map(({ locale, value }, valueIndex) => ({
        locale,
        key: keyOf(row),
        value,
        pointer: `/data/attributes/translations/${String(index)}/locale-values/${String(valueIndex)}/value`,
      })),
    ),
  );
}

/** `GET /inquiry-templates/:id/translations.csv`: one row per text, every cell neutralised. */
export async function translationsCsv(
  { db }: ApiDependencies,
  environmentId: string,
  templateId: string,
): Promise<string> {
  const version = await sourceVersion(db, environmentId, templateId);
  const locales = version.enabledLocales;
  return writeCsv(
    [...TRANSLATIONS_CSV_FIXED_COLUMNS, ...locales],
    rowsOf(version).map((row) => [
      row.step,
      row.component,
      row['attribute-name'],
      ...locales.map(
        (locale) => row['locale-values'].find((value) => value.locale === locale)?.value ?? null,
      ),
    ]),
  );
}

/** The header's refusals: the three fixed columns, then built-in locales, each once. */
function headerProblems(header: readonly string[]): CsvProblem[] {
  const problems: CsvProblem[] = [];
  TRANSLATIONS_CSV_FIXED_COLUMNS.forEach((column, index) => {
    if (header[index] !== column) problems.push({ row: null, column, code: 'missing_column' });
  });
  header.slice(TRANSLATIONS_CSV_FIXED_COLUMNS.length).forEach((column) => {
    if (!templateLocaleSchema.safeParse(column).success) {
      problems.push({ row: null, column: null, code: 'unknown_column' });
    }
  });
  return problems;
}

/** `POST /inquiry-templates/:id/translations.csv`: refused whole on any parser or header problem. */
export function importTranslationsCsv(
  deps: ApiDependencies,
  acting: TemplateActing,
  templateId: string,
  bytes: Uint8Array,
): Promise<InquiryTemplateTranslationsDocument> {
  const reading = readCsv(bytes, {
    maxRows: TRANSLATIONS_CSV_LIMITS.rows,
    maxRecordCharacters: TRANSLATIONS_CSV_LIMITS.bytes,
    headerProblems,
  });
  if (reading.refused || reading.errors.length > 0) {
    throw new UnprocessableContentError(
      'The translations file is refused; each problem names its row and column.',
      reading.errors.map(({ row, column, code }) => ({
        location: 'body',
        pointer: `/rows/${row === null ? 'header' : String(row)}${column === null ? '' : `/${column}`}`,
        detail: code,
        code,
      })),
    );
  }
  const cells = reading.rows.flatMap(({ row, cells: values }) => {
    const cell = (name: string) => stripNeutraliser(values[name] ?? '');
    const step = cell('step') === '' ? null : cell('step');
    const component = cell('component') === '' ? null : cell('component');
    const key = keyOf({ step, component, 'attribute-name': cell('attribute') });
    return Object.keys(values)
      .filter((name) => !(TRANSLATIONS_CSV_FIXED_COLUMNS as readonly string[]).includes(name))
      .map((locale) => ({
        locale,
        key,
        value: cell(locale),
        pointer: `/rows/${String(row)}/${locale}`,
      }));
  });
  return importCells(deps, acting, templateId, cells);
}
