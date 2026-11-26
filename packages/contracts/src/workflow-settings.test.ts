/**
 * C143.7 (Workflow 8A): the workflow settings on the C16 settings body. Each list keeps its cap, and
 * each entry its shape; what only the egress rules can judge is `api-egress`' check on the route.
 */
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SETTINGS_DEFAULTS,
  WORKFLOW_SETTING_LIMITS,
  dashboardSettingsSchema,
  dashboardUpdateSettingsBodySchema,
} from './dashboard-api.js';

const valid = (body: object) => dashboardUpdateSettingsBodySchema.safeParse(body).success;

describe('the workflow settings (C143.7)', () => {
  it('state their defaults', () => {
    expect(DASHBOARD_SETTINGS_DEFAULTS).toMatchObject({
      'workflow-run-retention-days': 30,
      'workflow-run-history-retention-days': 365,
      'workflow-in-flight-cap': 50,
      'workflow-http-ports': [],
      'workflow-http-hosts': null,
      'workflow-http-private-cidrs': [],
      'workflow-email-recipients': [],
      'workflow-sms-recipients': [],
      'workflow-sms-countries': null,
      'workflow-link-hosts': [],
      'case-retention-days': null,
    });
  });

  it('are optional in an answer, so earlier answers parse', () => {
    expect(
      dashboardSettingsSchema.safeParse({
        'require-mfa': false,
        'inquiry-retention-days': null,
        'api-log-retention-days': 30,
        'webhook-delivery-retention-days': 30,
        'event-retention-days': 90,
      }).success,
    ).toBe(true);
  });

  it('take each in an update', () => {
    expect(
      valid({
        'workflow-run-retention-days': 7,
        'workflow-run-history-retention-days': 90,
        'workflow-in-flight-cap': 10,
        'workflow-http-ports': [8443],
        'workflow-http-hosts': ['api.example.com'],
        'workflow-http-private-cidrs': ['10.0.0.0/8', 'fd00::/8'],
        'workflow-email-recipients': ['alerts@example.com', 'example.org'],
        'workflow-sms-recipients': ['+15005550006'],
        'workflow-sms-countries': ['GB', 'US'],
        'workflow-link-hosts': ['www.example.com'],
        'case-retention-days': 400,
      }),
    ).toBe(true);
  });

  it('take null to turn the host allowlist off and to follow the template’s countries', () => {
    expect(valid({ 'workflow-http-hosts': null, 'workflow-sms-countries': null })).toBe(true);
    expect(valid({ 'case-retention-days': null })).toBe(true);
  });

  it.each([
    ['workflow-run-retention-days', 0],
    ['workflow-run-retention-days', 3_651],
    ['workflow-run-history-retention-days', 0],
    ['workflow-in-flight-cap', 0],
    ['workflow-http-ports', [0]],
    ['workflow-http-ports', [65_536]],
    ['workflow-http-hosts', ['https://api.example.com']],
    ['workflow-http-hosts', ['API.example.com']],
    ['workflow-http-private-cidrs', ['not a cidr']],
    ['workflow-email-recipients', ['no spaces@example.com']],
    ['workflow-sms-recipients', ['not a number']],
    ['workflow-sms-countries', ['gb']],
    ['workflow-link-hosts', ['exa mple.com']],
    ['case-retention-days', 0],
    ['case-retention-days', 3_651],
  ])('refuse %s %j', (key, value) => {
    expect(valid({ [key]: value })).toBe(false);
  });

  it('cap each list', () => {
    const over = (count: number, value: unknown) => Array.from({ length: count }, () => value);

    expect(
      valid({
        'workflow-http-ports': over(WORKFLOW_SETTING_LIMITS.ports + 1, 8443),
      }),
    ).toBe(false);
    expect(
      valid({ 'workflow-http-hosts': over(WORKFLOW_SETTING_LIMITS.hosts + 1, 'example.com') }),
    ).toBe(false);
    expect(
      valid({
        'workflow-email-recipients': over(WORKFLOW_SETTING_LIMITS.recipients + 1, 'example.com'),
      }),
    ).toBe(false);
  });
});
