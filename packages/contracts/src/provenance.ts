/**
 * C235.1 (Phase 11, Workflow 11A Stage 1a; ours): `provenance`, the machine-readable mark on every
 * object a Connect redemption made or filled. A copy is never a fresh pass (ADR 0010): a cloned
 * inquiry, verification, check or file says so here and with `cloned: true`, and a hydrated object
 * names the keys that were filled. The source's object ids are not disclosed; the share token links
 * the two sides' audit entries.
 */
import { z } from 'zod';
import { environmentKindSchema } from './environments.js';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

export const PROVENANCE_KINDS = ['connect-clone', 'connect-hydrate'] as const;
export const provenanceKindSchema = z.enum(PROVENANCE_KINDS);
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;

const sourceOrganizationName = z.string().min(1).max(255);
/**
 * C237.6 (2): set on the destination's copies when the destination-side consent they rest on is
 * withdrawn; from then on the copy no longer counts under `accept-cloned-results` (C235.4).
 */
const consentWithdrawnAt = timestampSchema.nullable().optional();

/** A cloned inquiry, verification, check or file: the source's own status and times, kept. */
export const connectCloneProvenanceSchema = z.strictObject({
  kind: z.literal('connect-clone'),
  'share-token-id': idSchema('cnst'),
  'source-organization-name': sourceOrganizationName,
  'source-environment-kind': environmentKindSchema,
  /** When the source created the object the copy was made from. */
  'source-created-at': timestampSchema,
  /** The source object's status when it was copied: an inquiry's, a verification's or a check's. */
  'source-status': z.string().min(1).max(64),
  'cloned-at': timestampSchema,
  'consent-withdrawn-at': consentWithdrawnAt,
});
export type ConnectCloneProvenance = z.infer<typeof connectCloneProvenanceSchema>;

/** A hydrated account, inquiry or transaction: which keys were filled, never their values. */
export const connectHydrateProvenanceSchema = z.strictObject({
  kind: z.literal('connect-hydrate'),
  'share-token-id': idSchema('cnst'),
  'source-organization-name': sourceOrganizationName,
  'hydrated-at': timestampSchema,
  fields: z.array(z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/)).max(1000),
  'consent-withdrawn-at': consentWithdrawnAt,
});
export type ConnectHydrateProvenance = z.infer<typeof connectHydrateProvenanceSchema>;

export const provenanceSchema = z.discriminatedUnion('kind', [
  connectCloneProvenanceSchema,
  connectHydrateProvenanceSchema,
]);
export type Provenance = z.infer<typeof provenanceSchema>;

/** Whether `provenance` marks a copy of another organisation's object. */
export function isCloneProvenance(
  provenance: Provenance | null | undefined,
): provenance is ConnectCloneProvenance {
  return provenance?.kind === 'connect-clone';
}
