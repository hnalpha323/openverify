/**
 * C238.5 (Workflow 11A, `api-consent`): client-side redemption starts only from an inquiry the
 * destination's backend creates with `POST /api/v1/inquiries` and `meta.share-token-id`. Checks, in
 * order: the token inbound to the caller's environment (the one generic 404 otherwise, C232.8),
 * `created` and unexpired (409 `share_token_already_redeemed`, `share_token_expired`,
 * `share_token_not_redeemable`), from an inquiry or a verification (422 `share_redeem_mode_invalid`,
 * C234.11), the template with a destination-side `share_consent` step (422
 * `share_consent_step_missing`), and one inquiry per token (409 `share_token_in_use`, recorded in
 * `reserved_inquiry_id`). The inquiry is created and the token reserved in one transaction, under the
 * token's row lock. There is no template-id entry and no `share-token` query parameter anywhere: the
 * person reaches the inquiry through today's session or one-time-link credentials.
 *
 * The reservation writes the token's row in the source environment, so it goes through
 * `cross-tenant.ts`'s entry point `reserveInboundShareToken` (built by integration-11a from
 * `api-consent`'s contract deviation).
 *
 * `foundation-11a` placed the hook (Stage 1b (K): the create route calls this instead of
 * `createInquiry` when `meta.share-token-id` is present); `api-consent` builds it (its file). While
 * the install switch is off the token is one the caller may not see: the one generic 404.
 */
import type { CreateInquiryAttributes, InquiryResource } from '@openverify/contracts';
import { getInquiryTemplate, type ConnectShareToken, type Db } from '@openverify/db';
import { isFlowV2, safeParseAnyFlow } from '@openverify/flow-spec';
import type { CreateInquiryMeta } from '../../flow-engine/expiry.js';
import type { ApiDependencies } from '../context.js';
import { createInquiryInTx, inquiryResourceFor, type Acting } from '../inquiries.js';
import { crossTenant, type CrossTenantCaller } from './cross-tenant.js';
import { connectNotFound } from './not-found.js';
import { ConnectProblemError } from './problems.js';
import { connectEnabled } from './switch.js';

/** What a client-side redemption needs of the token's side. */
export interface ClientSideCrossTenant {
  getInboundShareToken(db: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  lockInboundShareToken(tx: Db, caller: CrossTenantCaller, id: string): Promise<ConnectShareToken>;
  /** C238.5: sets `reserved_inquiry_id` on a token the caller holds FOR UPDATE. */
  reserveInboundShareToken(
    tx: Db,
    caller: CrossTenantCaller,
    token: ConnectShareToken,
    inquiryId: string,
  ): Promise<ConnectShareToken>;
}

/** The production binding: `cross-tenant.ts`'s entry points. */
export const clientSideCrossTenant: ClientSideCrossTenant = {
  getInboundShareToken: (db, caller, id) => crossTenant.getInboundShareToken(db, caller, id),
  lockInboundShareToken: (tx, caller, id) => crossTenant.lockInboundShareToken(tx, caller, id),
  reserveInboundShareToken: (tx, caller, token, inquiryId) =>
    crossTenant.reserveInboundShareToken(tx, caller, token, inquiryId),
};

/** C238.5: the status a token must be in to be reserved. */
function refuseStatus(token: ConnectShareToken, now: Date): void {
  switch (token.status) {
    case 'pending':
    case 'redeemed':
      throw new ConnectProblemError(
        'share_token_already_redeemed',
        'The share token was already redeemed.',
      );
    case 'expired':
      throw new ConnectProblemError('share_token_expired', 'The share token has expired.');
    case 'failed':
      throw new ConnectProblemError(
        'share_token_not_redeemable',
        'The share token failed and cannot be redeemed.',
      );
    case 'created':
      if (token.expiresAt.getTime() <= now.getTime()) {
        throw new ConnectProblemError('share_token_expired', 'The share token has expired.');
      }
  }
}

const inUse = () =>
  new ConnectProblemError('share_token_in_use', 'The share token is reserved for another inquiry.');

/** Creates the inquiry and reserves the token for it, in one transaction. */
export async function createInquiryWithShareToken(
  deps: ApiDependencies,
  acting: Acting,
  attributes: CreateInquiryAttributes,
  meta: CreateInquiryMeta & { 'share-token-id'?: string | undefined },
  port: ClientSideCrossTenant = clientSideCrossTenant,
): Promise<InquiryResource> {
  if (!connectEnabled(deps.connect)) {
    throw connectNotFound();
  }
  const { 'share-token-id': tokenId = '', ...inquiryMeta } = meta;
  const now = deps.clock.now();
  const caller: CrossTenantCaller = {
    organizationId: acting.ctx.organizationId,
    environmentId: acting.ctx.environmentId,
    environmentKind: acting.environmentKind,
  };
  const seen = await port.getInboundShareToken(deps.db, caller, tokenId);
  refuseStatus(seen, now);
  if (seen.sourceType !== 'inquiry' && seen.sourceType !== 'verification') {
    throw new ConnectProblemError(
      'share_redeem_mode_invalid',
      'Only an inquiry or a verification can fill an inquiry.',
    );
  }
  if (seen.reservedInquiryId !== null) {
    throw inUse();
  }
  const template = await getInquiryTemplate(
    deps.db,
    caller.environmentId,
    attributes['inquiry-template-id'],
  );
  const parsed = template === null ? null : safeParseAnyFlow(template.currentVersion.flow);
  const hasDestinationStep =
    parsed?.success === true &&
    isFlowV2(parsed.data) &&
    parsed.data.steps.some((step) => step.type === 'share_consent' && step.side === 'destination');
  if (template !== null && !hasDestinationStep) {
    throw new ConnectProblemError(
      'share_consent_step_missing',
      'The template has no destination-side share_consent step.',
    );
  }
  const { inquiry, staged } = await deps.db.transaction(async (tx) => {
    const token = await port.lockInboundShareToken(tx, caller, seen.id);
    refuseStatus(token, deps.clock.now());
    if (token.reservedInquiryId !== null) {
      throw inUse();
    }
    const created = await createInquiryInTx(tx, deps, acting, attributes, inquiryMeta);
    await port.reserveInboundShareToken(tx, caller, token, created.inquiry.id);
    return created;
  });
  await deps.events.dispatch(staged);
  return inquiryResourceFor(inquiry, [], acting.mask);
}
