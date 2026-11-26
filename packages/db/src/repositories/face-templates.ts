/**
 * C42: the worker's face template and background repository (Workflow 4A Stage 3, `api-worker`),
 * beside Stage 1's shared functions in `selfie-captures.ts` (`createFaceTemplate`,
 * `listFaceTemplates`, `createSelfieBackground`, `deleteFaceDataForInquiry`):
 * - {@link writeFaceData}: a passed selfie's sealed template and its background row, written in
 *   the decision transaction (C42.2);
 * - {@link listAccountFaceTemplates}, {@link listInquiryIdsOfAccount}: the account comparison and
 *   the 1:N scan's exclusions, resolved through `inquiries.account_id` when asked (C42.4, C42.8);
 * - {@link findNearestSelfieBackgrounds}: the background search's nearest rows (HNSW, C42.8);
 * - {@link deleteExpiredFaceData}: `face-template-retention-days` (C42.6);
 * - {@link listFaceTemplateRefs}, {@link lockFaceTemplate}, {@link rewriteFaceTemplate},
 *   {@link rewriteSelfieBackground}, {@link deleteFaceTemplate}: `face-index:rebuild` (C42.7).
 *
 * Lock order (C40.6): every writer locks the inquiry first, then the template, then its background
 * row, as the decision transaction, a redaction and an operator decline do; the retention deletion
 * does so per inquiry. Templates are biometric data: decrypted here only for the worker's
 * comparisons, never logged.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, l2Distance, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { withSensitiveParameters } from '../errors.js';
import { SEALED } from '../encrypted-columns.js';
import { generateId } from '../ids.js';
import { sealValue } from '../sealed.js';
import { environments, faceTemplates, inquiries, selfieBackgrounds } from '../schema.js';
import { DEFAULT_FACE_TEMPLATE_SETTINGS } from './retention.js';
import { firstOrNull } from './rows.js';
import {
  createFaceTemplate,
  createSelfieBackground,
  encodeFaceTemplate,
  openFaceTemplate,
  type FaceTemplate,
} from './selfie-captures.js';
import { DEFAULT_SWEEP_LIMIT } from './sweeps.js';

/** The background row written beside a template (C42.5): 144 Lab values, 48 cells, coverage. */
export interface BackgroundLayoutInput {
  layout: readonly number[];
  validCells: string;
  coverage: number;
}

export interface NewFaceData {
  verificationId: string;
  inquiryId: string;
  /** The recogniser that made the embedding, such as `sface-2021dec`. */
  model: string;
  /** The L2-normalised SFace embedding of the centre face. */
  embedding: readonly number[];
  /** The centre's background layout; no background row without one. */
  background: BackgroundLayoutInput | null;
}

/**
 * C42.2: writes the template and, with a layout, its background row; returns their ids (internal
 * `ftpl_` and `sbg_` ids, generated here). The caller holds the inquiry lock (C40.6).
 */
export async function writeFaceData(
  tx: Db,
  environmentId: string,
  input: NewFaceData,
): Promise<{ templateId: string; backgroundId: string | null }> {
  const template = await createFaceTemplate(tx, environmentId, {
    id: generateId('ftpl'),
    verificationId: input.verificationId,
    inquiryId: input.inquiryId,
    model: input.model,
    embedding: input.embedding,
  });
  if (input.background === null) {
    return { templateId: template.id, backgroundId: null };
  }
  const background = await createSelfieBackground(tx, environmentId, {
    id: generateId('sbg'),
    verificationId: input.verificationId,
    inquiryId: input.inquiryId,
    faceTemplateId: template.id,
    layout: input.background.layout,
    validCells: input.background.validCells,
    coverage: input.background.coverage,
  });
  return { templateId: template.id, backgroundId: background.id };
}

/**
 * Every inquiry id of the account (no limit), resolved through `inquiries.account_id` now, so a
 * consolidation that moved an inquiry is followed (C42.4).
 */
export async function listInquiryIdsOfAccount(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.accountId, accountId)))
    .orderBy(asc(inquiries.id));
  return rows.map((row) => row.id);
}

/**
 * C42.8 `selfie_account_comparison`: the decrypted templates of the account's inquiries other
 * than `excludeInquiryId`, newest first, all of them.
 * @throws when a template cannot be opened (the comparison then could not run).
 */
export async function listAccountFaceTemplates(
  db: Db,
  environmentId: string,
  input: { accountId: string; excludeInquiryId: string },
): Promise<FaceTemplate[]> {
  const rows = await db
    .select({ template: faceTemplates })
    .from(faceTemplates)
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, faceTemplates.environmentId),
        eq(inquiries.id, faceTemplates.inquiryId),
      ),
    )
    .where(
      and(
        eq(faceTemplates.environmentId, environmentId),
        eq(inquiries.accountId, input.accountId),
        ne(faceTemplates.inquiryId, input.excludeInquiryId),
      ),
    )
    .orderBy(desc(faceTemplates.createdAt), desc(faceTemplates.id));
  return rows.map((row) => openFaceTemplate(row.template));
}

