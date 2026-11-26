/**
 * C289 (Phase 11, Workflow 11C, images-11c): what `onnxruntime-web/wasm` resolves to in a flow built
 * with `OPENVERIFY_FLOW_FACE_GUIDANCE=off` (`src/vite-plugins/face-guidance-build.ts`): nothing, so
 * no part of onnxruntime-web reaches that bundle. Its detector never imports it (`flow-environment`).
 */
export {};
