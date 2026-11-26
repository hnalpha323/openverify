import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type {
  FlowRunGrantRecord,
  TemplateRecordActorType,
  TemplateRecordLocale,
} from '@openverify/core';
import {
  inquiryTemplatePromotions,
  inquiryTemplateVersions,
  inquiryTemplates,
  type InquiryTemplate,
  type InquiryTemplateSettings,
  type InquiryTemplateStatus,
  type InquiryTemplateVersion,
  type InquiryTemplateVersionStatus,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type CursorTable,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted, type OneOrMany } from './rows.js';

export interface TemplateVersionInput {
  id: string;
  /** flow-spec document, validated by the caller with `parseFlow`. */
  flow: Record<string, unknown>;
  /** C2 `verification-config`. */
  verificationConfig: Record<string, unknown>;
  /** C11 `settings` (kebab-case keys); defaults to `{}`. */
  settings?: InquiryTemplateSettings;
  /** C84.1 `report-config` as sent; defaults to `{}` (no report). */
  reportConfig?: Record<string, unknown>;
  /** C90.6 (Workflow 7A): `signal-config` as stored (`signalConfigSchema`); `{}` by default. */
  signalConfig?: Record<string, unknown>;
  /** C99.5 (Workflow 7B): `list-config` as stored (`listConfigSchema`); `{}` by default. */
  listConfig?: Record<string, unknown>;
  /** C154.1 (Workflow 9A): the version members; each absent one takes its column default. */
  members?: TemplateVersionMembers;
}

export interface NewInquiryTemplateInput {
  id: string;
  name: string;
  version: TemplateVersionInput;
}

export type InquiryTemplateWithVersion = InquiryTemplate & {
  /** C11: the published version, which new inquiries pin. */
  currentVersion: InquiryTemplateVersion;
  /**
   * The same object as `currentVersion`, under its Phase 1 name, kept for Phase 1 callers:
   * in Phase 1 every version was published when created, so the latest was the current one.
   * New code should read `currentVersion`.
   */
  latestVersion: InquiryTemplateVersion;
};

const templateCursor: CursorTable = {
  table: inquiryTemplates,
  id: inquiryTemplates.id,
  scope: inquiryTemplates.environmentId,
  createdAt: inquiryTemplates.createdAt,
};

/** Creates a template and its version 1, published, in one transaction (C2, C11). */
export async function createInquiryTemplate(
  db: Db,
  environmentId: string,
  input: NewInquiryTemplateInput,
): Promise<InquiryTemplateWithVersion> {
  return db.transaction(async (tx) => {
    const template = inserted(
      await tx
        .insert(inquiryTemplates)
        .values({ id: input.id, environmentId, name: input.name })
        .returning(),
      'createInquiryTemplate',
    );
    const currentVersion = inserted(
      await tx
        .insert(inquiryTemplateVersions)
        .values({
          id: input.version.id,
          environmentId,
          inquiryTemplateId: template.id,
          version: 1,
          flow: input.version.flow,
          verificationConfig: input.version.verificationConfig,
          settings: input.version.settings ?? {},
          reportConfig: input.version.reportConfig ?? {},
          signalConfig: input.version.signalConfig ?? {},
          listConfig: input.version.listConfig ?? {},
          ...memberColumns(input.version.members),
          status: 'published',
          publishedAt: sql`now()`,
        })
        .returning(),
      'createInquiryTemplate',
    );
    return { ...template, currentVersion, latestVersion: currentVersion };
  });
}

/**
 * Adds the next version of a template and publishes it at once, superseding the current
 * one (the Phase 1 behaviour, where a new version was current immediately). C11 drafts use
 * `createDraftInquiryTemplateVersion` and `publishInquiryTemplateVersion` instead. The
 * template row is locked, so concurrent calls number their versions one after the other.
 * `null` when the template is not here.
 */
export async function createInquiryTemplateVersion(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
  input: TemplateVersionInput,
): Promise<InquiryTemplateVersion | null> {
  return insertNextVersion(db, environmentId, inquiryTemplateId, input, 'published');
}

