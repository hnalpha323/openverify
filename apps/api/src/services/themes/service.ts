/**
 * C160.1, C160.2, C160.5, C160.7 (`api-themes`, Workflow 9B): theme sets in the caller's environment
 * (decision 24): list, create, retrieve, update, archive, revisions and restore. Each save passes
 * {@link assertStylesSavable} first, writes an immutable revision and an audit entry naming it, and
 * is live at every flow's next session load (decision 25). Archiving detaches the set (flows fall
 * back to the default); the environment's default is never archived (409 `theme_set_default`).
 */
import {
  buildThemeSetResource,
  buildThemeSetRevisionResource,
  DEFAULT_PAGE_SIZE,
  type CreateThemeSetBody,
  type LastUpdater,
  type ListThemeSetRevisionsQuery,
  type ListThemeSetsQuery,
  type RestoreThemeSetBody,
  type ThemeSetResource,
  type ThemeSetRevisionResource,
  type ThemeStyles,
  type UpdateThemeSetBody,
} from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { NotFoundError, UnprocessableContentError } from '../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import { nextLink } from '../pagination.js';
import type { ThemeActing } from './acting.js';
import { themeAudit, type ThemeAuditAction } from './audit.js';
import { ThemeProblemError } from './problems.js';
import { assertStylesSavable } from './rules.js';
import {
  archiveThemeSetInTx,
  defaultThemeSetIdOf,
  getThemeSet,
  getThemeSetRevision,
  insertThemeSetInTx,
  listThemeSetRevisions,
  listThemeSets,
  lockThemeSet,
  saveThemeSetRevisionInTx,
  type ThemeSetRevisionRow,
  type ThemeSetRow,
} from './store.js';
import { storedStylesOf } from './styles.js';

const PATH = '/api/v1/theme-sets';

export interface ThemeSetDocument {
  data: ThemeSetResource;
}

type ThemeDeps = Pick<ApiDependencies, 'db' | 'clock' | 'ids' | 'audit'>;

/** The stored tree, which every write validated; an unreadable one reads as the empty tree. */
const stylesOf = (row: { styles: unknown }): ThemeStyles => storedStylesOf(row.styles) ?? {};

/** The resource of `row`, `is-default` read from the environment's settings. */
export function themeSetResourceOf(row: ThemeSetRow, defaultId: string | null): ThemeSetResource {
  return buildThemeSetResource({
    id: row.id,
    name: row.name,
    status: row.status,
    styles: stylesOf(row),
    revision: row.revision,
    isDefault: row.status === 'active' && row.id === defaultId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  });
}

function revisionResourceOf(row: ThemeSetRevisionRow): ThemeSetRevisionResource {
  return buildThemeSetRevisionResource({
    themeSetId: row.themeSetId,
    revision: row.revision,
    name: row.name,
    styles: stylesOf(row),
    creator: { type: row.creatorType, id: row.creatorId },
    restoredFrom: row.restoredFrom,
    createdAt: row.createdAt,
  });
}

const creatorOf = (acting: ThemeActing): LastUpdater => acting.actor as LastUpdater;

async function documentOf(db: Db, environmentId: string, row: ThemeSetRow) {
  return { data: themeSetResourceOf(row, await defaultThemeSetIdOf(db, environmentId)) };
}

async function requireSet(db: Db, environmentId: string, id: string): Promise<ThemeSetRow> {
  const row = await getThemeSet(db, environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Theme set ${id} was not found.`);
  }
  return row;
}

async function lockedSet(tx: Db, environmentId: string, id: string): Promise<ThemeSetRow> {
  const row = await lockThemeSet(tx, environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Theme set ${id} was not found.`);
  }
  return row;
}

function requireActive(row: ThemeSetRow): void {
  if (row.status === 'archived') {
    throw new UnprocessableContentError(
      `Theme set ${row.id} is archived; an archived set is not changed.`,
    );
  }
}

const audit = <Action extends ThemeAuditAction>(
  deps: ThemeDeps,
  tx: Db,
  acting: ThemeActing,
  ...entry: Parameters<typeof themeAudit<Action>>
) => deps.audit.record(tx, auditEntryOf(acting.ctx, acting.actor, themeAudit(...entry)));

/** `GET /theme-sets`: newest first, the caller's environment only. */
export async function listThemeSetsFor(
  { db }: ThemeDeps,
  environmentId: string,
  query: ListThemeSetsQuery,
): Promise<{ data: ThemeSetResource[]; links: { next: string | null } }> {
  const statuses = query['filter[status]']?.split(',');
  const page = await listThemeSets(db, environmentId, {
    statuses,
    after: query['page[after]'],
    size: query['page[size]'] ?? DEFAULT_PAGE_SIZE,
  });
  const defaultId = await defaultThemeSetIdOf(db, environmentId);
  return {
    data: page.items.map((row) => themeSetResourceOf(row, defaultId)),
    links: {
      next: nextLink(PATH, { 'filter[status]': query['filter[status]'] }, query, page.next),
    },
  };
}

/** `GET /theme-sets/:id`. @throws {NotFoundError} outside the caller's environment. */
export async function getThemeSetFor(
  { db }: ThemeDeps,
  environmentId: string,
  id: string,
): Promise<ThemeSetDocument> {
  return documentOf(db, environmentId, await requireSet(db, environmentId, id));
}

