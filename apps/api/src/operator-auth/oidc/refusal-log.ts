/**
 * C248.7 and C250.7 (Workflow 11B, `sso-oidc`): where an SSO refusal is told. The browser sees one
 * generic problem; the log line carries the refusal's own code and the provider id, and the metric
 * `sso_sign_in_refused` counts it without a label. Neither ever holds a value from the identity
 * provider (rule 11).
 */
import { metrics } from '../../metrics-registry.js';
import type { SsoRefusalLog } from './service.js';

/** The part of a pino logger the refusal log needs. */
export interface SsoRefusalLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
}

export function createSsoRefusalLog(logger: SsoRefusalLogger): SsoRefusalLog {
  return (failure, { providerId }) => {
    logger.warn(
      { sso: providerId === undefined ? { failure } : { failure, providerId } },
      'sso sign-in refused',
    );
    metrics.emit(logger, 'sso_sign_in_refused', 1);
  };
}
