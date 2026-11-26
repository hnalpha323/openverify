import { describe, expect, it } from 'vitest';
import {
  FLOW_API_URL_VARIABLE,
  FLOW_FACE_GUIDANCE_VARIABLE,
  FLOW_RUNTIME_CONFIG_PATH,
  faceGuidanceEnabled,
} from './runtime-config';

describe("the flow's run-time configuration, frozen (C257.1, C289; decision 73)", () => {
  it('names its variables and the path the bundle reads', () => {
    expect(FLOW_API_URL_VARIABLE).toBe('OPENVERIFY_FLOW_API_URL');
    expect(FLOW_FACE_GUIDANCE_VARIABLE).toBe('OPENVERIFY_FLOW_FACE_GUIDANCE');
    expect(FLOW_RUNTIME_CONFIG_PATH).toBe('/config.json');
  });

  it.each([
    [undefined, true],
    ['', true],
    ['on', true],
    ['off', false],
    [' off ', false],
  ])('reads %j as %s', (value, enabled) => {
    expect(faceGuidanceEnabled(value)).toBe(enabled);
  });

  it.each(['OFF', 'false', '0', 'no', 'disabled', 'onn'])(
    'refuses %j, naming the variable',
    (value) => {
      expect(() => faceGuidanceEnabled(value)).toThrow(
        /OPENVERIFY_FLOW_FACE_GUIDANCE must be on or off/,
      );
    },
  );
});
