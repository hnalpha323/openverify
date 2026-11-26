/**
 * Workflow 9A Stage 1b (T): what templates gain beside their versions (C154.5, C154.7, C156.4).
 * The repositories are `api-templates`' (`deployments.ts`, `simulation-presets.ts`, and the
 * promotion in `inquiry-templates.ts`).
 */
import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { TEMPLATE_RECORD_ACTOR_TYPES, type TemplateRecordActorType } from '@openverify/core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { createdAt, idFormat, oneOf, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiryTemplates, inquiryTemplateVersions } from './inquiry-templates.js';
import { users } from './users.js';

/**
 * C154.7: a deployment (`dply_`), written by each publish of a version, including the publish of a
 * promoted or restored draft: publishing is deploying to the template's own environment. Read-only
 * history; one per version, since a version is published once.
 */
export const deployments = pgTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryTemplateId: text('inquiry_template_id').notNull(),
    inquiryTemplateVersionId: text('inquiry_template_version_id').notNull(),
    /** The deployment this one superseded on the template, `null` for its first publish. */
    sourceDeploymentId: text('source_deployment_id'),
    creatorType: text('creator_type').$type<TemplateRecordActorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'deployments_version_fk',
      columns: [table.environmentId, table.inquiryTemplateId, table.inquiryTemplateVersionId],
      foreignColumns: [
        inquiryTemplateVersions.environmentId,
        inquiryTemplateVersions.inquiryTemplateId,
        inquiryTemplateVersions.id,
      ],
    }).onDelete('cascade'),
    unique('deployments_inquiry_template_version_id_key').on(table.inquiryTemplateVersionId),
    index('deployments_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('deployments_environment_id_template_created_at_id_idx').on(
      table.environmentId,
      table.inquiryTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('deployments_creator_valid', oneOf(table.creatorType, TEMPLATE_RECORD_ACTOR_TYPES)),
    check(
      'deployments_creator_id_format',
      sql`(${table.creatorType} <> 'user' or ${table.creatorId} ~ ${sql.raw(`'${idPattern('usr')}'`)})
        and (${table.creatorType} <> 'api-key' or ${table.creatorId} ~ ${sql.raw(`'${idPattern('key')}'`)})`,
    ),
    check(
      'deployments_source_deployment_id_format',
      sql`${table.sourceDeploymentId} is null or ${table.sourceDeploymentId} ~ ${sql.raw(`'${idPattern('dply')}'`)}`,
    ),
    idFormat('deployments', table.id, 'dply'),
  ],
);

/**
 * C154.5: a promote into this environment: the target template's new draft and its source, named by
 * ids only (the source environment may be deleted; no foreign key reaches it). Users only.
 */
export const inquiryTemplatePromotions = pgTable(
  'inquiry_template_promotions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    inquiryTemplateId: text('inquiry_template_id').notNull(),
    /** The draft the promote created. */
    inquiryTemplateVersionId: text('inquiry_template_version_id').notNull(),
    sourceEnvironmentId: text('source_environment_id').notNull(),
    sourceTemplateId: text('source_template_id').notNull(),
    sourceVersionId: text('source_version_id').notNull(),
    promotedBy: text('promoted_by').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'inquiry_template_promotions_version_fk',
      columns: [table.environmentId, table.inquiryTemplateId, table.inquiryTemplateVersionId],
      foreignColumns: [
        inquiryTemplateVersions.environmentId,
        inquiryTemplateVersions.inquiryTemplateId,
        inquiryTemplateVersions.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inquiry_template_promotions_template_fk',
      columns: [table.environmentId, table.inquiryTemplateId],
      foreignColumns: [inquiryTemplates.environmentId, inquiryTemplates.id],
    }).onDelete('cascade'),
    // A later promote of the same source finds the template the first one created (by ids).
    index('inquiry_template_promotions_source_idx').on(table.environmentId, table.sourceTemplateId),
    check(
      'inquiry_template_promotions_ids_format',
      sql`${table.sourceEnvironmentId} ~ ${sql.raw(`'${idPattern('env')}'`)}
        and ${table.sourceTemplateId} ~ ${sql.raw(`'${idPattern('itmpl')}'`)}
        and ${table.sourceVersionId} ~ ${sql.raw(`'${idPattern('itmplv')}'`)}`,
    ),
    check(
      'inquiry_template_promotions_promoted_by_format',
      sql`${table.promotedBy} ~ ${sql.raw(`'${idPattern('usr')}'`)}`,
    ),
  ],
);

/**
 * C156.4: a user's simulation preset (`ssp_`), its scope sealed for the row
 * (`simulation_presets.scope#<id>`): labelled synthetic, but an operator may paste a real person's
 * values (C174.5, review P12). Deleted with its user.
 */
export const simulationPresets = pgTable(
  'simulation_presets',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scopeSealed: sealedColumn('scope').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('simulation_presets_environment_id_user_id_created_at_id_idx').on(
      table.environmentId,
      table.userId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('simulation_presets_name_length', sql`char_length(${table.name}) between 1 and 100`),
    idFormat('simulation_presets', table.id, 'ssp'),
  ],
);

export type DeploymentRow = typeof deployments.$inferSelect;
export type InquiryTemplatePromotionRow = typeof inquiryTemplatePromotions.$inferSelect;
export type SimulationPresetRow = typeof simulationPresets.$inferSelect;
