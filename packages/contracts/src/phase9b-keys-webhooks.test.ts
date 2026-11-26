/**
 * C169 (Workflow 9B Stage 1a, (W)): key rotation, the key note, age and attribute blocklist, the
 * webhook name, description, failure alert and attempt headers, the notification subject and the
 * webhook-failure kind, notification preferences, and the sender name's grammar. Read through the
 * package root, so the index lines are held too.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;

describe('API keys (C169.1-C169.3)', () => {
  it('rotates in one call, the previous token kept up to 30 days', () => {
    expect(parses('rotateApiKeyBodySchema', { meta: { 'previous-expires-in-seconds': 0 } })).toBe(
      true,
    );
    expect(
      parses('rotateApiKeyBodySchema', { meta: { 'previous-expires-in-seconds': 2_592_000 } }),
    ).toBe(true);
    expect(
      parses('rotateApiKeyBodySchema', { meta: { 'previous-expires-in-seconds': 2_592_001 } }),
    ).toBe(false);
    expect(parses('rotateApiKeyBodySchema', { meta: {} })).toBe(false);
    const rotated = readFixture('api/api-key-rotated.json');
    expect(schema('rotatedApiKeyDocumentSchema').parse(rotated)).toEqual(rotated);
  });

  it('takes a note and an attribute blocklist, and marks an old key', () => {
    const create = {
      data: {
        type: 'api-key',
        attributes: {
          name: 'Back office',
          scopes: ['inquiries:read'],
          note: 'Rotated by the platform team every quarter',
          'attribute-blocklist': ['fields', 'reference-id'],
        },
      },
    };
    expect(parses('createApiKeyBodySchema', create)).toBe(true);
    expect(
      parses('updateApiKeyBodySchema', {
        data: { type: 'api-key', attributes: { note: 'x'.repeat(256) } },
      }),
    ).toBe(false);
    const key = readFixture('api/api-key-phase9b.json');
    expect(schema('apiKeyDocumentSchema').parse(key)).toEqual(key);
    expect(key).toMatchObject({ data: { attributes: { 'age-warning': true } } });
  });
});

describe('webhooks (C169.5, C169.6)', () => {
  it('takes a name, a description and a failure alert', () => {
    const body = {
      data: {
        type: 'webhook',
        attributes: {
          url: 'https://hooks.example.test/openverify',
          'enabled-events': ['inquiry.completed'],
          name: 'Back office',
          description: 'Completed inquiries for the review queue.',
          'failure-alert': { enabled: true, threshold: 5, 'window-minutes': 60 },
        },
      },
    };
    expect(parses('createWebhookBodySchema', body)).toBe(true);
    const alert = (value: unknown) =>
      parses('updateWebhookBodySchema', {
        data: { type: 'webhook', attributes: { 'failure-alert': value } },
      });
    expect(alert({ enabled: true, threshold: 0, 'window-minutes': 60 })).toBe(false);
    expect(alert({ enabled: true, threshold: 1, 'window-minutes': 4 })).toBe(false);
    expect(alert({ enabled: true, threshold: 1, 'window-minutes': 1441 })).toBe(false);
    expect(alert({ enabled: false, threshold: 1, 'window-minutes': 1440 })).toBe(true);
    const webhook = readFixture('api/webhook-phase9b.json');
    expect(schema('webhookDocumentSchema').parse(webhook)).toEqual(webhook);
  });

  it('names the three attempt headers every delivery sends', () => {
    expect(pick('WEBHOOK_ATTEMPTS_MADE_HEADER')).toBe('openverify-webhook-attempts-made');
    expect(pick('WEBHOOK_ATTEMPTS_LEFT_HEADER')).toBe('openverify-webhook-attempts-left');
    expect(pick('WEBHOOK_FIRST_ATTEMPTED_AT_HEADER')).toBe('openverify-webhook-first-attempted-at');
  });
});

describe('notifications (C169.7)', () => {
  it('serves a webhook failure with its webhook as the subject, and a case kind with its case', () => {
    const list = readFixture('api/user-notifications-phase9b.json');
    expect(schema('userNotificationListDocumentSchema').parse(list)).toEqual(list);
    const wrong = structuredClone(list) as {
      data: { relationships: Record<string, unknown> }[];
    };
    const [failure] = wrong.data;
    if (failure !== undefined) {
      failure.relationships = {
        case: { data: { type: 'case', id: 'case_01M5CN00000000000000009B50' } },
      };
    }
    expect(parses('userNotificationListDocumentSchema', wrong)).toBe(false);
  });

  it('holds a console and an email choice per kind, console on and email off by default', () => {
    const preferences = readFixture('api/notification-preferences.json');
    expect(schema('notificationPreferencesDocumentSchema').parse(preferences)).toEqual(preferences);
    expect(
      parses('updateNotificationPreferencesBodySchema', {
        data: {
          type: 'notification-preferences',
          attributes: { preferences: { 'webhook-failure': { console: true, email: true } } },
        },
      }),
    ).toBe(true);
    expect(
      parses('updateNotificationPreferencesBodySchema', {
        data: {
          type: 'notification-preferences',
          attributes: { preferences: { unknown: { console: true, email: true } } },
        },
      }),
    ).toBe(false);
  });
});

describe('the sender name (C169.8, review P29)', () => {
  const name = (value: string) => parses('mailSenderNameSchema', value);

  it('takes a display name, and none of the spoofing forms', () => {
    expect(name('Example Verification')).toBe(true);
    expect(name('Équipe de vérification')).toBe(true);
    for (const spoof of [
      'Bank Security <alerts@bank.example>',
      'alerts@bank.example',
      '"Bank" Security',
      'Bank\nSecurity',
      'Bank\u0007Security',
      'Bank > Security',
      'a'.repeat(101),
      '',
    ]) {
      expect(name(spoof), JSON.stringify(spoof)).toBe(false);
    }
  });

  it('refuses a format character and an encoded word, which formatSender would only ignore (integration-9b)', () => {
    for (const spoof of [
      'Bank\u202eytiruceS',
      'Bank\u200bSecurity',
      '=?utf-8?q?alerts=40bank.example?=',
      'Bank =? Security',
    ]) {
      expect(name(spoof), JSON.stringify(spoof)).toBe(false);
    }
  });

  it('holds the settings route to the same grammar', () => {
    expect(
      parses('dashboardUpdateSettingsBodySchema', {
        'mail-sender-name': 'Bank Security <alerts@bank.example>',
      }),
    ).toBe(false);
  });
});
