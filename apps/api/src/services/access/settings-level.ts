/**
 * C167.2 (Phase 9, Workflow 9B; verification round V14): `PATCH /dashboard/settings` changes an
 * organisation setting (`SETTING_LEVEL`, today `require-mfa`) only for a caller who holds
 * `settings:write` through an organisation-wide assignment, while a `settings:write` held in one
 * environment still changes that environment's own settings. Owner: `api-access`; `foundation-9b`
 * (Stage 1b (U)) froze the signature and placed the call in `updateDashboardSettings`
 * (`services/settings.ts`), before anything is written.
 *
 * Only a dashboard user changes an organisation setting: any other actor is refused one (fails
 * closed), and keeps changing environment settings as before.
 */
import type { AuditActor } from '@openverify/contracts';
import { settingLevel } from '@openverify/core';
import { listUserRoleAssignments, type Db } from '@openverify/db';
import { PermissionDeniedError } from '../../errors.js';
import { organizationWidePermissions } from './grants.js';

export interface SettingsLevelCheck {
  organizationId: string;
  environmentId: string;
  /** Who changes the settings (a dashboard user). */
  actor: AuditActor;
  /** The settings keys the change sets. */
  keys: readonly string[];
}

export type AssertSettingsLevelAllowed = (db: Db, check: SettingsLevelCheck) => Promise<void>;

/**
 * Refuses an organisation-level settings change the caller may not make.
 * @throws {PermissionDeniedError} 403 `forbidden`, naming the organisation settings.
 */
export const assertSettingsLevelAllowed: AssertSettingsLevelAllowed = async (db, check) => {
  const organizationKeys = check.keys.filter((key) => settingLevel(key) === 'organization');
  if (organizationKeys.length === 0) {
    return;
  }
  const held =
    check.actor.type === 'user'
      ? organizationWidePermissions(
          await listUserRoleAssignments(db, check.organizationId, check.actor.id),
        )
      : new Set<string>();
  if (!held.has('settings:write')) {
    throw new PermissionDeniedError(
      `Changing ${organizationKeys.join(', ')} needs settings:write in every environment of the organization.`,
      ['settings:write'],
    );
  }
};
