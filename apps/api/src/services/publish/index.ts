/**
 * C50.4, C54.1: the publish rules that need server state, one async hook per Phase 5 type
 * (`services/publish/<api-type>.ts`), run when a template is created and when a version is
 * published (never on drafts or stored versions), after the pure C50.4 rules
 * (`templatePublishProblems`): the OTP channel guard (`otp_channel_not_configured`, C55.10) and,
 * in a production environment, a `database` or `aamva` step whose provider kind is unbound, or an
 * `nfc` step while the trust store holds no non-sandbox anchor (`provider_not_configured`, unless
 * the type sets `accept-review-without-provider`, H28). A hook runs only for a type whose step
 * the flow holds; each problem points into the template attributes.
 */
import {
  isVerificationStep,
  STEP_VERIFICATION_TYPES,
  type VerificationConfig,
} from '@openverify/contracts';
import type { Db } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { EnvironmentKind } from '../../ports.js';
import type { Phase5VerificationType } from '../attributes/index.js';
import type { ApiDependencies } from '../context.js';
import { aamvaPublish } from './aamva.js';
import { businessWebsitePublish } from './business-website.js';
import { cryptoWalletPublish } from './crypto-wallet.js';
import { databaseBusinessPublish } from './database-business.js';
import { UnprocessableContentError } from '../../errors.js';
import { themeSetPublishProblems } from '../themes/publish.js';
import { databasePublish } from './database.js';
import { documentPublish } from './document.js';
import { emailAddressPublish } from './email-address.js';
import { governmentIdNfcPublish } from './government-id-nfc.js';
import { phoneNumberPublish } from './phone-number.js';

/** What a publish hook reads. */
export interface PublishContext {
  deps: ApiDependencies;
  /** The request's database, or the transaction that publishes. */
  db: Db;
  environment: { id: string; kind: EnvironmentKind };
  flow: Flow;
  config: VerificationConfig;
  /**
   * C160.7, C154.9 (Workflow 9A Stage 1b (H)): the version's `theme-set-id`, which
   * `themeSetPublishProblems` (`services/themes/`, `api-themes`) checks beside the hooks; absent, no
   * check (a caller from before 9A). `api-templates` passes it with the version it publishes.
   */
  themeSetId?: string | null;
}

/** One broken rule: its code, a JSON Pointer into the template attributes and what is wrong. */
export interface PublishHookProblem {
  code: 'otp_channel_not_configured' | 'provider_not_configured';
  /** Such as `/flow/steps/4`. */
  pointer: string;
  detail: string;
}

/** One type's publish rules (C50.4). */
export interface PublishHook {
  problems(ctx: PublishContext): Promise<PublishHookProblem[]>;
}

export const PUBLISH_HOOKS: Readonly<Record<Phase5VerificationType, PublishHook>> = Object.freeze({
  document: documentPublish,
  database: databasePublish,
  aamva: aamvaPublish,
  phone_number: phoneNumberPublish,
  email_address: emailAddressPublish,
  government_id_nfc: governmentIdNfcPublish,
  crypto_wallet: cryptoWalletPublish,
  database_business: databaseBusinessPublish,
  business_website: businessWebsitePublish,
});

/**
 * Every problem of the hooks of the types whose step the flow holds, in step order.
 * @throws {UnprocessableContentError} first, when the version names a theme set that is not an
 * active set of its environment (C160.7, `themeSetPublishProblems`, `api-themes`).
 */
export async function publishHookProblems(ctx: PublishContext): Promise<PublishHookProblem[]> {
  if (ctx.themeSetId !== undefined) {
    const theme = await themeSetPublishProblems(ctx.db, {
      environmentId: ctx.environment.id,
      themeSetId: ctx.themeSetId,
    });
    const [refused] = theme;
    if (refused !== undefined) {
      throw new UnprocessableContentError(
        refused.detail,
        theme.map(({ pointer, detail }) => ({
          location: 'body',
          pointer: `/data/attributes${pointer}`,
          detail,
        })),
      );
    }
  }
  const problems: PublishHookProblem[] = [];
  const asked = new Set<string>();
  for (const step of ctx.flow.steps) {
    if (!isVerificationStep(step)) {
      continue;
    }
    const type = STEP_VERIFICATION_TYPES[step.type];
    if (type === 'government_id' || type === 'selfie' || asked.has(type)) {
      continue;
    }
    asked.add(type);
    problems.push(...(await PUBLISH_HOOKS[type].problems(ctx)));
  }
  return problems;
}
