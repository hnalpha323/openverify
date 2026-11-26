/**
 * The NFC checks' effective config (C51.3: `packages/core/src/check-config/nfc.ts`), and the
 * Passive Authentication options the worker passes to `@openverify/emrtd` from it.
 */
import type { VerificationTemplateConfig } from '@openverify/core';
import { booleanIn, phase5CheckConfig } from '../contact/phase5-config.js';

/** `verifyPassiveAuthentication`'s policy options from the template (`accept-sha1`). */
export function nfcPassiveAuthenticationOptions(template: VerificationTemplateConfig): {
  readonly acceptSha1: boolean;
} {
  const config = phase5CheckConfig(template, 'id_nfc_passive_authentication_detection');
  return { acceptSha1: booleanIn(config, 'accept-sha1', true) };
}
