import { describe, expect, it } from 'vitest';
import {
  MAX_EXPIRATION_SECONDS,
  MAX_RETENTION_DAYS,
  MIN_EXPIRATION_SECONDS,
  MIN_RETENTION_DAYS,
  TEMPLATE_SETTINGS_DEFAULTS,
  resolveTemplateSettings,
  resolvedTemplateSettingsSchema,
  templateSettingsSchema,
} from './template-settings.js';
import { issuesOf } from './test-support.js';

describe('template settings (C11)', () => {
  it('default to 24 hours and the environment retention', () => {
    expect(TEMPLATE_SETTINGS_DEFAULTS).toEqual({
      'inquiry-expiration-seconds': 86_400,
      'session-expiration-seconds': 86_400,
      'one-time-link-expiration-seconds': 86_400,
      'retention-days': null,
      // C91.5 (Phase 7): the session cap.
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
      // C151.10 (Workflow 9A): no change at start, a day at resume.
      'inquiry-expiration-after-start-seconds': null,
      'inquiry-expiration-after-resume-seconds': 86_400,
      // C235.3 (Workflow 11A): off by default.
      'accept-cloned-results': null,
    });
    expect(Object.isFrozen(TEMPLATE_SETTINGS_DEFAULTS)).toBe(true);
  });

  it('bound expirations to 5 minutes-30 days and retention to 1-3650 days', () => {
    expect([MIN_EXPIRATION_SECONDS, MAX_EXPIRATION_SECONDS]).toEqual([300, 2_592_000]);
    expect([MIN_RETENTION_DAYS, MAX_RETENTION_DAYS]).toEqual([1, 3650]);
  });

  it('are all optional when sent', () => {
    expect(issuesOf(templateSettingsSchema.safeParse({}))).toEqual([]);
    expect(templateSettingsSchema.parse({})).toEqual({});
    const full = {
      'inquiry-expiration-seconds': 300,
      'session-expiration-seconds': 2_592_000,
      'one-time-link-expiration-seconds': 3600,
      'retention-days': 3650,
    };
    expect(templateSettingsSchema.parse(full)).toEqual(full);
    expect(templateSettingsSchema.parse({ 'retention-days': null })).toEqual({
      'retention-days': null,
    });
  });

  it.each([
    ['an expiration below 5 minutes', { 'inquiry-expiration-seconds': 299 }],
    ['an expiration above 30 days', { 'session-expiration-seconds': 2_592_001 }],
    ['a fractional expiration', { 'one-time-link-expiration-seconds': 300.5 }],
    ['a retention of 0 days', { 'retention-days': 0 }],
    ['a retention above 10 years', { 'retention-days': 3651 }],
    ['an unknown setting', { 'max-attempts': 3 }],
  ])('reject %s', (_name, value) => {
    expect(templateSettingsSchema.safeParse(value).success).toBe(false);
  });

  it('apply the defaults on read', () => {
    expect(resolveTemplateSettings()).toEqual(TEMPLATE_SETTINGS_DEFAULTS);
    expect(resolveTemplateSettings({ 'session-expiration-seconds': 600 })).toEqual({
      ...TEMPLATE_SETTINGS_DEFAULTS,
      'session-expiration-seconds': 600,
    });
    expect(resolvedTemplateSettingsSchema.parse(resolveTemplateSettings())).toEqual(
      TEMPLATE_SETTINGS_DEFAULTS,
    );
    expect(resolvedTemplateSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('keep every value a version sets, including a null retention', () => {
    const full = {
      'inquiry-expiration-seconds': 600,
      'session-expiration-seconds': 900,
      'one-time-link-expiration-seconds': 1200,
      'retention-days': 7,
      'max-sessions': 3,
      'expire-inquiry-on-session-limit': true,
      'inquiry-expiration-after-start-seconds': 1800,
      'inquiry-expiration-after-resume-seconds': 3600,
      'accept-cloned-results': {
        'verification-types': ['government-id' as const],
        'max-age-days': 30,
      },
    };
    expect(resolveTemplateSettings(full)).toEqual(full);
    expect(resolveTemplateSettings({ 'retention-days': null })['retention-days']).toBeNull();
  });

  // Workflow 9A Stage 1a (final e2e gate): the console's "New draft" copies the current version's
  // resolved settings into the new draft, so what is served must be accepted back unchanged.
  it('take back the resolved settings, the after-start window null meaning none (C151.10)', () => {
    expect(templateSettingsSchema.safeParse(TEMPLATE_SETTINGS_DEFAULTS).success).toBe(true);
    expect(
      templateSettingsSchema.parse({ 'inquiry-expiration-after-start-seconds': null }),
    ).toEqual({ 'inquiry-expiration-after-start-seconds': null });
    expect(
      resolveTemplateSettings({ 'inquiry-expiration-after-start-seconds': null })[
        'inquiry-expiration-after-start-seconds'
      ],
    ).toBeNull();
    expect(resolveTemplateSettings(resolveTemplateSettings({}))).toEqual(
      TEMPLATE_SETTINGS_DEFAULTS,
    );
  });
});
