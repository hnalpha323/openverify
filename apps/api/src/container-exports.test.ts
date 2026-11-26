/**
 * C166.1, C166.5 (Workflow 9B Stage 1b (X)): the API's construction site holds the `export` and
 * `report-bulk` producers, which `POST /exports` and `POST /reports/bulk` enqueue on after their
 * commit (`ApiDependencies.exports`, `.reportBulk`), and closes them with the rest.
 */
import { setDefaultKeyring } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';
import { syntheticEnv } from './test-support/env.js';

vi.mock('./watchlists/reconcile.js', () => ({ reconcileWatchlistSources: vi.fn() }));
vi.mock('./network/reconcile.js', () => ({ reconcileNetworkSources: vi.fn() }));

const containers: Container[] = [];

afterEach(async () => {
  await Promise.all(containers.splice(0).map((container) => container.close()));
  setDefaultKeyring(undefined);
});

const fake = (member: string) => ({
  [member]: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
});

describe('createContainer: the export and bulk report producers (C166.1, C166.5)', () => {
  it('takes them, and closes them', async () => {
    const exports = fake('enqueueExport');
    const reportBulk = fake('enqueueReportBulk');
    const container = createContainer(loadConfig(syntheticEnv({})), {
      exports: exports as never,
      reportBulk: reportBulk as never,
    });
    containers.push(container);

    await container.close();
    containers.length = 0;

    expect(exports.close).toHaveBeenCalled();
    expect(reportBulk.close).toHaveBeenCalled();
  });
});
