/**
 * `@openverify/js`, the embed client (C159): `OpenVerify.embed({ container, flowUrl, inquiryId, ... })`
 * mounts the hosted flow in a sandboxed iframe at `{flowUrl}/embed/{inquiryId}` with the credentials
 * in the fragment, and exchanges the versioned messages of `flow-messages.ts` with it, checking
 * `event.origin` and `event.source` on every one. Owner: `flow-server-embed`.
 */
export { EMBED_PROTOCOL_VERSION, readFlowMessage, type FlowMessage } from './messages';
export { frameUrlOf, type FrameUrlInput } from './frame-url';
export {
  embed,
  type EmbedErrorCode,
  type EmbedHandle,
  type EmbedOptions,
  type EmbedEventName,
} from './embed';
