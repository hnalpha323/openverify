import { describe, expect, it } from 'vitest';
import type { GuidanceAssetSource } from './guidance-assets-plugin';
import { faceGuidanceBuild } from './face-guidance-build';

// C289 (Phase 11, Workflow 11C, images-11c; review H20, OD-11C-2): OPENVERIFY_FLOW_FACE_GUIDANCE=off
// builds the flow without onnxruntime-web, its WASM, YuNet or their notices; the guidance then
// reports its detector unavailable (the manual shutter), as when the detector cannot load.
const asset = (path: string): GuidanceAssetSource => ({
  path,
  sha256: '0'.repeat(64),
  contentType: 'application/octet-stream',
  source: `/repo/${path}`,
});
const ASSETS = [
  asset('guidance/face_detection_yunet_2026may.onnx'),
  asset('guidance/ort-wasm-simd-threaded.wasm'),
  asset('guidance/ort-wasm-simd-threaded.mjs'),
  asset('licenses/onnxruntime-web/LICENSE.txt'),
  asset('licenses/onnxruntime-web/ThirdPartyNotices.txt'),
  asset('licenses/onnxruntime-web/EIGEN-SOURCE.txt'),
  asset('licenses/libphonenumber-js/LICENSE'),
  asset('licenses/libphonenumber-js/LICENSE.Apache'),
];
const STUB = '/repo/apps/flow/src/guidance/no-face-guidance.ts';

describe('the flow built with or without face guidance (C289)', () => {
  it.each([undefined, '', 'on'])('builds every guidance file with %j', (value) => {
    const build = faceGuidanceBuild({ OPENVERIFY_FLOW_FACE_GUIDANCE: value }, ASSETS, STUB);
    expect(build.enabled).toBe(true);
    expect(build.assets).toEqual(ASSETS);
    expect(build.define).toEqual({ 'import.meta.env.OPENVERIFY_FLOW_FACE_GUIDANCE': '"on"' });
    expect(build.alias).toEqual({});
  });

  it('with off keeps only the phone-number library notices and stubs onnxruntime-web out', () => {
    const build = faceGuidanceBuild({ OPENVERIFY_FLOW_FACE_GUIDANCE: 'off' }, ASSETS, STUB);
    expect(build.enabled).toBe(false);
    expect(build.assets.map((kept) => kept.path)).toEqual([
      'licenses/libphonenumber-js/LICENSE',
      'licenses/libphonenumber-js/LICENSE.Apache',
    ]);
    expect(build.define).toEqual({ 'import.meta.env.OPENVERIFY_FLOW_FACE_GUIDANCE': '"off"' });
    expect(build.alias).toEqual({ 'onnxruntime-web/wasm': STUB });
  });

  it('refuses any other value, naming the variable', () => {
    expect(() => faceGuidanceBuild({ OPENVERIFY_FLOW_FACE_GUIDANCE: 'no' }, ASSETS, STUB)).toThrow(
      /OPENVERIFY_FLOW_FACE_GUIDANCE must be on or off/,
    );
  });
});
