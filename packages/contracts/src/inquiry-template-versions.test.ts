import { describe, expect, it } from 'vitest';
import {
  INQUIRY_TEMPLATE_VERSION_STATUSES,
  buildInquiryTemplateVersionResource,
  createInquiryTemplateVersionBodySchema,
  inquiryTemplateVersionContentSchema,
  inquiryTemplateVersionDocumentSchema,
  inquiryTemplateVersionListDocumentSchema,
  inquiryTemplateVersionResourceSchema,
  listInquiryTemplateVersionsQuerySchema,
  publishInquiryTemplateVersionBodySchema,
  updateInquiryTemplateVersionBodySchema,
} from './inquiry-template-versions.js';
import { defaultInquiryTemplateAttributes } from './inquiry-templates.js';
import { TEMPLATE_SETTINGS_DEFAULTS } from './template-settings.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, issuesOf } from './test-support.js';

const { flow, 'verification-config': verificationConfig } = defaultInquiryTemplateAttributes();

const version = {
  type: 'inquiry-template-version',
  id: IDS.templateVersion2,
  attributes: {
    'version-number': 2,
    status: 'published',
    flow,
    'verification-config': verificationConfig,
    settings: { ...TEMPLATE_SETTINGS_DEFAULTS, 'inquiry-expiration-seconds': 3600 },
    // C84.1 (Phase 6): the report list, with its defaults.
    'report-config': { 'on-completion': [], 'on-report-match': 'none' },
    'created-at': AT_ISO,
    'published-at': LATER_ISO,
  },
  relationships: {
    'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
  },
};

const record = {
  id: IDS.templateVersion2,
  inquiryTemplateId: IDS.template,
  versionNumber: 2,
  status: 'published' as const,
  flow,
  verificationConfig,
  settings: { 'inquiry-expiration-seconds': 3600 },
  createdAt: AT,
  publishedAt: LATER,
};

describe('inquiry-template-version resource (C11)', () => {
  it('has a draft, published or superseded status', () => {
    expect(INQUIRY_TEMPLATE_VERSION_STATUSES).toEqual(['draft', 'published', 'superseded']);
  });

  it('carries the flow, config, resolved settings and its template', () => {
    expect(inquiryTemplateVersionResourceSchema.parse(version)).toEqual(version);
    expect(inquiryTemplateVersionDocumentSchema.safeParse({ data: version }).success).toBe(true);
    expect(
      inquiryTemplateVersionListDocumentSchema.safeParse({ data: [version], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it('is built from a version record, applying the default settings', () => {
    expect(buildInquiryTemplateVersionResource(record)).toEqual(version);
  });

  it('has a publication time exactly when it was published', () => {
    const draft = buildInquiryTemplateVersionResource({
      ...record,
      status: 'draft',
      publishedAt: null,
    });
    expect(draft.attributes['published-at']).toBeNull();
    expect(() => buildInquiryTemplateVersionResource({ ...record, publishedAt: null })).toThrow();
    expect(() => buildInquiryTemplateVersionResource({ ...record, status: 'draft' })).toThrow();
  });

  it('rejects a flow and config that disagree', () => {
    const broken = structuredClone(version);
    delete (broken.attributes['verification-config'] as Record<string, unknown>).selfie;
    expect(inquiryTemplateVersionResourceSchema.safeParse(broken).success).toBe(false);
  });
});

describe('inquiry-template-version requests (C11)', () => {
  it('create a draft for a template with the Phase 1 template validation', () => {
    const body = {
      data: {
        type: 'inquiry-template-version',
        attributes: {
          'inquiry-template-id': IDS.template,
          flow,
          'verification-config': verificationConfig,
          settings: { 'session-expiration-seconds': 900 },
        },
      },
    };
    expect(createInquiryTemplateVersionBodySchema.parse(body)).toEqual(body);
    const withoutSelfieConfig = structuredClone(body);
    delete (withoutSelfieConfig.data.attributes['verification-config'] as Record<string, unknown>)
      .selfie;
    expect(issuesOf(createInquiryTemplateVersionBodySchema.safeParse(withoutSelfieConfig))).toEqual(
      ['data.attributes.verification-config: missing configuration for "selfie" (step "selfie")'],
    );
    expect(
      createInquiryTemplateVersionBodySchema.safeParse({
        data: { attributes: { flow, 'verification-config': verificationConfig } },
      }).success,
    ).toBe(false);
  });

  it('patch a draft partially, checking flow and config together when both are sent', () => {
    expect(
      updateInquiryTemplateVersionBodySchema.parse({
        data: { attributes: { settings: { 'retention-days': 90 } } },
      }),
    ).toEqual({ data: { attributes: { settings: { 'retention-days': 90 } } } });
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse({ data: { attributes: { flow } } }).success,
    ).toBe(true);
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse({
        data: {
          attributes: { flow, 'verification-config': { selfie: verificationConfig.selfie } },
        },
      }).success,
    ).toBe(false);
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse({ data: { attributes: {} } }).success,
    ).toBe(false);
  });

  it('validate merged content with the same rules', () => {
    expect(
      inquiryTemplateVersionContentSchema.safeParse({
        flow,
        'verification-config': verificationConfig,
        settings: {},
      }).success,
    ).toBe(true);
  });

  it('publish without parameters', () => {
    expect(publishInquiryTemplateVersionBodySchema.parse(undefined)).toBeUndefined();
    expect(
      publishInquiryTemplateVersionBodySchema.safeParse({ meta: { force: true } }).success,
    ).toBe(false);
  });

  it('list versions by template and status', () => {
    expect(
      listInquiryTemplateVersionsQuerySchema.parse({
        'filter[inquiry-template-id]': IDS.template,
        'filter[status]': 'draft,published',
        'page[after]': IDS.templateVersion,
      }),
    ).toEqual({
      'filter[inquiry-template-id]': IDS.template,
      'filter[status]': 'draft,published',
      'page[after]': IDS.templateVersion,
    });
    expect(
      listInquiryTemplateVersionsQuerySchema.safeParse({ 'filter[status]': 'active' }).success,
    ).toBe(false);
  });
});

const DEFAULT_TEMPLATE_FOR_LIST_CONFIG = defaultInquiryTemplateAttributes();

describe('list-config on a version (C99.5)', () => {
  const version = {
    id: 'itmplv_01M5CK3190XEVBM5ZXA76E1JSN',
    inquiryTemplateId: 'itmpl_01M5CK3190XEVBM5ZXA76E1JSN',
    versionNumber: 1,
    status: 'draft',
    flow: DEFAULT_TEMPLATE_FOR_LIST_CONFIG.flow,
    verificationConfig: DEFAULT_TEMPLATE_FOR_LIST_CONFIG['verification-config'],
    settings: {},
    createdAt: new Date('2026-10-31T12:00:00.000Z'),
    publishedAt: null,
  } as const;
  const attributes = (extra: object) =>
    buildInquiryTemplateVersionResource({ ...version, ...extra }).attributes;

  it('serves the resolved configuration when the record carries one', () => {
    expect(attributes({ listConfig: { screen: 'none' } })['list-config']).toEqual({
      screen: 'none',
      'on-list-match': 'none',
    });
  });

  it('leaves the member out for a record without one', () => {
    expect(attributes({})).not.toHaveProperty('list-config');
  });
});
