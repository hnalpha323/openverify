'use client';
/**
 * `@openverify/react` (plan C266.2): React bindings over `@openverify/js`, a `<OpenVerifyFlow>`
 * component and a `useOpenVerify` hook. They add no capability the embed lacks and keep no state
 * beyond the embed's own events: the server decides every step, and the completion the flow
 * reports is a hint (C159.6), so business logic belongs on webhooks or the API.
 */
export {
  INITIAL_OPEN_VERIFY_STATE,
  useOpenVerify,
  type OpenVerifyBinding,
  type OpenVerifyOptions,
  type OpenVerifyState,
  type OpenVerifyStatus,
} from './use-open-verify.js';
export { OpenVerifyFlow, type OpenVerifyFlowProps } from './open-verify-flow.js';
export type { EmbedErrorCode, EmbedEventName } from '@openverify/js';
