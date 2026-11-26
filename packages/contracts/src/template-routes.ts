/**
 * Workflow 9A Stage 1a, (T): the route schemas of C154.4 and C156 (validate, diff, preview,
 * simulate, restore, copy, used by and promote), frozen here and served by `api-templates`
 * (Workflow 9A Stage 3) from the frozen route files of `foundation-9a`. Each answer carries
 * configuration and synthetic values only: a preview never holds inquiry data, a simulated path is
 * never stored, and every member of a simulate body's `scope` and a preview's field defaults is
 * personal data in API logs (C174.5, review P12).
 */
import {
  CHECK_STAGES,
  SIGNAL_TIERS,
  VERIFICATION_STATUSES,
  CONTRAST_PALETTE_TOKENS,
  INQUIRY_STATUSES,
} from '@openverify/core';
import {
  clientStepViewSchema,
  onNullSchema,
  portSchema,
  stepIdSchema as flowStepIdSchema,
  DEVICE_KINDS,
  DEVICE_PLATFORMS,
} from '@openverify/flow-spec';
import { z } from 'zod';
import { actionBodySchema } from './actions.js';
import { flowThemeSchema, themeStylesSchema } from './flow-theme.js';
import { idSchema } from './ids.js';
import { anyFlowSchema } from './inquiry-templates.js';
import { singleDocumentSchema } from './json-api.js';
import {
  fieldSchemasSchema,
  sha256HexSchema,
  templateCopySchema,
  templateLocaleSchema,
  templateValidationSchema,
} from './template-fields.js';
import { templateAcknowledgementKeySchema } from './inquiry-template-versions.js';

// Validate (C154.4) ------------------------------------------------------------------------

/**
 * `POST /inquiry-template-versions/:id/validate` (`inquiry-templates:read`, policy
 * `template-preview`): a dry run of every rule, the async publish hooks included, on the stored draft
 * or, when sent, an unsaved body of the members `PATCH` takes.
 */
export const validateInquiryTemplateVersionBodySchema = z
  .strictObject({
    data: z
      .strictObject({
        type: z.literal('inquiry-template-version').optional(),
        attributes: z.record(z.string(), z.unknown()),
      })
      .optional(),
    meta: z.strictObject({ mode: z.enum(['save', 'publish']).optional() }).optional(),
  })
  .optional();

export const templateVersionValidationDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-version-validation'),
    id: idSchema('itmplv'),
    attributes: z.strictObject({
      validation: templateValidationSchema,
      /** `null` when the flow does not parse. */
      'flow-sha256': sha256HexSchema.nullable(),
      /** The acknowledgements a publish of this content would need (C154.9). */
      'acknowledgements-required': z.array(templateAcknowledgementKeySchema).max(400),
    }),
  }),
);

// Diff (C154.6) ---------------------------------------------------------------------------

/** `GET /inquiry-template-versions/:id/diff?against=<itmplv_>` (`inquiry-templates:read`). */
export const diffInquiryTemplateVersionQuerySchema = z.strictObject({
  against: idSchema('itmplv'),
});

/** One changed position: configuration before and after, never subject data (C154.6). */
const changeSchema = z.strictObject({
  pointer: z.string().max(512),
  before: z.unknown(),
  after: z.unknown(),
});

/**
 * C154.6: consequences said in words, each a code: a required check disabled or made optional, a
 * `ga` check replaced by a `beta` one, a verification step removed or skippable on a path, a consent
 * text changed (new sessions need fresh consent), an enabled locale that is not reviewed.
 */
export const TEMPLATE_DIFF_CONSEQUENCES = [
  'required_check_relaxed',
  'ga_check_replaced_by_beta',
  'verification_step_removed',
  'verification_step_skippable',
  'consent_text_changed',
  'unreviewed_locale_enabled',
] as const;

