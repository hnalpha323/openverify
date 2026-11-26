/**
 * Workflow 7A Stage 1b, checkpoint (N) (C92.2, C92.5, C93.5, C107.8): the network data settings.
 *
 * - `OPENVERIFY_NETWORK_SOURCES_DISABLED` and `OPENVERIFY_NETWORK_SOURCES_ENABLED` are read the same
 *   way by every process (C92.5): comma-separated source ids, trimmed, each once.
 * - `OPENVERIFY_NETWORK_REFRESH` is the worker's (the 15-minute tick); the API never reads it.
 * - `OPENVERIFY_IP_REPUTATION_MMDB_PATH` is read by the API and the worker, and is required while
 *   either environment kind binds `ipReputation` to `mmdb-file`. A problem names the variable and
 *   never echoes its value.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type LoadConfigOptions } from './config.js';
import { syntheticEnv } from './test-support/env.js';

function issuesOf(env: NodeJS.ProcessEnv, options: LoadConfigOptions = {}): readonly string[] {
  try {
    loadConfig(syntheticEnv(env), options);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

const PROCESSES = ['api', 'worker'] as const;
const MMDB_PATH = '/var/lib/openverify/ip-reputation/synthetic.mmdb';

describe('the network settings (C92.5, C93.5)', () => {
  it('default to the manifest, no refresh and no MMDB file in both processes', () => {
    for (const process of PROCESSES) {
      expect(loadConfig(syntheticEnv(), { process }).network).toEqual({
        sourcesDisabled: [],
        sourcesEnabled: [],
        refresh: false,
        ipReputationMmdbPath: null,
      });
    }
  });

  it('read the source lists the same way in every process', () => {
    const env = syntheticEnv({
      OPENVERIFY_NETWORK_SOURCES_DISABLED: ' gcp-cloud,aws-ip-ranges, gcp-cloud ,',
      OPENVERIFY_NETWORK_SOURCES_ENABLED: 'dbip-city-lite',
    });

    for (const process of PROCESSES) {
      expect(loadConfig(env, { process }).network).toMatchObject({
        sourcesDisabled: ['gcp-cloud', 'aws-ip-ranges'],
        sourcesEnabled: ['dbip-city-lite'],
      });
    }
  });

  it.each(['OPENVERIFY_NETWORK_SOURCES_DISABLED', 'OPENVERIFY_NETWORK_SOURCES_ENABLED'])(
    'refuse a %s entry that is not a source id, without echoing it',
    (name) => {
      for (const process of PROCESSES) {
        const issues = issuesOf({ [name]: 'dbip-country-lite,Not An Id!' }, { process });
        expect(issues).toEqual([`${name}: must be comma-separated source ids such as gcp-cloud`]);
      }
    },
  );

  it('let only the worker read the refresh tick', () => {
    const env = syntheticEnv({ OPENVERIFY_NETWORK_REFRESH: 'true' });

    expect(loadConfig(env, { process: 'worker' }).network.refresh).toBe(true);
    expect(loadConfig(env, { process: 'api' }).network.refresh).toBe(false);
    expect(issuesOf({ OPENVERIFY_NETWORK_REFRESH: 'hourly' }, { process: 'worker' })).toEqual([
      'OPENVERIFY_NETWORK_REFRESH: must be true or false',
    ]);
  });

  it('give both processes the MMDB file of an mmdb-file binding', () => {
    const env = syntheticEnv({
      OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION: 'mmdb-file',
      OPENVERIFY_IP_REPUTATION_MMDB_PATH: MMDB_PATH,
    });

    for (const process of PROCESSES) {
      const config = loadConfig(env, { process });
      expect(config.network.ipReputationMmdbPath).toBe(MMDB_PATH);
      expect((config.providers.production as Record<string, unknown>).ipReputation).toBe(
        'mmdb-file',
      );
    }
  });

  it('stop either process binding mmdb-file without the file, naming the variable', () => {
    for (const process of PROCESSES) {
      expect(
        issuesOf({ OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX: 'mmdb-file' }, { process }),
      ).toEqual([
        'OPENVERIFY_IP_REPUTATION_MMDB_PATH: is required while ipReputation is bound to mmdb-file',
      ]);
    }
  });

  it('refuse a relative MMDB path, never echoing it', () => {
    const issues = issuesOf({ OPENVERIFY_IP_REPUTATION_MMDB_PATH: 'synthetic.mmdb' });

    expect(issues).toEqual(['OPENVERIFY_IP_REPUTATION_MMDB_PATH: must be an absolute path']);
    expect(issues.join()).not.toContain('synthetic.mmdb');
  });
});
