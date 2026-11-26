import { CHECK_REGISTRY } from '@openverify/core';
import { parseFlow } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  INQUIRY_TEMPLATE_STATUSES,
  SUPPORTED_FLOW_STEP_TYPES,
  buildInquiryTemplateResource,
  createInquiryTemplateAttributesSchema,
  createInquiryTemplateBodySchema,
  DEFAULT_SELFIE_CHECKS,
  defaultInquiryTemplateAttributes,
  inquiryTemplateDocumentSchema,
  inquiryTemplateListDocumentSchema,
  inquiryTemplateResourceSchema,
  listInquiryTemplatesQuerySchema,
  updateInquiryTemplateBodySchema,
  verificationConfigSchema,
} from './inquiry-templates.js';
import { TEMPLATE_SETTINGS_DEFAULTS } from './template-settings.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, issuesOf } from './test-support.js';

type Json = Record<string, unknown>;
type Template = Json & {
  flow: Json & { steps: Json[]; transitions: Json[] };
  'verification-config': Json;
};

function template(mutate: (value: Template) => void = () => undefined): Template {
  const value = defaultInquiryTemplateAttributes() as unknown as Template;
  mutate(value);
  return value;
}

function issues(value: unknown): string[] {
  const result = createInquiryTemplateAttributesSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('verificationConfigSchema (C2)', () => {
  const config = () => structuredClone(defaultInquiryTemplateAttributes()['verification-config']);

  it('maps API verification types to per-check switches', () => {
    expect(verificationConfigSchema.parse(config())).toEqual(config());
  });

  it('rejects domain (snake_case) or unsupported verification type keys', () => {
    const { 'government-id': governmentId } = config();
    expect(verificationConfigSchema.safeParse({ government_id: governmentId }).success).toBe(false);
    // C50.1: `business` was split into database-business and business-website.
    expect(verificationConfigSchema.safeParse({ business: governmentId }).success).toBe(false);
  });

  it('rejects checks missing from the registry', () => {
    const value = config();
    value.selfie = {
      checks: { ...value.selfie?.checks, selfie_mind_reading: { enabled: true, required: true } },
    };
    const result = verificationConfigSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['selfie', 'checks', 'selfie_mind_reading']);
  });

  it('rejects checks of another verification type', () => {
    const value = config();
    value.selfie = {
      checks: { ...value.selfie?.checks, id_blur_detection: { enabled: true, required: true } },
    };
    const result = verificationConfigSchema.safeParse(value);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'check "id_blur_detection" belongs to government_id verifications',
    ]);
  });

  it('accepts the optional id_selfie_comparison mirror on the government ID', () => {
    const value = config();
    value['government-id'] = {
      checks: {
        ...value['government-id']?.checks,
        id_selfie_comparison: { enabled: true, required: false },
      },
    };
    expect(verificationConfigSchema.safeParse(value).success).toBe(true);
  });

  it('needs at least one enabled, required check per configured type, so nothing passes by default', () => {
    const value = config();
    value.selfie = {
      checks: {
        selfie_image_quality_detection: { enabled: true, required: false },
        selfie_id_comparison: { enabled: false, required: true },
      },
    };
    const result = verificationConfigSchema.safeParse(value);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['selfie.checks']);
  });
});

