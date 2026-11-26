/**
 * Migration 0023 (Phase 7, Workflow 7A; one migration for the Workflow, extended per Stage 1b
 * checkpoint) on the production server image: on an empty database, and on one upgraded from 0022
 * with rows in it. Checkpoint (N) adds the install-wide network source and sync tables, the
 * environment's `networks` and the session's network facts (C91.1, C91.3, C92, C93), and recreates
 * the two `report_type` CHECK constraints with `ip-address` (C106.1). Checkpoint (S) adds the signal
 * bodies, the signals outbox, devices and their session links, and the signal and device columns
 * of inquiries, versions and sessions (C90.5, C90.6, C91.1, C91.2, C94.2). Checkpoint (H) adds the
 * handoff tokens and the handoff state per inquiry and step, the session's handoff fields, and the
 * session that created each verification and selfie capture (C91.1, C96, V02, V03, V05). Every
 * value is synthetic, and every ASN is from the documentation ranges.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import {
  createIntegrationPool,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  testId,
  startIntegrationPostgres,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
const pools: Pool[] = [];

beforeAll(async () => {
  setDefaultKeyring(keyring);
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await Promise.all(pools.map((pool) => pool.end()));
  await container?.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  if (!container) throw new Error('no container');
  const admin = createIntegrationPool(container.getConnectionUri());
  pools.push(admin);
  await admin.query(`create database ${name}`);
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  const pool = createIntegrationPool(url.toString());
  pools.push(pool);
  return createDatabase(pool);
}

/** An inquiry and an active session of it, written with the columns every schema since 0003 has. */
async function seedSession(db: Database) {
  const { environment } = await createTestTenant(db);
  const { inquiry, templateId, versionId } = await createTestInquiryOnEarlierSchema(
    db,
    environment.id,
  );
  const sessionId = testId('iqse');
  await db.execute(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ('${sessionId}', '${environment.id}', '${inquiry.id}', '${'b'.repeat(64)}',
               now() + interval '1 hour')`,
  );
  return { environmentId: environment.id, inquiryId: inquiry.id, sessionId, templateId, versionId };
}

/** A network evaluation of the session, and an `ip-address` report template and report. */
async function writePhase7Rows(db: Database, seeded: Awaited<ReturnType<typeof seedSession>>) {
  const { environmentId, sessionId } = seeded;
  await db.execute(
    `insert into networks (id, environment_id, inquiry_session_id, asn, country_code,
       client_address_source, evaluated_at)
     values ('${testId('net')}', '${environmentId}', '${sessionId}', 64496, 'ZZ', 'socket', now())`,
  );
  await db.execute(
    `update inquiry_sessions set network_evaluated_at = now(), is_tor = false, threat_level = 'low'
      where id = '${sessionId}'`,
  );
  const template = testId('rptp');
  const version = testId('rptpv');
  await db.execute(
    `insert into report_templates (id, environment_id, name, report_type)
       values ('${template}', '${environmentId}', 'Synthetic IP address', 'ip-address')`,
  );
  await db.execute(
    `insert into report_template_versions (id, environment_id, report_template_id, version,
       config, status, published_at)
     values ('${version}', '${environmentId}', '${template}', 1, '{}', 'published', now())`,
  );
  await db.execute(
    `insert into reports (id, environment_id, report_type, report_template_id,
       report_template_version_id, origin)
     values ('${testId('rep')}', '${environmentId}', 'ip-address', '${template}', '${version}', 'api')`,
  );
}

/** A signal body, an outbox row and a device linked to the session (checkpoint (S)). */
async function writeSignalRows(db: Database, seeded: Awaited<ReturnType<typeof seedSession>>) {
  const { environmentId, inquiryId, sessionId } = seeded;
  const device = testId('dev');
  await db.execute(
    `insert into inquiry_session_signals (environment_id, inquiry_session_id, sequence, screen,
       platform, collector_version)
     values ('${environmentId}', '${sessionId}', 0, 'consent', 'web', 1)`,
  );
  await db.execute(
    `insert into inquiry_signal_computations (environment_id, inquiry_id, trigger_status)
       values ('${environmentId}', '${inquiryId}', 'completed')`,
  );
  await db.execute(
    `insert into devices (id, environment_id, platform, collector_version, device_class, key_id,
       first_seen_at, last_seen_at)
     values ('${device}', '${environmentId}', 'web', 1, '${'c'.repeat(64)}', 'AAAAAAAAAAA', now(),
       now())`,
  );
  await db.execute(
    `insert into session_devices (environment_id, inquiry_session_id, device_id)
       values ('${environmentId}', '${sessionId}', '${device}')`,
  );
}

/** A phone session redeemed from the seeded one, its token and its step's state (checkpoint (H)). */
async function writeHandoffRows(db: Database, seeded: Awaited<ReturnType<typeof seedSession>>) {
  const { environmentId, inquiryId, sessionId } = seeded;
  const phone = testId('iqse');
  await db.execute(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at,
       device_handoff_method, handoff_from_session_id, handoff_redeemed_at)
     values ('${phone}', '${environmentId}', '${inquiryId}', '${'d'.repeat(64)}',
       now() + interval '1 hour', 'qr', '${sessionId}', now())`,
  );
  await db.execute(
    `insert into handoff_tokens (id, environment_id, inquiry_id, issuing_session_id, step_id,
       method, token_hash, expires_at, redeemed_at, redeemed_session_id)
     values ('${testId('hnd')}', '${environmentId}', '${inquiryId}', '${sessionId}',
       'device_handoff', 'qr', '${'e'.repeat(64)}', now() + interval '5 minutes', now(),
       '${phone}')`,
  );
  await db.execute(
    `insert into inquiry_handoff_steps (environment_id, inquiry_id, step_id, state)
       values ('${environmentId}', '${inquiryId}', 'device_handoff', 'redeemed')`,
  );
  await db.execute(
    `insert into verifications (id, environment_id, inquiry_id, type, created_by_session_id)
       values ('${testId('ver')}', '${environmentId}', '${inquiryId}', 'government_id',
         '${phone}')`,
  );
}

