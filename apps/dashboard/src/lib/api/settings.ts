/**
 * Settings (C15, C16, dashboard API): the organization's `require-mfa`, and the retention windows
 * of the session's environment. Reading needs `settings:read`, changing `settings:write`; every
 * change is audited.
 */
import 'server-only';
import {
  dashboardSettingsSchema,
  type DashboardSettings,
  type DashboardUpdateSettingsBody,
} from '@openverify/contracts';
import { apiRequest } from './client';

const SETTINGS_PATH = '/dashboard/settings';

/** `GET /dashboard/settings`, with the C16 defaults applied by the API. */
export function getSettings(): Promise<DashboardSettings> {
  return apiRequest({ method: 'GET', path: SETTINGS_PATH, schema: dashboardSettingsSchema });
}

/** `PATCH /dashboard/settings`: sets the given settings; the others keep their values. */
export function updateSettings(changes: DashboardUpdateSettingsBody): Promise<DashboardSettings> {
  return apiRequest({
    method: 'PATCH',
    path: SETTINGS_PATH,
    body: changes,
    schema: dashboardSettingsSchema,
  });
}
