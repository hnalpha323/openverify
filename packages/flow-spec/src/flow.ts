/**
 * Server-driven verification flow definition, shared by the web flow and the
 * Android SDK. zod is the source of truth; `schema/flow.schema.json` is
 * generated from it (see `scripts/export-json-schema.ts`).
 *
 * Execution model: steps run in list order. After a step completes, its
 * outgoing transitions are evaluated in order and the first whose condition
 * is absent or true (JSONLogic) picks the next step; if none matches, the next
 * step in the list runs. `completion` and `failure` steps end the flow.
 */
import {
  DomainError,
  cryptoChainIdSchema,
  documentTypeSchema,
  idClassSchema,
} from '@openverify/core';
import { z } from 'zod';
import { PATTERN_SOURCE_LIMIT, compilePattern } from './v2/pattern/index.js';

export const FLOW_SPEC_VERSION = 1;

/** Arrays whose items must be distinct; `uniqueItems` carries the rule into JSON Schema. */
function uniqueList<Item extends z.ZodType>(item: Item) {
  return z
    .array(item)
    .min(1)
    .refine((values) => new Set(values).size === values.length, 'must not contain duplicates')
    .meta({ uniqueItems: true });
}

export const stepIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]{0,63}$/,
    'must be lowercase letters, digits, _ or -, starting with a letter',
  )
  .meta({ description: 'Step identifier, unique within the flow.' });

/** Translation key, e.g. `consent.biometric.body`. */
export const i18nKeySchema = z
  .string()
  .max(200)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, 'must be a dotted translation key');

/** ISO 3166-1 alpha-2 country code. */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code');

const attemptsSchema = z.int().min(1).max(10);

export const metadataSchema = z.strictObject({
  /** Version of this specification format. */
  specVersion: z.literal(FLOW_SPEC_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'must be a lowercase slug'),
  /** Revision of this flow; increases on every published change. */
  version: z.int().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

// Form fields -----------------------------------------------------------------

const fieldBase = {
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case field name'),
  labelKey: i18nKeySchema,
  required: z.boolean(),
};

const textFieldSchema = z.strictObject({
  type: z.literal('text'),
  ...fieldBase,
  validation: z
    .strictObject({
      minLength: z.int().min(0).optional(),
      maxLength: z.int().min(1).max(10_000).optional(),
      /**
       * A pattern the whole value must match, in C148.3's restricted grammar (an ECMAScript `u`
       * pattern subset). C252 (Workflow 11B): it is never compiled with the native engine. A write
       * checks it with `compilePattern` (`v1FieldPatternProblems`, `pattern_refused`); a stored
       * flow whose pattern the grammar refuses still parses, because stored versions are never
       * rewritten, and no client or server matches a v1 pattern (the v2 migration converts it).
       */
      pattern: z.string().max(PATTERN_SOURCE_LIMIT).optional(),
    })
    .refine(
      ({ minLength, maxLength }) =>
        minLength === undefined || maxLength === undefined || minLength <= maxLength,
      'minLength must not exceed maxLength',
    )
    .optional(),
});

const dateFieldSchema = z.strictObject({
  type: z.literal('date'),
  ...fieldBase,
  validation: z
    .strictObject({ min: z.iso.date().optional(), max: z.iso.date().optional() })
    .refine(
      ({ min, max }) => min === undefined || max === undefined || min <= max,
      'min must not be after max',
    )
    .optional(),
});

const emailFieldSchema = z.strictObject({ type: z.literal('email'), ...fieldBase });

const countryRestriction = z
  .strictObject({ allowedCountries: uniqueList(countryCodeSchema).optional() })
  .optional();

const phoneFieldSchema = z.strictObject({
  type: z.literal('phone'),
  ...fieldBase,
  validation: countryRestriction,
});

const selectFieldSchema = z.strictObject({
  type: z.literal('select'),
  ...fieldBase,
  options: z
    .array(z.strictObject({ value: z.string().min(1).max(200), labelKey: i18nKeySchema }))
    .min(1)
    .refine(
      (options) => new Set(options.map((option) => option.value)).size === options.length,
      'option values must be unique',
    ),
});

const countryFieldSchema = z.strictObject({
  type: z.literal('country'),
  ...fieldBase,
  validation: countryRestriction,
});

export const formFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  dateFieldSchema,
  emailFieldSchema,
  phoneFieldSchema,
  selectFieldSchema,
  countryFieldSchema,
]);

