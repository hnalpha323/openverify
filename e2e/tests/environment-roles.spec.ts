/**
 * C178.4 (Workflow 9B, integration-9b): a role granted only in the sandbox (C167.2, C167.3).
 * Budget: 90 s.
 *
 * The admin assigns a new operator one custom role reaching the sandbox only. The operator's
 * session opens in the sandbox and acts there, cannot switch to production (403
 * `no_environment_role`), and so can never act in production. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { operatorWithRole, serverRequest } from './support/platform-9b.js';
import { dashboardRequest } from './support/platform.js';

test('a role granted only in sandbox cannot act in production (C167.2, C167.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const operator = await operatorWithRole(
    stack,
    ['inquiries:read', 'inquiries:write'],
    [stack.environments.sandbox],
  );
  const token = await operator.signIn();

  const me = await dashboardRequest(stack, 'GET', '/me', { token });
  expect(me.status, JSON.stringify(me.body)).toBe(200);
  expect(JSON.stringify(me.body)).toContain(stack.environments.sandbox);
  const created = await serverRequest(stack, token, 'POST', '/inquiries', {
    data: {
      type: 'inquiry',
      attributes: {
        'inquiry-template-id': stack.defaultTemplateId,
        'reference-id': `e2e-sandbox-role-${randomUUID()}`,
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const switched = await dashboardRequest(stack, 'PUT', '/sessions/current/environment', {
    token,
    body: { 'environment-id': stack.environments.production },
  });
  expect(switched.status, JSON.stringify(switched.body)).toBe(403);
  expect((switched.body as { code?: string }).code).toBe('no_environment_role');
  // The session is still in the sandbox: nothing it does reaches production.
  const listed = await serverRequest(stack, token, 'GET', '/inquiries?page[size]=1');
  expect(listed.status).toBe(200);
});
