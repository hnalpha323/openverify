/**
 * C61.5, C61.6: the sandbox backlink provider: backlinks.example has 250 backlinks, every other
 * host none. The factory builds it.
 */
import { describe, expect, it } from 'vitest';
import { createBacklinkProvider } from './index.js';
import {
  SANDBOX_BACKLINK_COUNT,
  SANDBOX_BACKLINK_HOST,
  createSandboxBacklinkProvider,
} from './sandbox.js';

describe('the sandbox backlink provider (C61.6)', () => {
  it('counts 250 backlinks to backlinks.example, with or without www.', async () => {
    expect([SANDBOX_BACKLINK_HOST, SANDBOX_BACKLINK_COUNT]).toEqual(['backlinks.example', 250]);
    for (const host of ['backlinks.example', 'www.backlinks.example']) {
      expect(await createSandboxBacklinkProvider().count({ host })).toEqual({ count: 250 });
    }
  });

  it('counts none to any other host', async () => {
    for (const host of ['old.example', 'shop.backlinks.example']) {
      expect(await createSandboxBacklinkProvider().count({ host })).toEqual({ count: 0 });
    }
  });

  it('is what the factory builds', async () => {
    const provider = createBacklinkProvider('sandbox');

    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(await provider.count({ host: 'backlinks.example' })).toEqual({ count: 250 });
  });
});