async function insertNextVersion(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
  input: TemplateVersionInput,
  status: 'draft' | 'published',
): Promise<InquiryTemplateVersion | null> {
  return db.transaction(async (tx) => {
    const template = firstOrNull(
      await tx
        .select({ id: inquiryTemplates.id })
        .from(inquiryTemplates)
        .where(
          and(
            eq(inquiryTemplates.id, inquiryTemplateId),
            eq(inquiryTemplates.environmentId, environmentId),
          ),
        )
        .for('update'),
    );
    if (template === null) {
      return null;
    }
    const [latest] = await tx
      .select({
        version: sql<number>`coalesce(max(${inquiryTemplateVersions.version}), 0)`.mapWith(Number),
      })
      .from(inquiryTemplateVersions)
      .where(eq(inquiryTemplateVersions.inquiryTemplateId, inquiryTemplateId));
    if (status === 'published') {
      await supersedePublished(tx, environmentId, inquiryTemplateId);
    }
    return inserted(
      await tx
        .insert(inquiryTemplateVersions)
        .values({
          id: input.id,
          environmentId,
          inquiryTemplateId,
          version: (latest?.version ?? 0) + 1,
          flow: input.flow,
          verificationConfig: input.verificationConfig,
          settings: input.settings ?? {},
          reportConfig: input.reportConfig ?? {},
          signalConfig: input.signalConfig ?? {},
          listConfig: input.listConfig ?? {},
          ...memberColumns(input.members),
          status,
          publishedAt: status === 'published' ? sql`now()` : null,
        })
        .returning(),
      'createInquiryTemplateVersion',
    );
  });
}

/** Marks the template's published version `superseded`; returns it, or `null` if none. */
async function supersedePublished(
  tx: Db,
  environmentId: string,
  inquiryTemplateId: string,
): Promise<InquiryTemplateVersion | null> {
  return firstOrNull(
    await tx
      .update(inquiryTemplateVersions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(inquiryTemplateVersions.environmentId, environmentId),
          eq(inquiryTemplateVersions.inquiryTemplateId, inquiryTemplateId),
          eq(inquiryTemplateVersions.status, 'published'),
        ),
      )
      .returning(),
  );
}

/** Adds each template's published version (C11 `current-version`). */
async function withCurrentVersions(
  db: Db,
  environmentId: string,
  templates: InquiryTemplate[],
): Promise<InquiryTemplateWithVersion[]> {
  if (templates.length === 0) {
    return [];
  }
  const versions = await db
    .select()
    .from(inquiryTemplateVersions)
    .where(
      and(
        eq(inquiryTemplateVersions.environmentId, environmentId),
        eq(inquiryTemplateVersions.status, 'published'),
        inArray(
          inquiryTemplateVersions.inquiryTemplateId,
          templates.map((template) => template.id),
        ),
      ),
    );
  const published = new Map(versions.map((version) => [version.inquiryTemplateId, version]));
  // C154.5 (Workflow 9A): a template the first promote created holds only a draft; it is not
  // served as a template until that draft is published.
  return templates.flatMap((template) => {
    const currentVersion = published.get(template.id);
    return currentVersion === undefined
      ? []
      : [{ ...template, currentVersion, latestVersion: currentVersion }];
  });
}

export async function getInquiryTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateWithVersion | null> {
  const templates = await db
    .select()
    .from(inquiryTemplates)
    .where(and(eq(inquiryTemplates.id, id), eq(inquiryTemplates.environmentId, environmentId)))
    .limit(1);
  return firstOrNull(await withCurrentVersions(db, environmentId, templates));
}

export async function getInquiryTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateVersion | null> {
  return firstOrNull(
    await db
      .select()
      .from(inquiryTemplateVersions)
      .where(
        and(
          eq(inquiryTemplateVersions.id, id),
          eq(inquiryTemplateVersions.environmentId, environmentId),
        ),
      )
      .limit(1),
  );
}

export interface ListInquiryTemplatesOptions extends PageRequest {
  /** C11 status filter. */
  status?: OneOrMany<InquiryTemplateStatus> | undefined;
}

