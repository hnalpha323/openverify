import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLOW_ENVIRONMENT } from './flow-environment';

// C289 (Phase 11, Workflow 11C, images-11c): a bundle built with OPENVERIFY_FLOW_FACE_GUIDANCE=off
// has no detector to load, so the default environment answers null at once, without a request:
// the guidance then shows its manual shutter through its existing 'unavailable' path.
describe('the face detector of a flow built without face guidance (C289)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers null without fetching a model or importing onnxruntime-web', async () => {
    vi.stubEnv('OPENVERIFY_FLOW_FACE_GUIDANCE', 'off');
    const fetch = vi.fn(() => Promise.reject(new Error('no request expected')));
    vi.stubGlobal('fetch', fetch);

    await expect(DEFAULT_FLOW_ENVIRONMENT.loadFaceDetector()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
