/**
 * Inquiry templates (contract C2): a server-driven flow plus a verification config, versioned.
 * Phase 1 templates may use only the steps the hosted flow and Android can run, and every
 * verification step needs a config with at least one enabled, required check, so no
 * verification can pass without being checked.
 */
import {
  reportConfigSchema,
  resolveReportConfig,
  resolvedReportConfigSchema,
  type ReportConfig,
} from './inquiry-report-config.js';
import {
  cryptoChainSchemes,
  defaultTemplateConfig,
  getCheckDefinition,
  phase5ConfigDefaults,
  verificationTemplateConfigSchema,
} from '@openverify/core';
import {
  V2_ONLY_STEP_TYPES,
  flowSchema,
  flowV2Schema,
  type AnyFlow,
  type DatabaseField,
  type Flow,
  type FlowStepType,
} from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  pageSizeSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import {
  resolveTemplateSettings,
  resolvedTemplateSettingsSchema,
  templateSettingsSchema,
  type TemplateSettings,
} from './template-settings.js';
import {
  API_VERIFICATION_TYPES,
  fromApiVerificationType,
  toApiVerificationType,
  verificationTypeForStep,
  type ApiVerificationType,
  type SupportedVerificationType,
} from './verification-types.js';

type TypeOption =
  'allowed-countries' | 'allowed-id-classes' | 'allowed-chains' | 'accept-review-without-provider';

/**
 * C50.4: the types that take each type-level option. `accept-review-without-provider` lets a
 * production template publish a step whose provider is unbound (the API's publish hooks, H28).
 */
const TYPE_OPTIONS: Readonly<
  Record<TypeOption, { types: readonly ApiVerificationType[]; message: string }>
> = {
  'allowed-countries': {
    types: ['government-id', 'database-business'],
    message: 'only government-id and database-business verifications restrict countries',
  },
  'allowed-id-classes': {
    types: ['government-id'],
    message: 'only government-id verifications restrict ID classes',
  },
  'allowed-chains': {
    types: ['crypto-wallet'],
    message: 'only crypto-wallet verifications restrict chains',
  },
  'accept-review-without-provider': {
    types: ['database', 'aamva', 'government-id-nfc'],
    message:
      'only database, aamva and government-id-nfc verifications accept review without a provider',
  },
};

/**
 * Per-type check configuration, keyed by API verification type (`government-id`, `selfie`).
 * The map is complete: a check that is not listed is disabled.
 *
 * Version 2 (C11) adds optional per-check `config` (validated by the check's registry
 * `configSchema`) and, on the government ID, `allowed-countries` and `allowed-id-classes`,
 * which the Phase 3 checks enforce. Version 1 documents stay valid.
 */
export const verificationConfigSchema = z
  .strictObject({
    'government-id': verificationTemplateConfigSchema.optional(),
    selfie: verificationTemplateConfigSchema.optional(),
    // C50.4: a key per Phase 5 API type.
    document: verificationTemplateConfigSchema.optional(),
    database: verificationTemplateConfigSchema.optional(),
    aamva: verificationTemplateConfigSchema.optional(),
    'phone-number': verificationTemplateConfigSchema.optional(),
    'email-address': verificationTemplateConfigSchema.optional(),
    'government-id-nfc': verificationTemplateConfigSchema.optional(),
    'crypto-wallet': verificationTemplateConfigSchema.optional(),
    'database-business': verificationTemplateConfigSchema.optional(),
    'business-website': verificationTemplateConfigSchema.optional(),
  })
  .superRefine((config, ctx) => {
    for (const apiType of API_VERIFICATION_TYPES) {
      const typeConfig = config[apiType];
      if (typeConfig === undefined) {
        continue;
      }
      for (const [option, rule] of Object.entries(TYPE_OPTIONS)) {
        if (typeConfig[option as TypeOption] !== undefined && !rule.types.includes(apiType)) {
          ctx.addIssue({ code: 'custom', message: rule.message, path: [apiType, option] });
        }
      }
      const type = fromApiVerificationType(apiType);
      let enforced = 0;
      for (const [checkId, { enabled, required }] of Object.entries(typeConfig.checks)) {
        const owner = getCheckDefinition(checkId)?.verificationType;
        if (owner === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `unknown check "${checkId}"`,
            path: [apiType, 'checks', checkId],
          });
        } else if (owner !== type) {
          ctx.addIssue({
            code: 'custom',
            message: `check "${checkId}" belongs to ${owner} verifications`,
            path: [apiType, 'checks', checkId],
          });
        }
        if (enabled && required) {
          enforced += 1;
        }
      }
      if (enforced === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'needs at least one enabled, required check',
          path: [apiType, 'checks'],
        });
      }
    }
  });
