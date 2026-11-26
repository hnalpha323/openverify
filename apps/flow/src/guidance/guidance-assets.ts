/**
 * The files the in-browser guidance loads (C46.1), each served from the flow's own origin and
 * pinned by SHA-256: the YuNet model the vision service also runs (`models/manifest.json`), and
 * onnxruntime-web's single-threaded WebAssembly runtime with its loader. Nothing comes from a
 * CDN. The build copies them (`src/vite-plugins/guidance-assets-plugin.ts`) and checks each
 * digest; the browser checks them again before running anything (`face-detector.ts`).
 *
 * ONNX Runtime's licence and third-party notices (Eigen's MPL-2.0 among them, compiled into the
 * WASM) are served beside them (C48), and so are libphonenumber-js's licences, whose metadata the
 * served JavaScript bundles.
 */

export interface GuidanceAsset {
  /** Where the flow serves the file, relative to its base URL. */
  readonly path: string;
  /** Lower-case hex SHA-256 of the file. */
  readonly sha256: string;
  readonly contentType: string;
}

/** YuNet 2026may (MIT), the pin of `models/manifest.json`. */
export const YUNET_MODEL: GuidanceAsset = Object.freeze({
  path: 'guidance/face_detection_yunet_2026may.onnx',
  sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
  contentType: 'application/octet-stream',
});

/** onnxruntime-web 1.30.0's WebAssembly binary (MIT; Eigen MPL-2.0 compiled in). */
export const ORT_WASM: GuidanceAsset = Object.freeze({
  path: 'guidance/ort-wasm-simd-threaded.wasm',
  sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  contentType: 'application/wasm',
});

/** onnxruntime-web 1.30.0's loader for that binary, imported as a module. */
export const ORT_WASM_LOADER: GuidanceAsset = Object.freeze({
  path: 'guidance/ort-wasm-simd-threaded.mjs',
  sha256: 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
  contentType: 'text/javascript',
});

/** ONNX Runtime's MIT licence and third-party notices at v1.30.0, and where Eigen's source is. */
export const ORT_NOTICES: readonly GuidanceAsset[] = Object.freeze([
  Object.freeze({
    path: 'licenses/onnxruntime-web/LICENSE.txt',
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    contentType: 'text/plain; charset=utf-8',
  }),
  Object.freeze({
    path: 'licenses/onnxruntime-web/ThirdPartyNotices.txt',
    sha256: '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
    contentType: 'text/plain; charset=utf-8',
  }),
  // OpenVerify's own note: where the source of the Eigen inside the WASM is (MPL-2.0 section
  // 3.2(a); Phase 10 owner decision P2, which settles Phase 4 decision 11). ORT's notices name
  // Eigen and its licence, but no location.
  Object.freeze({
    path: 'licenses/onnxruntime-web/EIGEN-SOURCE.txt',
    sha256: '4ccf08443448b6201fe4e0d80ca411c4955e7f4daee7daede07101452225e75b',
    contentType: 'text/plain; charset=utf-8',
  }),
]);

/**
 * libphonenumber-js's MIT licence and the Apache-2.0 licence of the Google libphonenumber
 * metadata it bundles, which the flow's phone and country steps put into the served JavaScript
 * (Workflow 5C review P020; `THIRD_PARTY_LICENSES.md` §2.1.7).
 */
export const LIBPHONENUMBER_NOTICES: readonly GuidanceAsset[] = Object.freeze([
  Object.freeze({
    path: 'licenses/libphonenumber-js/LICENSE',
    sha256: 'ea6fc5fe0f905c5fdedd8f160f1dd73ce739004fc5f35656b35258aea126dbde',
    contentType: 'text/plain; charset=utf-8',
  }),
  Object.freeze({
    path: 'licenses/libphonenumber-js/LICENSE.Apache',
    sha256: '59899c6091b540582ed617e8eeaac4919dc985ccfc35459ee9752b699be5205b',
    contentType: 'text/plain; charset=utf-8',
  }),
]);
