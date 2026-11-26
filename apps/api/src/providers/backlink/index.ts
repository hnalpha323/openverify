/**
 * C61.5, C63: the backlink provider, bound by `OPENVERIFY_PROVIDER_BACKLINK_{SANDBOX,PRODUCTION}`
 * in the worker: `sandbox` only (sandbox environments, C61.6: metadata `backlink-count` and
 * `backlink-threshold`); unset means unbound. No real backlink source ships.
 *
 * `api-kyb` (Workflow 5B Stage 3) built the sandbox provider (`sandbox.ts`) over
 * `contracts-5b`'s stub.
 */
import type { BacklinkProvider } from '../../ports.js';
import { createSandboxBacklinkProvider } from './sandbox.js';

/** The provider `name` binds: the sandbox one, the only one this version ships. */
export function createBacklinkProvider(name: 'sandbox'): BacklinkProvider {
  return { ...createSandboxBacklinkProvider(), id: name };
}
