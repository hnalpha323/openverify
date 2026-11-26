/** Inquiry templates and their immutable, numbered versions. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  FLOW_RUN_GRANTS_COLUMN,
  TEMPLATE_RECORD_LOCALES,
  type FlowRunGrantRecord,
  type TemplateRecordActorType,
  type TemplateRecordLocale,
} from '@openverify/core';
import { idPattern } from '../ids.js';
import { createdAt, idFormat, timestamptz, updatedAt } from './columns.js';
import { inquiryTemplateStatus, inquiryTemplateVersionStatus } from './enums.js';
import { environmentId } from './environment-id.js';

export const inquiryTemplates = pgTable(
  'inquiry_templates',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** C11: inquiries cannot be created from an archived template. */
    status: inquiryTemplateStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('inquiry_templates_environment_id_id_key').on(table.environmentId, table.id),
    index('inquiry_templates_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('inquiry_templates', table.id, 'itmpl'),
  ],
);

/** C11 template version `settings`, stored with the API's kebab-case keys. */
export type InquiryTemplateSettings = Record<string, unknown>;

/**
 * A template version pins the flow (flow-spec), the verification config (C2
 * `verification-config`) and the settings (C11). Inquiries reference the version they were
 * created with, so publishing a new one never changes an inquiry in progress.
 *
 * C11 lifecycle: a version starts as `draft` (editable), is `published` (at most one per
 * template, the template's current version) and becomes `superseded` when the next one is
 * published. `published_at` is set exactly when the version left `draft`.
 */
