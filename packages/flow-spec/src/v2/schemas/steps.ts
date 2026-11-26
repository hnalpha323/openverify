/**
 * C147.3: the v2 step types. The fourteen supported v1 types keep their v1 members, with the
 * additive optional members of C147.3 (`captureMethodsByDevice`, `onFallback`, `prefillFrom`, the
 * failure step's bases); Phase 7's `device_handoff` and the v1 `consent` and `completion` steps are
 * reused unchanged; `screen`, `branch` and `action` are new. `form` is not a v2 type: the
 * migration turns it into a `screen` (C147.10).
 */
import { z } from 'zod';
import { BIOMETRIC_BASES, DECISION_BASES } from '@openverify/core';
import {
  CAPTURE_METHODS,
  DATABASE_FIELDS,
  aamvaStepSchema,
  businessWebsiteStepSchema,
  completionStepSchema,
  consentStepSchema,
  cryptoWalletStepSchema,
  databaseBusinessStepSchema,
  databaseStepSchema,
  deviceHandoffStepSchema,
  documentStepSchema,
  emailOtpStepSchema,
  failureStepSchema,
  governmentIdStepSchema,
  nfcStepSchema,
  phoneOtpStepSchema,
  selfieStepSchema,
  stepIdSchema,
} from '../../flow.js';
import { flowActionSchema } from './actions.js';
import {
  FLOW_V2_CAPS,
  conditionSchema,
  distinctList,
  fieldKeySchema,
  nameSchema,
  portKeySchema,
  publicIdSchema,
  scopePathSchema,
} from './common.js';
import { componentSchema, type Component } from './components.js';

/** C150.2: the device classes a client reports (ours; never Phase 7's pseudonymous class). */
export const DEVICE_KINDS = ['desktop-web', 'mobile-web', 'native'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/**
 * C153.2 (decision 22): the capture methods per device class, each a non-empty subset of
 * `CAPTURE_METHODS`; the client applies its class's entry. Client-reported guidance only: the
 * production camera rules stay where they are.
 */
export const captureMethodsByDeviceSchema = z
  .strictObject({
    'desktop-web': distinctList(z.enum(CAPTURE_METHODS)).optional(),
    'mobile-web': distinctList(z.enum(CAPTURE_METHODS)).optional(),
    native: distinctList(z.enum(CAPTURE_METHODS)).optional(),
  })
  .refine((byDevice) => Object.keys(byDevice).length > 0, 'name at least one device class');

/**
 * C150.6 (decision 6): what an `exhausted` exit does to the outcome. `review` (the default) sends
 * the inquiry to review at completion; `continue` needs the acknowledgement `fallback:<step id>`.
 */
export const ON_FALLBACK_VALUES = ['review', 'continue'] as const;
const onFallback = { onFallback: z.enum(ON_FALLBACK_VALUES).optional() };

/**
 * C148.7 (review H22): the field whose value a step that collects one shows filled and editable.
 * A phone or email step takes one field; a database step and an AAMVA form step map their inputs.
 */
const prefillMap = <Key extends string>(keys: readonly [Key, ...Key[]]) =>
  z
    .partialRecord(z.enum(keys), fieldKeySchema)
    .refine((map) => Object.keys(map).length > 0, 'map at least one input');

const AAMVA_FORM_INPUTS = [
  'name-first',
  'name-last',
  'birthdate',
  'identification-number',
  'issuing-authority',
  'issue-date',
  'expiration-date',
  'address-postal-code',
] as const;

export const governmentIdStepV2Schema = governmentIdStepSchema
  .safeExtend({ ...onFallback, captureMethodsByDevice: captureMethodsByDeviceSchema.optional() })
  .meta({ id: 'GovernmentIdStepV2' });

export const selfieStepV2Schema = selfieStepSchema
  .safeExtend(onFallback)
  .meta({ id: 'SelfieStepV2' });

export const documentStepV2Schema = documentStepSchema
  .safeExtend({ ...onFallback, captureMethodsByDevice: captureMethodsByDeviceSchema.optional() })
  .meta({ id: 'DocumentStepV2' });

export const phoneOtpStepV2Schema = phoneOtpStepSchema
  .safeExtend({ ...onFallback, prefillFrom: fieldKeySchema.optional() })
  .meta({ id: 'PhoneOtpStepV2' });

export const emailOtpStepV2Schema = emailOtpStepSchema
  .safeExtend({ ...onFallback, prefillFrom: fieldKeySchema.optional() })
  .meta({ id: 'EmailOtpStepV2' });

export const databaseStepV2Schema = databaseStepSchema
  .safeExtend({ ...onFallback, prefillFrom: prefillMap(DATABASE_FIELDS).optional() })
  .meta({ id: 'DatabaseStepV2' });

export const aamvaStepV2Schema = aamvaStepSchema
  .safeExtend({ ...onFallback, prefillFrom: prefillMap(AAMVA_FORM_INPUTS).optional() })
  .refine((step) => step.prefillFrom === undefined || step.source === 'form', {
    message: 'only an AAMVA step with source form collects values to prefill',
    path: ['prefillFrom'],
  })
  .meta({ id: 'AamvaStepV2' });

export const nfcStepV2Schema = nfcStepSchema.safeExtend(onFallback).meta({ id: 'NfcStepV2' });

export const cryptoWalletStepV2Schema = cryptoWalletStepSchema
  .safeExtend(onFallback)
  .meta({ id: 'CryptoWalletStepV2' });

export const databaseBusinessStepV2Schema = databaseBusinessStepSchema
  .safeExtend(onFallback)
  .meta({ id: 'DatabaseBusinessStepV2' });

export const businessWebsiteStepV2Schema = businessWebsiteStepSchema
  .safeExtend(onFallback)
  .meta({ id: 'BusinessWebsiteStepV2' });

/**
 * C128.3's contest route in the format's camelCase: an `https:` URL or a contact, with an
 * optional case template for review requests (`@openverify/contracts`' `contestRouteSchema`).
 */
export const contestRouteV2Schema = z
  .strictObject({
    url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .optional(),
    contact: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\P{Cc}+$/u, 'must hold no control character')
      .optional(),
    caseTemplateId: publicIdSchema('ctmpl').optional(),
  })
  .refine(
    ({ url, contact }) => url !== undefined || contact !== undefined,
    'a contest route reaches the person by a URL or a contact',
  );