/** Templates newest first, each with its current version (C2 list, C11 status filter). */
export async function listInquiryTemplates(
  db: Db,
  environmentId: string,
  options: ListInquiryTemplatesOptions = {},
): Promise<Page<InquiryTemplateWithVersion>> {
  const filters = allFilters([
    eq(inquiryTemplates.environmentId, environmentId),
    equalsAny(inquiryTemplates.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  const result = await paginate(db, templateCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(inquiryTemplates)
      .where(and(...filters, after))
      .orderBy(...newestFirst(templateCursor))
      .limit(limit),
  );
  return { items: await withCurrentVersions(db, environmentId, result.items), next: result.next };
}

export interface InquiryTemplateChanges {
  name?: string;
  status?: InquiryTemplateStatus;
}

/** C11 `PATCH /inquiry-templates/:id`: name and status. `null` when it is not here. */
export async function updateInquiryTemplate(
  db: Db,
  environmentId: string,
  id: string,
  changes: InquiryTemplateChanges,
): Promise<InquiryTemplateWithVersion | null> {
  const set: Partial<typeof inquiryTemplates.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.status !== undefined) set.status = changes.status;
  if (Object.keys(set).length === 0) {
    return getInquiryTemplate(db, environmentId, id);
  }
  const rows = await db
    .update(inquiryTemplates)
    .set(set)
    .where(and(eq(inquiryTemplates.id, id), eq(inquiryTemplates.environmentId, environmentId)))
    .returning();
  return firstOrNull(await withCurrentVersions(db, environmentId, rows));
}

// ---------------------------------------------------------------------------------------
// C11 version lifecycle

const versionCursor = environmentCursor(inquiryTemplateVersions);
const versionInEnvironment = (environmentId: string, id: string) =>
  and(eq(inquiryTemplateVersions.id, id), eq(inquiryTemplateVersions.environmentId, environmentId));

export interface ListInquiryTemplateVersionsOptions extends PageRequest {
  /** C11 `filter[inquiry-template-id]`. */
  inquiryTemplateId?: OneOrMany<string> | undefined;
  status?: OneOrMany<InquiryTemplateVersionStatus> | undefined;
}

export interface DraftChanges {
  flow?: Record<string, unknown>;
  verificationConfig?: Record<string, unknown>;
  settings?: InquiryTemplateSettings;
  /** C84.1: replaces the stored `report-config`. */
  reportConfig?: Record<string, unknown>;
  /** C90.6 (Workflow 7A): `signal-config` as stored (`signalConfigSchema`); `{}` by default. */
  signalConfig?: Record<string, unknown>;
  /** C99.5 (Workflow 7B): `list-config` as stored (`listConfigSchema`); `{}` by default. */
  listConfig?: Record<string, unknown>;
  /** C154.1 (Workflow 9A): the members sent replace the stored ones. */
  members?: TemplateVersionMembers;
}

export type PublishResult =
  | {
      status: 'published';
      version: InquiryTemplateVersion;
      /** The version that was current before, now `superseded`. */
      superseded: InquiryTemplateVersion | null;
    }
  | { status: 'not_draft'; version: InquiryTemplateVersion };

/**
 * C11 `POST /inquiry-template-versions`: a draft numbered `max + 1`. The current version
 * does not change. `null` when the template is not here.
 */
export async function createDraftInquiryTemplateVersion(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
  input: TemplateVersionInput,
): Promise<InquiryTemplateVersion | null> {
  return insertNextVersion(db, environmentId, inquiryTemplateId, input, 'draft');
}

/**
 * C11 `PATCH /inquiry-template-versions/:id`, drafts only. `null` when the version is not
 * here or no longer a draft (read it to tell which: 404 or 409).
 */
export async function updateDraftInquiryTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
  changes: DraftChanges,
): Promise<InquiryTemplateVersion | null> {
  const set: Partial<typeof inquiryTemplateVersions.$inferInsert> = {};
  if (changes.flow !== undefined) set.flow = changes.flow;
  if (changes.verificationConfig !== undefined) set.verificationConfig = changes.verificationConfig;
  if (changes.settings !== undefined) set.settings = changes.settings;
  if (changes.reportConfig !== undefined) set.reportConfig = changes.reportConfig;
  if (changes.signalConfig !== undefined) set.signalConfig = changes.signalConfig;
  if (changes.listConfig !== undefined) set.listConfig = changes.listConfig;
  Object.assign(set, memberColumns(changes.members));
  if (Object.keys(set).length === 0) {
    const version = await getInquiryTemplateVersion(db, environmentId, id);
    return version?.status === 'draft' ? version : null;
  }
  return firstOrNull(
    await db
      .update(inquiryTemplateVersions)
      .set(set)
      .where(
        and(versionInEnvironment(environmentId, id), eq(inquiryTemplateVersions.status, 'draft')),
      )
      .returning(),
  );
}

/**
 * C11 `POST /inquiry-template-versions/:id/publish`: the draft becomes the template's
 * published (current) version and the previous one `superseded`, in one transaction with
 * the template row locked. `not_draft` for a version that is not a draft; `null` when it
 * is not here. Existing inquiries keep the version they pinned.
 */
export async function publishInquiryTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
  at?: Date,
  options: PublishVersionOptions = {},
): Promise<PublishResult | null> {
  return db.transaction(async (tx) => {
    const version = await getInquiryTemplateVersion(tx, environmentId, id);
    if (version === null) {
      return null;
    }
    await tx
      .select({ id: inquiryTemplates.id })
      .from(inquiryTemplates)
      .where(
        and(
          eq(inquiryTemplates.id, version.inquiryTemplateId),
          eq(inquiryTemplates.environmentId, environmentId),
        ),
      )
      .for('update');
    const draft = await getInquiryTemplateVersion(tx, environmentId, id);
    if (draft?.status !== 'draft') {
      return { status: 'not_draft' as const, version: draft ?? version };
    }
    const superseded = await supersedePublished(tx, environmentId, version.inquiryTemplateId);
    const published = inserted(
      await tx
        .update(inquiryTemplateVersions)
        .set({
          status: 'published',
          publishedAt: at ?? sql`now()`,
          ...(options.publishNote === undefined ? {} : { publishNote: options.publishNote }),
          ...(options.acknowledgements === undefined
            ? {}
            : { acknowledgements: options.acknowledgements }),
          ...(options.lastUpdater === undefined ? {} : { lastUpdater: options.lastUpdater }),
          ...(options.validation === undefined ? {} : { validation: options.validation }),
          ...(options.flowRunGrants === undefined ? {} : { flowRunGrants: options.flowRunGrants }),
        })
        .where(versionInEnvironment(environmentId, id))
        .returning(),
      'publishInquiryTemplateVersion',
    );
    return { status: 'published' as const, version: published, superseded };
  });
}