// Steps -----------------------------------------------------------------------

export const consentStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('consent'),
    /** Keys of the consent texts (biometric and data processing) shown to the user. */
    textKeys: z.array(i18nKeySchema).min(1),
    /**
     * C42.3: texts the user may accept or decline, each with its own unchecked checkbox, such as
     * `consent.biometric-matching`. Declining one still lets the user verify.
     */
    optionalTextKeys: uniqueList(i18nKeySchema)
      .refine((keys) => keys.length <= 20, 'at most 20 optional texts')
      .optional(),
    /** Whether the user must accept to continue. */
    required: z.boolean(),
  })
  .refine((step) => !(step.optionalTextKeys ?? []).some((key) => step.textKeys.includes(key)), {
    message: 'an optional text cannot also be required',
    path: ['optionalTextKeys'],
  })
  .meta({ id: 'ConsentStep' });

export const formStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('form'),
    fields: z.array(formFieldSchema).min(1),
  })
  .superRefine((step, ctx) => {
    const seen = new Set<string>();
    step.fields.forEach((field, index) => {
      if (seen.has(field.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate field name "${field.name}"`,
          path: ['fields', index, 'name'],
        });
      }
      seen.add(field.name);
    });
  })
  .meta({ id: 'FormStep' });

/** How the user may capture a document or ID (C50.3). */
export const CAPTURE_METHODS = ['upload', 'camera'] as const;

export const governmentIdStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('government_id'),
    sides: z.enum(['front', 'back', 'both']),
    /** When absent, every country is accepted. */
    allowedCountries: uniqueList(countryCodeSchema).optional(),
    /** When absent, every ID class is accepted. */
    allowedIdClasses: uniqueList(idClassSchema).optional(),
    maxAttempts: attemptsSchema,
    captureMethods: uniqueList(z.enum(CAPTURE_METHODS)),
  })
  .meta({ id: 'GovernmentIdStep' });

export const selfieStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('selfie'),
    poses: uniqueList(z.enum(['center', 'left', 'right'])),
    liveness: z.enum(['passive', 'active']),
    maxAttempts: attemptsSchema,
  })
  .refine((step) => step.liveness === 'passive' || step.poses.some((pose) => pose !== 'center'), {
    message: 'active liveness needs a left or right pose',
    path: ['poses'],
  })
  .meta({ id: 'SelfieStep' });

/**
 * C50.3: the accepted document classes and capture methods. The recency window is the
 * `document_recency_detection` config (`max-age-days`), sent to clients as guidance.
 */
export const documentStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('document'),
    documentTypes: uniqueList(documentTypeSchema),
    captureMethods: uniqueList(z.enum(CAPTURE_METHODS)),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'DocumentStep' });

/** Six to ten digits (C55.2, SP 800-63B-4 §3.1.3.2); six when absent. */
const codeLengthSchema = z.int().min(6).max(10);

/** The most countries a phone step may allow (C50.3). */
export const MAX_PHONE_COUNTRIES = 250;

export const phoneOtpStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('phone_otp'),
    /** The countries whose numbers may receive a code (C55.8): the SMS-pumping fence. */
    allowedCountries: uniqueList(countryCodeSchema).refine(
      (countries) => countries.length <= MAX_PHONE_COUNTRIES,
      `at most ${String(MAX_PHONE_COUNTRIES)} countries`,
    ),
    codeLength: codeLengthSchema.optional(),
    /** Accept VoIP numbers; false when absent (C55.8). */
    allowVoip: z.boolean().optional(),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'PhoneOtpStep' });

export const emailOtpStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('email_otp'),
    codeLength: codeLengthSchema.optional(),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'EmailOtpStep' });

export const DATABASE_FIELDS = [
  'name_first',
  'name_middle',
  'name_last',
  'birthdate',
  'address_street_1',
  'address_street_2',
  'address_city',
  'address_subdivision',
  'address_postal_code',
  'address_country_code',
  'identification_number',
  'phone_number',
  'email_address',
] as const;
export type DatabaseField = (typeof DATABASE_FIELDS)[number];

/** C50.3: every database step collects these ... */
export const DATABASE_REQUIRED_FIELDS = [
  'name_first',
  'name_last',
  'address_country_code',
] as const;
/** ... and at least one of these, so a record can be matched on more than the name. */
export const DATABASE_IDENTIFYING_FIELDS = [
  'birthdate',
  'address_street_1',
  'identification_number',
  'phone_number',
  'email_address',
] as const;

export const databaseStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('database'),
    fields: uniqueList(z.enum(DATABASE_FIELDS)),
    /** The collected fields the user must fill; each must be in `fields`. */
    requiredFields: uniqueList(z.enum(DATABASE_FIELDS)).optional(),
    maxAttempts: attemptsSchema.optional(),
  })
  .superRefine((step, ctx) => {
    const collected = new Set<string>(step.fields);
    if (!DATABASE_REQUIRED_FIELDS.every((field) => collected.has(field))) {
      ctx.addIssue({
        code: 'custom',
        message: `a database step collects ${DATABASE_REQUIRED_FIELDS.slice(0, -1).join(', ')} and ${DATABASE_REQUIRED_FIELDS.at(-1) ?? ''}`,
        path: ['fields'],
      });
    }
    if (!DATABASE_IDENTIFYING_FIELDS.some((field) => collected.has(field))) {
      ctx.addIssue({
        code: 'custom',
        message: `a database step also collects one of ${DATABASE_IDENTIFYING_FIELDS.slice(0, -1).join(', ')} or ${DATABASE_IDENTIFYING_FIELDS.at(-1) ?? ''}`,
        path: ['fields'],
      });
    }
    const uncollected = (step.requiredFields ?? []).filter((field) => !collected.has(field));
    if (uncollected.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `required fields must be collected: ${uncollected.join(', ')}`,
        path: ['requiredFields'],
      });
    }
  })
  .meta({ id: 'DatabaseStep' });

/**
 * C50.3, C59.6: `government_id` runs on the inquiry's US licence or ID card with no screen (the
 * server creates and submits it, or skips it); `form` shows the AAMVA form.
 */
export const AAMVA_SOURCES = ['government_id', 'form'] as const;

export const aamvaStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('aamva'),
    source: z.enum(AAMVA_SOURCES),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'AamvaStep' });

export const nfcStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('nfc'),
    /** Chip reading needs the native SDK; web clients skip or hand off this step. */
    androidOnly: z.literal(true),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'NfcStep' });

/** How the user proves control of a wallet (C57): an injected EIP-1193 wallet, or pasting. */
export const CRYPTO_SIGNING_METHODS = ['wallet', 'paste'] as const;

export const cryptoWalletStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('crypto_wallet'),
    /** The CAIP-2 chains offered (C57.1), in their canonical form. */
    chains: uniqueList(cryptoChainIdSchema),
    signing: uniqueList(z.enum(CRYPTO_SIGNING_METHODS)),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'CryptoWalletStep' });

export const databaseBusinessStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('database_business'),
    /** Ask for the business's officers and owners (C52.3); false when absent. */
    collectAssociatedPersons: z.boolean().optional(),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'DatabaseBusinessStep' });

export const businessWebsiteStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('business_website'),
    maxAttempts: attemptsSchema.optional(),
  })
  .meta({ id: 'BusinessWebsiteStep' });

/** C96.1 (Phase 7): how a device handoff reaches the phone; QR alone by default (P02). */
export const DEVICE_HANDOFF_METHODS = ['qr', 'email', 'sms'] as const;

/**
 * C96.1: the defaults of a `device_handoff` step's options, which the server applies; the schema
 * transforms nothing. The lifetimes are ours, shorter than the public hour, for phishing (H27).
 */
export const DEVICE_HANDOFF_DEFAULTS = Object.freeze({
  methods: Object.freeze(['qr'] as const),
  qrTtlSeconds: 300,
  linkTtlSeconds: 900,
  confirmationCode: false,
  skipOnMobile: true,
  allowContinueHere: true,
});

/**
 * C96.1 (Phase 7): the move from a desktop to a phone, placed where it should happen (usually
 * before `government_id`). Email and SMS go only to a destination the inquiry confirmed, unless
 * `confirmationCode` is on; `sms` needs an SMS adapter (422 `sms_not_configured`) and the step
 * needs the environment's `organization-display-name` (422 `display_name_required`), both at
 * publish. The server skips it for a smartphone, a tablet or an SDK session (`skipOnMobile`).
 */
export const deviceHandoffStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('device_handoff'),
    methods: z
      .array(z.enum(DEVICE_HANDOFF_METHODS))
      .min(1)
      .max(DEVICE_HANDOFF_METHODS.length)
      .refine((methods) => new Set(methods).size === methods.length, 'must not repeat a method')
      .optional(),
    /** A QR token's lifetime: 2 to 15 minutes. */
    qrTtlSeconds: z.int().min(120).max(900).optional(),
    /** An email or SMS token's lifetime: 5 to 60 minutes. */
    linkTtlSeconds: z.int().min(300).max(3600).optional(),
    /** The phone asks for the six digits the desktop shows. */
    confirmationCode: z.boolean().optional(),
    /** Skip the step on a phone, a tablet or an SDK session. */
    skipOnMobile: z.boolean().optional(),
    /** The desktop may skip the handoff and capture here. */
    allowContinueHere: z.boolean().optional(),
  })
  .meta({ id: 'DeviceHandoffStep' });

export const completionStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('completion'),
    messageKey: i18nKeySchema.optional(),
  })
  .meta({ id: 'CompletionStep' });

export const failureStepSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('failure'),
    messageKey: i18nKeySchema.optional(),
  })
  .meta({ id: 'FailureStep' });

export const stepSchema = z.discriminatedUnion('type', [
  consentStepSchema,
  formStepSchema,
  governmentIdStepSchema,
  selfieStepSchema,
  documentStepSchema,
  phoneOtpStepSchema,
  emailOtpStepSchema,
  databaseStepSchema,
  aamvaStepSchema,
  nfcStepSchema,
  cryptoWalletStepSchema,
  databaseBusinessStepSchema,
  businessWebsiteStepSchema,
  deviceHandoffStepSchema,
  completionStepSchema,
  failureStepSchema,
]);

export const STEP_TYPES = [
  'consent',
  'form',
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
  // Phase 7 (C96.1).
  'device_handoff',
  'completion',
  'failure',
] as const;

const TERMINAL_STEP_TYPES: ReadonlySet<string> = new Set(['completion', 'failure']);

export const transitionSchema = z
  .strictObject({
    from: stepIdSchema,
    to: stepIdSchema,
    /** JSONLogic rule, kept opaque here; absent means "always". */
    condition: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'Transition' });

export const flowSchema = z
  .strictObject({
    metadata: metadataSchema,
    steps: z.array(stepSchema).min(1, 'a flow needs at least one step'),
    transitions: z.array(transitionSchema),
  })
  .superRefine((flow, ctx) => {
    const types = new Map<string, string>();
    flow.steps.forEach((step, index) => {
      if (types.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate step id "${step.id}"`,
          path: ['steps', index, 'id'],
        });
      } else {
        types.set(step.id, step.type);
      }
    });
    flow.transitions.forEach((transition, index) => {
      for (const end of ['from', 'to'] as const) {
        if (!types.has(transition[end])) {
          ctx.addIssue({
            code: 'custom',
            message: `unknown step id "${transition[end]}"`,
            path: ['transitions', index, end],
          });
        }
      }
      if (TERMINAL_STEP_TYPES.has(types.get(transition.from) ?? '')) {
        ctx.addIssue({
          code: 'custom',
          message: `terminal step "${transition.from}" cannot have outgoing transitions`,
          path: ['transitions', index, 'from'],
        });
      }
    });
  });

