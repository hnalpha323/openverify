/**
 * C57.2: the wallet challenges of the flow API (`api-crypto`). A challenge is the message the
 * server builds for one claimed address on one offered chain, which the wallet signs:
 *
 * - its preconditions are C52.1's (`requireFlowVerification`): the session's `initiated` crypto
 *   wallet verification of an open inquiry, after consent;
 * - its refusals are `crypto_chain_not_offered`, `crypto_address_invalid` and
 *   `crypto_expected_address_mismatch` (422), before any write;
 * - in one transaction under the C40.6 lock order (the inquiry re-checked open and unredacted,
 *   then the verification re-checked `initiated`, then its challenges), the open challenge is
 *   superseded (or expired), and the new one stored with its address and message sealed;
 * - the 11th challenge cancels the verification instead (a retryable attempt; the inquiry fails
 *   when the step has no attempt left) and answers 409 `crypto_challenge_invalid`.
 *
 * The message's domain and URI come from `OPENVERIFY_FLOW_PUBLIC_URL`, never from a request
 * header; nothing here logs an address or a message.
 */
export * from './create.js';
export * from './rules.js';
