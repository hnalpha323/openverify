/**
 * C151.5 (review P14): the `step` member of the session, sent only to a client that declared spec
 * 2: an allowlist of what the renderer needs. Never a step's `name`, never `onFallback` or
 * `prefillFrom` (the session's `values` carries the prefilled value), never a branch or an action,
 * so no route condition, threshold or signal name reaches an end user. `clientViewOf` of
 * `../client-view.ts` builds it.
 */
import { z } from 'zod';
import {
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
import { FLOW_V2_CAPS } from './common.js';
import { componentSchema } from './components.js';
import { captureMethodsByDeviceSchema } from './steps.js';

const byDevice = { captureMethodsByDevice: captureMethodsByDeviceSchema.optional() };

/** A screen as the person's client sees it: its components, with copy keys, validation and rules. */
export const screenClientViewSchema = z.strictObject({
  id: stepIdSchema,
  type: z.literal('screen'),
  components: z.array(componentSchema).min(1).max(FLOW_V2_CAPS.componentsPerScreen),
});

/**
 * C207.2, C221.1 (Workflow 10C): the MRZ's access-key fields of the inquiry's decided government
 * ID, as the MRZ holds them: the document number (upper case, digits and fillers), and the birth
 * and expiry dates as YYMMDD (a birth date may hold fillers for unknown positions). Personal data:
 * served only to an SDK client, only while the `nfc` step is the current position, never to the web
 * flow, and masked in every exit (`NFC_PREFILL_MRZ_MEMBER` of `@openverify/contracts`).
 */
export const nfcPrefillMrzSchema = z
  .strictObject({
    documentNumber: z.string().regex(/^[A-Z0-9<]{1,30}$/, 'must be MRZ characters'),
    birthDate: z.string().regex(/^[0-9<]{6}$/, 'must be YYMMDD as the MRZ holds it'),
    expiryDate: z.string().regex(/^[0-9]{6}$/, 'must be YYMMDD'),
  })
  .meta({ pii: true });
export type NfcPrefillMrz = z.infer<typeof nfcPrefillMrzSchema>;

/**
 * C207.1 (Workflow 10C; review F26): the `nfc` step as a client sees it, a schema of its own over
 * the v1 step (which validates flows and takes none of these):
 * - `fallbackAvailable`: the step has an `exhausted` edge, so "use another way" may be offered
 *   (C207.9); a pure fact of the flow, filled by `clientViewOf`;
 * - `sandboxChipAvailable`: the sandbox test chip is offered (C208.2); the API's session builder
 *   sets it only in a sandbox environment whose trust store holds the current test anchor;
 * - `prefillMrz`: see {@link nfcPrefillMrzSchema}; the session builder's, for an SDK client only.
 *
 * All three change what a person is asked or told, so none is appearance-only (C194.4). Spec 2
 * carries them without a version change: no client released or built before Workflow 10C renders
 * an `nfc` step (the SDK showed it as unsupported, and the web flow ships with the server).
 */
export const nfcClientViewSchema = nfcStepSchema.safeExtend({
  fallbackAvailable: z.boolean().optional(),
  sandboxChipAvailable: z.boolean().optional(),
  prefillMrz: nfcPrefillMrzSchema.optional(),
});
export type NfcClientView = z.infer<typeof nfcClientViewSchema>;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest');

/**
 * C238.3 (Phase 11, Workflow 11A; ours): a `share_consent` step as the person's client sees it,
 * composed by the server and never by the client: the recipient's and the source's names as they
 * are shown, the share's categories, the text (the logical form: placeholders filled, NFC) with its
 * SHA-256 and the copy keys it came from, and, when the share carries biometric data, the separate
 * biometric text the person ticks. No connection, token or source object id, no withdrawal contact
 * and no validity is in it: `{withdraw}` and `{expires}` are filled into the text. The client echoes
 * the digests of what it displayed (C238.4).
 */
export const shareConsentClientViewSchema = z
  .strictObject({
    id: stepIdSchema,
    type: z.literal('share_consent'),
    side: z.enum(['source', 'destination']),
    recipientName: z.string().min(1).max(255),
    sourceName: z.string().min(1).max(255),
    categories: z
      .array(z.string().regex(/^[a-z][a-z-]{0,39}$/))
      .min(1)
      .max(6),
    text: z.strictObject({
      locale: z.string().max(35),
      body: z.string().min(1).max(20_000),
      sha256: sha256Schema,
      keys: z.array(z.string().max(120)).min(1).max(8),
    }),
    biometric: z
      .strictObject({ body: z.string().min(1).max(20_000), sha256: sha256Schema })
      .optional(),
  })
  .meta({ id: 'ShareConsentClientView' });
export type ShareConsentClientView = z.infer<typeof shareConsentClientViewSchema>;

export const clientStepViewSchema = z.discriminatedUnion('type', [
  consentStepSchema,
  governmentIdStepSchema.safeExtend(byDevice),
  selfieStepSchema,
  documentStepSchema.safeExtend(byDevice),
  phoneOtpStepSchema,
  emailOtpStepSchema,
  databaseStepSchema,
  aamvaStepSchema,
  nfcClientViewSchema,
  cryptoWalletStepSchema,
  databaseBusinessStepSchema,
  businessWebsiteStepSchema,
  deviceHandoffStepSchema,
  completionStepSchema,
  failureStepSchema,
  screenClientViewSchema,
  // C238.3 (Workflow 11A).
  shareConsentClientViewSchema,
]);

export type ClientStepView = z.infer<typeof clientStepViewSchema>;
export type ScreenClientView = z.infer<typeof screenClientViewSchema>;
