import * as entry from '@openverify/signals';
import * as browser from '@openverify/signals/browser';
import * as network from '@openverify/signals/network';
import * as testing from '@openverify/signals/testing';
import { describe, expect, it } from 'vitest';

describe('@openverify/signals entry points (C94.1)', () => {
  it('names the package and resolves to its sources without a build', () => {
    expect(entry.PACKAGE_NAME).toBe('@openverify/signals');
  });

  it('exposes the browser collector as its own entry, for the flow alone (C94.1, F06)', () => {
    expect(browser.SIGNALS_BROWSER_AREA).toBe('browser');
  });

  it('exposes the network and testing areas as their own entries (F06)', () => {
    expect(network.SIGNALS_NETWORK_AREA).toBe('network');
    expect(testing.SIGNALS_TESTING_AREA).toBe('testing');
  });
});
