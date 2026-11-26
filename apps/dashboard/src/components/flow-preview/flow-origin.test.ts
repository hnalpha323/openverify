// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FLOW_URL_ENV, previewFlowOrigin } from './flow-origin';

describe('the flow origin the console frames (C156.2, C170.1)', () => {
  it('is the origin of OPENVERIFY_FLOW_PUBLIC_URL', () => {
    expect(FLOW_URL_ENV).toBe('OPENVERIFY_FLOW_PUBLIC_URL');
    expect(previewFlowOrigin({ OPENVERIFY_FLOW_PUBLIC_URL: 'http://127.0.0.1:5173' })).toBe(
      'http://127.0.0.1:5173',
    );
    expect(
      previewFlowOrigin({ OPENVERIFY_FLOW_PUBLIC_URL: ' https://verify.example.test/hosted/ ' }),
    ).toBe('https://verify.example.test');
  });

  it('is null when unset, blank or not a plain http(s) URL', () => {
    for (const value of [
      undefined,
      '',
      '  ',
      'not a url',
      'ftp://verify.example.test',
      'javascript:alert(1)',
      'https://user:secret@verify.example.test',
    ]) {
      expect(previewFlowOrigin({ OPENVERIFY_FLOW_PUBLIC_URL: value })).toBeNull();
    }
  });
});
