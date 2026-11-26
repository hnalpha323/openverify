/**
 * C50.4 (H28): in a production environment, an `nfc` step is published only while the trust store
 * holds a non-sandbox anchor that an enabled source lists, or with the type's
 * `accept-review-without-provider: true` (every chip would otherwise end in review); otherwise 422
 * `provider_not_configured`, pointing at the step. The seed's Utopia anchor is sandbox-only, so it
 * never counts. A sandbox environment publishes it as it is. Certificates here are synthetic bytes.
 */
import { createHash } from 'node:crypto';
import {
  applyTrustSync,
  syncTrustAnchorSources,
  type Db,
  type TrustAnchorInput,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nfcTemplateAttributes } from '../chip-challenges/testing.js';
import type { ApiDependencies } from '../context.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { governmentIdNfcPublish } from './government-id-nfc.js';

const NOW = new Date('2026-10-23T08:00:00.000Z');

function anchor(name: string): TrustAnchorInput {
  const certificate = new Uint8Array(Buffer.from(`synthetic csca ${name}`));
  return {
    sha256: createHash('sha256').update(certificate).digest('hex'),
    certificate,
    country: 'DE',
    subjectDn: `C=DE, CN=Synthetic ${name}`,
    ski: createHash('sha1').update(name).digest('hex'),
    aki: null,
    notBefore: new Date('2020-01-01T00:00:00.000Z'),
    notAfter: new Date('2035-01-01T00:00:00.000Z'),
    isLink: false,
  };
}

function problems(db: Db, kind: 'sandbox' | 'production', accept?: boolean) {
  const attributes = nfcTemplateAttributes(
    accept === undefined ? {} : { acceptReviewWithoutProvider: accept },
  );
  return governmentIdNfcPublish.problems({
    deps: {} as ApiDependencies,
    db,
    environment: { id: 'env_x', kind },
    flow: attributes.flow,
    config: attributes['verification-config'],
  });
}

const NFC_STEP_INDEX = nfcTemplateAttributes().flow.steps.findIndex((step) => step.type === 'nfc');

describe('the government ID NFC publish rule (C50.4, H28)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it('refuses a production nfc step without a non-sandbox anchor, even with the seed anchor', async () => {
    await installSandboxTrustAnchor(database.db, { now: NOW });

    await expect(problems(database.db, 'production')).resolves.toEqual([
      {
        code: 'provider_not_configured',
        pointer: `/flow/steps/${String(NFC_STEP_INDEX)}`,
        detail: expect.stringContaining('accept-review-without-provider') as string,
      },
    ]);
  });

  it('accepts it with accept-review-without-provider, and always in sandbox', async () => {
    await expect(problems(database.db, 'production', true)).resolves.toEqual([]);
    await expect(problems(database.db, 'production', false)).resolves.toHaveLength(1);
    await expect(problems(database.db, 'sandbox')).resolves.toEqual([]);
  });

  it('accepts it once an enabled source lists a non-sandbox anchor', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: NOW, anchors: [anchor('de')] },
      crls: [],
      now: NOW,
    });

    await expect(problems(database.db, 'production')).resolves.toEqual([]);

    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: false }]);
    await expect(problems(database.db, 'production')).resolves.toHaveLength(1);
  });
});

describe('publishing through the API (C50.4)', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('answers 422 provider_not_configured for a production template, 201 in sandbox', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const body = { data: { type: 'inquiry-template', attributes: nfcTemplateAttributes() } };

    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(production.token),
      payload: body,
    });
    const created = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
      payload: body,
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'provider_not_configured',
      errors: [{ pointer: `/data/attributes/flow/steps/${String(NFC_STEP_INDEX)}` }],
    });
    expect(created.statusCode).toBe(201);
  });
});