async function handoffRowCounts(db: Database) {
  const result = await db.execute(
    `select (select count(*)::int from handoff_tokens) as tokens,
            (select count(*)::int from inquiry_handoff_steps) as steps,
            (select count(*)::int from inquiry_sessions where handoff_from_session_id is not null)
              as phones`,
  );
  return result.rows;
}

async function signalRowCounts(db: Database) {
  const result = await db.execute(
    `select (select count(*)::int from inquiry_session_signals) as bodies,
            (select count(*)::int from inquiry_signal_computations) as computations,
            (select count(*)::int from session_devices) as links`,
  );
  return result.rows;
}

async function networkFacts(db: Database, sessionId: string) {
  const result = await db.execute(
    `select s.is_tor, s.threat_level, n.asn::int as asn, n.threat_level as network_threat_level
       from inquiry_sessions s join networks n on n.inquiry_session_id = s.id
      where s.id = '${sessionId}'`,
  );
  return result.rows;
}

describe('Workflow 7A migration 0023 on Postgres 17', () => {
  it('creates the network, signal, device and handoff tables on an empty database; a session takes its rows with it', async () => {
    const db = await freshDatabase('phase7_0023_empty');
    await runMigrations(db);
    const seeded = await seedSession(db);

    await writePhase7Rows(db, seeded);
    await writeSignalRows(db, seeded);
    await writeHandoffRows(db, seeded);

    expect(await handoffRowCounts(db)).toEqual([{ tokens: 1, steps: 1, phones: 1 }]);
    expect(await networkFacts(db, seeded.sessionId)).toEqual([
      { is_tor: false, threat_level: 'low', asn: 64496, network_threat_level: 'unknown' },
    ]);
    expect(await signalRowCounts(db)).toEqual([{ bodies: 1, computations: 1, links: 1 }]);
    await db.execute(`delete from inquiries where id = '${seeded.inquiryId}'`);
    const left = await db.execute(`select count(*)::int as count from networks`);
    expect(left.rows).toEqual([{ count: 0 }]);
    // The session's bodies and links and the inquiry's outbox row go with it.
    expect(await signalRowCounts(db)).toEqual([{ bodies: 0, computations: 0, links: 0 }]);
    // The handoff tokens, the step's state and the phone's session go with the inquiry too.
    expect(await handoffRowCounts(db)).toEqual([{ tokens: 0, steps: 0, phones: 0 }]);
  });

  it('upgrades a database at 0022 with rows in it: the session keeps its row, its facts and signals start empty', async () => {
    const db = await freshDatabase('phase7_0023_upgrade');
    await runMigrations(db, { upTo: '0022_watchlist_changed_page_index' });
    const seeded = await seedSession(db);
    await db.execute(
      `insert into verifications (id, environment_id, inquiry_id, type)
         values ('${testId('ver')}', '${seeded.environmentId}', '${seeded.inquiryId}', 'selfie')`,
    );

    await runMigrations(db);

    const session = await db.execute(
      `select status, network_evaluated_at, is_tor, threat_level, location
         from inquiry_sessions where id = '${seeded.sessionId}'`,
    );
    expect(session.rows).toEqual([
      {
        status: 'active',
        network_evaluated_at: null,
        is_tor: null,
        threat_level: null,
        location: null,
      },
    ]);
    const signals = await db.execute(
      `select i.signals, i.signal_details, v.signal_config, s.signals_collected,
              s.signal_bodies_dropped, s.os_name
         from inquiries i
         join inquiry_template_versions v on v.id = i.inquiry_template_version_id
         join inquiry_sessions s on s.inquiry_id = i.id
        where s.id = '${seeded.sessionId}'`,
    );
    expect(signals.rows).toEqual([
      {
        signals: null,
        signal_details: null,
        signal_config: {},
        signals_collected: [],
        signal_bodies_dropped: 0,
        os_name: null,
      },
    ]);
    const handoff = await db.execute(
      `select s.device_handoff_method, s.handoff_from_session_id, s.handoff_rejected_at,
              v.created_by_session_id, v.from_rejected_handoff
         from inquiry_sessions s join verifications v on v.inquiry_id = s.inquiry_id
        where s.id = '${seeded.sessionId}'`,
    );
    expect(handoff.rows).toEqual([
      {
        device_handoff_method: null,
        handoff_from_session_id: null,
        handoff_rejected_at: null,
        created_by_session_id: null,
        from_rejected_handoff: false,
      },
    ]);
    await writePhase7Rows(db, seeded);
    await writeSignalRows(db, seeded);
    await writeHandoffRows(db, seeded);
    expect(await handoffRowCounts(db)).toEqual([{ tokens: 1, steps: 1, phones: 1 }]);
    expect(await networkFacts(db, seeded.sessionId)).toHaveLength(1);
    expect(await signalRowCounts(db)).toEqual([{ bodies: 1, computations: 1, links: 1 }]);
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });
});