export const templateVersionDiffDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-version-diff'),
    /** `<this version>..<against>`. */
    id: z.string().regex(/^itmplv_[0-9A-Z]{26}\.\.itmplv_[0-9A-Z]{26}$/),
    attributes: z.strictObject({
      'from-version-id': idSchema('itmplv'),
      'to-version-id': idSchema('itmplv'),
      steps: z.strictObject({
        added: z.array(flowStepIdSchema),
        removed: z.array(flowStepIdSchema),
        changed: z.array(
          z.strictObject({ 'step-id': flowStepIdSchema, changes: z.array(changeSchema) }),
        ),
      }),
      edges: z.strictObject({
        added: z.array(z.string()),
        removed: z.array(z.string()),
        retargeted: z.array(z.string()),
      }),
      'route-order': z.array(flowStepIdSchema),
      'verification-config': z.array(changeSchema),
      settings: z.array(changeSchema),
      'report-config': z.array(changeSchema),
      'field-schemas': z.array(changeSchema),
      copy: z.array(changeSchema),
      'theme-set-id': changeSchema.nullable(),
      locales: z.array(changeSchema),
      /** Only `layout` changed: never set when a change has a consequence (C154.10). */
      'layout-only': z.boolean(),
      consequences: z.array(
        z.strictObject({ code: z.enum(TEMPLATE_DIFF_CONSEQUENCES), pointer: z.string().max(512) }),
      ),
    }),
  }),
);

// Preview (C156.1) ------------------------------------------------------------------------

/** C161.7: the pseudo-locales, accepted by the preview only. */
export const PREVIEW_PSEUDO_LOCALES = ['en-XA', 'ar-XB'] as const;
export const previewLocaleSchema = z.union([templateLocaleSchema, z.enum(PREVIEW_PSEUDO_LOCALES)]);

/**
 * `POST /inquiry-template-versions/:id/preview` (`inquiry-templates:read`, policy
 * `template-preview`): an optional unsaved body, including unsaved theme `styles` checked by C160.3's
 * schema and the contrast gate (review H15), and the locale. The field defaults are personal data in
 * logs (C174.5, P12).
 */
export const previewInquiryTemplateVersionBodySchema = z.strictObject({
  data: z
    .strictObject({
      type: z.literal('inquiry-template-version').optional(),
      attributes: z.strictObject({
        flow: anyFlowSchema.optional(),
        copy: templateCopySchema.optional(),
        'field-schemas': fieldSchemasSchema.optional(),
        'theme-set-id': idSchema('theset').nullable().optional(),
        styles: themeStylesSchema.optional(),
      }),
    })
    .optional(),
  meta: z.strictObject({ locale: previewLocaleSchema }),
});
export type PreviewInquiryTemplateVersionBody = z.infer<
  typeof previewInquiryTemplateVersionBodySchema
>;

/** One finding of the gate: a pair below its minimum (`fail`) or a text pair below 7:1 (`warn`). */
export const previewContrastFindingSchema = z.strictObject({
  pointer: z.string().max(512).regex(/^\//, 'must be a JSON Pointer'),
  foreground: z.enum(CONTRAST_PALETTE_TOKENS),
  background: z.enum(CONTRAST_PALETTE_TOKENS),
  /** Never rounded (rule 10): 4.499 fails 4.5. */
  ratio: z.number().min(1).max(21),
  required: z.number().min(1).max(21),
  level: z.enum(['fail', 'warn']),
});
export const previewContrastSchema = z
  .strictObject({
    status: z.enum(['passed', 'failed']),
    findings: z.array(previewContrastFindingSchema).max(64),
  })
  .refine(
    (contrast) =>
      (contrast.status === 'failed') === contrast.findings.some(({ level }) => level === 'fail'),
    { message: 'failed exactly when a finding fails', path: ['status'] },
  );

/**
 * C156.1: the preview document: every renderable step's client view in the session's `step` form,
 * the resolved theme and copy, and synthetic guidance values. Never inquiry data; the steps a client
 * never sees (a branch, an action) are left out.
 */
export const templatePreviewDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-preview'),
    id: idSchema('itmplv'),
    attributes: z.strictObject({
      locale: previewLocaleSchema,
      'spec-version': z.literal(2),
      steps: z.array(clientStepViewSchema).max(200),
      theme: flowThemeSchema,
      /**
       * C156.1, C160.4 (Workflow 9B, (F); review H15): the contrast gate's answer for the resolved
       * theme, both palettes: `failed` when a pair is below its minimum. The preview renders either
       * way, so the theme editor shows a failing palette on real screens before any save.
       */
      contrast: previewContrastSchema,
      /** The copy for the locale, already through the pseudo-locale transform when one is asked. */
      copy: z.record(z.string(), z.string()),
      /** Synthetic guidance per step id (C156.1): never a person's value. */
      guidance: z.record(flowStepIdSchema, z.record(z.string(), z.unknown())),
    }),
  }),
);

