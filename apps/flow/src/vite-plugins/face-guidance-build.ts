/**
 * C289 (Phase 11, Workflow 11C, images-11c; review H20, OD-11C-2): the flow built with or without
 * on-device face guidance. `OPENVERIFY_FLOW_FACE_GUIDANCE` (`on`, the default, or `off`) is read
 * when the bundle is built. With `off`, Phase 10 P2's decline outcome, the build copies none of
 * onnxruntime-web's WASM, YuNet or their notices (only the phone-number library's licences stay),
 * `onnxruntime-web/wasm` resolves to an empty module, and the bundle's detector answers `null` at
 * once, so the guidance shows its manual shutter through its existing `unavailable` path.
 */
import { faceGuidanceEnabled, FLOW_FACE_GUIDANCE_VARIABLE } from '../security/runtime-config';
import type { GuidanceAssetSource } from './guidance-assets-plugin';

export interface FaceGuidanceBuild {
  readonly enabled: boolean;
  /** The guidance files the build copies and checks. */
  readonly assets: readonly GuidanceAssetSource[];
  /** Vite's `define`: the switch as the bundle reads it. */
  readonly define: Readonly<Record<string, string>>;
  /** Vite's `resolve.alias`: onnxruntime-web replaced by `noGuidanceModule` when off. */
  readonly alias: Readonly<Record<string, string>>;
}

/** The licences that stay without guidance: the phone-number library is bundled either way. */
const ALWAYS_SHIPPED = 'licenses/libphonenumber-js/';

/**
 * The build's guidance settings from the environment.
 * @throws {TypeError} for a value other than on or off, naming the variable.
 */
export function faceGuidanceBuild(
  env: Readonly<Record<string, string | undefined>>,
  assets: readonly GuidanceAssetSource[],
  noGuidanceModule: string,
): FaceGuidanceBuild {
  const enabled = faceGuidanceEnabled(env[FLOW_FACE_GUIDANCE_VARIABLE]);
  return {
    enabled,
    assets: enabled ? assets : assets.filter((asset) => asset.path.startsWith(ALWAYS_SHIPPED)),
    define: {
      [`import.meta.env.${FLOW_FACE_GUIDANCE_VARIABLE}`]: JSON.stringify(enabled ? 'on' : 'off'),
    },
    alias: enabled ? {} : { 'onnxruntime-web/wasm': noGuidanceModule },
  };
}
