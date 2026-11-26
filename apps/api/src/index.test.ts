import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@openverify/api entry point', () => {
  it('identifies the package', () => {
    expect(PACKAGE_NAME).toBe('@openverify/api');
  });
});
