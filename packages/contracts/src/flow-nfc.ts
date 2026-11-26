/**
 * Phase 10, Workflow 10C Stage 1a (contracts-10c), family (N): NFC on the flow API (C207.9, C208,
 * C221.1). The device reads and the server verifies (ADR 0009, C207.11): a client-unable report is
 * self-asserted and never passes, and a sandbox chip proves the flow and the server's checks,
 * never a reader (C208.4).
 */
import { z } from 'zod';
import { ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES } from './chip-challenges.js';
import { maxUploadBytes } from './files.js';
import { idSchema } from './ids.js';

/**
 * C207.9: why a client says it cannot read a document chip. Every reason is self-reported:
 * - `nfc_unavailable`: the phone has no NFC hardware;
 * - `reader_not_installed`: the host app installed no chip reader;
 * - `nfc_disabled_declined`: NFC is off and the person chose another way;
 * - `platform_unsupported`: the platform cannot read a chip at all (the web flow's reason);
 * - `read_failed`: the client can read chips, but its reads of this one did not finish (the SDK
 *   sends it when the person takes another way after the step's chip challenges are spent).
 */
export const CLIENT_UNABLE_REASONS = Object.freeze([
  'nfc_unavailable',
  'reader_not_installed',
  'nfc_disabled_declined',
  'platform_unsupported',
  'read_failed',
] as const);
export const clientUnableReasonSchema = z.enum(CLIENT_UNABLE_REASONS);
export type ClientUnableReason = z.infer<typeof clientUnableReasonSchema>;

/**
 * C207.9: `POST /api/v1/flow/verifications/:id/client-unable`, accepted only for the current step
 * of type `nfc`, at most once per verification (409 `client_unable_not_allowed` otherwise).
 */
export const flowClientUnableBodySchema = z.strictObject({ reason: clientUnableReasonSchema });
export type FlowClientUnableBody = z.infer<typeof flowClientUnableBodySchema>;

/**
 * C207.9: the answer: the verification, ended without passing (`canceled`). It says nothing of
 * where the flow goes next: the client reads the session for the server's position.
 */
export const flowClientUnableResponseSchema = z.strictObject({
  'verification-id': idSchema('ver'),
  status: z.literal('canceled'),
});
export type FlowClientUnableResponse = z.infer<typeof flowClientUnableResponseSchema>;

/** C207.9: the platforms a client-unable note names, read from the session's client facts. */
export const CLIENT_UNABLE_PLATFORMS = Object.freeze(['android', 'ios', 'web'] as const);
export type ClientUnablePlatform = (typeof CLIENT_UNABLE_PLATFORMS)[number];

/**
 * C208.1: the sandbox test chip's scenarios: a chip that matches the inquiry (`match`), one whose
 * MRZ differs from the government ID's, one with another person's face, one without an Active
 * Authentication key, and one whose DG1 no longer matches its signed hash.
 */
export const SANDBOX_CHIP_SCENARIOS = Object.freeze([
  'match',
  'mrz-mismatch',
  'face-mismatch',
  'no-active-authentication',
  'tampered-dg1',
] as const);
export const sandboxChipScenarioSchema = z.enum(SANDBOX_CHIP_SCENARIOS);
export type SandboxChipScenario = z.infer<typeof sandboxChipScenarioSchema>;

/** C208.1: the scenario a body without one asks for. */
export const SANDBOX_CHIP_DEFAULT_SCENARIO = 'match' satisfies SandboxChipScenario;

/**
 * C208.1: `POST /api/v1/flow/verifications/:id/sandbox-chip` (sandbox environments only; the
 * generic 404 anywhere else). The challenge is the one the client took for this read.
 */
export const flowSandboxChipBodySchema = z.strictObject({
  'challenge-id': idSchema('chc'),
  scenario: sandboxChipScenarioSchema.default(SANDBOX_CHIP_DEFAULT_SCENARIO),
});
export type FlowSandboxChipBody = z.infer<typeof flowSandboxChipBodySchema>;

/**
 * C208.1 (decision 69; review P15): the chip files the route returns. Never DG2: the server
 * attaches it to the verification itself, by reference to the stored selfie, so no image leaves
 * the server.
 */
export const SANDBOX_CHIP_RETURNED_FILE_KINDS = Object.freeze([
  'chip-sod',
  'chip-dg1',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
] as const);

/** Standard base64 with padding. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The base64 length of `bytes` bytes, padded. */
const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4;

/**
 * C208.1: the answer: a synthetic chip's files (base64; each at most the 64 KiB a chip file other
 * than DG2 may be), `dg2-attached: true`, and the Active Authentication response over the
 * challenge's nonce when the scenario's chip has a key. DG1 holds the MRZ the same session holder
 * just photographed, so `content` is PII-marked.
 */
export const flowSandboxChipResponseSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        kind: z.enum(SANDBOX_CHIP_RETURNED_FILE_KINDS),
        content: z
          .string()
          .min(4)
          .max(base64Length(maxUploadBytes('chip-sod')))
          .regex(BASE64, 'must be standard base64 with padding')
          .meta({ pii: true }),
      }),
    )
    .min(1)
    .max(SANDBOX_CHIP_RETURNED_FILE_KINDS.length),
  'dg2-attached': z.literal(true),
  'active-authentication-response': z
    .string()
    .min(4)
    .max(base64Length(ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES))
    .regex(BASE64, 'must be standard base64 with padding')
    .optional(),
});
export type FlowSandboxChipResponse = z.infer<typeof flowSandboxChipResponseSchema>;

/**
 * C208.1: what marks a verification read from a sandbox chip, with its scenario
 * (`sandbox-chip: <scenario>`), wherever the verification and the console show it (C208.4).
 */
export const SANDBOX_CHIP_LABEL_MEMBER = 'sandbox-chip';

/**
 * C207.2, C221.1: the nfc client view's PII member (`nfcPrefillMrzSchema` of
 * `@openverify/flow-spec`), which joins the API log's masked members.
 */
export const NFC_PREFILL_MRZ_MEMBER = 'prefillMrz';
