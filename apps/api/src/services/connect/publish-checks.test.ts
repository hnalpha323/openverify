/**
 * C238.2 (verification V06; Workflow 11A, `api-consent` checkpoint 3): the one Connect publish hook.
 * One test per code and per acknowledgement, over `connect-logic`'s `connectPublishRules` with the
 * version's flow, settings, copy and the organisation's connections read here: the seven codes
 * (`share_consent_connect_disabled`, `share_consent_connection_invalid` with its warning
 * `share_consent_connection_not_active`, `share_consent_after_completion`,
 * `share_consent_after_cloned_step`, `share_consent_withdrawal_contact_missing`,
 * `share_consent_retention_missing`, `cloned_results_without_binding`) and the three
 * acknowledgements (`cloned-results`, `cloned-results-unbound`, `share-consent-default-text`). Also
 * the names connect-logic mirrors (its contractDeviation (a)): the placeholders, the text keys and
 * the publish codes equal flow-spec's and the contracts'.
 */
import { CONNECT_PUBLISH_RULE_CODES, CONNECT_PUBLISH_WARNING_CODES } from '@openverify/contracts';
import {
  CONNECT_PUBLISH_ERROR_CODES,
  CONNECT_PUBLISH_WARNINGS,
  SHARE_CONSENT_TEXT_KEYS,
  SHARE_TEXT_PLACEHOLDERS,
} from '@openverify/core';
import { getInquiryTemplate, type InquiryTemplateVersion } from '@openverify/db';
import { COPY_KEYS, SHARE_CONSENT_PLACEHOLDERS } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemplate, createTestApi, type TestApi } from '../../test-support/harness.js';
import { flowPublishReport } from '../publish/flow-v2.js';
import { seedConnection } from './consent.test-support.js';
import { connectPublishChecks } from './publish-checks.js';

let api: TestApi;
let active: string;
let pending: string;
let inbound: string;

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
  const partner = await api.newTenant();
  active = (
    await seedConnection(api.database.db, {
      sourceOrganizationId: api.organizationId,
      destinationOrganizationId: partner.organizationId,
    })
  ).id;
  const other = await api.newTenant();
  pending = (
    await seedConnection(api.database.db, {
      sourceOrganizationId: api.organizationId,
      destinationOrganizationId: other.organizationId,
      status: 'pending',
    })
  ).id;
  inbound = (
    await seedConnection(api.database.db, {
      sourceOrganizationId: partner.organizationId,
      destinationOrganizationId: api.organizationId,
    })
  ).id;
});

afterAll(async () => {
  await api.close();
});

const CONTACT = 'Write to privacy@example.com';
type Step = Record<string, unknown> & { id: string; type: string };

const flowOf = (steps: Step[], edges: [string, string][] = []) => ({
  metadata: { specVersion: 2, id: 'flow_publish', version: 1, name: 'Synthetic' },
  entry: steps[0]?.id ?? 'done',
  steps,
  edges: edges.map(([from, to], index) => ({ id: `e${String(index)}`, from, port: 'next', to })),
});

const chain = (steps: Step[]) =>
  flowOf(
    steps,
    steps.slice(1).map((step, index) => [steps[index]?.id ?? '', step.id]),
  );

const sourceStep = (overrides: Record<string, unknown> = {}): Step => ({
  id: 'share-out',
  type: 'share_consent',
  side: 'source',
  connectionId: active,
  withdrawalContact: CONTACT,
  ...overrides,
});
const destinationStep = (overrides: Record<string, unknown> = {}): Step => ({
  id: 'share-in',
  type: 'share_consent',
  side: 'destination',
  withdrawalContact: CONTACT,
  ...overrides,
});
const done: Step = { id: 'done', type: 'completion' };
const governmentId: Step = {
  id: 'gov',
  type: 'government_id',
  sides: 'both',
  maxAttempts: 3,
  captureMethods: ['camera', 'upload'],
};

