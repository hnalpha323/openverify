/**
 * C59.1, C63: the database providers, bound by `OPENVERIFY_PROVIDER_DATABASE_{SANDBOX,PRODUCTION}`
 * in both processes (the publish rule reads the binding in the API; the job asks it in the
 * worker). Only `sandbox` ships, for sandbox environments (C59.2, `sandbox.ts`): no free,
 * authoritative source of personal records exists to ship an adapter for (research §6).
 */
import type { SandboxDatabaseProvider } from '../../ports.js';
import { createSandboxDatabaseProvider } from './sandbox.js';

/** The providers by binding name. */
const PROVIDERS = Object.freeze({ sandbox: createSandboxDatabaseProvider });

/** The provider `name` binds. */
export function createDatabaseProvider(name: keyof typeof PROVIDERS): SandboxDatabaseProvider {
  return PROVIDERS[name]();
}