/** `POST /theme-sets`: revision 1, after the rules; audited. */
export async function createThemeSet(
  deps: ThemeDeps,
  acting: ThemeActing,
  body: CreateThemeSetBody,
): Promise<ThemeSetDocument> {
  const { environmentId } = acting.ctx;
  const styles = body.data.attributes.styles ?? {};
  await assertStylesSavable(deps.db, environmentId, styles);
  const row = await deps.db.transaction(async (tx) => {
    const created = await insertThemeSetInTx(tx, environmentId, {
      id: deps.ids.newId('theset'),
      name: body.data.attributes.name,
      styles,
      creator: creatorOf(acting),
    });
    await audit(deps, tx, acting, 'theme-set.created', created.id, { revision: 1 });
    return created;
  });
  return documentOf(deps.db, environmentId, row);
}

/** `PATCH /theme-sets/:id`: the next revision; an omitted attribute is unchanged. */
export async function updateThemeSet(
  deps: ThemeDeps,
  acting: ThemeActing,
  id: string,
  body: UpdateThemeSetBody,
): Promise<ThemeSetDocument> {
  const { environmentId } = acting.ctx;
  const { name, styles } = body.data.attributes;
  if (styles !== undefined) {
    await assertStylesSavable(deps.db, environmentId, styles);
  }
  const row = await deps.db.transaction(async (tx) => {
    const current = await lockedSet(tx, environmentId, id);
    requireActive(current);
    const saved = await saveThemeSetRevisionInTx(tx, current, {
      name: name ?? current.name,
      styles: styles ?? current.styles,
      creator: creatorOf(acting),
      restoredFrom: null,
      now: deps.clock.now(),
    });
    await audit(deps, tx, acting, 'theme-set.updated', id, { revision: saved.revision });
    return saved;
  });
  return documentOf(deps.db, environmentId, row);
}

/** `POST /theme-sets/:id/restore`: an earlier revision's name and styles, as the next revision. */
export async function restoreThemeSet(
  deps: ThemeDeps,
  acting: ThemeActing,
  id: string,
  body: RestoreThemeSetBody,
): Promise<ThemeSetDocument> {
  const { environmentId } = acting.ctx;
  const wanted = body.meta.revision;
  await requireSet(deps.db, environmentId, id);
  const source = await getThemeSetRevision(deps.db, environmentId, id, wanted);
  if (source === null) {
    throw new UnprocessableContentError(`Theme set ${id} has no such revision.`, [
      { location: 'body', pointer: '/meta/revision', detail: 'names no revision of this set' },
    ]);
  }
  // The rules may have changed since the revision was saved, and its assets must still be here.
  await assertStylesSavable(deps.db, environmentId, stylesOf(source));
  const row = await deps.db.transaction(async (tx) => {
    const current = await lockedSet(tx, environmentId, id);
    requireActive(current);
    const saved = await saveThemeSetRevisionInTx(tx, current, {
      name: source.name,
      styles: source.styles,
      creator: creatorOf(acting),
      restoredFrom: wanted,
      now: deps.clock.now(),
    });
    await audit(deps, tx, acting, 'theme-set.restored', id, {
      revision: saved.revision,
      'restored-from': wanted,
    });
    return saved;
  });
  return documentOf(deps.db, environmentId, row);
}

/**
 * `DELETE /theme-sets/:id`: archives (public), which detaches the set; an archived set is answered
 * as it is.
 * @throws {ThemeProblemError} 409 `theme_set_default` for the environment's default.
 */
export async function archiveThemeSet(
  deps: ThemeDeps,
  acting: ThemeActing,
  id: string,
): Promise<ThemeSetDocument> {
  const { environmentId } = acting.ctx;
  const row = await deps.db.transaction(async (tx) => {
    const current = await lockedSet(tx, environmentId, id);
    if (current.status === 'archived') {
      return current;
    }
    if ((await defaultThemeSetIdOf(tx, environmentId)) === id) {
      throw new ThemeProblemError(
        'theme_set_default',
        "The environment's default theme set cannot be archived.",
      );
    }
    const archived = await archiveThemeSetInTx(tx, current, deps.clock.now());
    await audit(deps, tx, acting, 'theme-set.archived', id, { revision: archived.revision });
    return archived;
  });
  return documentOf(deps.db, environmentId, row);
}

/** `GET /theme-sets/:id/revisions`: newest first, paged by `page[before]`. */
export async function listThemeSetRevisionsFor(
  { db }: ThemeDeps,
  environmentId: string,
  id: string,
  query: ListThemeSetRevisionsQuery,
): Promise<{ data: ThemeSetRevisionResource[]; links: { next: string | null } }> {
  await requireSet(db, environmentId, id);
  const page = await listThemeSetRevisions(db, environmentId, id, {
    before: query['page[before]'],
    size: query['page[size]'] ?? DEFAULT_PAGE_SIZE,
  });
  const size = query['page[size]'];
  return {
    data: page.items.map(revisionResourceOf),
    links: {
      next:
        page.next === null
          ? null
          : `${PATH}/${id}/revisions?page[before]=${String(page.next)}` +
            (size === undefined ? '' : `&page[size]=${String(size)}`),
    },
  };
}