export type Flow = z.infer<typeof flowSchema>;
export type FlowStep = z.infer<typeof stepSchema>;
export type FlowStepType = FlowStep['type'];
export type FormField = z.infer<typeof formFieldSchema>;
export type FlowTransition = z.infer<typeof transitionSchema>;

export interface FlowIssue {
  /** RFC 6901 JSON Pointer into the flow, e.g. `/transitions/2/to`; empty for the root (C147.8). */
  pointer: string;
  /** Dotted path into the flow, e.g. `transitions.2.to`; empty for the root. Kept for callers. */
  path: string;
  message: string;
}

/** An RFC 6901 JSON Pointer to `path`: each segment prefixed with `/`, `~` and `/` escaped. */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

export class FlowSpecError extends DomainError {
  readonly issues: readonly FlowIssue[];

  constructor(issues: readonly FlowIssue[]) {
    super('invalid_flow', 'The flow definition is invalid');
    this.issues = issues;
  }
}

export type SafeParseFlowResult =
  { success: true; data: Flow } | { success: false; issues: FlowIssue[] };

export function safeParseFlow(input: unknown): SafeParseFlowResult {
  const parsed = flowSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      pointer: toJsonPointer(issue.path),
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}

/**
 * Validates a flow definition, including the rules JSON Schema cannot express:
 * unique step ids, transitions that reference existing steps, and no
 * transitions out of terminal steps.
 *
 * @throws {FlowSpecError} listing every problem found.
 */
