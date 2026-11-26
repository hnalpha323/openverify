/**
 * C257.1, C289 (Workflow 11C Stage 1a, contracts-11c; decision 73): the flow's run-time
 * configuration, frozen. The flow server reads `OPENVERIFY_FLOW_API_URL` at start (falling back to
 * `VITE_OPENVERIFY_API_URL`, which it reads today), serves the origin to a bundle built without it as
 * `/config.json` and sends it as the `connect-src` header; `OPENVERIFY_FLOW_FACE_GUIDANCE` (`on`, the
 * default, or `off`) is read when the bundle is built, and `off` leaves onnxruntime-web and the
 * guidance assets out (Phase 10 P2's decline outcome). images-11c wires both, as named borrowed
 * edits of the flow server, `main.tsx`, `security-meta.ts` and `vite.config.ts`.
 *
 * Erasable TypeScript only and no import: the flow server, run by Node's type stripping, imports it.
 */

/** The API's public URL, read by the flow server at start. */
export const FLOW_API_URL_VARIABLE = 'OPENVERIFY_FLOW_API_URL';
/** The build-time switch of on-device face guidance. */
export const FLOW_FACE_GUIDANCE_VARIABLE = 'OPENVERIFY_FLOW_FACE_GUIDANCE';
/** Where the flow server serves the run-time configuration to the bundle. */
export const FLOW_RUNTIME_CONFIG_PATH = '/config.json';

/**
 * Whether the bundle is built with face guidance: `on` or unset (yes), `off` (no).
 * @throws {TypeError} for any other value, naming the variable and never echoing the value.
 */
export function faceGuidanceEnabled(value: string | undefined): boolean {
  const setting = value?.trim() ?? '';
  if (setting === '' || setting === 'on') {
    return true;
  }
  if (setting === 'off') {
    return false;
  }
  throw new TypeError(`${FLOW_FACE_GUIDANCE_VARIABLE} must be on or off`);
}
