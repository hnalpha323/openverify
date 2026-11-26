/**
 * Phase 11, Workflow 11A Stage 1a, the (R) checkpoint (C234, C235, C238.10): the redeem body and its
 * pure rules (the mode, the meta conflicts, the pairings), `redeem-summary`, the internal
 * `fill-inquiry` mode, `provenance`, the version setting `accept-cloned-results`, the publish code
 * `cloned_results_without_binding` and the three acknowledgement kinds. Everything is read through
 * the package root, so the export lines are held too.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};
const fn = (name: string): unknown => {
  const found = pick(name);
  if (typeof found !== 'function') {
    throw new TypeError(`${name} is not exported as a function`);
  }
  return found;
};
type Json = Record<string, unknown>;
const CONSENT = 'cnsr_01M5CN0000000000000011A412';

describe('the redeem body (C234.1)', () => {
  it.each([
    'redeem-clone-inquiry.json',
    'redeem-clone-verification.json',
    'redeem-hydrate-account.json',
  ])('reads api/connect/%s', (name) => {
    expect(
      schema('redeemShareTokenBodySchema').safeParse(readFixture(`api/connect/${name}`)).success,
    ).toBe(true);
  });

  it('needs the destination-side consent record (decision 24)', () => {
    expect(schema('redeemShareTokenBodySchema').safeParse({ meta: {} }).success).toBe(false);
    expect(
      schema('redeemShareTokenBodySchema').safeParse({
        meta: { 'destination-consent-record-id': CONSENT },
      }).success,
    ).toBe(true);
  });

  it('never accepts a mode on the route, fill-inquiry least of all (C234.11)', () => {
    for (const body of [
      { meta: { 'destination-consent-record-id': CONSENT, mode: 'fill-inquiry' } },
      {
        data: { attributes: { 'redeem-mode': 'fill-inquiry' } },
        meta: { 'destination-consent-record-id': CONSENT },
      },
    ]) {
      expect(schema('redeemShareTokenBodySchema').safeParse(body).success).toBe(false);
    }
    expect(pick('SHARE_REDEEM_ROUTE_MODES')).toEqual(['clone', 'hydrate']);
    expect(contracts.SHARE_REDEEM_MODES).toEqual(['clone', 'hydrate', 'fill-inquiry']);
  });

  it('takes field mappings with dot notation for a nested destination, at most 600', () => {
    const mapping = { 'source-field-name': 'name_first', 'destination-field-name': 'name.first' };
    const body = (count: number) => ({
      data: { attributes: { 'destination-id': 'acc_01M5CN0000000000000011A630' } },
      meta: {
        'field-mappings': Array.from({ length: count }, () => mapping),
        'destination-consent-record-id': CONSENT,
      },
    });
    expect(schema('redeemShareTokenBodySchema').safeParse(body(600)).success).toBe(true);
    expect(schema('redeemShareTokenBodySchema').safeParse(body(601)).success).toBe(false);
    const bad = body(1);
    bad.meta['field-mappings'] = [{ ...mapping, 'destination-field-name': 'name..first' }];
    expect(schema('redeemShareTokenBodySchema').safeParse(bad).success).toBe(false);
  });

  it('reads the mode from destination-id: clone without it, hydrate with it', () => {
    const modeOf = fn('shareRedeemModeOf') as (body: unknown) => string;
    expect(modeOf(readFixture('api/connect/redeem-clone-inquiry.json'))).toBe('clone');
    expect(modeOf(readFixture('api/connect/redeem-hydrate-account.json'))).toBe('hydrate');
  });

  it('names each meta member that conflicts (422 share_redeem_meta_conflict, the public rule)', () => {
    const conflicts = fn('shareRedeemMetaConflicts') as (body: unknown) => string[];
    const hydrate = readFixture('api/connect/redeem-hydrate-account.json') as { meta: Json };
    expect(conflicts(readFixture('api/connect/redeem-clone-inquiry.json'))).toEqual([]);
    expect(conflicts(hydrate)).toEqual([]);
    expect(
      conflicts({
        ...hydrate,
        meta: { ...hydrate.meta, 'account-id': 'acc_01M5CN0000000000000011A610' },
      }),
    ).toEqual(['/meta/account-id']);
    expect(
      conflicts({
        meta: {
          'account-id': 'acc_01M5CN0000000000000011A610',
          'auto-create-account-reference-id': 'synthetic-ref-1',
          'auto-create-account-type-id': 'acctp_01M5CN0000000000000011A640',
          'destination-consent-record-id': CONSENT,
        },
      }),
    ).toEqual(['/meta/auto-create-account-reference-id', '/meta/auto-create-account-type-id']);
    expect(
      conflicts({
        meta: {
          'auto-create-account-reference-id': 'synthetic-ref-1',
          'destination-consent-record-id': CONSENT,
        },
      }),
    ).toEqual(['/meta/auto-create-account-type-id']);
  });

  it.each([
    ['inquiry', 'clone', null, true],
    ['verification', 'clone', null, true],
    ['account', 'clone', null, false],
    ['transaction', 'clone', null, false],
    ['inquiry', 'hydrate', 'account', true],
    ['account', 'hydrate', 'inquiry', true],
    ['transaction', 'hydrate', 'transaction', true],
    ['verification', 'hydrate', 'account', false],
    ['inquiry', 'hydrate', 'verification', false],
    ['inquiry', 'hydrate', 'report', false],
  ] as const)(
    'pairs a %s source with %s into %s: %s (else 422 share_redeem_mode_invalid)',
    (source, mode, destination, allowed) => {
      const pairs = fn('shareRedeemPairAllowed') as (
        source: string,
        mode: string,
        destination: string | null,
      ) => boolean;
      expect(pairs(source, mode, destination)).toBe(allowed);
    },
  );
});

describe('fill-inquiry, the internal mode (C234.11, C238.4)', () => {
  it('freezes the request api-consent hands api-redeem, never a route body', () => {
    const request = {
      'share-token-id': 'cnst_01M5CN0000000000000011A200',
      'inquiry-id': 'inq_01M5CN0000000000000011A620',
      'destination-consent-record-id': CONSENT,
    };
    expect(schema('fillInquiryRedemptionSchema').parse(request)).toEqual(request);
    expect(
      schema('fillInquiryRedemptionSchema').safeParse({ ...request, mode: 'clone' }).success,
    ).toBe(false);
  });

  it('takes only an inquiry or a verification source', () => {
    const pairs = fn('shareRedeemPairAllowed') as (
      source: string,
      mode: string,
      destination: string | null,
    ) => boolean;
    expect(pairs('inquiry', 'fill-inquiry', 'inquiry')).toBe(true);
    expect(pairs('verification', 'fill-inquiry', 'inquiry')).toBe(true);
    expect(pairs('account', 'fill-inquiry', 'inquiry')).toBe(false);
    expect(pairs('transaction', 'fill-inquiry', 'inquiry')).toBe(false);
  });
});

describe('the answer to a redemption (C234.1, C234.8)', () => {
  it('is 202 with the token pending and its mode', () => {
    const answer = contracts.shareTokenDocumentSchema.parse(
      readFixture('api/connect/share-token-redeem-accepted.json'),
    );
    expect(answer.data.attributes).toMatchObject({
      status: 'pending',
      'redeem-mode': 'clone',
      'redeem-summary': null,
    });
  });

  it('summarises counts and dropped keys, never a value', () => {
    const redeemed = contracts.shareTokenDocumentSchema.parse(
      readFixture('api/connect/share-token-inbound-redeemed.json'),
    );
    const summary = redeemed.data.attributes['redeem-summary'];
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      [
        'checks',
        'dropped-fields',
        'fields',
        'files',
        'peek-count',
        'policy-version',
        'verifications',
      ].sort(),
    );
    expect(
      contracts.redeemSummarySchema.safeParse({ ...summary, 'dropped-fields': ['Alex Synthetic'] })
        .success,
    ).toBe(false);
  });
});

describe('provenance (C235.1, C237.6)', () => {
  const clone = {
    kind: 'connect-clone',
    'share-token-id': 'cnst_01M5CN0000000000000011A200',
    'source-organization-name': 'Example Source',
    'source-environment-kind': 'sandbox',
    'source-created-at': '2026-10-20T11:00:00.000Z',
    'source-status': 'passed',
    'cloned-at': '2026-10-20T12:21:00.000Z',
  };

  it('takes consent-withdrawn-at once the destination-side consent is withdrawn', () => {
    expect(
      contracts.provenanceSchema.safeParse({
        ...clone,
        'consent-withdrawn-at': '2026-10-22T09:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('never discloses a source object id', () => {
    for (const member of ['source-id', 'source-inquiry-id', 'source-verification-id']) {
      expect(
        contracts.provenanceSchema.safeParse({
          ...clone,
          [member]: 'inq_01M5CN0000000000000011A300',
        }).success,
      ).toBe(false);
    }
  });
});

describe('accept-cloned-results, a version setting (C235.3, orchestrator decision 22)', () => {
  it('reads the golden settings and resolves absent as off (null)', () => {
    const settings = readFixture('api/connect/template-settings-accept-cloned-results.json');
    expect(contracts.templateSettingsSchema.parse(settings)).toEqual(settings);
    expect(contracts.resolveTemplateSettings(settings as contracts.TemplateSettings)).toMatchObject(
      settings as Json,
    );
    expect(contracts.resolveTemplateSettings({})).toMatchObject({ 'accept-cloned-results': null });
    expect(contracts.TEMPLATE_SETTINGS_DEFAULTS).toMatchObject({ 'accept-cloned-results': null });
  });

  it.each([
    ['no verification type', { 'verification-types': [], 'max-age-days': 90 }],
    ['a type outside the six', { 'verification-types': ['aamva'], 'max-age-days': 90 }],
    ['a duplicate type', { 'verification-types': ['selfie', 'selfie'], 'max-age-days': 90 }],
    ['an age of 0 days', { 'verification-types': ['database'], 'max-age-days': 0 }],
    ['an age of 3,651 days', { 'verification-types': ['database'], 'max-age-days': 3651 }],
    ['no age', { 'verification-types': ['database'] }],
  ])('refuses %s', (_name, value) => {
    expect(
      contracts.templateSettingsSchema.safeParse({ 'accept-cloned-results': value }).success,
    ).toBe(false);
  });
});

describe('the publish rule and acknowledgements (C235.3, C235.8, C238.10)', () => {
  it('adds the three acknowledgement kinds, each <kind>:<target>', () => {
    expect(contracts.TEMPLATE_ACKNOWLEDGEMENT_KINDS).toEqual(
      expect.arrayContaining([
        'cloned-results',
        'cloned-results-unbound',
        'share-consent-default-text',
      ]),
    );
    for (const key of [
      'cloned-results:government-id',
      'cloned-results-unbound:selfie',
      'share-consent-default-text:share-consent-1',
    ]) {
      expect(contracts.templateAcknowledgementKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it('names cloned_results_without_binding among the Connect publish rules', () => {
    expect(pick('CONNECT_PUBLISH_RULE_CODES')).toEqual(
      expect.arrayContaining(['cloned_results_without_binding']),
    );
  });

  it('holds its golden definition_invalid', () => {
    const raw = readFixture('problems/connect-publish/definition-invalid-cloned-results.json') as {
      errors: { code: string }[];
    };
    expect(contracts.problemSchema.parse(raw)).toEqual(raw);
    expect(raw.errors.map(({ code }) => code)).toEqual(['cloned_results_without_binding']);
  });
});
