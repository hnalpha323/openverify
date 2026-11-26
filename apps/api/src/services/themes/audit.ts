/**
 * C160.5, C160.6, C160.8, C174.5 (Phase 8 C143.5): what a theme audit entry may carry. Each action
 * has a strict schema with no free-text member, so a set's name or a style never reaches
 * `audit_logs.metadata`: revision numbers, ids, kinds and sizes.
 */
import { idSchema, THEME_ASSET_KINDS, THEME_ASSET_MEDIA_TYPES } from '@openverify/contracts';
import { z } from 'zod';
import type { AuditedAction } from '../context.js';

const revision = z.int().min(1);

const SCHEMAS = {
  'theme-set.created': z.strictObject({ revision }),
  'theme-set.updated': z.strictObject({ revision }),
  'theme-set.restored': z.strictObject({ revision, 'restored-from': revision }),
  'theme-set.archived': z.strictObject({ revision }),
  // C160.8: a promote copied the set from another environment of the organisation.
  'theme-set.copied': z.strictObject({
    revision,
    'source-theme-set-id': idSchema('theset'),
    'source-environment-id': idSchema('env'),
  }),
  'theme-asset.created': z.strictObject({
    kind: z.enum(THEME_ASSET_KINDS),
    'media-type': z.enum(THEME_ASSET_MEDIA_TYPES),
    'byte-size': z.int().min(1),
  }),
  'theme-asset.copied': z.strictObject({
    kind: z.enum(THEME_ASSET_KINDS),
    'source-theme-asset-id': idSchema('tsa'),
    'source-environment-id': idSchema('env'),
  }),
} as const;

export type ThemeAuditAction = keyof typeof SCHEMAS;

/** Every action this folder writes, for the coverage test. */
export const THEME_AUDIT_ACTIONS = Object.keys(SCHEMAS) as readonly ThemeAuditAction[];

/**
 * The entry of `action` on `resourceId`.
 * @throws {z.ZodError} for metadata outside the action's schema, which is a bug here.
 */
export function themeAudit<Action extends ThemeAuditAction>(
  action: Action,
  resourceId: string,
  metadata: z.input<(typeof SCHEMAS)[Action]>,
): AuditedAction & { metadata: Record<string, unknown> } {
  return {
    action,
    resourceType: action.startsWith('theme-asset.') ? 'theme-asset' : 'theme-set',
    resourceId,
    metadata: SCHEMAS[action].parse(metadata),
  };
}