// Simulate (C156.4) -----------------------------------------------------------------------

const simulatedCheckStatus = z.enum(['passed', 'failed', 'not_applicable']).nullable();

/** One verification of the simulated scope: its status, or the per-check overrides it follows from. */
/** C150.2: the inquiry facts a route may read beside its fields. */
const simulatedInquirySchema = z.strictObject({
  status: z.enum(INQUIRY_STATUSES).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
});

const simulatedVerificationSchema = z.strictObject({
  status: z.enum(VERIFICATION_STATUSES).nullable().optional(),
  attempts: z.int().min(0).max(10).optional(),
  checks: z.record(z.string().max(80), simulatedCheckStatus).optional(),
  extractions: z.record(z.string().max(64), z.unknown()).optional(),
});

/**
 * C156.4: the simulated facts, `null` for any nullable fact. Every member is personal data in logs
 * (C174.5): operators paste a real person's values here, in production too (review P12). Only
 * `flowProvisional` signals can be set (C150.9, review H02).
 */
export const simulatedScopeSchema = z
  .strictObject({
    verifications: z.record(flowStepIdSchema, simulatedVerificationSchema).optional(),
    /** Workflow 9B (F): the inquiry's status and tags (C150.2's `inquiry` root). */
    inquiry: simulatedInquirySchema.optional(),
    fields: z.record(z.string().max(64), z.unknown()).optional(),
    signals: z.record(z.string().max(80), z.unknown()).optional(),
    lists: z
      .record(z.string().max(40), z.strictObject({ matched: z.boolean().nullable() }))
      .optional(),
    device: z
      .strictObject({
        kind: z.enum(DEVICE_KINDS).nullable().optional(),
        platform: z.enum(DEVICE_PLATFORMS).nullable().optional(),
      })
      .optional(),
    account: z.record(z.string().max(64), z.unknown()).optional(),
    workflows: z
      .record(
        flowStepIdSchema,
        z.strictObject({
          status: z.enum(['completed', 'errored', 'canceled', 'timed-out']),
          /** Workflow 9B (F): C152.2's `workflows.<step>.error-type`, such as `timeout`. */
          'error-type': z
            .string()
            .regex(/^[a-z][a-z0-9_]{0,63}$/)
            .nullable()
            .optional(),
          outputs: z.record(z.string().max(64), z.unknown()).optional(),
        }),
      )
      .optional(),
    session: z.record(z.string().max(64), z.unknown()).optional(),
  })
  .meta({ pii: true });
export type SimulatedScope = z.infer<typeof simulatedScopeSchema>;

/**
 * `POST /inquiry-template-versions/:id/simulate` (`inquiry-templates:read`, policy
 * `template-preview`): the scope, or a preset of the caller's (`ssp_`) or a built-in one.
 */
export const simulateInquiryTemplateVersionBodySchema = actionBodySchema(
  z
    .strictObject({
      scope: simulatedScopeSchema.optional(),
      'preset-id': z
        .string()
        .regex(/^(?:ssp_[0-9A-Z]{26}|builtin:[a-z0-9_-]{1,80})$/)
        .optional(),
    })
    .refine((meta) => (meta.scope === undefined) !== (meta['preset-id'] === undefined), {
      message: 'send a scope or a preset, not both',
    }),
);
export type SimulateInquiryTemplateVersionBody = z.infer<
  typeof simulateInquiryTemplateVersionBodySchema
>;

