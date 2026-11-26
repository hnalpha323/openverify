/**
 * Crypto-wallet checks (plan C57), built by `checks-contact-crypto` in Workflow 5A Stage 2: the
 * per-chain address validators, the challenge message builders, the signature schemes (EIP-191,
 * BIP-137, BIP-322 simple and legacy, TRON, Solana ed25519) on `@noble/*` and `@scure/*`, and the
 * evaluators of the four `crypto_wallet_*` checks. The package entry point re-exports this
 * module, so the owner adds its exports here and never edits `src/index.ts`.
 */

/** The area this folder holds (`checks-contact-crypto` owns it). */
export const CRYPTO_CHECKS_AREA = 'crypto';

export * from './addresses.js';
export * from './bip137.js';
export * from './bip322.js';
export * from './context.js';
export * from './crypto-wallet-address-comparison.js';
export * from './crypto-wallet-disallowed-chain-detection.js';
export * from './crypto-wallet-statement-comparison.js';
export * from './crypto-wallet-validity-detection.js';
export * from './eip191.js';
export * from './eip55.js';
export * from './evaluate.js';
export * from './evaluators.js';
export * from './inputs.js';
export * from './messages.js';
export * from './reasons.js';
export * from './solana-offchain.js';
export * from './solana.js';
export * from './tron.js';
export * from './verify.js';
