/**
 * C127.4: the list actions. `get_list_match` answers `true`, `false` or `null`: `false` only when
 * every configured list was screened by its stated method, and `null` with its Phase 7 reason when a
 * list could not be read, so an unscreened list never reads as "not listed". It calls C99.1's engine,
 * so its probes are the kinds that engine reads on demand, and a face or background list is read
 * through a custom-list report instead.
 */
import {
  checkStageSchema,
  listItemStatusSchema,
  listMatchMethodSchema,
  listUnscreenedReasonSchema,
} from '@openverify/core';
import { z } from 'zod';
import {
  actionOutcomeSchema,
  actionReferenceSchema,
  actionTemplateSchema,
  adverseConfigShape,
  decisionFollowsOutcome,
  decisionIdSchema,
  plain,
} from './common.js';

const text = actionTemplateSchema;

/** C99.4's probes, each value a template. The numbers of a geolocation stay templates too. */
const listProbeTemplateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('browser-fingerprint'), value: text }),
  z.strictObject({ kind: z.literal('device-fingerprint'), value: text }),
  z.strictObject({ kind: z.literal('country'), 'country-code': text }),
  z.strictObject({ kind: z.literal('email-address'), value: text }),
  z.strictObject({ kind: z.literal('geolocation'), latitude: text, longitude: text }),
  z.strictObject({
    kind: z.literal('government-id-number'),
    'id-number': text,
    'id-class': text.optional(),
  }),
  z.strictObject({
    kind: z.literal('field'),
    'field-key': actionReferenceSchema,
    'field-value': text,
  }),
  z.strictObject({ kind: z.literal('ip-address'), value: text }),
  z.strictObject({ kind: z.literal('name'), 'name-first': text, 'name-last': text }),
  z.strictObject({ kind: z.literal('phone-number'), value: text }),
  z.strictObject({ kind: z.literal('string'), value: text }),
]);

/** C127.4: `error` is the default, and no choice reads an unscreened list as `false`. */
export const GET_LIST_MATCH_ON_UNSCREENED = ['error', 'null'] as const;

export const getListMatchConfigSchema = z.strictObject({
  /** Without it, every active list of the probe's kind. */
  'list-ids': z.array(actionReferenceSchema).min(1).max(50).optional(),
  probe: listProbeTemplateSchema,
  'on-unscreened': z.enum(GET_LIST_MATCH_ON_UNSCREENED).default('error'),
});
export type GetListMatchConfig = z.infer<typeof getListMatchConfigSchema>;

/** H10: each match with what a decision needs to know of it; the value stays on the item. */
const listMatchEvidenceSchema = z.strictObject({
  'list-item-id': z.string().min(1).max(64),
  method: listMatchMethodSchema,
  tier: z.enum(['R', 'H']),
  stage: checkStageSchema,
  confidence: z.number().min(0).max(1).nullable(),
  approximate: z.boolean(),
});

interface ListMatchAnswer {
  readonly matched: boolean | null;
  readonly 'null-reason': string | null;
}

/** ADR 0007: an unknown carries its reason, and only an unknown does. */
const reasonFollowsNull = (value: ListMatchAnswer): boolean =>
  (value.matched === null) === (value['null-reason'] !== null);

export const getListMatchOutputSchema = z
  .strictObject({
    matched: plain(z.boolean().nullable()),
    'null-reason': plain(listUnscreenedReasonSchema.nullable()),
    matches: plain(z.array(listMatchEvidenceSchema)),
  })
  .refine(reasonFollowsNull, {
    message: 'an unknown answer names its reason, and only an unknown one does',
    path: ['null-reason'],
  });
export type GetListMatchOutput = z.infer<typeof getListMatchOutputSchema>;

/** C97.1's item values, each a template, for the kinds a value can be written to. */
const listItemTemplateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('browser-fingerprint'), value: text }),
  z.strictObject({ kind: z.literal('device-fingerprint'), value: text }),
  z.strictObject({ kind: z.literal('country'), 'country-code': text }),
  z.strictObject({
    kind: z.literal('email-address'),
    value: text,
    'match-type': z.enum(['email_address', 'domain']).optional(),
  }),
  z.strictObject({
    kind: z.literal('geolocation'),
    latitude: text,
    longitude: text,
    'radius-meters': text,
  }),
  z.strictObject({
    kind: z.literal('government-id-number'),
    'id-number': text,
    'id-class': text.optional(),
  }),
  z.strictObject({ kind: z.literal('field'), 'field-value': text }),
  z.strictObject({ kind: z.literal('ip-address'), value: text }),
  z.strictObject({ kind: z.literal('name'), 'name-first': text, 'name-last': text }),
  z.strictObject({ kind: z.literal('phone-number'), value: text }),
  z.strictObject({ kind: z.literal('string'), value: text }),
]);

export const addListItemConfigSchema = z.strictObject({
  'list-id': actionReferenceSchema,
  item: listItemTemplateSchema,
  ...adverseConfigShape,
});
export type AddListItemConfig = z.infer<typeof addListItemConfigSchema>;

const DECISION_RULE = { message: 'a step that changed nothing made no decision' };

export const addListItemOutputSchema = z
  .strictObject({
    'list-item-id': plain(z.string().regex(/^li[a-z]{1,3}_/)),
    /** C127.4: the list's match-key uniqueness makes a repeat `no_change`. */
    outcome: plain(actionOutcomeSchema),
    /** `null` on a `no_change`, and on a list whose purpose is not adverse. */
    'decision-id': plain(decisionIdSchema),
  })
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type AddListItemOutput = z.infer<typeof addListItemOutputSchema>;

export const addFaceListItemConfigSchema = z.strictObject({
  'list-id': actionReferenceSchema,
  'inquiry-id': actionReferenceSchema,
  ...adverseConfigShape,
});
export type AddFaceListItemConfig = z.infer<typeof addFaceListItemConfigSchema>;

export const addFaceListItemOutputSchema = z
  .strictObject({
    'list-item-id': plain(z.string().regex(/^lifc_/)),
    /** `pending` until the embed job makes it matchable (outcome 25). */
    status: plain(listItemStatusSchema),
    outcome: plain(actionOutcomeSchema),
    'decision-id': plain(decisionIdSchema),
  })
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type AddFaceListItemOutput = z.infer<typeof addFaceListItemOutputSchema>;
