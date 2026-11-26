/**
 * C55: what every one-time code request reads before it acts: the verification's channel, its
 * step in the inquiry's pinned flow (the countries, VoIP and code length), the environment, and
 * the flow view a request answers with.
 */
import {
  OTP_CODE_LENGTH,
  stepForVerificationType,
  toApiVerificationType,
  verificationConfigSchema,
  type FlowVerificationResource,
} from '@openverify/contracts';
import {
  getEnvironment,
  getInquiryTemplateVersion,
  getEffectiveConsent,
  type ConsentHolder,
  getOrganization,
  type Db,
  type Environment,
  type Inquiry,
  type OtpChannel,
  type VerificationType,
  type VerificationWithChecks,
} from '@openverify/db';
import type { Flow, FlowStep } from '@openverify/flow-spec';
import { UnprocessableContentError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { flowVerificationResource } from '../resources.js';
import { storedFlowView } from '../stored-flow.js';
import { otpMessageLocale, type OtpMessageLocale } from './messages.js';

/** The verification types that confirm a destination with a code. */
export type OtpVerificationType = Extract<VerificationType, 'phone_number' | 'email_address'>;

/** A phone or email step of the flow-spec. */
export type OtpStep = Extract<FlowStep, { type: 'phone_otp' | 'email_otp' }>;

/** The channel a type's codes go by (C55.10). */
export function channelOf(type: OtpVerificationType): OtpChannel {
  return type === 'phone_number' ? 'sms' : 'email';
}

export interface OtpContext {
  channel: OtpChannel;
  step: OtpStep;
  /** The step's `codeLength`, six by default (C55.2). */
  codeLength: number;
  environment: Environment;
  /** The inquiry's pinned version: its flow and verification config. */
  pinned: { flow: Flow; verificationConfig: unknown };
}

const isOtpType = (type: VerificationType): type is OtpVerificationType =>
  type === 'phone_number' || type === 'email_address';

/**
 * The context of `verification` (a phone or email verification of `inquiry`).
 * @throws {UnprocessableContentError} when its pinned flow has no step of its type.
 */
export async function otpContextOf(
  deps: ApiDependencies,
  inquiry: Inquiry,
  verification: VerificationWithChecks,
): Promise<OtpContext> {
  const version = await getInquiryTemplateVersion(
    deps.db,
    inquiry.environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const environment = await getEnvironment(deps.db, inquiry.environmentId);
  if (version === null || environment === null || !isOtpType(verification.type)) {
    throw new Error(`Inquiry ${inquiry.id} has no template version or environment`);
  }
  const flow = storedFlowView(version.flow);
  const step = stepForVerificationType(flow, verification.type);
  if (step?.type !== 'phone_otp' && step?.type !== 'email_otp') {
    throw new UnprocessableContentError(
      `The flow has no ${toApiVerificationType(verification.type)} step.`,
    );
  }
  return {
    channel: channelOf(verification.type),
    step,
    codeLength: step.codeLength ?? OTP_CODE_LENGTH.default,
    environment,
    pinned: { flow, verificationConfig: version.verificationConfig },
  };
}

/** The flow view of `row` (C52.2), with its guidance, read with `db`. */
export async function otpFlowView(
  deps: ApiDependencies,
  db: Db,
  context: OtpContext,
  row: VerificationWithChecks,
): Promise<FlowVerificationResource> {
  const config = verificationConfigSchema.safeParse(context.pinned.verificationConfig);
  return flowVerificationResource(
    deps,
    db,
    row,
    context.step,
    config.success ? config.data[toApiVerificationType(row.type)] : undefined,
  );
}

/** The organization's name, as the messages name it before sanitizing (C55.9). */
export async function organizationNameOf(
  deps: ApiDependencies,
  environment: Environment,
): Promise<string> {
  return (await getOrganization(deps.db, environment.organizationId))?.name ?? '';
}

/**
 * The language of the consent the user gave, which the messages are written in. C94.6 (Workflow
 * 7A, V03): the consent of the session that asked for the code.
 */
export async function messageLocaleOf(
  deps: ApiDependencies,
  holder: ConsentHolder,
): Promise<OtpMessageLocale> {
  const consent = await getEffectiveConsent(deps.db, holder);
  return otpMessageLocale(consent?.locale);
}
