/**
 * The signal logic (plan C90.4, C93.4, C94.5, C94.8, C95), built by `signal-logic` in Workflow 7A
 * Stage 2: the user-agent mapping over bowser, the bot score and the behaviour level with their
 * caps (`BOT_SCORE_RULES`, `BEHAVIOUR_RULES`), the cross-layer consistency rules, the threat-level
 * table (`THREAT_LEVEL_RULES`), the distances, the session-combination rules and the signal values
 * from stored facts, each a pure function. The constants come from `@openverify/core`'s signal
 * registry. The package entry point re-exports this module, so the owner adds its exports here
 * and never edits `src/index.ts`.
 */

/** The area this folder holds (`signal-logic` owns it). */
export const SIGNALS_CHECKS_AREA = 'signals';

export * from './behaviour.js';
export * from './bot-score.js';
export * from './compute.js';
export * from './consistency.js';
export * from './device-integrity.js';
export * from './distance.js';
export * from './evidence.js';
export * from './inputs.js';
export * from './network-facts.js';
export * from './request-headers.js';
export * from './review-rules.js';
export * from './threat-level.js';
export * from './user-agent.js';
export * from './vocabulary.js';