/** Overrides the copy of every share.consent key in English, so no default-text ack is asked. */
const ALL_COPY = {
  messages: {
    en: Object.fromEntries(
      Object.keys(COPY_KEYS)
        .filter((key) => key.startsWith('share.consent.'))
        .map((key) => [key, 'Synthetic operator text.']),
    ),
  },
};

const versionOf = (
  flow: unknown,
  options: { settings?: Record<string, unknown>; copy?: unknown; config?: unknown } = {},
) =>
  ({
    flow,
    settings: { 'retention-days': 365, ...options.settings },
    verificationConfig: options.config ?? {},
    copy: options.copy ?? ALL_COPY,
    enabledLocales: ['en'],
  }) as unknown as InquiryTemplateVersion;

const check = (
  version: InquiryTemplateVersion,
  options: { connectEnabled?: boolean; givenAcknowledgements?: readonly string[] } = {},
) =>
  connectPublishChecks(api.database.db, {
    environment: { id: api.environmentId, kind: 'sandbox' },
    templateId: 'itmpl_01M5CN0000000000000011A001',
    version,
    connectEnabled: options.connectEnabled ?? true,
    ...(options.givenAcknowledgements === undefined
      ? {}
      : { givenAcknowledgements: options.givenAcknowledgements }),
  });

const codes = async (...args: Parameters<typeof check>) =>
  (await check(...args)).problems.map(({ code, pointer }) => `${code} ${pointer}`);
const keys = async (...args: Parameters<typeof check>) =>
  (await check(...args)).acknowledgements.map(({ key }) => key);

describe('the names connect-logic mirrors (its contractDeviation (a))', () => {
  it('holds the placeholders, the text keys and the publish codes to flow-spec and the contracts', () => {
    expect([...SHARE_TEXT_PLACEHOLDERS]).toEqual([...SHARE_CONSENT_PLACEHOLDERS]);
    for (const side of ['source', 'destination'] as const) {
      const sideKeys: readonly string[] = Object.values(SHARE_CONSENT_TEXT_KEYS[side]);
      for (const key of sideKeys) {
        expect(Object.hasOwn(COPY_KEYS, key), key).toBe(true);
      }
    }
    expect([...CONNECT_PUBLISH_ERROR_CODES].sort()).toEqual([...CONNECT_PUBLISH_RULE_CODES].sort());
    expect([...CONNECT_PUBLISH_WARNINGS]).toEqual([...CONNECT_PUBLISH_WARNING_CODES]);
  });
});

