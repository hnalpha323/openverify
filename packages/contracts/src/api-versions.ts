/**
 * Date-based API versions (contract C12). A request may name one in the `OpenVerify-Version`
 * header; otherwise the API key's `api-version` applies, and user sessions get the latest.
 * An unknown version answers 400 `unsupported-api-version`.
 */
import { z } from 'zod';

/** Every supported version, oldest first. */
export const API_VERSIONS = ['2026-10-01'] as const;
export const apiVersionSchema = z.enum(API_VERSIONS);
export type ApiVersion = z.infer<typeof apiVersionSchema>;

/** Request and response header; webhook deliveries send it too. */
export const API_VERSION_HEADER = 'openverify-version';

const KNOWN_VERSIONS: ReadonlySet<string> = new Set(API_VERSIONS);

export function isApiVersion(value: unknown): value is ApiVersion {
  return typeof value === 'string' && KNOWN_VERSIONS.has(value);
}

/**
 * The newest version, which user sessions get. Update it with `API_VERSIONS`; a test checks
 * it is the newest entry.
 */
export const LATEST_API_VERSION = '2026-10-01' satisfies ApiVersion;

export function latestApiVersion(): ApiVersion {
  return LATEST_API_VERSION;
}
