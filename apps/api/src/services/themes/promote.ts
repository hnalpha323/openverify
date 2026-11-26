/**
 * C160.8 (`api-themes`, Workflow 9B; review P19): a promoted version's `theme-set-id` re-resolved by
 * **name** among the target environment's active sets. One match is used as it is. With none, the
 * promote copies the set (its current revision's name and styles, as revision 1) and its logo and
 * font assets into the target, only for a caller who holds `theme-sets:write` there; otherwise, and
 * for more than one match, it is refused with `promote_unresolved` naming the theme reference.
 * `api-templates`' promote (`services/templates/operations.ts`) calls it and records `copied` in its
 * answer and its audit entry.
 *
 * Copying an asset needs the storage and the keyring: the template promote passes them as `assets`
 * (K9-32, Workflow 9D), so a set with a logo or font is copied with its assets, each as stored (its
 * bytes re-sealed under a new id in the target, never re-uploaded from a client). A caller that
 * passes no `assets` still has a set with an asset refused with `promote_unresolved`, never copied
 * without it.
 */
import type { AuditActor, LastUpdater } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { TemplateProblemError } from '../../errors.js';
import { ulidIdGenerator, type FileStorage, type IdGenerator } from '../../ports.js';
import type { Keyring } from '@openverify/db';
import { copyThemeAssetInTx } from './assets.js';
import {
  activeThemeSetsNamed,
  getThemeAsset,
  getThemeSet,
  insertThemeSetInTx,
  type ThemeSetRow,
} from './store.js';
import { storedStylesOf } from './styles.js';

/** A promote's theme reference, from the source version into the target environment. */
export interface PromoteThemeReference {
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  /** The source version's `theme-set-id`. */
  themeSetId: string | null;
  /** The promoting user (promote is users only, C154.5). */
  actor: AuditActor;
  /** Whether the caller holds `theme-sets:write` in the target environment. */
  mayWriteThemeSets: boolean;
  /** What copies an asset's object (C160.8); without it a set with an asset is not copied. */
  assets?: { storage: FileStorage; keyring: Keyring; ids?: IdGenerator } | undefined;
}

/** The target version's `theme-set-id`, and whether the set was copied into the target. */
export interface PromotedThemeReference {
  themeSetId: string | null;
  copied: boolean;
}

const POINTER = '/data/attributes/theme-set-id';

function unresolved(detail: string): TemplateProblemError {
  return new TemplateProblemError(
    'promote_unresolved',
    'A reference has no single match in the target environment.',
    [{ location: 'body', pointer: POINTER, detail }],
  );
}

/** The asset ids a stored styles tree names: its logo and its uploaded font. */
function assetIdsOf(styles: Record<string, unknown>): { logo?: string; font?: string } {
  const parsed = storedStylesOf(styles);
  const logo = parsed?.branding?.logo?.['asset-id'];
  const font = parsed?.typography?.font;
  return {
    ...(logo === undefined ? {} : { logo }),
    ...(font?.kind === 'uploaded' ? { font: font['asset-id'] } : {}),
  };
}

/** The source tree with each asset id replaced by its copy's. */
function withAssetIds(
  styles: Record<string, unknown>,
  ids: { logo?: string; font?: string },
): Record<string, unknown> {
  const copy = structuredClone(styles) as {
    branding?: { logo?: { 'asset-id': string } };
    typography?: { font?: { kind: string; 'asset-id'?: string } };
  };
  if (ids.logo !== undefined && copy.branding?.logo !== undefined) {
    copy.branding.logo['asset-id'] = ids.logo;
  }
  if (ids.font !== undefined && copy.typography?.font !== undefined) {
    copy.typography.font['asset-id'] = ids.font;
  }
  return copy;
}

async function copySet(
  tx: Db,
  reference: PromoteThemeReference,
  source: ThemeSetRow,
): Promise<string> {
  const named = assetIdsOf(source.styles);
  const ids = reference.assets?.ids ?? ulidIdGenerator;
  const copied: { logo?: string; font?: string } = {};
  for (const kind of ['logo', 'font'] as const) {
    const assetId = named[kind];
    if (assetId === undefined) {
      continue;
    }
    if (reference.assets === undefined) {
      throw unresolved(
        'The theme set has assets, and this promote cannot copy them; create the set in the ' +
          'target environment first.',
      );
    }
    const asset = await getThemeAsset(tx, reference.sourceEnvironmentId, assetId, kind);
    if (asset === null) {
      throw unresolved('The theme set names an asset its environment no longer has.');
    }
    copied[kind] = (
      await copyThemeAssetInTx(
        tx,
        { ...reference.assets, ids },
        asset,
        reference.targetEnvironmentId,
      )
    ).id;
  }
  const created = await insertThemeSetInTx(tx, reference.targetEnvironmentId, {
    id: ids.newId('theset'),
    name: source.name,
    styles: withAssetIds(source.styles, copied),
    creator: reference.actor as LastUpdater,
  });
  return created.id;
}

/**
 * Re-resolves (or copies) the theme set of a promoted version.
 * @throws {TemplateProblemError} `promote_unresolved` at `/data/attributes/theme-set-id`.
 */
export async function promoteThemeReferenceInTx(
  tx: Db,
  reference: PromoteThemeReference,
): Promise<PromotedThemeReference> {
  if (reference.themeSetId === null) {
    return { themeSetId: null, copied: false };
  }
  const source = await getThemeSet(tx, reference.sourceEnvironmentId, reference.themeSetId);
  if (source === null) {
    throw unresolved('The version names a theme set its environment does not have.');
  }
  const matches = await activeThemeSetsNamed(tx, reference.targetEnvironmentId, source.name);
  const [match] = matches;
  if (matches.length > 1) {
    throw unresolved('More than one active theme set of this name is in the target environment.');
  }
  if (match !== undefined) {
    return { themeSetId: match.id, copied: false };
  }
  if (!reference.mayWriteThemeSets) {
    throw unresolved(
      'No active theme set of this name is in the target environment, and copying one needs ' +
        'theme-sets:write there.',
    );
  }
  return { themeSetId: await copySet(tx, reference, source), copied: true };
}
