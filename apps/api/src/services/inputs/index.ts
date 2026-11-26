/**
 * C52.3: the values a user enters for a database, AAMVA form, business registry or business
 * website verification (`POST /api/v1/flow/verifications/:id/inputs`). Workflow 5B's KYB types
 * reuse this service unchanged: each type's rules beyond its body schema are a module of this
 * folder (`rules.ts`).
 *
 * In order: the C52.1 preconditions (`requireFlowVerification`, before the body is read); the
 * type's step in the inquiry's pinned flow (a silent AAMVA step answers 409
 * `verification_created_by_server`, C59.6); the body cleaned ({@link cleanInputValues}); the
 * type's body schema (`INPUTS_SCHEMA_BY_API_TYPE`) and its rule, every refusal at once as one 422
 * with a JSON Pointer per member; then, under the C40.6 locks (the inquiry re-checked open and
 * unredacted, the verification re-checked `initiated`), the values sealed to the verification,
 * replacing earlier ones. Values are never echoed, logged or put in a problem; the answer is the
 * flow view, whose `inputs-received` says they were received. No event is published.
 */
import {
  INPUTS_SCHEMA_BY_API_TYPE,
  sanitizeInputValue,
  stepForVerificationType,
  toApiVerificationType,
  verificationConfigSchema,
  type FlowVerificationResource,
  type SupportedVerificationType,
} from '@openverify/contracts';
import { getInquiryTemplateVersion, putEnteredVerificationInputs } from '@openverify/db';
import type { z } from 'zod';
import type { FlowSession } from '../../auth/flow-session.js';
import { UnprocessableContentError, type ProblemFieldError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import {
  requireFlowVerification,
  requireFlowVerificationUnderLock,
} from '../flow-preconditions.js';
import { flowVerificationResource } from '../resources.js';
import { storedFlowView } from '../stored-flow.js';
import { assertNotCreatedByServer } from '../submit/stub.js';
import { aamvaInputRule } from './aamva.js';
import { businessWebsiteInputRule } from './business-website.js';
import { databaseBusinessInputRule } from './database-business.js';
import { databaseInputRule } from './database.js';
import { inputError, type InputRule, type InputRuleContext } from './rules.js';

export { businessRequiredInputs } from './database-business.js';
export type { InputRule, InputRuleContext } from './rules.js';

/** The types whose step collects entered values (C52.3). */
export const INPUT_VERIFICATION_TYPES = [
  'database',
  'aamva',
  'database_business',
  'business_website',
] as const satisfies readonly SupportedVerificationType[];
export type InputVerificationType = (typeof INPUT_VERIFICATION_TYPES)[number];

/** Each form type's rule beyond its body schema. */
export const INPUT_RULES: Readonly<Record<InputVerificationType, InputRule>> = Object.freeze({
  database: databaseInputRule,
  aamva: aamvaInputRule,
  database_business: databaseBusinessInputRule,
  business_website: businessWebsiteInputRule,
});

const isInputType = (type: SupportedVerificationType): type is InputVerificationType =>
  (INPUT_VERIFICATION_TYPES as readonly string[]).includes(type);

/** Each form type's body schema (C52.3), by domain type. */
const INPUT_SCHEMAS: Readonly<Record<InputVerificationType, z.ZodType>> = Object.freeze({
  database: INPUTS_SCHEMA_BY_API_TYPE.database,
  aamva: INPUTS_SCHEMA_BY_API_TYPE.aamva,
  database_business: INPUTS_SCHEMA_BY_API_TYPE['database-business'],
  business_website: INPUTS_SCHEMA_BY_API_TYPE['business-website'],
});

/**
 * C52.3: an entered value as the server keeps it: C0 controls and bidirectional characters
 * removed (`sanitizeInputValue`), then surrounding space trimmed; the members of an object and the
 * items of an array likewise. Other values are kept as they are.
 */
export function cleanInputValues(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeInputValue(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(cleanInputValues);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) => [name, cleanInputValues(member)]),
    );
  }
  return value;
}

/** The refusals of one schema issue: one per unknown member, else one at the issue's path. */
function issueRefusals(issue: z.core.$ZodIssue): ProblemFieldError[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) =>
      inputError([...issue.path.map(String), key], 'is not a member of this body'),
    );
  }
  return [inputError(issue.path.map(String), issue.message)];
}

/**
 * Every refusal of `ctx.values` for a verification of `type`: its body schema's, then its rule's,
 * one per pointer (the first wins).
 */
export function inputRefusals(
  type: InputVerificationType,
  ctx: InputRuleContext,
): ProblemFieldError[] {
  const parsed = INPUT_SCHEMAS[type].safeParse(ctx.values);
  const refusals = [
    ...(parsed.success ? [] : parsed.error.issues.flatMap(issueRefusals)),
    ...INPUT_RULES[type].refusals(ctx),
  ];
  const seen = new Set<string>();
  return refusals.filter((refusal) => {
    const fresh = !seen.has(refusal.pointer);
    seen.add(refusal.pointer);
    return fresh;
  });
}

/**
 * C52.3: enters the values of the session's verification, replacing earlier ones, and answers its
 * flow view.
 * @throws {UnprocessableContentError} 422 for a type that takes no values, a flow without the
 *   type's step, or refused values (`errors`, a pointer per member).
 * @throws {Phase5ProblemError} 409 `verification_created_by_server` for a silent AAMVA attempt.
 * @throws the C52.1 precondition errors (404, 409, 410).
 */
export async function enterVerificationInputs(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  body: Readonly<Record<string, unknown>>,
): Promise<FlowVerificationResource> {
  const { inquiry, verification } = await requireFlowVerification(deps, session, verificationId, {
    types: INPUT_VERIFICATION_TYPES,
  });
  const { type } = verification;
  const apiType = toApiVerificationType(type);
  if (!isInputType(type)) {
    throw new UnprocessableContentError(`A ${apiType} verification takes no entered values.`);
  }
  const version = await getInquiryTemplateVersion(
    deps.db,
    session.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  if (version === null) {
    throw new Error(`Inquiry ${inquiry.id} has no template version`);
  }
  const step = stepForVerificationType(storedFlowView(version.flow), type);
  if (step === undefined) {
    throw new UnprocessableContentError(`The flow has no ${apiType} step.`);
  }
  assertNotCreatedByServer(step);
  const parsedConfig = verificationConfigSchema.safeParse(version.verificationConfig);
  const config = parsedConfig.success ? parsedConfig.data[apiType] : undefined;
  const values = cleanInputValues(body) as Readonly<Record<string, unknown>>;
  const refusals = inputRefusals(type, { step, config, values });
  if (refusals.length > 0) {
    throw new UnprocessableContentError('The entered values were refused.', refusals);
  }
  await deps.db.transaction(async (tx) => {
    const locked = await requireFlowVerificationUnderLock(tx, session, verificationId);
    await putEnteredVerificationInputs(tx, session.environmentId, {
      verificationId,
      inquiryId: locked.verification.inquiryId,
      values,
      at: deps.clock.now(),
    });
  });
  return flowVerificationResource(deps, deps.db, verification, step, config);
}
