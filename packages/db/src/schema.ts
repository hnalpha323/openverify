/**
 * Database schema v2. drizzle-kit loads this file to generate migrations
 * (`pnpm --filter @openverify/db db:generate`); it may only export tables, enums and
 * types, and must not need any KEK or database to load.
 */
export * from './tables/enums.js';
export * from './tables/tenancy.js';
export * from './tables/users.js';
export * from './tables/mfa.js';
export * from './tables/inquiry-templates.js';
// Workflow 9A Stage 1b (T): deployments, promotions and simulation presets (C154.5, C154.7, C156.4).
export * from './tables/template-records.js';
export * from './tables/theme-sets.js';
export * from './tables/accounts.js';
export * from './tables/inquiries.js';
// Workflow 9A Stage 1b (S): the flow engine's records (C151.1, C152.8, C150.9).
export * from './tables/inquiry-flow.js';
export * from './tables/verifications.js';
export * from './tables/government-id-extractions.js';
export * from './tables/selfie.js';
export * from './tables/verification-inputs.js';
export * from './tables/otp.js';
export * from './tables/crypto-challenges.js';
export * from './tables/document-extractions.js';
export * from './tables/chip.js';
export * from './tables/business-registry-records.js';
export * from './tables/trust-anchors.js';
export * from './tables/reports.js';
export * from './tables/watchlists.js';
export * from './tables/networks.js';
export * from './tables/signals.js';
export * from './tables/handoffs.js';
export * from './tables/lists.js';
export * from './tables/transactions.js';
export * from './tables/graph.js';
export * from './tables/workflows.js';
export * from './tables/decisions.js';
export * from './tables/workflow-secrets.js';
export * from './tables/cases.js';
export * from './tables/case-queues.js';
// Workflow 9B Stage 1b (X): exports, saved views and bulk report jobs (C165, C166).
export * from './tables/exports.js';
export * from './tables/case-files.js';
export * from './tables/webhooks.js';
export * from './tables/audit-logs.js';
export * from './tables/platform.js';
// Workflow 9B Stage 1b (A): the analytics rollups and their state (C163.3, C163.4).
export * from './tables/analytics.js';
// Workflow 9B Stage 1b (W): a user's notification preferences (C169.7).
export * from './tables/notification-preferences.js';
// Workflow 10B Stage 1b (I): the integrity challenges and verdicts (C211.3, C211.4, C221.3).
export * from './tables/integrity.js';
// Workflow 11A Stage 1b (C) (C230.5): Connect's connections, share policies and share tokens.
export * from './tables/connect.js';
// Workflow 11A Stage 1b (R) (C230.5): the provenance and reliance columns' shared declarations.
export * from './tables/connect-columns.js';
// Workflow 11B Stage 1b (A) (C248): SSO providers, identities and login states.
export * from './tables/sso.js';
// Workflow 11B Stage 1b (D) (C253): the access exports.
export * from './tables/account-exports.js';
// Workflow 11B Stage 1b (P) (C251.1): one slot per environment and capped queue.
export * from './tables/queue-slots.js';