/** C150.7: a failure step reachable on non-outcome facts carries a basis and a contest route. */
export const failureStepV2Schema = failureStepSchema
  .safeExtend({
    decisionBasis: z.enum(DECISION_BASES).optional(),
    contestRoute: contestRouteV2Schema.optional(),
    biometricBasis: z.enum(BIOMETRIC_BASES).optional(),
  })
  .meta({ id: 'FailureStepV2' });

/** The component ids of a screen, nested ones included, in document order. */
export function componentIdsOf(components: readonly Component[]): string[] {
  return components.flatMap((component) =>
    'children' in component
      ? [component.id, ...componentIdsOf(component.children)]
      : [component.id],
  );
}

/**
 * C148.1: a screen of components. Its primary submit button exits through `next`, each further
 * submit button through `button:<key>`.
 */
export const screenStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('screen'),
    name: nameSchema.optional(),
    components: z.array(componentSchema).min(1).max(FLOW_V2_CAPS.componentsPerScreen),
  })
  .superRefine((step, ctx) => {
    const ids = componentIdsOf(step.components);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate component id "${id}"`,
          path: ['components'],
        });
      }
      seen.add(id);
    }
  })
  .meta({ id: 'ScreenStep' });

/**
 * C150.3: where a route goes when its condition meets a null: another route's port, the next
 * route (`skip-route`), `else`, or `review` (`else`, and the inquiry goes to review at completion).
 * There is no `error`: a person never reaches a dead end. No default: a route that reads a nullable
 * path without one is refused at publish (`on_null_missing`).
 */
export const ON_NULL_PATTERN = /^(?:else|skip-route|review|route:[a-z][a-z0-9_]{0,39})$/;
export const onNullSchema = z
  .string()
  .regex(ON_NULL_PATTERN, 'must be else, skip-route, review or route:<key>');

export const branchRouteSchema = z.strictObject({
  key: portKeySchema,
  label: nameSchema,
  condition: conditionSchema,
  onNull: onNullSchema.optional(),
});

/** C150.5: the nullable facts a branch may wait for, up to `maxSeconds`. */
export const branchWaitSchema = z.strictObject({
  facts: z.array(scopePathSchema).min(1).max(FLOW_V2_CAPS.waitFacts),
  maxSeconds: z.int().min(1).max(FLOW_V2_CAPS.waitMaxSeconds),
});

/**
 * C150.1: routes tried in order, the first whose condition holds is taken; `else` is the
 * catch-all. Evaluated by `@openverify/workflow-engine` on the server only (ADR 0008).
 */
export const branchStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('branch'),
    name: nameSchema.optional(),
    routes: z.array(branchRouteSchema).min(1).max(FLOW_V2_CAPS.routesPerBranch),
    waitFor: branchWaitSchema.optional(),
  })
  .superRefine((step, ctx) => {
    const keys = new Set<string>();
    step.routes.forEach((route, index) => {
      if (keys.has(route.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate route key "${route.key}"`,
          path: ['routes', index, 'key'],
        });
      }
      keys.add(route.key);
    });
  })
  .meta({ id: 'BranchStep' });

