/**
 * C240.2 (Workflow 11A, `api-connect` checkpoint 4): the authorization matrix as a contract test,
 * through the routes on PGlite. Each case gets a fresh scene, so a write never changes another's
 * answer; every 404 is the one generic body of C232.8.
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM, newId, type SharePolicyInput } from '@openverify/contracts';
import { createEnvironment, organizations, setOrganizationConnectInbound } from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import {
  AUTHORIZATION_MATRIX,
  caseName,
  matrixScene,
  permissionsOf,
  targetOf,
  type MatrixCase,
  type MatrixOrg,
} from './authorization-matrix.test-support.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as SharePolicyInput;

let api: TestApi;
let callCount = 0;

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
}, 120_000);
afterAll(async () => {
  await api.close();
});

async function organisation(name: string, inbound: boolean): Promise<MatrixOrg> {
  const tenant = await api.newTenant({ kind: 'production' });
  const sandbox = await createEnvironment(api.database.db, {
    id: newId('env'),
    organizationId: tenant.organizationId,
    kind: 'sandbox',
  });
  await api.database.db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, tenant.organizationId));
  if (inbound) {
    await setOrganizationConnectInbound(api.database.db, tenant.organizationId, true);
  }
  return { id: tenant.organizationId, sandbox: sandbox.id, production: tenant.environmentId };
}

/** The request of a case's route, against its scene's ids. */
function requestOf(
  matrixCase: MatrixCase,
  target: { connectionId: string; tokenId: string },
  fresh: { inquiryId: string; consentRecordId: string },
): { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> } {
  const connection = `/api/v1/connect/connections/${target.connectionId}`;
  const token = `/api/v1/connect/share-tokens/${target.tokenId}`;
  switch (matrixCase.route) {
    case 'connection.list':
      return { method: 'GET', url: '/api/v1/connect/connections' };
    case 'connection.get':
      return { method: 'GET', url: connection };
    case 'connection.deactivate':
      return { method: 'POST', url: `${connection}/deactivate`, payload: {} };
    case 'connection.reactivate':
      return { method: 'POST', url: `${connection}/reactivate`, payload: {} };
    case 'connection.policy':
      return {
        method: 'POST',
        url: `${connection}/share-policy`,
        payload: { data: { attributes: { 'share-policy': POLICY } } },
      };
    case 'token.list':
      return { method: 'GET', url: '/api/v1/connect/share-tokens' };
    case 'token.create':
      return {
        method: 'POST',
        url: '/api/v1/connect/share-tokens',
        payload: {
          data: {
            attributes: {
              'connection-id': target.connectionId,
              'source-id': fresh.inquiryId,
              'consent-record-id': fresh.consentRecordId,
            },
          },
        },
      };
    case 'token.get':
      return { method: 'GET', url: token };
    case 'token.peek':
      return { method: 'GET', url: `${token}?peek-source-data=true` };
    case 'token.expire':
      return { method: 'POST', url: `${token}/expire`, payload: {} };
  }
}

describe('the Connect authorization matrix through the routes (C240.2)', () => {
  it.each(AUTHORIZATION_MATRIX.map((matrixCase) => [caseName(matrixCase), matrixCase] as const))(
    '%s',
    async (_name, matrixCase) => {
      const scene = await matrixScene(api.deps, organisation, POLICY);
      const org = scene.orgs[matrixCase.organisation];
      const environmentId = matrixCase.kind === 'sandbox' ? org.sandbox : org.production;
      const permissions = permissionsOf(matrixCase.principal);
      const credential = matrixCase.principal.startsWith('key')
        ? await api.newApiKey(environmentId, { scopes: permissions })
        : api.newUserToken(environmentId, { permissions });
      const request = requestOf(matrixCase, targetOf(scene, matrixCase), scene.fresh);
      const response = await api.app.inject({
        method: request.method,
        url: request.url,
        headers: {
          ...bearer(credential),
          'idempotency-key': `synthetic-matrix-${String((callCount += 1))}`,
        },
        ...(request.payload === undefined ? {} : { payload: request.payload }),
      });
      expect(response.statusCode, response.body).toBe(matrixCase.expected);
      if (matrixCase.expected === 404) {
        expect(
          Object.fromEntries(
            Object.entries(response.json<Record<string, unknown>>()).filter(
              ([member]) => member !== 'instance' && member !== 'requestId',
            ),
          ),
        ).toEqual(CONNECT_NOT_FOUND_PROBLEM);
      }
    },
  );
});