describe('createInquiryTemplateAttributesSchema (C2)', () => {
  it('accepts the default template', () => {
    expect(issues(template())).toEqual([]);
  });

  it('needs a non-empty name', () => {
    expect(issues(template((value) => (value.name = '')))).toHaveLength(1);
  });

  it('applies the flow-spec rules', () => {
    const result = issues(
      template((value) => value.flow.transitions.push({ from: 'selfie', to: 'nowhere' })),
    );
    expect(result).toEqual(['flow.transitions.2.to: unknown step id "nowhere"']);
  });

  it('needs a configuration for every verification step in the flow', () => {
    const result = issues(
      template((value) => {
        delete value['verification-config'].selfie;
      }),
    );
    expect(result).toEqual([
      'verification-config: missing configuration for "selfie" (step "selfie")',
    ]);
  });

  it('needs a flow step for every configured verification type', () => {
    const result = issues(
      template((value) => {
        value.flow.steps = value.flow.steps.filter((step) => step.type !== 'selfie');
        value.flow.transitions = value.flow.transitions.filter(
          (transition) => transition.from !== 'selfie',
        );
      }),
    );
    expect(result).toEqual([
      'verification-config.selfie: no step in the flow creates this verification',
    ]);
  });

  it('rejects the form step, the only step type clients cannot run (C50.4)', () => {
    expect(SUPPORTED_FLOW_STEP_TYPES).toEqual([
      'consent',
      'government_id',
      'selfie',
      'document',
      'phone_otp',
      'email_otp',
      'database',
      'aamva',
      'nfc',
      'crypto_wallet',
      'database_business',
      'business_website',
      // C96.1 (Phase 7).
      'device_handoff',
      'completion',
      'failure',
    ]);
    const result = issues(
      template((value) => {
        value.flow.steps.splice(1, 0, {
          id: 'details',
          type: 'form',
          fields: [{ type: 'text', name: 'nickname', labelKey: 'form.nickname', required: false }],
        });
      }),
    );
    expect(result).toEqual(['flow.steps.1.type: step type "form" is not supported yet']);
  });

  it('allows one step per verification type', () => {
    const result = issues(
      template((value) => {
        value.flow.steps.splice(2, 0, { ...value.flow.steps[1], id: 'second_id' });
      }),
    );
    expect(result).toEqual(['flow.steps.2.type: only one "government_id" step is supported']);
  });

  it('needs at least one verification step', () => {
    const result = issues({
      name: 'Consent only',
      flow: {
        metadata: { specVersion: 1, id: 'consent-only', version: 1, name: 'Consent only' },
        steps: [
          { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
          { id: 'done', type: 'completion' },
        ],
        transitions: [],
      },
      'verification-config': {},
    });
    expect(result).toEqual(['flow.steps: the flow needs a verification step']);
  });

  it('is sent as a JSON:API request document', () => {
    const body = { data: { type: 'inquiry-template', attributes: template() } };
    expect(createInquiryTemplateBodySchema.safeParse(body).success).toBe(true);
    expect(createInquiryTemplateBodySchema.safeParse(template()).success).toBe(false);
  });
});

/** Phase 12A C7: the default template's option on `id_extracted_properties_detection`. */
const REVIEW_MISSING_FIELDS = { 'missing-fields-outcome': 'review' };

describe('defaultInquiryTemplateAttributes (C7)', () => {
  it('passes parseFlow', () => {
    expect(() => parseFlow(defaultInquiryTemplateAttributes().flow)).not.toThrow();
  });

  it('runs consent, a two-sided government ID, a center selfie and completion', () => {
    const { flow } = defaultInquiryTemplateAttributes();
    expect(flow.steps.map((step) => step.type)).toEqual([
      'consent',
      'government_id',
      'selfie',
      'completion',
      'failure',
    ]);
    expect(flow.steps[0]).toMatchObject({
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      required: true,
    });
    expect(flow.steps[1]).toMatchObject({ sides: 'both', captureMethods: ['upload', 'camera'] });
    // C45.1: three poses with active liveness (default-template-selfie.test.ts has the rest).
    expect(flow.steps[2]).toMatchObject({ poses: ['center', 'left', 'right'], liveness: 'active' });
  });

  it('routes a failed inquiry to the failure step', () => {
    // The default template is flow-spec 1 (Workflow 9A: `DefaultInquiryTemplateAttributes`).
    const flow = defaultInquiryTemplateAttributes().flow;
    const condition = { '==': [{ var: 'inquiry.status' }, 'failed'] };
    expect(flow.transitions).toEqual([
      { from: 'government_id', to: 'failure', condition },
      { from: 'selfie', to: 'failure', condition },
    ]);
  });

  it('enables the C36 government ID checks: required, advisory or disabled, by group', () => {
    const config = defaultInquiryTemplateAttributes()['verification-config'];
    expect(Object.keys(config)).toEqual(['government-id', 'selfie']);
    const required = [
      // Image and capture.
      'id_unprocessable_submission_detection',
      'id_blur_detection',
      'id_glare_detection',
      'id_double_side_detection',
      'id_portrait_detection',
      'id_portrait_clarity_detection',
      // MRZ.
      'id_mrz_detection',
      'id_mrz_inconsistency_detection',
      // Extraction and logic.
      'id_extracted_properties_detection',
      'id_extraction_inconsistency_detection',
      'id_number_format_inconsistency_detection',
      'id_expired_detection',
      'id_valid_dates_detection',
      'id_disallowed_country_detection',
      'id_disallowed_type_detection',
      'id_compromised_detection',
    ];
    const advisory = [
      // Barcode.
      'id_barcode_detection',
      'id_barcode_inconsistency_detection',
      'id_real_id_detection',
      // Comparisons and repeats.
      'id_inquiry_comparison',
      'id_account_comparison',
      'id_selfie_comparison',
      'id_repeat_detection',
      'id_inconsistent_repeat_detection',
      'id_age_comparison',
      'id_po_box_detection',
      // H-tier (beta).
      'id_color_inconsistency_detection',
      'id_electronic_replica_detection',
      'id_tamper_detection',
      'id_fabrication_detection',
      'id_handwriting_detection',
      'id_entity_detection',
    ];
    const disabled = [
      // A-tier: no provider is bound by default (C35).
      'id_aamva_database_lookup',
      'id_public_figure_detection',
      'id_age_inconsistency_detection',
    ];
    expect(config['government-id']?.checks).toEqual(
      Object.fromEntries([
        ...required.map((id) => [
          id,
          id === 'id_extracted_properties_detection'
            ? { enabled: true, required: true, config: REVIEW_MISSING_FIELDS }
            : { enabled: true, required: true },
        ]),
        ...advisory.map((id) => [id, { enabled: true, required: false }]),
        ...disabled.map((id) => [id, { enabled: false, required: false }]),
      ]),
    );
    expect(config.selfie?.checks).toEqual(
      // C45.1: every selfie check, required, advisory or disabled.
      Object.fromEntries([
        ...DEFAULT_SELFIE_CHECKS.required.map((id) => [id, { enabled: true, required: true }]),
        ...DEFAULT_SELFIE_CHECKS.advisory.map((id) => [id, { enabled: true, required: false }]),
        ...DEFAULT_SELFIE_CHECKS.disabled.map((id) => [id, { enabled: false, required: false }]),
      ]),
    );
  });

  it('lists every government ID check of the registry but the NFC chip check (C36)', () => {
    const listed = Object.keys(
      defaultInquiryTemplateAttributes()['verification-config']['government-id']?.checks ?? {},
    );
    const registered = CHECK_REGISTRY.filter(
      (definition) => definition.verificationType === 'government_id',
    ).map((definition) => definition.id);
    expect([...listed].sort()).toEqual([...registered].sort());
  });

  it('sends missing required fields to review instead of failing the inquiry (Phase 12A C7)', () => {
    const checks =
      defaultInquiryTemplateAttributes()['verification-config']['government-id']?.checks ?? {};
    expect(checks.id_extracted_properties_detection).toEqual({
      enabled: true,
      required: true,
      config: { 'missing-fields-outcome': 'review' },
    });
  });

  it('returns an independent copy each time', () => {
    const first = defaultInquiryTemplateAttributes();
    first.name = 'changed';
    expect(defaultInquiryTemplateAttributes().name).not.toBe('changed');
  });
});

describe('inquiry template resource', () => {
  const {
    name,
    flow,
    'verification-config': verificationConfig,
  } = defaultInquiryTemplateAttributes();
  const resource = {
    type: 'inquiry-template',
    id: IDS.template,
    attributes: {
      name,
      'current-version': {
        id: IDS.templateVersion,
        'version-number': 1,
        flow,
        'verification-config': verificationConfig,
        'created-at': AT_ISO,
      },
      'created-at': AT_ISO,
      'updated-at': LATER_ISO,
    },
  };

  it('embeds its current version', () => {
    expect(inquiryTemplateResourceSchema.parse(resource)).toEqual(resource);
    expect(inquiryTemplateDocumentSchema.safeParse({ data: resource }).success).toBe(true);
    expect(
      inquiryTemplateListDocumentSchema.safeParse({ data: [resource], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it('rejects a version whose flow and configuration disagree', () => {
    const broken = structuredClone(resource);
    delete (broken.attributes['current-version']['verification-config'] as Json).selfie;
    expect(inquiryTemplateResourceSchema.safeParse(broken).success).toBe(false);
  });

  it('is built from a template record', () => {
    expect(
      buildInquiryTemplateResource({
        id: IDS.template,
        name,
        createdAt: AT,
        updatedAt: LATER,
        currentVersion: {
          id: IDS.templateVersion,
          versionNumber: 1,
          flow,
          verificationConfig,
          createdAt: AT,
        },
      }),
    ).toEqual(resource);
  });

  it('paginates by template id', () => {
    expect(
      listInquiryTemplatesQuerySchema.parse({ 'page[after]': IDS.template, 'page[size]': '10' }),
    ).toEqual({
      'page[after]': IDS.template,
      'page[size]': 10,
    });
    expect(listInquiryTemplatesQuerySchema.safeParse({ 'page[after]': IDS.inquiry }).success).toBe(
      false,
    );
    expect(listInquiryTemplatesQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});

describe('verificationConfigSchema v2 (C11)', () => {
  const config = () => structuredClone(defaultInquiryTemplateAttributes()['verification-config']);

  it('accepts per-check thresholds validated through the check registry', () => {
    const value = config();
    value['government-id'] = {
      checks: {
        ...value['government-id']?.checks,
        id_blur_detection: { enabled: true, required: true, config: { 'min-blur-score': 120 } },
      },
    };
    value.selfie = {
      checks: {
        ...value.selfie?.checks,
        selfie_id_comparison: { enabled: true, required: true, config: { threshold: 0.4 } },
      },
    };
    expect(verificationConfigSchema.parse(value)).toEqual(value);
  });

  it('rejects an out-of-range threshold and config on a check that takes none', () => {
    const value = config();
    value.selfie = {
      checks: {
        ...value.selfie?.checks,
        selfie_id_comparison: { enabled: true, required: true, config: { threshold: 0.9 } },
        // C39.3 gave selfie_multiple_faces_detection a config; the public figure match has none.
        selfie_public_figure_detection: { enabled: true, required: true, config: {} },
      },
    };
    expect(issuesOf(verificationConfigSchema.safeParse(value))).toEqual([
      expect.stringMatching(/^selfie\.checks\.selfie_id_comparison\.config\.threshold: /),
      'selfie.checks.selfie_public_figure_detection.config: check "selfie_public_figure_detection" takes no config',
    ]);
  });

  it('accepts allowed countries and ID classes on the government ID', () => {
    const value = config();
    value['government-id'] = {
      checks: value['government-id']?.checks ?? {},
      'allowed-countries': ['US', 'CA'],
      'allowed-id-classes': ['drivers_license', 'passport'],
    };
    expect(verificationConfigSchema.parse(value)).toEqual(value);
  });

  it('rejects allowed countries and ID classes on a selfie', () => {
    const value = config();
    value.selfie = {
      checks: value.selfie?.checks ?? {},
      'allowed-countries': ['US'],
      'allowed-id-classes': ['passport'],
    };
    expect(issuesOf(verificationConfigSchema.safeParse(value))).toEqual([
      'selfie.allowed-countries: only government-id and database-business verifications restrict countries',
      'selfie.allowed-id-classes: only government-id verifications restrict ID classes',
    ]);
  });
});

describe('inquiry template status and settings (C11)', () => {
  const {
    name,
    flow,
    'verification-config': verificationConfig,
  } = defaultInquiryTemplateAttributes();
  const record = {
    id: IDS.template,
    name,
    createdAt: AT,
    updatedAt: LATER,
    currentVersion: {
      id: IDS.templateVersion,
      versionNumber: 1,
      flow,
      verificationConfig,
      createdAt: AT,
    },
  };

  it('are active or archived', () => {
    expect(INQUIRY_TEMPLATE_STATUSES).toEqual(['active', 'archived']);
  });

  it('builds the status and the resolved version settings when the record has them', () => {
    const resource = buildInquiryTemplateResource({
      ...record,
      status: 'archived',
      currentVersion: { ...record.currentVersion, settings: { 'retention-days': 30 } },
    });
    expect(resource.attributes.status).toBe('archived');
    expect(resource.attributes['current-version'].settings).toEqual({
      ...TEMPLATE_SETTINGS_DEFAULTS,
      'retention-days': 30,
    });
    expect(inquiryTemplateResourceSchema.parse(resource)).toEqual(resource);
  });

  it('leaves them out for a Phase 1 record', () => {
    const resource = buildInquiryTemplateResource(record);
    expect(resource.attributes).not.toHaveProperty('status');
    expect(resource.attributes['current-version']).not.toHaveProperty('settings');
  });

  it('may be set when the template is created', () => {
    const attributes = { ...defaultInquiryTemplateAttributes(), settings: { 'retention-days': 7 } };
    expect(createInquiryTemplateAttributesSchema.parse(attributes)).toEqual(attributes);
    expect(
      createInquiryTemplateAttributesSchema.safeParse({
        ...attributes,
        settings: { 'retention-days': 0 },
      }).success,
    ).toBe(false);
  });

  it('PATCH changes the name or the status', () => {
    expect(
      updateInquiryTemplateBodySchema.parse({ data: { attributes: { status: 'archived' } } }),
    ).toEqual({ data: { attributes: { status: 'archived' } } });
    expect(
      updateInquiryTemplateBodySchema.safeParse({ data: { attributes: { name: 'Renamed' } } })
        .success,
    ).toBe(true);
    expect(updateInquiryTemplateBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(
      false,
    );
    expect(
      updateInquiryTemplateBodySchema.safeParse({ data: { attributes: { status: 'deleted' } } })
        .success,
    ).toBe(false);
    expect(
      updateInquiryTemplateBodySchema.safeParse({ data: { attributes: { flow } } }).success,
    ).toBe(false);
  });
});
