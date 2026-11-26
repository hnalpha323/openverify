/** Workspace package name. */
export const PACKAGE_NAME = '@openverify/workflow-engine';

// Each folder's owner adds its exports to its folder's index only, so this file never changes.
export * from './actions/index.js';
export * from './code-runner/index.js';
export * from './definition/index.js';
export * from './expressions/index.js';
export * from './graph/index.js';
export * from './interpreter/index.js';
export * from './limits/index.js';
export * from './schedules/index.js';
export * from './templates/index.js';
export * from './variables/index.js';