export function parseFlow(input: unknown): Flow {
  const result = safeParseFlow(input);
  if (!result.success) {
    throw new FlowSpecError(result.issues);
  }
  return result.data;
}

/** C252 (Workflow 11B): a flow-spec 1 text field's pattern the restricted grammar refuses. */
export interface V1FieldPatternProblem {
  /** RFC 6901 pointer into the flow, `/steps/<i>/fields/<j>/validation/pattern`. */
  readonly pointer: string;
  readonly code: 'pattern_refused';
  readonly detail: string;
}

/**
 * C252.1 (Workflow 11B): every flow-spec 1 text field pattern C148.3's grammar refuses, in step and
 * field order, with the reason `compilePattern` gives. The API's save and publish rules refuse a
 * write that has one (`pattern_refused`, as the v2 publish rule does), so operator text becomes a
 * pattern only through the linear-time matcher.
 */
export function v1FieldPatternProblems(flow: Flow): readonly V1FieldPatternProblem[] {
  const problems: V1FieldPatternProblem[] = [];
  flow.steps.forEach((step, stepIndex) => {
    if (step.type !== 'form') return;
    step.fields.forEach((field, fieldIndex) => {
      if (field.type !== 'text') return;
      const pattern = field.validation?.pattern;
      if (pattern === undefined) return;
      const compiled = compilePattern(pattern);
      if (!compiled.ok) {
        problems.push({
          pointer: `/steps/${String(stepIndex)}/fields/${String(fieldIndex)}/validation/pattern`,
          code: 'pattern_refused',
          detail: `The pattern is outside the restricted grammar (${compiled.reason})`,
        });
      }
    });
  });
  return problems;
}