/** C11 `GET /inquiry-template-versions`: newest first, by template and status. */
export async function listInquiryTemplateVersions(
  db: Db,
  environmentId: string,
  options: ListInquiryTemplateVersionsOptions = {},
): Promise<Page<InquiryTemplateVersion>> {
  const filters = allFilters([
    eq(inquiryTemplateVersions.environmentId, environmentId),
    equalsAny(inquiryTemplateVersions.inquiryTemplateId, options.inquiryTemplateId),
    equalsAny(inquiryTemplateVersions.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, versionCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(inquiryTemplateVersions)
      .where(and(...filters, after))
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

// C154 (Workflow 9A, `api-templates`): the version members, drafts, copies and promotions.

/** C154.1: the members a Workflow 9A version stores beside its configuration, as columns. */
export interface TemplateVersionMembers {
  fieldSchemas?: unknown[];
  copy?: Record<string, unknown>;
  enabledLocales?: TemplateRecordLocale[];
  defaultLocale?: TemplateRecordLocale;
  themeSetId?: string | null;
  embedOrigins?: string[];
  redirectUri?: string | null;
  redirectUriSchemes?: string[];
  redirectIncludeStatus?: boolean;
  helpUrl?: string | null;
  privacyUrl?: string | null;
  description?: string | null;
  lastUpdater?: { type: TemplateRecordActorType; id: string } | null;
  validation?: Record<string, unknown> | null;
  flowSha256?: string | null;
  /** C154.9: stored at publish; a copy carries its source's (the same content, environment). */
  acknowledgements?: unknown[];
  /**
   * C152.2 (Workflow 9B Stage 1b (F); 9A Stage 3 amendment 31, contracts B45): each `run_workflow`
   * step's target grant and egress as the publish saw them; stored at publish, and a copy carries
   * its source's, as it does the acknowledgements.
   */
  flowRunGrants?: FlowRunGrantRecord[];
}

/** What a publish stores with the version (C154.1, C154.9). */
export interface PublishVersionOptions {
  publishNote?: string | null;
  acknowledgements?: unknown[];
  lastUpdater?: { type: TemplateRecordActorType; id: string } | null;
  validation?: Record<string, unknown> | null;
  /** C152.2 (Workflow 9B Stage 1b (F)): `flowActionPublishGrants`' records; left out, kept as stored. */
  flowRunGrants?: FlowRunGrantRecord[];
}

/** The member columns a change sends; the absent ones are left out (their defaults or values stay). */
function memberColumns(
  members: TemplateVersionMembers | undefined,
): Partial<typeof inquiryTemplateVersions.$inferInsert> {
  return Object.fromEntries(
    Object.entries(members ?? {}).filter(([, value]) => value !== undefined),
  );
}

/** A template row without its versions; `null` when it is not here. */
export async function getInquiryTemplateRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplate | null> {
  return firstOrNull(
    await db
      .select()
      .from(inquiryTemplates)
      .where(and(eq(inquiryTemplates.id, id), eq(inquiryTemplates.environmentId, environmentId)))
      .limit(1),
  );
}

/** A version locked for update in the caller's transaction (C154.3's `If-Match`); `null` when absent. */
export async function lockInquiryTemplateVersionInTx(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<InquiryTemplateVersion | null> {
  return firstOrNull(
    await tx
      .select()
      .from(inquiryTemplateVersions)
      .where(versionInEnvironment(environmentId, id))
      .for('update'),
  );
}

/** The template's draft, or `null` when it has none. */
export function findTemplateDraft(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
): Promise<InquiryTemplateVersion | null> {
  return findLatestTemplateVersion(db, environmentId, inquiryTemplateId, ['draft']);
}

/** The template's newest version in one of `statuses` (highest number), or `null`. */
export async function findLatestTemplateVersion(
  db: Db,
  environmentId: string,
  inquiryTemplateId: string,
  statuses: readonly InquiryTemplateVersionStatus[],
): Promise<InquiryTemplateVersion | null> {
  return firstOrNull(
    await db
      .select()
      .from(inquiryTemplateVersions)
      .where(
        and(
          eq(inquiryTemplateVersions.environmentId, environmentId),
          eq(inquiryTemplateVersions.inquiryTemplateId, inquiryTemplateId),
          inArray(inquiryTemplateVersions.status, [...statuses]),
        ),
      )
      .orderBy(desc(inquiryTemplateVersions.version))
      .limit(1),
  );
}

/**
 * C154.5: a template whose only version, 1, is a draft (the first promote into an environment).
 * Such a template is not listed or served until its draft is published.
 */
export async function createInquiryTemplateWithDraft(
  db: Db,
  environmentId: string,
  input: NewInquiryTemplateInput,
): Promise<InquiryTemplateVersion> {
  return db.transaction(async (tx) => {
    await tx.insert(inquiryTemplates).values({ id: input.id, environmentId, name: input.name });
    const draft = await insertNextVersion(tx, environmentId, input.id, input.version, 'draft');
    return inserted(draft === null ? [] : [draft], 'createInquiryTemplateWithDraft');
  });
}

/** C154.5: the template an earlier promote of `sourceTemplateId` created here, or `null`. */
export async function findPromotedTemplateId(
  db: Db,
  environmentId: string,
  sourceTemplateId: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ id: inquiryTemplatePromotions.inquiryTemplateId })
      .from(inquiryTemplatePromotions)
      .where(
        and(
          eq(inquiryTemplatePromotions.environmentId, environmentId),
          eq(inquiryTemplatePromotions.sourceTemplateId, sourceTemplateId),
        ),
      )
      .orderBy(desc(inquiryTemplatePromotions.id))
      .limit(1),
  );
  return row?.id ?? null;
}

// C154.5 (Workflow 9A Stage 1b (T)): promote's record, a stub until `api-templates` builds it.

/** A promote into this environment: the target template's new draft, and its source by ids only. */
export interface NewInquiryTemplatePromotion {
  templateId: string;
  versionId: string;
  sourceEnvironmentId: string;
  sourceTemplateId: string;
  sourceVersionId: string;
  /** The user who promoted (users only, C154.5). */
  promotedBy: string;
}

/** Records a promote into `environmentId` (the target's), in the promote's transaction. */
export async function recordInquiryTemplatePromotionInTx(
  tx: Db,
  environmentId: string,
  input: NewInquiryTemplatePromotion,
): Promise<void> {
  await tx.insert(inquiryTemplatePromotions).values({
    environmentId,
    inquiryTemplateId: input.templateId,
    inquiryTemplateVersionId: input.versionId,
    sourceEnvironmentId: input.sourceEnvironmentId,
    sourceTemplateId: input.sourceTemplateId,
    sourceVersionId: input.sourceVersionId,
    promotedBy: input.promotedBy,
  });
}
