/**
 * C46.1: the in-browser face guidance runs on onnxruntime-web (MIT; no telemetry in its
 * WebAssembly builds, research §1a), pinned exactly so the WASM files the build copies and
 * verifies never change underneath it.
 */
import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';

describe('the guidance runtime (C46.1)', () => {
  it('is onnxruntime-web 1.30.0, pinned exactly, at runtime', () => {
    expect((manifest.dependencies as Record<string, string>)['onnxruntime-web']).toBe('1.30.0');
  });

  it('is not MediaPipe, whose builds send usage data (decision 1)', () => {
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(all).filter((name) => name.startsWith('@mediapipe/'))).toEqual([]);
  });
});