/** C152.1: one action of the closed list, with ports `next` and `error` (always wired). */
export const actionStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('action'),
    name: nameSchema.optional(),
    action: flowActionSchema,
  })
  .meta({ id: 'ActionStep' });

/**
 * C238.1 (Phase 11, Workflow 11A; ours): how long a `share_consent` record is valid, the share
 * token's range (60 s to 21 days), 14 days by default. A token never outlives its consent.
 */
export const SHARE_CONSENT_VALID_SECONDS = Object.freeze({
  min: 60,
  max: 1_814_400,
  default: 1_209_600,
});

/** C238.1: the side of a share a `share_consent` step records consent for. */
export const SHARE_CONSENT_SIDES = ['source', 'destination'] as const;
export type ShareConsentSide = (typeof SHARE_CONSENT_SIDES)[number];

/**
 * C238.1 (Phase 11, Workflow 11A; orchestrator decision 17: the type literal is snake_case, the
 * members camelCase): the person's consent to a Connect share, recorded as a `flow` consent record.
 * A `source` step names its connection (an outbound connection of the template's organisation,
 * checked at publish); a `destination` step takes the inquiry's share token and names none.
 * `withdrawalContact` (C237.4) fills `{withdraw}` and is required at publish
 * (`share_consent_withdrawal_contact_missing`). Accepting and declining both continue on `next`:
 * declining never ends the flow (consent must be free). The texts are the version's operator copy
 * for the `share.consent.*` keys, else the built-in ones, composed by the server (C238.3).
 */
export const shareConsentStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('share_consent'),
    name: nameSchema.optional(),
    side: z.enum(SHARE_CONSENT_SIDES),
    connectionId: publicIdSchema('cxn').optional(),
    consentValidSeconds: z
      .int()
      .min(SHARE_CONSENT_VALID_SECONDS.min)
      .max(SHARE_CONSENT_VALID_SECONDS.max)
      .optional(),
    withdrawalContact: z
      .string()
      .min(1)
      .max(500)
      .regex(/^\P{Cc}+$/u, 'must hold no control character')
      .optional(),
  })
  .superRefine((step, ctx) => {
    if (step.side === 'source' && step.connectionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a source-side step names its connection',
        path: ['connectionId'],
      });
    }
    if (step.side === 'destination' && step.connectionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "a destination-side step takes the inquiry's share token and names no connection",
        path: ['connectionId'],
      });
    }
  })
  .meta({ id: 'ShareConsentStep' });
export type ShareConsentStep = z.infer<typeof shareConsentStepSchema>;

export const stepV2Schema = z.discriminatedUnion('type', [
  consentStepSchema,
  governmentIdStepV2Schema,
  selfieStepV2Schema,
  documentStepV2Schema,
  phoneOtpStepV2Schema,
  emailOtpStepV2Schema,
  databaseStepV2Schema,
  aamvaStepV2Schema,
  nfcStepV2Schema,
  cryptoWalletStepV2Schema,
  databaseBusinessStepV2Schema,
  businessWebsiteStepV2Schema,
  deviceHandoffStepSchema,
  completionStepSchema,
  failureStepV2Schema,
  screenStepSchema,
  branchStepSchema,
  actionStepSchema,
  // C238.1 (Phase 11, Workflow 11A): joins the union without a format change (Phase 9 C175.2).
  shareConsentStepSchema,
]);

export const FLOW_V2_STEP_TYPES = [
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
  'device_handoff',
  'completion',
  'failure',
  'screen',
  'branch',
  'action',
  'share_consent',
] as const;
export type FlowV2StepType = (typeof FLOW_V2_STEP_TYPES)[number];

/** The types that create a verification, each at most once per flow (C147.6). */
export const VERIFICATION_STEP_TYPES = [
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
] as const satisfies readonly FlowV2StepType[];
export type VerificationStepType = (typeof VERIFICATION_STEP_TYPES)[number];

/** The types with no v1 form: served to spec-1 clients as a placeholder (C151.6). */
export const V2_ONLY_STEP_TYPES = [
  'screen',
  'branch',
  'action',
  // C238.1 (Workflow 11A): a spec-1 client gets the placeholder.
  'share_consent',
] as const satisfies readonly FlowV2StepType[];

/** The types a person never sees (C151.5: never sent, never `previous-step-id`). */
export const SERVER_STEP_TYPES = ['branch', 'action'] as const satisfies readonly FlowV2StepType[];

export type FlowV2Step = z.infer<typeof stepV2Schema>;
export type ScreenStep = z.infer<typeof screenStepSchema>;
export type BranchStep = z.infer<typeof branchStepSchema>;
export type BranchRoute = z.infer<typeof branchRouteSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