/**
 * C156.4: the path `nextPosition` takes and the outcome `flowOutcome` reaches, the same functions the
 * live engine runs (review H16). Labelled simulated; never stored as a run or a step record.
 */
export const templateSimulationDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-simulation'),
    id: idSchema('itmplv'),
    attributes: z.strictObject({
      simulated: z.literal(true),
      steps: z.array(
        z.strictObject({
          'step-id': flowStepIdSchema,
          'step-type': z.string().max(40),
          port: portSchema.nullable(),
          route: z
            .strictObject({
              key: z.string().max(40).nullable(),
              'condition-result': z.boolean().nullable(),
              'on-null': onNullSchema.nullable(),
              'null-paths': z.array(z.string().max(300)),
            })
            .nullable(),
          waited: z.boolean(),
          /**
           * Workflow 9B (F): the step's notes as the live engine writes them on the step record
           * (`FLOW_STEP_NOTES`, such as `on-null-review`), so simulate shows what the path recorded.
           */
          notes: z.array(z.string().max(64)).max(20),
          /** The tier and stage of every fact the route read (C150.8). */
          facts: z.array(
            z.strictObject({
              path: z.string().max(300),
              tier: z.enum(SIGNAL_TIERS).nullable(),
              stage: z.enum(CHECK_STAGES).nullable(),
              source: z.enum(['verification', 'server', 'person', 'client', 'operator']),
            }),
          ),
        }),
      ),
      outcome: z.strictObject({
        status: z.enum(INQUIRY_STATUSES),
        'flow-outcome': z.strictObject({
          'verification-types-on-path': z.array(z.string().max(64)),
          'fallbacks-taken': z.array(flowStepIdSchema),
          flags: z.array(z.string().max(64)),
        }),
      }),
      /** The run ended at a halt (C151.2: `flow_loop_limit`, `scope_path_missing`). */
      halted: z.string().max(64).nullable(),
    }),
  }),
);

// Restore, copy, used by, promote (C154.4, C154.5) ------------------------------------------

/** `POST /inquiry-templates/:id/restore` (`inquiry-templates:write`): a draft from that version. */
export const restoreInquiryTemplateBodySchema = actionBodySchema(
  z.strictObject({ 'version-id': idSchema('itmplv') }),
);

/** `POST /inquiry-templates/:id/copy` (`inquiry-templates:write`): a new template, its draft a copy. */
export const copyInquiryTemplateBodySchema = actionBodySchema(
  z.strictObject({
    name: z.string().min(1).max(200),
    'version-id': idSchema('itmplv').optional(),
  }),
);

/**
 * `POST /inquiry-templates/:id/promote` (`inquiry-templates:write` in both environments; users
 * only; `environments:production` when either side is production). Never replaces a draft.
 */
export const promoteInquiryTemplateBodySchema = actionBodySchema(
  z.strictObject({
    'environment-id': idSchema('env'),
    'version-id': idSchema('itmplv').optional(),
  }),
);

/** What a promote copied besides the version (C160.8): a theme set and its assets. */
export const promoteMetaSchema = z.strictObject({
  copied: z.array(z.strictObject({ type: z.literal('theme-set'), id: idSchema('theset') })),
});

const namedReferenceSchema = z.strictObject({
  id: z.string().max(40),
  name: z.string().max(200),
});

/**
 * `GET /inquiry-templates/:id/used-by` (`inquiry-templates:read`): what names this template, each by
 * name only for a caller who can read it, otherwise counted (review P34).
 */
export const templateUsageDocumentSchema = singleDocumentSchema(
  z.strictObject({
    type: z.literal('inquiry-template-usage'),
    id: idSchema('itmpl'),
    attributes: z.strictObject({
      workflows: z.array(namedReferenceSchema),
      'workflows-hidden': z.int().min(0),
      'report-templates': z.array(namedReferenceSchema),
      'report-templates-hidden': z.int().min(0),
      'case-templates': z.array(namedReferenceSchema),
      'case-templates-hidden': z.int().min(0),
      'embed-origins': z.array(z.string().max(300)),
    }),
  }),
);