export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

/**
 * Flow step types a template may use: every step but `form` since Phase 5 (C50.4). A client that
 * cannot run a step shows its unsupported screen, never skips it.
 */
export const SUPPORTED_FLOW_STEP_TYPES = [
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
  // C96.1 (Phase 7): the move to a phone; publish rules in services/publish/handoff.ts.
  'device_handoff',
  'completion',
  'failure',
] as const satisfies readonly FlowStepType[];

/**
 * C147 (Workflow 9A): a version's flow is flow-spec 1 or 2. Stored versions are never rewritten
 * (C147.1): a v1 document stays v1 and parses with today's `flowSchema`; every new draft is v2. The
 * graph, component, field and publish rules of a v2 flow are `checkFlowGraph`'s, run by the API.
 */
export const anyFlowSchema = z.union([flowSchema, flowV2Schema]);

const SUPPORTED_STEPS: ReadonlySet<string> = new Set([
  ...SUPPORTED_FLOW_STEP_TYPES,
  // C147.3 (Workflow 9A): the v2-only types, in a v2 flow (the v1 schema refuses them).
  ...V2_ONLY_STEP_TYPES,
]);

interface FlowWithConfig {
  flow: AnyFlow;
  'verification-config': VerificationConfig;
}

/**
 * The flow and the config must describe the same verifications (one step per type), and the
 * flow may use only the steps clients can run. Shared by templates and template versions.
 */
export function checkFlowMatchesConfig(value: FlowWithConfig, ctx: z.RefinementCtx): void {
  const config = value['verification-config'];
  const stepTypes = new Set<SupportedVerificationType>();
  value.flow.steps.forEach((step, index) => {
    const path = ['flow', 'steps', index, 'type'];
    if (!SUPPORTED_STEPS.has(step.type)) {
      ctx.addIssue({
        code: 'custom',
        message: `step type "${step.type}" is not supported yet`,
        path,
      });
      return;
    }
    const type = verificationTypeForStep(step.type as FlowStepType);
    if (type === null) {
      return;
    }
    if (stepTypes.has(type)) {
      ctx.addIssue({ code: 'custom', message: `only one "${step.type}" step is supported`, path });
      return;
    }
    stepTypes.add(type);
    const apiType = toApiVerificationType(type);
    if (config[apiType] === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `missing configuration for "${apiType}" (step "${step.id}")`,
        path: ['verification-config'],
      });
    }
  });
  for (const apiType of API_VERIFICATION_TYPES) {
    if (config[apiType] !== undefined && !stepTypes.has(fromApiVerificationType(apiType))) {
      ctx.addIssue({
        code: 'custom',
        message: 'no step in the flow creates this verification',
        path: ['verification-config', apiType],
      });
    }
  }
  if (stepTypes.size === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'the flow needs a verification step',
      path: ['flow', 'steps'],
    });
  }
}

/**
 * Rules a flow meets when it is created or published, but that stored versions need not meet, so
 * they still parse (C40.2): a selfie step prompts `center`, the pose every capture starts with.
 */
export function checkFlowPublishable(value: { flow: AnyFlow }, ctx: z.RefinementCtx): void {
  value.flow.steps.forEach((step, index) => {
    if (step.type === 'selfie' && !step.poses.includes('center')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a selfie step must prompt center, the pose every capture starts with',
        path: ['flow', 'steps', index, 'poses'],
      });
    }
  });
}

export const templateNameSchema = z.string().min(1).max(200);

/** `active` templates create inquiries; creating one from an `archived` template answers 422. */
export const INQUIRY_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export const inquiryTemplateStatusSchema = z.enum(INQUIRY_TEMPLATE_STATUSES);
export type InquiryTemplateStatus = z.infer<typeof inquiryTemplateStatusSchema>;

export const createInquiryTemplateAttributesSchema = z
  .strictObject({
    name: templateNameSchema,
    /** C147.1 (Workflow 9A): flow-spec 1 or 2. */
    flow: anyFlowSchema,
    'verification-config': verificationConfigSchema,
    /** Settings of version 1 (C11); the defaults apply to what is left out. */
    settings: templateSettingsSchema.optional(),
    /** C84.1: the reports version 1 runs on completion. */
    'report-config': reportConfigSchema.optional(),
  })
  .superRefine(checkFlowMatchesConfig)
  .superRefine(checkFlowPublishable);
