/**
 * C162.7 (public, behaviour note 2.4; Workflow 9A Stage 1a, (T)): a template's translations, from its
 * latest draft, else its latest published version. `POST` imports rows into the draft (creating one
 * from the latest published version when none exists), partially, never publishes, and a blank cell
 * never deletes. The CSV form (`translations.csv`, ours) has the same rows, written by Phase 7's
 * formula-neutralising writer and read by Phase 8's `readCsv`; import problems name the row and the
 * column and never echo a value. Operator copy is not personal data.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { singleDocumentSchema } from './json-api.js';
import { templateLocaleSchema } from './template-fields.js';

/** C162.7 (ours): at most 2 MiB and 20,000 rows of CSV. */
export const TRANSLATIONS_CSV_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, rows: 20_000 });

export const translationRowSchema = z.strictObject({
  /** The step id; `null` for a built-in key that belongs to no step. */
  step: z.string().max(64).nullable(),
  'step-display-name': z.string().max(200).nullable(),
  /** The component id; `null` for a built-in key. */
  component: z.string().max(64).nullable(),
  /** `label`, `hint`, `title`, `body`, `button`, `alt`, `option.<key>`, or a built-in copy key. */
  'attribute-name': z.string().min(1).max(200),
  'locale-values': z
    .array(z.strictObject({ locale: templateLocaleSchema, value: z.string().max(10_000) }))
    .max(5),
});
export type TranslationRow = z.infer<typeof translationRowSchema>;

export const inquiryTemplateTranslationsAttributesSchema = z.strictObject({
  /** The version the rows come from: the latest draft, else the latest published version. */
  'inquiry-template-version-id': idSchema('itmplv'),
  translations: z.array(translationRowSchema).max(20_000),
});

export const inquiryTemplateTranslationsDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-translations'),
    id: idSchema('itmpl'),
    attributes: inquiryTemplateTranslationsAttributesSchema,
  }),
);
export type InquiryTemplateTranslationsDocument = z.infer<
  typeof inquiryTemplateTranslationsDocumentSchema
>;

/** `POST /inquiry-templates/:id/translations`: rows to import; a blank value deletes nothing. */
export const importTranslationsBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('inquiry-template-translations').optional(),
    attributes: z.strictObject({ translations: z.array(translationRowSchema).min(1).max(20_000) }),
  }),
});
export type ImportTranslationsBody = z.infer<typeof importTranslationsBodySchema>;

/** The header of `translations.csv`: three fixed columns, then one per locale. */
export const TRANSLATIONS_CSV_FIXED_COLUMNS = ['step', 'component', 'attribute'] as const;