/** A background row near the probe, with its template decrypted (`null` when it cannot be). */
export interface BackgroundNeighbour {
  id: string;
  verificationId: string;
  inquiryId: string;
  faceTemplateId: string;
  /** L2 distance of the layouts (CIE76 ΔE over the 48 cells). */
  distance: number;
  template: FaceTemplate | null;
}

/** HNSW candidates examined per query; filtered rows are skipped by the iterative scan. */
const HNSW_EF_SEARCH = 100;

/**
 * C42.8: the background rows nearest `layout` (HNSW `vector_l2_ops`), of the environment, created
 * at or after `since`, from unredacted inquiries of accounts other than `excludeAccountId`,
 * nearest first. The index scan is iterative in strict order (pgvector 0.8), so the filters never
 * leave the page short while nearer rows exist. Runs in its own transaction for `SET LOCAL`.
 */
export async function findNearestSelfieBackgrounds(
  db: Db,
  environmentId: string,
  input: { layout: readonly number[]; since: Date; excludeAccountId: string; limit: number },
): Promise<BackgroundNeighbour[]> {
  const rows = await withSensitiveParameters('findNearestSelfieBackgrounds', () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = strict_order`);
      await tx.execute(sql.raw(`set local hnsw.ef_search = ${String(HNSW_EF_SEARCH)}`));
      const distance = l2Distance(selfieBackgrounds.layout, [...input.layout]);
      return tx
        .select({
          id: selfieBackgrounds.id,
          verificationId: selfieBackgrounds.verificationId,
          inquiryId: selfieBackgrounds.inquiryId,
          faceTemplateId: selfieBackgrounds.faceTemplateId,
          distance: sql<number>`${distance}`.mapWith(Number),
          template: faceTemplates,
        })
        .from(selfieBackgrounds)
        .innerJoin(
          inquiries,
          and(
            eq(inquiries.environmentId, selfieBackgrounds.environmentId),
            eq(inquiries.id, selfieBackgrounds.inquiryId),
          ),
        )
        .innerJoin(
          faceTemplates,
          and(
            eq(faceTemplates.environmentId, selfieBackgrounds.environmentId),
            eq(faceTemplates.id, selfieBackgrounds.faceTemplateId),
          ),
        )
        .where(
          and(
            eq(selfieBackgrounds.environmentId, environmentId),
            gte(selfieBackgrounds.createdAt, input.since),
            ne(inquiries.accountId, input.excludeAccountId),
            isNull(inquiries.redactedAt),
          ),
        )
        .orderBy(distance)
        .limit(input.limit);
    }),
  );
  return rows.map(({ template, ...row }) => {
    let opened: FaceTemplate | null;
    try {
      opened = openFaceTemplate(template);
    } catch {
      opened = null;
    }
    return { ...row, template: opened };
  });
}

/** `created_at` older than the environment's `face-template-retention-days` at `at`. */
const pastRetention = (at: string) =>
  sql`${faceTemplates.createdAt} < ${at}::timestamptz - make_interval(days => coalesce(
    (${environments.settings} ->> 'face-template-retention-days')::integer,
    ${DEFAULT_FACE_TEMPLATE_SETTINGS['face-template-retention-days']}::integer))`;

/**
 * C42.6: one batch of templates older than their environment's `face-template-retention-days`
 * (default 365), deleted with their background rows, across environments, oldest first. Each
 * inquiry's rows go in one transaction that locks the inquiry first (C40.6) and re-checks the
 * age under it. Call until it deletes fewer templates than `limit`.
 */
export async function deleteExpiredFaceData(
  db: Db,
  options: { now?: Date; limit?: number } = {},
): Promise<{ templates: number; backgrounds: number }> {
  const at = (options.now ?? new Date()).toISOString();
  const due = await db
    .select({
      id: faceTemplates.id,
      environmentId: faceTemplates.environmentId,
      inquiryId: faceTemplates.inquiryId,
    })
    .from(faceTemplates)
    .innerJoin(environments, eq(environments.id, faceTemplates.environmentId))
    .where(pastRetention(at))
    .orderBy(asc(faceTemplates.createdAt), asc(faceTemplates.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  const byInquiry = new Map<string, { environmentId: string; inquiryId: string; ids: string[] }>();
  for (const row of due) {
    const key = `${row.environmentId}/${row.inquiryId}`;
    const group = byInquiry.get(key) ?? {
      environmentId: row.environmentId,
      inquiryId: row.inquiryId,
      ids: [],
    };
    group.ids.push(row.id);
    byInquiry.set(key, group);
  }
  const total = { templates: 0, backgrounds: 0 };
  for (const { environmentId, inquiryId, ids } of byInquiry.values()) {
    const deleted = await db.transaction(async (tx) => {
      await tx
        .select({ id: inquiries.id })
        .from(inquiries)
        .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, inquiryId)))
        .for('update');
      const still = await tx
        .select({ id: faceTemplates.id })
        .from(faceTemplates)
        .innerJoin(environments, eq(environments.id, faceTemplates.environmentId))
        .where(
          and(
            eq(faceTemplates.environmentId, environmentId),
            inArray(faceTemplates.id, ids),
            pastRetention(at),
          ),
        )
        .for('update', { of: faceTemplates });
      const stillIds = still.map((row) => row.id);
      if (stillIds.length === 0) {
        return { templates: 0, backgrounds: 0 };
      }
      const backgrounds = await tx
        .delete(selfieBackgrounds)
        .where(
          and(
            eq(selfieBackgrounds.environmentId, environmentId),
            inArray(selfieBackgrounds.faceTemplateId, stillIds),
          ),
        )
        .returning({ id: selfieBackgrounds.id });
      const templates = await tx
        .delete(faceTemplates)
        .where(
          and(eq(faceTemplates.environmentId, environmentId), inArray(faceTemplates.id, stillIds)),
        )
        .returning({ id: faceTemplates.id });
      return { templates: templates.length, backgrounds: backgrounds.length };
    });
    total.templates += deleted.templates;
    total.backgrounds += deleted.backgrounds;
  }
  return total;
}

/** A template row as the rebuild walks them: ids only, never the template. */
export interface FaceTemplateRef {
  id: string;
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  model: string;
  createdAt: Date;
}

/** C42.7: one page of every environment's template rows, by id, after `after`. */
export async function listFaceTemplateRefs(
  db: Db,
  options: { after?: string | undefined; limit: number },
): Promise<FaceTemplateRef[]> {
  return db
    .select({
      id: faceTemplates.id,
      environmentId: faceTemplates.environmentId,
      verificationId: faceTemplates.verificationId,
      inquiryId: faceTemplates.inquiryId,
      model: faceTemplates.model,
      createdAt: faceTemplates.createdAt,
    })
    .from(faceTemplates)
    .where(options.after === undefined ? undefined : gt(faceTemplates.id, options.after))
    .orderBy(asc(faceTemplates.id))
    .limit(options.limit);
}

/**
 * C42.7: the template row locked `FOR UPDATE` (the caller locked its inquiry first), and whether
 * it has a background row; `null` when it is gone or of another environment.
 */
export async function lockFaceTemplate(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<{ id: string; inquiryId: string; hasBackground: boolean } | null> {
  const row = firstOrNull(
    await tx
      .select({
        id: faceTemplates.id,
        inquiryId: faceTemplates.inquiryId,
        backgroundId: selfieBackgrounds.id,
      })
      .from(faceTemplates)
      .leftJoin(
        selfieBackgrounds,
        and(
          eq(selfieBackgrounds.environmentId, faceTemplates.environmentId),
          eq(selfieBackgrounds.faceTemplateId, faceTemplates.id),
        ),
      )
      .where(and(eq(faceTemplates.environmentId, environmentId), eq(faceTemplates.id, id)))
      .for('update', { of: faceTemplates }),
  );
  return row === null
    ? null
    : { id: row.id, inquiryId: row.inquiryId, hasBackground: row.backgroundId !== null };
}

/** C42.7: re-seals an existing template with a new embedding; `created_at` is kept. */
export async function rewriteFaceTemplate(
  tx: Db,
  environmentId: string,
  input: { id: string; model: string; embedding: readonly number[] },
): Promise<boolean> {
  const rows = await tx
    .update(faceTemplates)
    .set({
      model: input.model,
      templateSealed: sealValue(SEALED.faceTemplate, input.id, encodeFaceTemplate(input.embedding)),
    })
    .where(and(eq(faceTemplates.environmentId, environmentId), eq(faceTemplates.id, input.id)))
    .returning({ id: faceTemplates.id });
  return rows.length > 0;
}

/** C42.7: rewrites the existing background row of a template; `created_at` is kept. */
export async function rewriteSelfieBackground(
  tx: Db,
  environmentId: string,
  input: BackgroundLayoutInput & { faceTemplateId: string },
): Promise<boolean> {
  const rows = await withSensitiveParameters('rewriteSelfieBackground', () =>
    tx
      .update(selfieBackgrounds)
      .set({ layout: [...input.layout], validCells: input.validCells, coverage: input.coverage })
      .where(
        and(
          eq(selfieBackgrounds.environmentId, environmentId),
          eq(selfieBackgrounds.faceTemplateId, input.faceTemplateId),
        ),
      )
      .returning({ id: selfieBackgrounds.id }),
  );
  return rows.length > 0;
}

/** C42.7: deletes one template and its background row; `false` when it was gone. */
export async function deleteFaceTemplate(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<boolean> {
  await tx
    .delete(selfieBackgrounds)
    .where(
      and(
        eq(selfieBackgrounds.environmentId, environmentId),
        eq(selfieBackgrounds.faceTemplateId, id),
      ),
    );
  const rows = await tx
    .delete(faceTemplates)
    .where(and(eq(faceTemplates.environmentId, environmentId), eq(faceTemplates.id, id)))
    .returning({ id: faceTemplates.id });
  return rows.length > 0;
}
