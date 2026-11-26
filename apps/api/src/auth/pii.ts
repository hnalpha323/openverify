/**
 * PII visibility (contract C15). API keys see everything their scopes reach, unless a principal
 * without `pii:view` minted them (Workflow 2B F001): such a key is masked as its creator is. A
 * dashboard user sees PII only with `pii:view`; without it, serializers replace each value in
 * `fields`, and `note`, `ip-address`, `user-agent`, the C31.5 extraction attributes of a
 * government ID and every C53.7 PII attribute of a verification, with `null`, and file content
 * answers 403 `forbidden`.
 *
 * Serializers take a {@link PiiMask}: routes pass `piiMaskFor(principal)`, and server-side
 * copies that are not shown to a user (event payloads, webhooks, jobs) pass {@link UNMASKED}.
 */
import { PII_CASE_ATTACHMENT_ATTRIBUTES, PII_MASKED_ATTRIBUTES } from '@openverify/contracts';
import type { Principal } from '../ports.js';
import { authorizePrincipal } from '../plugins/principal-auth.js';

/**
 * Resource attributes C15 masks for a user without `pii:view`, C31.6 the extraction attributes of
 * a government ID (`extraction-sources` names fields only, so it stays), and C53.7 every attribute
 * a verification resource marks PII (`PII_VERIFICATION_ATTRIBUTES`, built from the contracts'
 * `.meta({ pii: true })` marks): a nested PII object is masked member-wise when it is `fields`,
 * whole otherwise (`associated-persons`).
 */
export const MASKED_ATTRIBUTES: readonly string[] = PII_MASKED_ATTRIBUTES;

/**
 * Masked member-wise (the keys stay): an inquiry's or account's `fields`, a report's `query`, a
 * graph query's `params` (C102.4: each parameter's name stays).
 */
const MEMBER_WISE: ReadonlySet<string> = new Set(['fields', 'query', 'params']);

/**
 * Whether `principal` may see PII: API keys unless they were minted masked, users with
 * `pii:view`.
 */
export function canViewPii(principal: Principal): boolean {
  return principal.kind === 'api-key'
    ? principal.piiMasked !== true
    : principal.permissions.has('pii:view');
}

/** Applies one principal's PII visibility to values about to be serialized. */
export interface PiiMask {
  /** True when values pass through unchanged. */
  readonly visible: boolean;
  /** The fields with every value replaced by `null` when masked; the keys stay. */
  fields<V>(fields: Readonly<Record<string, V>>): Record<string, V | null>;
  fields<V>(fields: Readonly<Record<string, V>> | null): Record<string, V | null> | null;
  /** The inquiry note, or `null` when masked. */
  note(note: string | null): string | null;
  /** A session's or audit entry's client address, or `null` when masked. */
  ipAddress(ipAddress: string | null): string | null;
  /** A session's or audit entry's user agent, or `null` when masked. */
  userAgent(userAgent: string | null): string | null;
  /**
   * A copy of a resource's `attributes` with each {@link MASKED_ATTRIBUTES} member it has
   * masked; nothing is added. The contract schemas allow `null` in every masked position.
   */
  attributes<A extends Readonly<Record<string, unknown>>>(attributes: A): A;
}

/**
 * Whether a field's value is C105.1's `{ type, value }`, as a transaction serves it. The `type`
 * names a field type, never a value, and the contract requires it, so it stays.
 */
function isTypedField(value: unknown): value is { type: string; value: unknown } {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('value') &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Each value of a fields object replaced with `null`, a transaction's with `{ type, value: null }`;
 * anything else (null) stays as it is.
 */
function maskFieldValues(fields: unknown): unknown {
  if (fields === null || typeof fields !== 'object') {
    return fields;
  }
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      isTypedField(value) ? { type: value.type, value: null } : null,
    ]),
  );
}

/** One served attachment with each of `PII_CASE_ATTACHMENT_ATTRIBUTES` nulled. */
function maskAttachment(attachment: unknown): unknown {
  if (attachment === null || typeof attachment !== 'object' || Array.isArray(attachment)) {
    return attachment;
  }
  return Object.fromEntries(
    Object.entries(attachment).map(([name, value]) => [
      name,
      PII_CASE_ATTACHMENT_ATTRIBUTES.includes(name) ? null : value,
    ]),
  );
}

function createMask(visible: boolean): PiiMask {
  const hide = <T>(value: T | null): T | null => (visible ? value : null);
  function fields<V>(value: Readonly<Record<string, V>>): Record<string, V | null>;
  function fields<V>(value: Readonly<Record<string, V>> | null): Record<string, V | null> | null;
  function fields<V>(value: Readonly<Record<string, V>> | null): Record<string, V | null> | null {
    if (value === null) {
      return null;
    }
    return visible ? { ...value } : (maskFieldValues(value) as Record<string, null>);
  }
  return Object.freeze({
    visible,
    fields,
    note: hide,
    ipAddress: hide,
    userAgent: hide,
    attributes<A extends Readonly<Record<string, unknown>>>(attributes: A): A {
      if (visible) {
        return { ...attributes };
      }
      const masked: Record<string, unknown> = { ...attributes };
      for (const name of MASKED_ATTRIBUTES) {
        if (name in masked) {
          masked[name] = MEMBER_WISE.has(name) ? maskFieldValues(masked[name]) : null;
        }
      }
      // C135.2 (Stage 1a amendment 40): a case's `attachments` keep their ids, sizes and statuses,
      // and lose each PII member (the filename).
      if (Array.isArray(masked.attachments)) {
        masked.attachments = masked.attachments.map(maskAttachment);
      }
      return masked as A;
    },
  });
}

/** Hides nothing: for copies never shown to a user, such as event payloads and webhooks. */
export const UNMASKED: PiiMask = createMask(true);
const MASKED: PiiMask = createMask(false);

/** The mask for what `principal` may see. */
export function piiMaskFor(principal: Principal): PiiMask {
  return canViewPii(principal) ? UNMASKED : MASKED;
}

/**
 * Refuses a user without `pii:view`, e.g. before serving file content (C15).
 * @throws {PermissionDeniedError} 403 `forbidden` naming `pii:view`.
 */
export function requirePiiView(principal: Principal): void {
  if (!canViewPii(principal)) {
    authorizePrincipal(principal, ['pii:view']);
  }
}
