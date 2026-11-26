/**
 * C243.1 (Phase 11, Workflow 11A Stage 1a (U)): the configs and outputs of Connect's three workflow
 * actions, frozen for `workflow-connect`, which builds their handlers and registry entries in
 * `apps/api/src/workflows/actions/connect/`. Each is idempotent by run step (Phase 8's effect key),
 * names the workflow as its audit actor, and outputs the share token as the run scope reads it: ids,
 * statuses and reasons, never shared data (`source-data` is a peek's alone). An id member takes a
 * reference (`{{trigger.data.id}}`) or a literal id, which the handler checks as the route does.
 * An automatic redemption still needs a valid destination-side consent record (C243.4).
 */
import {
  SHARE_REDEEM_ROUTE_MODES,
  SHARE_TOKEN_EXPIRES_IN_SECONDS,
  shareFieldMappingSchema,
  shareTokenExpiryReasonSchema,
  shareTokenStatusSchema,
  type EventName,
} from '@openverify/contracts';
import type { ApiScope } from '@openverify/core';
import { z } from 'zod';
import { actionReferenceSchema, plain } from './common.js';
import type { ActionContract } from './contracts.js';
import type { ConnectActionKey } from './registry.js';

const shareTokenIdSchema = z.string().regex(/^cnst_/, 'must be a share token id');

/** `create_share_token`: C232.1's body, each id a reference or a literal id. */
export const createShareTokenConfigSchema = z.strictObject({
  'connection-id': actionReferenceSchema,
  'source-id': actionReferenceSchema,
  'consent-record-id': actionReferenceSchema,
  'expires-in-seconds': z
    .union([
      z.int().min(SHARE_TOKEN_EXPIRES_IN_SECONDS.min).max(SHARE_TOKEN_EXPIRES_IN_SECONDS.max),
      actionReferenceSchema,
    ])
    .optional(),
});
export type CreateShareTokenConfig = z.infer<typeof createShareTokenConfigSchema>;

export const createShareTokenOutputSchema = z.strictObject({
  'share-token-id': plain(shareTokenIdSchema),
  status: plain(shareTokenStatusSchema),
  'expires-at': plain(z.string()),
});
export type CreateShareTokenOutput = z.infer<typeof createShareTokenOutputSchema>;

/**
 * `redeem_share_token`: C234.1's redeem body, flattened (`destination-id` beside `meta`), with no
 * mode of its own: `fill-inquiry` is never a workflow's.
 */
export const redeemShareTokenConfigSchema = z.strictObject({
  'share-token-id': actionReferenceSchema,
  'destination-id': actionReferenceSchema.optional(),
  meta: z.strictObject({
    'field-mappings': z.array(shareFieldMappingSchema).max(600).optional(),
    'account-id': actionReferenceSchema.optional(),
    'auto-create-account-reference-id': actionReferenceSchema.optional(),
    'auto-create-account-type-id': actionReferenceSchema.optional(),
    'inquiry-template-id': actionReferenceSchema.optional(),
    'inquiry-template-version-id': actionReferenceSchema.optional(),
    'inquiry-id': actionReferenceSchema.optional(),
    'destination-consent-record-id': actionReferenceSchema,
  }),
});
export type RedeemShareTokenConfig = z.infer<typeof redeemShareTokenConfigSchema>;

/** The redemption is accepted (the token is `pending`); its job ends it later (C234.2). */
export const redeemShareTokenOutputSchema = z.strictObject({
  'share-token-id': plain(shareTokenIdSchema),
  status: plain(shareTokenStatusSchema),
  'redeem-mode': plain(z.enum(SHARE_REDEEM_ROUTE_MODES)),
});
export type RedeemShareTokenOutput = z.infer<typeof redeemShareTokenOutputSchema>;

/** `expire_share_token`: C232.4, the source only. */
export const expireShareTokenConfigSchema = z.strictObject({
  'share-token-id': actionReferenceSchema,
});
export type ExpireShareTokenConfig = z.infer<typeof expireShareTokenConfigSchema>;

export const expireShareTokenOutputSchema = z.strictObject({
  'share-token-id': plain(shareTokenIdSchema),
  status: plain(shareTokenStatusSchema),
  'expiry-reason': plain(shareTokenExpiryReasonSchema.nullable()),
});
export type ExpireShareTokenOutput = z.infer<typeof expireShareTokenOutputSchema>;

export const CONNECT_ACTION_CONTRACTS = Object.freeze({
  create_share_token: {
    config: createShareTokenConfigSchema,
    output: createShareTokenOutputSchema,
  },
  redeem_share_token: {
    config: redeemShareTokenConfigSchema,
    output: redeemShareTokenOutputSchema,
  },
  expire_share_token: {
    config: expireShareTokenConfigSchema,
    output: expireShareTokenOutputSchema,
  },
} as const satisfies Record<ConnectActionKey, ActionContract>);

/** C243.1, C240.1: the scope each needs and the events it can cause (C118.8's warning). */
export interface ConnectActionRow {
  readonly scope: ApiScope;
  readonly emits: readonly EventName[];
}

export const CONNECT_ACTION_ROWS: Readonly<Record<ConnectActionKey, ConnectActionRow>> =
  Object.freeze({
    create_share_token: {
      scope: 'connect-share-tokens:write',
      emits: ['connect/share-token.outbound-created'],
    },
    redeem_share_token: {
      scope: 'connect-share-tokens:redeem',
      emits: ['connect/share-token.inbound-redeemed', 'connect/share-token.failed'],
    },
    expire_share_token: {
      scope: 'connect-share-tokens:write',
      emits: ['connect/share-token.expired'],
    },
  });