describe('the publish codes (C238.2)', () => {
  it('passes a well-formed source step on an active connection', async () => {
    expect(await check(versionOf(chain([sourceStep(), done])))).toEqual({
      problems: [],
      acknowledgements: [],
    });
  });

  it('share_consent_connect_disabled while the install switch is off (C231.10)', async () => {
    expect(
      await codes(versionOf(chain([sourceStep(), done])), { connectEnabled: false }),
    ).toContain('share_consent_connect_disabled /flow/steps/0');
  });

  it('share_consent_connection_invalid for an unknown or an inbound connection', async () => {
    for (const connectionId of ['cxn_01M5CN0000000000000011A999', inbound]) {
      expect(await codes(versionOf(chain([sourceStep({ connectionId }), done])))).toContain(
        'share_consent_connection_invalid /flow/steps/0',
      );
    }
  });

  it('the warning share_consent_connection_not_active for a pending connection', async () => {
    const report = await check(versionOf(chain([sourceStep({ connectionId: pending }), done])));
    expect(report.problems).toEqual([
      expect.objectContaining({
        code: 'share_consent_connection_not_active',
        severity: 'warning',
        pointer: '/flow/steps/0',
      }),
    ]);
  });

  it('share_consent_after_completion for a step reachable from a completion', async () => {
    const flow = flowOf([done, sourceStep()], [['done', 'share-out']]);
    expect(await codes(versionOf(flow))).toContain('share_consent_after_completion /flow/steps/1');
  });

  it('share_consent_after_cloned_step for a destination step after a listed verification step', async () => {
    const flow = chain([governmentId, destinationStep(), done]);
    const found = await codes(
      versionOf(flow, {
        settings: {
          'accept-cloned-results': { 'verification-types': ['government-id'], 'max-age-days': 30 },
        },
      }),
      { givenAcknowledgements: ['cloned-results-unbound:government-id'] },
    );
    expect(found).toContain('share_consent_after_cloned_step /flow/steps/1');
  });

  it('share_consent_withdrawal_contact_missing for a step without a contact (C237.4)', async () => {
    const step = sourceStep();
    delete step.withdrawalContact;
    expect(await codes(versionOf(chain([step, done])))).toContain(
      'share_consent_withdrawal_contact_missing /flow/steps/0/withdrawalContact',
    );
  });

  it('share_consent_retention_missing for a destination step with no retention term (C238.9)', async () => {
    const flow = chain([destinationStep(), done]);
    expect(await codes(versionOf(flow, { settings: { 'retention-days': null } }))).toContain(
      'share_consent_retention_missing /flow/steps/0',
    );
    expect(await codes(versionOf(flow))).toEqual([]);
  });

  it('cloned_results_without_binding unless cloned-results-unbound is given (C235.8)', async () => {
    const flow = chain([destinationStep(), governmentId, done]);
    const version = versionOf(flow, {
      settings: {
        'accept-cloned-results': { 'verification-types': ['government-id'], 'max-age-days': 30 },
      },
    });
    expect(await codes(version)).toContain(
      'cloned_results_without_binding /settings/accept-cloned-results/verification-types/0',
    );
    expect(
      await codes(version, { givenAcknowledgements: ['cloned-results-unbound:government-id'] }),
    ).toEqual([]);
  });
});

describe('the acknowledgements (C235.3, C235.8, C238.10)', () => {
  const cloned = {
    'accept-cloned-results': { 'verification-types': ['government-id'], 'max-age-days': 30 },
  };

  it('cloned-results:<type> for every listed type', async () => {
    expect(await keys(versionOf(chain([done]), { settings: cloned }))).toEqual([
      'cloned-results:government-id',
    ]);
  });

  it('cloned-results-unbound:<type> where no live selfie binds the person', async () => {
    const flow = chain([destinationStep(), governmentId, done]);
    expect(await keys(versionOf(flow, { settings: cloned }))).toEqual([
      'cloned-results:government-id',
      'cloned-results-unbound:government-id',
    ]);
  });

  it('share-consent-default-text:<step> where a built-in text counsel has not reviewed shows', async () => {
    expect(await keys(versionOf(chain([sourceStep(), done]), { copy: { messages: {} } }))).toEqual([
      'share-consent-default-text:share-out',
    ]);
  });
});

describe('the hook in flowPublishReport (C238.2; V06)', () => {
  it('joins the report and reads the publish’s given acknowledgements', async () => {
    const templateId = await createTemplate(api);
    const stored = await getInquiryTemplate(api.database.db, api.environmentId, templateId);
    if (stored === null) throw new Error('no template');
    const version = {
      ...stored.latestVersion,
      flow: chain([destinationStep(), governmentId, done]),
      settings: {
        'retention-days': 365,
        'accept-cloned-results': { 'verification-types': ['government-id'], 'max-age-days': 30 },
      },
      copy: ALL_COPY,
    } as unknown as InquiryTemplateVersion;
    const input = {
      environment: { id: api.environmentId, kind: 'sandbox' as const },
      templateId,
      version,
      connectEnabled: true,
    };
    const draft = await flowPublishReport(api.database.db, input);
    expect(draft.problems.map(({ code }) => code)).toContain('cloned_results_without_binding');
    const published = await flowPublishReport(api.database.db, {
      ...input,
      givenAcknowledgements: ['cloned-results-unbound:government-id'],
    });
    expect(published.problems.map(({ code }) => code)).not.toContain(
      'cloned_results_without_binding',
    );
    expect(published.acknowledgements.map(({ key }) => key)).toContain(
      'cloned-results-unbound:government-id',
    );
  });
});
