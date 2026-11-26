/**
 * Workflow 9A Stage 1a, (T): the members C149, C154.1 and C162 add to a template version. Field
 * schemas (typed template fields), operator copy with its locales, the version's link fields,
 * its validation, its last updater and the strong ETag of C154.3. Everything here is the
 * operator's configuration, never a person's data, except a field's `default` value, which is
 * masked in API logs like the preview body's (C174.5).
 */
import { BUILT_IN_LOCALES, fieldKeySchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';

// Field schemas (C149.1-C149.5) --------------------------------------------------------------

/** C149.1: the public subset of field types; `file`, `hash`, `json` and relations are not built. */
export const TEMPLATE_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'email-address',
  'choices',
  'multi-choices',
  'array',
] as const;
export const templateFieldTypeSchema = z.enum(TEMPLATE_FIELD_TYPES);
export type TemplateFieldType = z.infer<typeof templateFieldTypeSchema>;

/** C149.2 (public): at most 1,000 fields per version, the inquiry's `MAX_INQUIRY_FIELDS`. */
export const MAX_TEMPLATE_FIELDS = 1000;

const fieldDefaultSchema = z
  .union([
    z.string().max(10_000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(10_000)).max(1000),
  ])
  .meta({ pii: true });

/**
 * C149.1: one typed field. A key published once keeps its type in every later version
 * (`field_type_changed`); `pii: false` only lets a string field be compared with a literal in a
 * condition (C149.7): every value stays masked without `pii:view`, whatever its mark.
 */
export const templateFieldSchema = z
  .strictObject({
    key: fieldKeySchema,
    type: templateFieldTypeSchema,
    label: z.string().min(1).max(200),
    pii: z.boolean(),
    'max-length': z.int().min(1).max(10_000).optional(),
    default: fieldDefaultSchema.optional(),
    'write-once': z.boolean().optional(),
    'strip-html': z.boolean().optional(),
    choices: z
      .array(
        z.strictObject({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) }),
      )
      .min(1)
      .max(1000)
      .optional(),
  })
  .refine(
    (field) =>
      (field.type === 'choices' || field.type === 'multi-choices') ===
      (field.choices !== undefined),
    {
      message: 'a choices field lists its choices, and only a choices field does',
      path: ['choices'],
    },
  );
export type TemplateField = z.infer<typeof templateFieldSchema>;

export const fieldSchemasSchema = z
  .array(templateFieldSchema)
  .max(MAX_TEMPLATE_FIELDS)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate field key', path: [index, 'key'] });
      }
      seen.add(field.key);
    });
  });
export type FieldSchemas = z.infer<typeof fieldSchemasSchema>;

// Locales and copy (C161.2, C162) -----------------------------------------------------------

/** C161.2 (H25): base language tags of the built-in locales only; a region tag is refused. */
export const templateLocaleSchema = z.enum(BUILT_IN_LOCALES);
export type TemplateLocale = z.infer<typeof templateLocaleSchema>;

/** The copy keys an operator may override (`COPY_KEYS`) and the component keys (C162.2). */
const copyKeySchema = z
  .string()
  .max(200)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, 'must be a dotted copy key');

/**
 * C162.1, C162.3: `{ messages: { <locale>: { <key>: <text> } } }`. Plain text with `{name}`
 * placeholders only; the key, placeholder, length and character rules are `api-templates`'
 * (C162.2, C162.3), answered as 422 with JSON Pointers.
 */
export const templateCopySchema = z.strictObject({
  messages: z.partialRecord(
    templateLocaleSchema,
    z.record(copyKeySchema, z.string().min(1).max(10_000)),
  ),
});
export type TemplateCopy = z.infer<typeof templateCopySchema>;

/** C162.3: the version's typed `https:` link fields, shown in the fixed slot after every step. */
export const templateLinkSchema = z.url({ protocol: /^https$/ }).max(2048);

// Validation, last updater, ETag (C154.1-C154.3) ---------------------------------------------

/** C154.1 (ours): one problem of a draft saved with problems; warnings never block. */
export const templateValidationProblemSchema = z.strictObject({
  pointer: z.string().max(512),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code'),
  detail: z.string().max(500),
  severity: z.enum(['error', 'warning']),
});
export type TemplateValidationProblem = z.infer<typeof templateValidationProblemSchema>;

export const templateValidationSchema = z.strictObject({
  status: z.enum(['valid', 'invalid']),
  problems: z.array(templateValidationProblemSchema).max(2000),
});
export type TemplateValidation = z.infer<typeof templateValidationSchema>;

/** C154.1: an OpenVerify id, never an email address (Phase 8 decision 64). */
export const lastUpdaterSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user'), id: idSchema('usr') }),
  z.strictObject({ type: z.literal('api-key'), id: idSchema('key') }),
]);
export type LastUpdater = z.infer<typeof lastUpdaterSchema>;

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest');

/**
 * C154.3 (RFC 9110): a version's strong ETag is the quoted SHA-256 of its stored content. `PATCH`
 * and `publish` honour `If-Match` and answer 412 `precondition_failed` with the current ETag in the
 * response's `ETag` header; without `If-Match` the API stays last-write-wins.
 */
export const templateVersionEtagSchema = z
  .string()
  .regex(/^"[0-9a-f]{64}"$/, 'must be a strong ETag');

/** The `If-Match` request header of a version's `PATCH` and `publish`. */
export const ifMatchHeadersSchema = z.looseObject({
  'if-match': templateVersionEtagSchema.optional(),
});

/** The quoted strong ETag of a version whose content digest is `sha256`. */
export function templateVersionEtag(sha256: string): string {
  return `"${sha256HexSchema.parse(sha256)}"`;
}
