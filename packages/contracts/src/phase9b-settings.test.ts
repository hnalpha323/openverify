/**
 * C174.6 (Workflow 9B Stage 1a, common): the platform settings of Workflow 9B on the C16 settings
 * route, each with its default and bounds (every one provisional, with its basis in the contract):
 * the reporting time zone (C163.2), the suppression threshold (C164.7, floor 11), the analytics,
 * settle and assignee windows (C163.3, C163.4, C163.6), the key age warning (C169.2), the mail
 * sender name (C169.8; its grammar is family (W)'s) and the audit log retention (C168.6).
 */
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  dashboardSettingsSchema,
  dashboardUpdateSettingsBodySchema,
  resolvePlatformSettings,
} from './dashboard-api.js';

const PLATFORM_DEFAULTS = {
  'analytics-time-zone': 'UTC',
  'analytics-suppression-threshold': 11,
  'analytics-retention-months': 13,
  'analytics-settle-days': 30,
  'analytics-assignee-retention-months': 13,
  'api-key-age-warning-days': 90,
  'mail-sender-name': null,
  'audit-log-retention-days': null,
};

const accepts = (body: Record<string, unknown>) =>
  dashboardUpdateSettingsBodySchema.safeParse(body).success;

describe('the Workflow 9B settings (C174.6)', () => {
  it('serves each with its default', () => {
    expect(DASHBOARD_SETTINGS_DEFAULTS).toMatchObject(PLATFORM_DEFAULTS);
    expect(dashboardSettingsSchema.parse(DASHBOARD_SETTINGS_DEFAULTS)).toMatchObject(
      PLATFORM_DEFAULTS,
    );
  });

  it.each([
    ['analytics-suppression-threshold', 11, 100, [10, 0, 101, 11.5]],
    ['analytics-retention-months', 13, 60, [12, 61]],
    ['analytics-settle-days', 1, 90, [0, 91]],
    ['analytics-assignee-retention-months', 1, 60, [0, 61]],
    ['api-key-age-warning-days', 1, 3650, [0, 3651]],
    ['audit-log-retention-days', 30, 3650, [29, 3651]],
  ] as const)('holds %s to %d..%d', (name, min, max, refused) => {
    expect(accepts({ [name]: min })).toBe(true);
    expect(accepts({ [name]: max })).toBe(true);
    for (const value of refused) {
      expect(accepts({ [name]: value }), `${name} ${String(value)}`).toBe(false);
    }
  });

  it('never lowers the suppression threshold below 11 (C164.7, decision 37)', () => {
    expect(accepts({ 'analytics-suppression-threshold': 10 })).toBe(false);
    expect(accepts({ 'analytics-suppression-threshold': null })).toBe(false);
  });

  it('keeps audit logs as today with null (C168.6)', () => {
    expect(accepts({ 'audit-log-retention-days': null })).toBe(true);
  });

  it.each(['UTC', 'Europe/Paris', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'Etc/UTC'])(
    'takes the IANA time zone %s',
    (zone) => {
      expect(accepts({ 'analytics-time-zone': zone })).toBe(true);
    },
  );

  it.each([
    '',
    'utc',
    '+05:30',
    '-03:00',
    'Mars/Olympus_Mons',
    'Europe/Paris ',
    'GMT+5',
    'x'.repeat(65),
  ])(
    'refuses %j: an offset, an unknown zone or a name the runtime does not know (C163.2)',
    (zone) => {
      expect(accepts({ 'analytics-time-zone': zone })).toBe(false);
    },
  );

  it('takes a sender display name of at most 100 characters, and null for none (C169.8)', () => {
    expect(accepts({ 'mail-sender-name': 'Example Verification Team' })).toBe(true);
    expect(accepts({ 'mail-sender-name': 'a'.repeat(100) })).toBe(true);
    expect(accepts({ 'mail-sender-name': 'a'.repeat(101) })).toBe(false);
    expect(accepts({ 'mail-sender-name': null })).toBe(true);
  });
});

describe('resolvePlatformSettings (C174.6)', () => {
  it('takes each stored value and the default for each absent one', () => {
    expect(resolvePlatformSettings({})).toEqual(PLATFORM_DEFAULTS);
    expect(
      resolvePlatformSettings({ 'analytics-time-zone': 'Asia/Kolkata', 'mail-sender-name': null }),
    ).toEqual({ ...PLATFORM_DEFAULTS, 'analytics-time-zone': 'Asia/Kolkata' });
    expect(resolvePlatformSettings({ 'audit-log-retention-days': 400 })).toMatchObject({
      'audit-log-retention-days': 400,
    });
  });
});
