/**
 * `@openverify/signals/testing` (plan C92.3, C111.1): our own MMDB writer for fixtures, and
 * synthetic files in every publisher's format built from the documentation ranges and ASNs. No
 * real database or list is ever committed. Owner: `network-data` (Workflow 7A Stage 2).
 */
export const SIGNALS_TESTING_AREA = 'testing';

export * from './cpu.js';
export * from './mmdb-writer.js';
export * from './publisher-files.js';
export * from './random.js';
export * from './sandbox-network.js';
