/**
 * `@openverify/docs-tools` (Workflow 11E, C273-C284; private, never published): the document
 * generators, record tests and release check. contracts-11e owns this file and `package.json`;
 * from 11E's Stage 2 on both are shared files (review F17): an area adds its exports in its own
 * `src/<area>/index.ts`, which this file re-exports whole.
 */
export * from './types.js';
export * from './repository.js';
export * from './fresh-render.js';
export * from './areas.js';
export * from './cli.js';
export * from './security/index.js';
export * from './records/index.js';
export * from './selfhost/index.js';
export * from './compliance/index.js';
export * from './catalog/index.js';
export * from './release/index.js';
export * from './integration/index.js';
export * from './text.js';
export * from './wording.js';
export * from './vendor-name.js';
export * from './switches.js';
export * from './docs-tree.js';
export * from './metrics.js';
