/**
 * C73.8 (P18): candidate retrieval binds the subject's name tokens and normalised name as query
 * parameters (C78.3), and Postgres logs bind parameters in full once statement or duration logging
 * is on. A Postgres started with `POSTGRES_TEST_COMMAND`, as compose's is, logs none, even after a
 * session turns statement logging on. Each log check first waits for the statement itself in the
 * log (R003), so an empty, late or unread log never passes; a Postgres started without the flags
 * is the control that shows the check sees a logged parameter. Every value is synthetic.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIntegrationPostgres, ifSet } from './testing.js';

let container: StartedPostgreSqlContainer;
let plain: StartedPostgreSqlContainer;
let client: pg.Client;

beforeAll(async () => {
  // The control starts here too, so its start counts against the hook timeout, as every other
  // container's does, and not against its test's.
  [container, plain] = await Promise.all([
    startIntegrationPostgres(),
    startIntegrationPostgres({ imageCommand: true }),
  ]);
  client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
});

afterAll(async () => {
  await ifSet(client)?.end();
  await Promise.all([ifSet(container)?.stop(), ifSet(plain)?.stop()]);
});

const setting = async (name: string) =>
  (
    await client.query<{ setting: string }>('select setting from pg_settings where name = $1', [
      name,
    ])
  ).rows[0]?.setting;

describe('the Testcontainers Postgres (C73.8)', () => {
  it('never logs bind parameters, in a statement or in an error', async () => {
    expect(await setting('log_parameter_max_length')).toBe('0');
    expect(await setting('log_parameter_max_length_on_error')).toBe('0');
  });

  it('keeps them out of the log when a session turns statement logging on', async () => {
    await client.query("set log_statement = 'all'");

    expect(await setting('log_parameter_max_length')).toBe('0');
    await expect(
      client.query('select $1::text as name', ['Synthetic Person']),
    ).resolves.toMatchObject({
      rows: [{ name: 'Synthetic Person' }],
    });
    const log = await logUntil(container, STATEMENT);
    expect(log).toContain(STATEMENT);
    expect(log).not.toContain('Synthetic Person');
  });

  it('is checked against a Postgres without the flags, whose log holds the parameter (the control)', async () => {
    const other = new pg.Client({ connectionString: plain.getConnectionUri() });
    try {
      await other.connect();
      await other.query("set log_statement = 'all'");
      await other.query('select $1::text as name', ['Synthetic Control']);
      const log = await logUntil(plain, 'Synthetic Control');
      expect(log).toContain(STATEMENT);
      expect(log).toContain('Synthetic Control');
    } finally {
      await other.end();
    }
  });
});

const STATEMENT = 'select $1::text as name';

/** How long a log check waits for its needle, within the 30 s test timeout. */
const LOG_DEADLINE_MS = 20_000;

/**
 * The container's log once it holds `needle`, or what arrived by the deadline (R003: never a fixed
 * wait). One followed stream is read throughout: a stream dropped after a short window can close
 * before Docker sends its first chunk under load, and then every window comes back empty.
 */
async function logUntil(started: StartedPostgreSqlContainer, needle: string): Promise<string> {
  const logs = await started.logs();
  let text = '';
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, LOG_DEADLINE_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      logs.on('data', (chunk: Buffer | string) => {
        text += String(chunk);
        if (text.includes(needle)) {
          done();
        }
      });
      logs.on('end', done);
    });
  } finally {
    logs.destroy();
  }
  return text;
}
