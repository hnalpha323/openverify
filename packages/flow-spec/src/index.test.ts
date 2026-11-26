import { describe, expect, it } from 'vitest';
import * as entry from '@openverify/flow-spec';
import { PACKAGE_NAME } from './index.js';

describe('@openverify/flow-spec entry point', () => {
  it('identifies the package', () => {
    expect(PACKAGE_NAME).toBe('@openverify/flow-spec');
  });

  it('resolves the package name to its TypeScript source without a build', () => {
    expect(entry.PACKAGE_NAME).toBe(PACKAGE_NAME);
  });
});