export const inquiryTemplateVersions = pgTable(
  'inquiry_template_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryTemplateId: text('inquiry_template_id').notNull(),
    version: integer('version').notNull(),
    flow: jsonb('flow').$type<Record<string, unknown>>().notNull(),
    verificationConfig: jsonb('verification_config').$type<Record<string, unknown>>().notNull(),
    settings: jsonb('settings').$type<InquiryTemplateSettings>().notNull().default({}),
    /**
     * C84.1: the reports that run when an inquiry completes, as `report-config` stores it
     * (`reportConfigSchema`); `{}` is no report.
     */
    reportConfig: jsonb('report_config').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * C90.6 (Workflow 7A): the signals collected and the review rules, as `signal-config` stores
     * them (`signalConfigSchema`); `{}` is the default set with `on-signal: none`.
     */
    signalConfig: jsonb('signal_config').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * C99.5 (Workflow 7B): the lists screened at completion and `on-list-match`, as `list-config`
     * stores them (`listConfigSchema`); `{}` is `screen: all` with `on-list-match: none`.
     */
    listConfig: jsonb('list_config').$type<Record<string, unknown>>().notNull().default({}),
    status: inquiryTemplateVersionStatus('status').notNull().default('draft'),
    publishedAt: timestamptz('published_at'),
    // C154.1 (Workflow 9A Stage 1b (T)): the version members of C149, C154, C158, C160.7 and C162,
    // in the contracts' forms (`InquiryTemplateVersionRecord.phase9`); `api-templates` reads and writes
    // them. Each default is what a version made before Workflow 9A reads.
    /** At most 255 characters, locked at publish. */
    publishNote: text('publish_note'),
    /** At most 2,000 characters, editable on every version. */
    description: text('description'),
    /** `{ type: 'user' | 'api-key', id }`: an OpenVerify id, never an email address. */
    lastUpdater: jsonb('last_updater').$type<{ type: TemplateRecordActorType; id: string }>(),
    /** C149.1: the typed fields (`fieldSchemasSchema`); a `default` is personal data in logs. */
    fieldSchemas: jsonb('field_schemas').$type<unknown[]>().notNull().default([]),
    /** C162.1: `{ messages: { <locale>: { <key>: text } } }`; `{}` is no operator copy. */
    copy: jsonb('copy').$type<Record<string, unknown>>().notNull().default({}),
    enabledLocales: text('enabled_locales')
      .array()
      .$type<TemplateRecordLocale[]>()
      .notNull()
      .default(sql`'{en}'::text[]`),
    defaultLocale: text('default_locale').$type<TemplateRecordLocale>().notNull().default('en'),
    /** C160.7: an active theme set of the environment (`theset_`), checked at publish. */
    themeSetId: text('theme_set_id'),
    /** C158.2: a subset of the environment's allowed origins; empty is the environment's list. */
    embedOrigins: text('embed_origins')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    redirectUri: text('redirect_uri'),
    redirectUriSchemes: text('redirect_uri_schemes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C158.5 (review P32): `status` joins the redirect only when the version opts in. */
    redirectIncludeStatus: boolean('redirect_include_status').notNull().default(false),
    /** C162.3: the link fields a `link` button names. */
    helpUrl: text('help_url'),
    privacyUrl: text('privacy_url'),
    /** C154.2: `{ status, problems[] }` of the last save; `null` until a Workflow 9A save. */
    validation: jsonb('validation').$type<Record<string, unknown>>(),
    /** C147.7: the SHA-256 of the flow's canonical JSON without `layout`; `null` until computed. */
    flowSha256: text('flow_sha256'),
    /** C154.9: `[{ key, acknowledged-by, acknowledged-at }]` stored at publish. */
    acknowledgements: jsonb('acknowledgements').$type<unknown[]>().notNull().default([]),
    /**
     * C152.2 (Workflow 9B Stage 1b (F); 9A Stage 3 amendment 31, contracts B45): each `run_workflow`
     * step's target grant and egress as the publish saw them (`flowActionPublishGrants`), which each
     * entry checks the resolved version against (`recordedGrantOf`); `[]` before one is stored. Ids,
     * scopes and step ids only.
     */
    flowRunGrants: jsonb(FLOW_RUN_GRANTS_COLUMN)
      .$type<FlowRunGrantRecord[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'inquiry_template_versions_publish_note_length',
      sql`${table.publishNote} is null or char_length(${table.publishNote}) <= 255`,
    ),
    check(
      'inquiry_template_versions_description_length',
      sql`${table.description} is null or char_length(${table.description}) <= 2000`,
    ),
    check(
      'inquiry_template_versions_flow_sha256_format',
      sql`${table.flowSha256} is null or ${table.flowSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'inquiry_template_versions_theme_set_id_format',
      sql`${table.themeSetId} is null or ${table.themeSetId} ~ ${sql.raw(`'${idPattern('theset')}'`)}`,
    ),
    check(
      'inquiry_template_versions_locales_valid',
      sql`cardinality(${table.enabledLocales}) between 1 and ${sql.raw(String(TEMPLATE_RECORD_LOCALES.length))}
        and ${table.enabledLocales} <@ ${sql.raw(`array[${TEMPLATE_RECORD_LOCALES.map((locale) => `'${locale}'`).join(', ')}]::text[]`)}
        and ${table.defaultLocale} = any(${table.enabledLocales})`,
    ),
    check(
      'inquiry_template_versions_json_shapes',
      sql`jsonb_typeof(${table.fieldSchemas}) = 'array' and jsonb_typeof(${table.copy}) = 'object'
        and jsonb_typeof(${table.acknowledgements}) = 'array'
        and (${table.lastUpdater} is null or jsonb_typeof(${table.lastUpdater}) = 'object')
        and (${table.validation} is null or jsonb_typeof(${table.validation}) = 'object')`,
    ),
    check(
      'inquiry_template_versions_flow_run_grants_array',
      sql`jsonb_typeof(${table.flowRunGrants}) = 'array'`,
    ),
    foreignKey({
      name: 'inquiry_template_versions_template_fk',
      columns: [table.environmentId, table.inquiryTemplateId],
      foreignColumns: [inquiryTemplates.environmentId, inquiryTemplates.id],
    }).onDelete('cascade'),
    uniqueIndex('inquiry_template_versions_inquiry_template_id_version_key').on(
      table.inquiryTemplateId,
      table.version,
    ),
    // Target of inquiries' key: the version belongs to the inquiry's template and env.
    unique('inquiry_template_versions_env_template_id_key').on(
      table.environmentId,
      table.inquiryTemplateId,
      table.id,
    ),
    uniqueIndex('inquiry_template_versions_one_published_key')
      .on(table.inquiryTemplateId)
      .where(sql`${table.status} = 'published'`),
    index('inquiry_template_versions_env_template_created_at_id_idx').on(
      table.environmentId,
      table.inquiryTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('inquiry_template_versions_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('inquiry_template_versions_version_positive', sql`${table.version} >= 1`),
    check(
      'inquiry_template_versions_published_at',
      sql`(${table.status} = 'draft') = (${table.publishedAt} IS NULL)`,
    ),
    idFormat('inquiry_template_versions', table.id, 'itmplv'),
  ],
);

export type InquiryTemplate = typeof inquiryTemplates.$inferSelect;
export type NewInquiryTemplate = typeof inquiryTemplates.$inferInsert;
export type InquiryTemplateVersion = typeof inquiryTemplateVersions.$inferSelect;
export type NewInquiryTemplateVersion = typeof inquiryTemplateVersions.$inferInsert;