export type CreateInquiryTemplateAttributes = z.infer<typeof createInquiryTemplateAttributesSchema>;

/** `POST /api/v1/inquiry-templates` body: creates the template and its first version. */
export const createInquiryTemplateBodySchema = requestDocumentSchema(
  'inquiry-template',
  createInquiryTemplateAttributesSchema,
);
export type CreateInquiryTemplateBody = z.infer<typeof createInquiryTemplateBodySchema>;

/**
 * The template's current (published) version, embedded in the template; inquiries pin the
 * version they were created with. `settings` (C11) are the resolved values; servers since
 * Phase 2 always send them.
 */
export const inquiryTemplateVersionSchema = z
  .strictObject({
    id: idSchema('itmplv'),
    'version-number': z.int().min(1),
    flow: anyFlowSchema,
    'verification-config': verificationConfigSchema,
    settings: resolvedTemplateSettingsSchema.optional(),
    /** C84.1, resolved; servers since Phase 6 always send it. */
    'report-config': resolvedReportConfigSchema.optional(),
    'created-at': timestampSchema,
  })
  .superRefine(checkFlowMatchesConfig);
export type InquiryTemplateVersion = z.infer<typeof inquiryTemplateVersionSchema>;

export const inquiryTemplateAttributesSchema = z.strictObject({
  name: templateNameSchema,
  /** C11; servers since Phase 2 always send it. */
  status: inquiryTemplateStatusSchema.optional(),
  'current-version': inquiryTemplateVersionSchema,
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const inquiryTemplateResourceSchema = resourceSchema(
  'inquiry-template',
  'itmpl',
  inquiryTemplateAttributesSchema,
);
export type InquiryTemplateResource = z.infer<typeof inquiryTemplateResourceSchema>;

export const inquiryTemplateDocumentSchema = singleDocumentSchema(inquiryTemplateResourceSchema);
export const inquiryTemplateListDocumentSchema = listDocumentSchema(inquiryTemplateResourceSchema);

/** `GET /api/v1/inquiry-templates` query. */
export const listInquiryTemplatesQuerySchema = z.strictObject({
  'page[after]': idSchema('itmpl').optional(),
  'page[size]': pageSizeSchema.optional(),
});

/** `PATCH /api/v1/inquiry-templates/:id` body (C11): the name or the status. */
export const updateInquiryTemplateBodySchema = requestDocumentSchema(
  'inquiry-template',
  z
    .strictObject({
      name: templateNameSchema.optional(),
      status: inquiryTemplateStatusSchema.optional(),
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateInquiryTemplateBody = z.infer<typeof updateInquiryTemplateBodySchema>;

export interface InquiryTemplateRecord {
  id: string;
  name: string;
  /** C11. Left out, the attribute is not sent (Phase 1 records). */
  status?: InquiryTemplateStatus;
  createdAt: Date;
  updatedAt: Date;
  currentVersion: {
    id: string;
    versionNumber: number;
    flow: AnyFlow;
    verificationConfig: VerificationConfig;
    /** C11; resolved with the defaults. Left out, the attribute is not sent. */
    settings?: TemplateSettings;
    /** C84.1; resolved with the defaults. Left out, the attribute is not sent. */
    reportConfig?: ReportConfig;
    createdAt: Date;
  };
}

/**
 * Builds the inquiry template resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildInquiryTemplateResource(
  record: InquiryTemplateRecord,
): InquiryTemplateResource {
  const version = record.currentVersion;
  return inquiryTemplateResourceSchema.parse({
    type: 'inquiry-template',
    id: record.id,
    attributes: {
      name: record.name,
      ...(record.status === undefined ? {} : { status: record.status }),
      'current-version': {
        id: version.id,
        'version-number': version.versionNumber,
        flow: version.flow,
        'verification-config': version.verificationConfig,
        ...(version.settings === undefined
          ? {}
          : { settings: resolveTemplateSettings(version.settings) }),
        ...(version.reportConfig === undefined
          ? {}
          : { 'report-config': resolveReportConfig(version.reportConfig) }),
        'created-at': toTimestamp(version.createdAt),
      },
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
  });
}

/**
 * C36: the default template's government ID checks, by group. Required: what decides whether a
 * document can be accepted at all. Enabled but not required (advisory): the barcode checks and
 * REAL ID (most national ID cards have no PDF417, so requiring them would send those cards to
 * review), the comparisons and repeats (every e2e run and developer submits the same synthetic
 * card), and the beta heuristics. Disabled: the A-tier checks, which need a provider (C35).
 */
export const DEFAULT_GOVERNMENT_ID_CHECKS = Object.freeze({
  required: Object.freeze([
    // Image and capture.
    'id_unprocessable_submission_detection',
    'id_blur_detection',
    'id_glare_detection',
    'id_double_side_detection',
    'id_portrait_detection',
    'id_portrait_clarity_detection',
    // MRZ (feature_absent for an established AAMVA card).
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
  ]),
  advisory: Object.freeze([
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
    // H-tier, beta.
    'id_color_inconsistency_detection',
    'id_electronic_replica_detection',
    'id_tamper_detection',
    'id_fabrication_detection',
    'id_handwriting_detection',
    'id_entity_detection',
  ]),
  disabled: Object.freeze([
    'id_aamva_database_lookup',
    'id_public_figure_detection',
    'id_age_inconsistency_detection',
  ]),
});

/**
 * C45.1: the default template's selfie checks. Required: what decides whether the selfie is a
 * live capture of the ID's holder. Enabled but advisory: glare, pose repeat (until volunteer
 * captures calibrate planarity), the account, repeat and background comparisons (every e2e run
 * reuses the same faces), and the H-tier covering, glasses and suspicious entity heuristics.
 * Disabled: the A-tier age and public figure checks, which need a provider (C44).
 */
export const DEFAULT_SELFIE_CHECKS = Object.freeze({
  required: Object.freeze([
    'selfie_image_quality_detection',
    'selfie_pose_detection',
    'selfie_multiple_faces_detection',
    'selfie_liveness_detection',
    'selfie_id_comparison',
  ]),
  advisory: Object.freeze([
    'selfie_glare_detection',
    'selfie_pose_repeat_detection',
    'selfie_account_comparison',
    'selfie_repeat_detection',
    'selfie_similar_background_detection',
    'selfie_face_covering_detection',
    'selfie_glasses_detection',
    'selfie_suspicious_entity_detection',
  ]),
  disabled: Object.freeze(['selfie_age_comparison', 'selfie_public_figure_detection']),
});

const listed = (checks: readonly string[], enabled: boolean, required: boolean) =>
  checks.map((id): [string, { enabled: boolean; required: boolean }] => [
    id,
    { enabled, required },
  ]);

/**
 * Phase 12A C7: a required field OCR could not read sends the verification to manual review
 * instead of failing it, so a genuine card whose print the parser misses is never failed for that
 * alone (`docs/plans/phase-12a.plan.md`, D12A-1).
 */
const DEFAULT_GOVERNMENT_ID_CHECK_CONFIGS: Readonly<Record<string, Record<string, unknown>>> = {
  id_extracted_properties_detection: { 'missing-fields-outcome': 'review' },
};

const DEFAULT_GOVERNMENT_ID_CONFIG = {
  checks: Object.fromEntries(
    [
      ...listed(DEFAULT_GOVERNMENT_ID_CHECKS.required, true, true),
      ...listed(DEFAULT_GOVERNMENT_ID_CHECKS.advisory, true, false),
      ...listed(DEFAULT_GOVERNMENT_ID_CHECKS.disabled, false, false),
    ].map(([id, check]) => {
      const config = DEFAULT_GOVERNMENT_ID_CHECK_CONFIGS[id];
      return [id, config === undefined ? check : { ...check, config }];
    }),
  ),
};

const DEFAULT_SELFIE_CONFIG = {
  checks: Object.fromEntries([
    ...listed(DEFAULT_SELFIE_CHECKS.required, true, true),
    ...listed(DEFAULT_SELFIE_CHECKS.advisory, true, false),
    ...listed(DEFAULT_SELFIE_CHECKS.disabled, false, false),
  ]),
};

const FAILED_INQUIRY = { '==': [{ var: 'inquiry.status' }, 'failed'] };

/**
 * The default template (C7, C36), identical to
 * `contracts/fixtures/flows/default-gov-id-selfie.json`. Transition conditions are JSONLogic over
 * `{ inquiry: { status } }` (see `flowConditionContext`). A change here is published by
 * `seed:dev` as a new version of the seeded template, so existing inquiries keep theirs.
 */
/** The default template's attributes: its flow is flow-spec 1, the form every Phase 1-8 test reads. */
export type DefaultInquiryTemplateAttributes = Omit<CreateInquiryTemplateAttributes, 'flow'> & {
  flow: Flow;
};

const DEFAULT_TEMPLATE = createInquiryTemplateAttributesSchema.parse({
  name: 'Government ID and selfie',
  flow: {
    metadata: {
      specVersion: 1,
      id: 'default-gov-id-selfie',
      // C45.1: version 2 asks for three poses with active liveness and the matching consent;
      // C94.6: version 3 shows the session-integrity notice, so session integrity collects.
      version: 3,
      name: 'Government ID and selfie',
      description:
        'Consent, a two-sided government ID, then a selfie compared with the ID portrait.',
    },
    steps: [
      {
        id: 'consent',
        type: 'consent',
        textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        optionalTextKeys: ['consent.biometric-matching'],
        required: true,
      },
      {
        id: 'government_id',
        type: 'government_id',
        sides: 'both',
        maxAttempts: 3,
        captureMethods: ['upload', 'camera'],
      },
      {
        id: 'selfie',
        type: 'selfie',
        poses: ['center', 'left', 'right'],
        liveness: 'active',
        maxAttempts: 3,
      },
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
      { id: 'failure', type: 'failure', messageKey: 'flow.failure' },
    ],
    transitions: [
      { from: 'government_id', to: 'failure', condition: FAILED_INQUIRY },
      { from: 'selfie', to: 'failure', condition: FAILED_INQUIRY },
    ],
  },
  'verification-config': {
    'government-id': DEFAULT_GOVERNMENT_ID_CONFIG,
    selfie: DEFAULT_SELFIE_CONFIG,
  },
});

/** A fresh copy of the default government ID and selfie template's create attributes. */
export function defaultInquiryTemplateAttributes(): DefaultInquiryTemplateAttributes {
  return structuredClone(DEFAULT_TEMPLATE) as DefaultInquiryTemplateAttributes;
}

/** One reason a template cannot be published, with a JSON Pointer into its attributes. */
export interface TemplatePublishProblem {
  /** Into the template attributes, such as `/flow/steps/3/source`. */
  pointer: string;
  detail: string;
}

/**
 * C50.4 (V18): the rules a template meets when it is created or a version is published, never on
 * drafts or stored versions, and that need no server state; the API answers each as a 422 with
 * the pointer under `/data/attributes`. The rules that need server state (the OTP channel guard,
 * unbound providers and the NFC trust store in production) are the API's async publish hooks
 * (C54.1).
 * - An `aamva` step with `source: government_id` needs an earlier `government_id` step.
 * - An `nfc` step needs an earlier `selfie` step, and an earlier `government_id` step when the
 *   flow has one.
 * - `crypto_wallet.chains` stays within the type's `allowed-chains`, and `xrpl:0` is refused
 *   while `crypto_wallet_address_comparison` is required (nothing proves its ownership).
 * - Every field a database match group names, configured or by default, is collected by the step.
 */
export function templatePublishProblems(
  flow: AnyFlow,
  config: VerificationConfig,
): TemplatePublishProblem[] {
  const problems: TemplatePublishProblem[] = [];
  const seen = new Set<string>();
  const hasGovernmentId = flow.steps.some((step) => step.type === 'government_id');
  flow.steps.forEach((step, index) => {
    const at = `/flow/steps/${String(index)}`;
    if (step.type === 'aamva' && step.source === 'government_id' && !seen.has('government_id')) {
      problems.push({
        pointer: `${at}/source`,
        detail: 'an aamva step with source government_id needs an earlier government_id step',
      });
    }
    if (step.type === 'nfc') {
      if (!seen.has('selfie')) {
        problems.push({ pointer: at, detail: 'an nfc step needs an earlier selfie step' });
      }
      if (hasGovernmentId && !seen.has('government_id')) {
        problems.push({ pointer: at, detail: 'an nfc step needs an earlier government_id step' });
      }
    }
    if (step.type === 'crypto_wallet') {
      problems.push(...cryptoChainProblems(step.chains, config['crypto-wallet'], at));
    }
    if (step.type === 'database') {
      problems.push(...matchGroupProblems(step.fields, config.database));
    }
    seen.add(step.type);
  });
  return problems;
}

/** The C50.4 chain rules of one crypto wallet step. */
function cryptoChainProblems(
  chains: readonly string[],
  typeConfig: VerificationConfig['crypto-wallet'],
  at: string,
): TemplatePublishProblem[] {
  const allowed = typeConfig?.['allowed-chains'];
  const address = typeConfig?.checks.crypto_wallet_address_comparison;
  const ownershipRequired = address?.enabled === true && address.required;
  return chains.flatMap((chain, index): TemplatePublishProblem[] => {
    const pointer = `${at}/chains/${String(index)}`;
    if (allowed !== undefined && !allowed.includes(chain)) {
      return [{ pointer, detail: `chain ${chain} is not in the crypto-wallet allowed-chains` }];
    }
    if (ownershipRequired && cryptoChainSchemes(chain).length === 0) {
      return [
        {
          pointer,
          detail: `${chain} has no ownership proof, so it cannot be offered while crypto_wallet_address_comparison is required`,
        },
      ];
    }
    return [];
  });
}

/** The database step fields each match-group field needs (C50.4). */
const MATCH_FIELD_STEP_FIELDS: Readonly<Record<string, readonly DatabaseField[]>> = {
  name: ['name_first', 'name_last'],
  birthdate: ['birthdate'],
  address: ['address_street_1'],
  'identification-number': ['identification_number'],
  'phone-number': ['phone_number'],
  'email-address': ['email_address'],
};

/** The C50.4 rule that a database step collects what its match groups name. */
function matchGroupProblems(
  fields: readonly DatabaseField[],
  typeConfig: VerificationConfig['database'],
): TemplatePublishProblem[] {
  const identity = typeConfig?.checks.database_identity_comparison;
  if (identity?.enabled !== true) {
    return [];
  }
  const configured = identity.config?.['match-groups'];
  const groups = (configured ??
    phase5ConfigDefaults('database_identity_comparison')['match-groups']) as
    readonly Readonly<Record<string, string>>[] | undefined;
  const collected = new Set<string>(fields);
  return (groups ?? []).flatMap((group, index): TemplatePublishProblem[] => {
    const missing = Object.keys(group).filter(
      (field) =>
        !(MATCH_FIELD_STEP_FIELDS[field] ?? []).every((stepField) => collected.has(stepField)),
    );
    return missing.length === 0
      ? []
      : [
          {
            pointer: `/verification-config/database/checks/database_identity_comparison/config/match-groups/${String(index)}`,
            detail: `match group ${String(index + 1)} names ${missing.join(', ')}, which the database step does not collect`,
          },
        ];
  });
}

/** How a template's default treats each check of a type (C51.1). */
export interface DefaultChecks {
  readonly required: readonly string[];
  readonly advisory: readonly string[];
  readonly disabled: readonly string[];
}

/** A type's checks grouped by their registry default (C51.1), in registry order. */
function registryDefaults(type: SupportedVerificationType): DefaultChecks {
  const checks = Object.entries(defaultTemplateConfig(type).checks);
  const ids = (keep: (switches: { enabled: boolean; required: boolean }) => boolean) =>
    Object.freeze(checks.filter(([, switches]) => keep(switches)).map(([id]) => id));
  return Object.freeze({
    required: ids(({ enabled, required }) => enabled && required),
    advisory: ids(({ enabled, required }) => enabled && !required),
    disabled: ids(({ enabled }) => !enabled),
  });
}

/**
 * C51.1: the default checks of each Phase 5 type, the registry's explicit table
 * (`PHASE5_CHECK_DEFAULTS`): required when a check binds the evidence to the person or the document
 * and needs no unshipped provider, advisory when its evidence often cannot be had, disabled when
 * it needs an operator's provider. Each keeps an enabled, required check.
 */
export const DEFAULT_DOCUMENT_CHECKS: DefaultChecks = registryDefaults('document');
export const DEFAULT_DATABASE_CHECKS: DefaultChecks = registryDefaults('database');
export const DEFAULT_AAMVA_CHECKS: DefaultChecks = registryDefaults('aamva');
export const DEFAULT_PHONE_NUMBER_CHECKS: DefaultChecks = registryDefaults('phone_number');
export const DEFAULT_EMAIL_ADDRESS_CHECKS: DefaultChecks = registryDefaults('email_address');
export const DEFAULT_GOVERNMENT_ID_NFC_CHECKS: DefaultChecks =
  registryDefaults('government_id_nfc');
export const DEFAULT_CRYPTO_WALLET_CHECKS: DefaultChecks = registryDefaults('crypto_wallet');
export const DEFAULT_DATABASE_BUSINESS_CHECKS: DefaultChecks =
  registryDefaults('database_business');
export const DEFAULT_BUSINESS_WEBSITE_CHECKS: DefaultChecks = registryDefaults('business_website');
