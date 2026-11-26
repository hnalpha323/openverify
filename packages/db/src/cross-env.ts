/**
 * `@openverify/db/cross-env` (C240.5, V04; Workflow 11A Stage 1b): the Connect repositories'
 * cross-environment functions, which take the counterparty's environment id. The package's entry
 * (`@openverify/db`) never exports them. Only `apps/api/src/services/connect/cross-tenant.ts` may
 * import this entry: the ESLint rule `no-restricted-imports` (`packages/config/eslint/phase5-rules.js`)
 * and the source test beside `cross-tenant.ts` hold it.
 */
export * as connectConnectionsCrossEnv from './repositories/connect-connections.cross-env.js';
export * as connectSharePoliciesCrossEnv from './repositories/connect-share-policies.cross-env.js';
export * as connectShareTokensCrossEnv from './repositories/connect-share-tokens.cross-env.js';
// Workflow 11A Stage 1b (K): the consent records' twin, `api-consent`'s.
export * as consentRecordsCrossEnv from './repositories/consent-records.cross-env.js';
