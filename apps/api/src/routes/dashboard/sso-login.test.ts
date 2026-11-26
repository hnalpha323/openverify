/**
 * C248.6 and C248.8 (Workflow 11B, `sso-oidc`): the C4 sign-in route `POST /dashboard/sessions`
 * takes the optional sign-in name `organization`, and answers 403 `sso_password_disabled` (one
 * generic problem) for a right password in an organisation whose provider is enforced. Synthetic
 * operators, secrets and addresses only.
 */
import { problemSchema } from '@openverify/contracts';
import { createSsoProvider, setOrganizationSlug } from '@openverify/db';
import { createTestDatabase, testId, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function harness() {
  const created = await createDashboardHarness(database);
  harnesses.push(created);
  return created;
}

async function named(api: DashboardHarness): Promise<TestOrganization & { slug: string }> {
  const organization = await api.organization();
  counter += 1;
  const slug = `synthetic-route-${String(counter)}`;
  expect(await setOrganizationSlug(database.db, organization.id, slug)).toBe('set');
  return { ...organization, slug };
}

describe('POST /dashboard/sessions with a sign-in name (C248.8)', () => {
  it('signs in with the name of the operator’s organisation and answers the generic 401 for any other name', async () => {
    const api = await harness();
    const mine = await named(api);
    const other = await named(api);
    const { email, user } = await api.operator(mine);

    const signedIn = expectJson<{ user: { id: string } }>(
      await api.call('POST', '/sessions', {
        payload: { email, password: PASSWORD, organization: mine.slug },
      }),
      201,
    );
    expect(signedIn.user.id).toBe(user.id);

    for (const organization of [other.slug, 'synthetic-nobody']) {
      const refused = await api.call('POST', '/sessions', {
        payload: { email, password: PASSWORD, organization },
      });
      expect(refused.statusCode).toBe(401);
      expect(problemSchema.parse(refused.json())).toMatchObject({
        status: 401,
        detail: 'The email or password is incorrect.',
      });
    }
  });
});

describe('POST /dashboard/sessions under an enforced provider (C248.6)', () => {
  it('answers 403 sso_password_disabled for the right password, the generic 401 for a wrong one', async () => {
    const api = await harness();
    const organization = await named(api);
    const { email } = await api.operator(organization);
    await createSsoProvider(database.db, {
      id: testId('ssop'),
      organizationId: organization.id,
      displayName: 'Workforce',
      issuer: 'https://idp.example.com/oauth2/default',
      clientId: 'synthetic-client-id',
      clientSecret: 'synthetic-client-secret-canary',
      allowedEmailDomains: ['example.test'],
      tenantPinClaim: null,
      tenantPinValue: null,
      requiredAmr: [],
      requiredAcr: [],
      jitProvisioning: false,
      defaultRoleIds: [],
      enforced: true,
      at: api.clock.now(),
    });

    const refused = await api.call('POST', '/sessions', { payload: { email, password: PASSWORD } });
    expect(refused.statusCode).toBe(403);
    expect(problemSchema.parse(refused.json())).toMatchObject({
      code: 'sso_password_disabled',
      detail: 'This organization signs in with single sign-on only.',
    });
    expect(refused.body).not.toContain(email);

    const wrong = await api.call('POST', '/sessions', {
      payload: { email, password: 'synthetic wrong password' },
    });
    expect(wrong.statusCode).toBe(401);
  });
});
