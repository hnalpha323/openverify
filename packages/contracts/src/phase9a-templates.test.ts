/**
 * Workflow 9A Stage 1a, (T): the template and version amendments (C149, C154.1-C154.3, C151.10),
 * the route schemas of C154.4 and C156, the translations (C162.7), deployments (C154.7), presets
 * (C156.4), the events of C154.8, and the inquiry's flow outcome and step names (C151.8, C151.13).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildDeploymentResource,
  deploymentDocumentSchema,
  deploymentListDocumentSchema,
  listDeploymentsQuerySchema,
} from './deployments.js';
import { EVENT_NAMES, eventSubject } from './event-names.js';
import { eventDocumentSchema } from './events.js';
import {
  MAX_INQUIRY_FIELDS,
  createInquiryBodySchema,
  inquiryDocumentSchema,
  inquiryFieldsSchema,
} from './inquiries.js';
import {
  importTranslationsBodySchema,
  inquiryTemplateTranslationsDocumentSchema,
} from './inquiry-template-translations.js';
import {
  inquiryTemplateVersionDocumentSchema,
  publishInquiryTemplateVersionBodySchema,
  updateInquiryTemplateVersionBodySchema,
} from './inquiry-template-versions.js';
import { RESOURCE_TYPES } from './resource-types.js';
import {
  PII_SIMULATION_PRESET_ATTRIBUTES,
  simulationPresetListDocumentSchema,
} from './simulation-presets.js';
import {
  MAX_TEMPLATE_FIELDS,
  fieldSchemasSchema,
  ifMatchHeadersSchema,
  templateCopySchema,
  templateVersionEtag,
} from './template-fields.js';
import {
  copyInquiryTemplateBodySchema,
  previewInquiryTemplateVersionBodySchema,
  promoteInquiryTemplateBodySchema,
  restoreInquiryTemplateBodySchema,
  simulateInquiryTemplateVersionBodySchema,
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
  templateUsageDocumentSchema,
  templateVersionDiffDocumentSchema,
  templateVersionValidationDocumentSchema,
} from './template-routes.js';
import { TEMPLATE_SETTINGS_DEFAULTS, resolveTemplateSettings } from './template-settings.js';
import { readFixture } from './test-support.js';

type Json = Record<string, unknown>;
const golden = (file: string): Json => structuredClone(readFixture(`api/${file}`)) as Json;
const versionAttributes = (doc: Json) => (doc.data as Json).attributes as Json;

describe('the inquiry (C149.2, C151.8, C151.10, C151.13)', () => {
  it('takes up to 1,000 fields, the public cap (a C10 amendment)', () => {
    expect(MAX_INQUIRY_FIELDS).toBe(1000);
    const fields = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${String(index)}`, 'x']));
    expect(inquiryFieldsSchema.safeParse(fields(1000)).success).toBe(true);
    expect(inquiryFieldsSchema.safeParse(fields(1001)).success).toBe(false);
  });

  it('says the step left and the step on, and how the flow ended, with no value in it', () => {
    const doc = golden('inquiry-flow-outcome.json');
    expect(inquiryDocumentSchema.parse(doc)).toEqual(doc);
    expect((doc.data as Json).attributes).toMatchObject({
      'previous-step-name': 'extra_details',
      'next-step-name': null,
      'flow-outcome': {
        'verification-types-on-path': ['government-id'],
        'fallbacks-taken': [],
        flags: [],
      },
    });
  });

  it('takes the public expiry windows in the create body meta, within the C11 bounds', () => {
    const body = (meta: Json) => ({
      data: { attributes: { 'inquiry-template-id': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6' } },
      meta,
    });
    expect(
      createInquiryBodySchema.safeParse(body({ 'expiration-after-start-interval-seconds': 3600 }))
        .success,
    ).toBe(true);
    expect(
      createInquiryBodySchema.safeParse(body({ 'expiration-after-resume-interval-seconds': 60 }))
        .success,
    ).toBe(false);
    expect(
      createInquiryBodySchema.safeParse(
        body({ 'expiration-after-create-interval-seconds': 86_400 }),
      ).success,
    ).toBe(true);
  });

  it('resolves the start and resume windows: none at start, a day at resume (C151.10)', () => {
    expect(resolveTemplateSettings({})).toMatchObject({
      'inquiry-expiration-after-start-seconds': null,
      'inquiry-expiration-after-resume-seconds': 86_400,
    });
    expect(TEMPLATE_SETTINGS_DEFAULTS).toMatchObject({
      'inquiry-expiration-after-resume-seconds': 86_400,
    });
  });
});

describe('the template version (C149, C154.1-C154.3)', () => {
  it('holds a flow-spec 2 draft with every new member, saved with its problems', () => {
    const doc = golden('inquiry-template-version-v2.json');
    expect(inquiryTemplateVersionDocumentSchema.parse(doc)).toEqual(doc);
    expect(versionAttributes(doc)).toMatchObject({
      status: 'draft',
      validation: { status: 'invalid' },
      'enabled-locales': ['en', 'es'],
      'last-updater': { type: 'user' },
    });
  });

  it('still reads a version served before Workflow 9A', () => {
    const doc = golden('inquiry-template-version.json');
    expect(inquiryTemplateVersionDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('types its fields: a choices field lists its choices, and no key repeats (C149.1)', () => {
    expect(MAX_TEMPLATE_FIELDS).toBe(1000);
    const field = (over: Json) => ({
      key: 'purpose',
      type: 'string',
      label: 'Purpose',
      pii: false,
      ...over,
    });
    expect(fieldSchemasSchema.safeParse([field({ type: 'choices' })]).success).toBe(false);
    expect(
      fieldSchemasSchema.safeParse([
        field({ type: 'choices', choices: [{ value: 'a', label: 'A' }] }),
      ]).success,
    ).toBe(true);
    expect(fieldSchemasSchema.safeParse([field({}), field({})]).success).toBe(false);
    expect(fieldSchemasSchema.safeParse([field({ type: 'file' })]).success).toBe(false);
  });

  it('takes copy for the five built-in base locales only (C161.2, C162.1)', () => {
    expect(
      templateCopySchema.safeParse({ messages: { ar: { 'flow.completion': 'شكرا' } } }).success,
    ).toBe(true);
    expect(
      templateCopySchema.safeParse({ messages: { 'ar-EG': { 'flow.completion': 'x' } } }).success,
    ).toBe(false);
    expect(
      templateCopySchema.safeParse({ messages: { pt: { 'flow.completion': 'x' } } }).success,
    ).toBe(false);
  });

  it('saves a draft with problems only when asked (meta.allow-invalid, C154.2)', () => {
    const flow = (golden('inquiry-template-version-v2.json').data as Json).attributes as Json;
    const body = { data: { attributes: { flow: flow.flow } }, meta: { 'allow-invalid': true } };
    expect(updateInquiryTemplateVersionBodySchema.safeParse(body).success).toBe(true);
  });

  it('publishes with acknowledgements of the kinds C154.9 names, and a note of 255 at most', () => {
    const publish = (meta: Json) => publishInquiryTemplateVersionBodySchema.safeParse({ meta });
    expect(
      publish({ acknowledgements: ['adverse-path:failed_minor', 'locale-unreviewed:ar'] }).success,
    ).toBe(true);
    expect(publish({ acknowledgements: ['irreversible:failed_minor'] }).success).toBe(false);
    expect(publish({ 'publish-note': 'x'.repeat(256) }).success).toBe(false);
  });

  it('answers a strong ETag and honours If-Match (C154.3, RFC 9110)', () => {
    expect(templateVersionEtag('a'.repeat(64))).toBe(`"${'a'.repeat(64)}"`);
    expect(() => templateVersionEtag('W/"x"')).toThrow();
    expect(ifMatchHeadersSchema.safeParse({ 'if-match': `"${'b'.repeat(64)}"` }).success).toBe(
      true,
    );
    expect(ifMatchHeadersSchema.safeParse({ 'if-match': 'W/"weak"' }).success).toBe(false);
  });

  it('refuses a redirect scheme on the denylist and a redirect URI with userinfo (C158.4)', () => {
    const attributes = (over: Json) => ({ data: { attributes: over } });
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse(
        attributes({ 'redirect-uri-schemes': ['myapp'] }),
      ).success,
    ).toBe(true);
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse(
        attributes({ 'redirect-uri-schemes': ['javascript'] }),
      ).success,
    ).toBe(false);
    expect(
      updateInquiryTemplateVersionBodySchema.safeParse(
        attributes({ 'redirect-uri': 'https://user:pw@example.com/done' }),
      ).success,
    ).toBe(false);
  });
});

describe('the routes of C154.4 and C156', () => {
  it.each([
    ['template-version-validation.json', templateVersionValidationDocumentSchema],
    ['template-version-diff.json', templateVersionDiffDocumentSchema],
    ['template-preview.json', templatePreviewDocumentSchema],
    ['template-simulation.json', templateSimulationDocumentSchema],
    ['inquiry-template-usage.json', templateUsageDocumentSchema],
    ['inquiry-template-translations.json', inquiryTemplateTranslationsDocumentSchema],
    ['deployment.json', deploymentDocumentSchema],
    ['deployments.json', deploymentListDocumentSchema],
    ['simulation-presets.json', simulationPresetListDocumentSchema],
  ] as const)('parses the golden %s', (file, schema: z.ZodType) => {
    const doc = golden(file);
    expect(schema.parse(doc)).toEqual(doc);
  });

  it('previews in a built-in locale or a pseudo-locale, never another (C156.1, C161.7)', () => {
    const body = (locale: string) =>
      previewInquiryTemplateVersionBodySchema.safeParse({ meta: { locale } });
    expect(body('en-XA').success).toBe(true);
    expect(body('ar').success).toBe(true);
    expect(body('pt').success).toBe(false);
    expect(previewInquiryTemplateVersionBodySchema.safeParse({}).success).toBe(false);
  });

  it('simulates a scope or a preset, never both (C156.4)', () => {
    const simulate = (meta: Json) => simulateInquiryTemplateVersionBodySchema.safeParse({ meta });
    expect(simulate({ scope: { device: { kind: 'mobile-web' } } }).success).toBe(true);
    expect(simulate({ 'preset-id': 'builtin:government-id-passed' }).success).toBe(true);
    expect(simulate({ scope: {}, 'preset-id': 'builtin:government-id-passed' }).success).toBe(
      false,
    );
    expect(simulate({}).success).toBe(false);
  });

  it('restores, copies and promotes by id, never by an arbitrary value (C154.4, C154.5)', () => {
    expect(
      restoreInquiryTemplateBodySchema.safeParse({
        meta: { 'version-id': 'itmplv_01M5A0GTG0VF5QW51511984D0G' },
      }).success,
    ).toBe(true);
    expect(copyInquiryTemplateBodySchema.safeParse({ meta: { name: 'Copy' } }).success).toBe(true);
    expect(
      promoteInquiryTemplateBodySchema.safeParse({
        meta: { 'environment-id': 'env_01M5CJZC30W7PFE0GD30HJWEC5' },
      }).success,
    ).toBe(true);
    expect(promoteInquiryTemplateBodySchema.safeParse({ meta: {} }).success).toBe(false);
  });

  it('imports translations into the draft, at least one row', () => {
    expect(
      importTranslationsBodySchema.safeParse({ data: { attributes: { translations: [] } } })
        .success,
    ).toBe(false);
  });

  it('filters deployments by template and environment, and keeps the public changes-only', () => {
    expect(
      listDeploymentsQuerySchema.safeParse({
        'filter[inquiry-template-id]': 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
        'filter[changes-only]': 'true',
      }).success,
    ).toBe(true);
  });

  it('builds the golden deployment from its record', () => {
    const doc = golden('deployment.json');
    const [route] = ((doc.data as Json).attributes as Json).routes as [Json];
    expect(
      buildDeploymentResource({
        id: (doc.data as Json).id as string,
        templateId: route['template-id'] as string,
        environmentId: route['environment-id'] as string,
        versionId: (route.rules as [Json])[0]['version-id'] as string,
        sourceDeploymentId: route['source-deployment-id'] as string,
        creator: { type: 'user', id: 'usr_01M5CJXHG03PHEQZPRWAH2RXM5' },
        createdAt: new Date('2026-10-20T12:05:00.000Z'),
      }),
    ).toEqual(doc.data);
  });

  it('marks a preset scope as personal data (C174.5, review P12)', () => {
    expect(PII_SIMULATION_PRESET_ATTRIBUTES).toEqual(['scope']);
  });

  it('registers the new resource types', () => {
    for (const type of [
      'deployment',
      'inquiry-template-translations',
      'simulation-preset',
      'inquiry-template-preview',
    ]) {
      expect(RESOURCE_TYPES).toContain(type);
    }
  });
});

describe('the events of C154.8 and inquiry.completed meta (C151.13)', () => {
  it('names a draft created, a version published and a deployment completed', () => {
    const names: readonly string[] = EVENT_NAMES;
    for (const name of [
      'inquiry-template-version.created',
      'inquiry-template-version.published',
      'deployment.completed',
    ]) {
      expect(names).toContain(name);
    }
    expect(eventSubject('deployment.completed')).toBe('deployment');
  });

  it.each([
    'event-inquiry-template-version-created.json',
    'event-inquiry-template-version-published.json',
    'event-deployment-completed.json',
    'event-inquiry-completed.json',
  ])('parses the golden %s', (file) => {
    const doc = golden(file);
    expect(eventDocumentSchema.parse(doc)).toEqual(doc);
  });

  it('carries a version summary, never its flow or copy', () => {
    const doc = golden('event-inquiry-template-version-published.json');
    const payload = (((doc.data as Json).attributes as Json).payload as Json).data as Json;
    (payload.attributes as Json).flow = {};
    expect(eventDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('refuses an inquiry.completed meta that is not a flow outcome', () => {
    const doc = golden('event-inquiry-completed.json');
    const payload = ((doc.data as Json).attributes as Json).payload as Json;
    payload.meta = { 'flow-outcome': { flags: ['Not A Code'] } };
    expect(eventDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
