/** Workspace package name. */
export const PACKAGE_NAME = '@openverify/flow-spec';

export * from './flow.js';
export * from './json-schema.js';

// Workflow 9A Stage 1a (C147-C152, C161.5, C161.7, C162.2): flow-spec v2. One export line per
// module, frozen after Stage 1a: `v2/schemas/` is contracts-9a's; `v2/copy-keys.ts` api-templates';
// `locale-review-status.ts` and `pseudo-locale.ts` flow-i18n's; the rest of `v2/` flow-spec-logic's.
export * from './locale-review-status.js';
// C238.10 (Workflow 11A): the counsel review status of the share-consent texts.
export * from './counsel-review-status.js';
export * from './pseudo-locale.js';
export * from './v2/schemas/index.js';
export * from './v2/client-view.js';
export * from './v2/copy-keys.js';
export * from './v2/device-kind.js';
export * from './v2/digits.js';
export * from './v2/graph.js';
export * from './v2/json-schema.js';
export * from './v2/migrate.js';
export * from './v2/next-position.js';
export * from './v2/pattern/index.js';
export * from './v2/projection.js';
export * from './v2/references.js';
export * from './v2/scope-schema.js';
export * from './v2/visibility.js';
