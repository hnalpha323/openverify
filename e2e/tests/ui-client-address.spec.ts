/**
 * C21's client-address chain, end to end (Workflow 2D F020): a browser request to the dashboard,
 * the custom server (`server.ts`) that sets `x-openverify-peer-ip` from the socket, the BFF that
 * sends it as `x-openverify-client-ip` with its token, and the API that records it in the audit
 * log. A client-chosen `X-Forwarded-For`, `x-openverify-peer-ip` or `x-openverify-client-ip`
 * must never be what the API records.
 *
 * The request comes from 127.0.0.2, another loopback address, so the recorded address tells the
 * operator's socket apart from the dashboard's own (127.0.0.1), which the API would record if the
 * BFF headers were lost.
 */
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { flowApi, recordingClient } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

/**
 * The dashboard's session cookie (`apps/dashboard/src/lib/session-cookie.ts`): the e2e stack serves
 * a production build, whose session cookie is Secure and so named with the `__Host-` prefix (KP11-78).
 */
const SESSION_COOKIE = '__Host-openverify_session';
const OPERATOR_ADDRESS = '127.0.0.2';
const FORGED = {
  'x-forwarded-for': '203.0.113.66',
  'x-openverify-peer-ip': '198.51.100.7',
  'x-openverify-client-ip': '192.0.2.9',
} as const;

/**
 * A GET from `localAddress`, as a browser on another host would send it; answers the status.
 * `family: 4` keeps the destination IPv4 like the source: where `localhost` resolves to `::1`
 * first (GitHub's runners), an IPv6 socket cannot bind 127.0.0.2 (`bind EINVAL`). The dashboard
 * listens on 127.0.0.1 (`e2e/setup/stack.ts`).
 */
function getFrom(localAddress: string, url: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const options = { method: 'GET', localAddress, family: 4, headers };
    const outgoing = request(url, options, (response) => {
      response.resume();
      response.on('end', () => {
        resolve(response.statusCode ?? 0);
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('the API records the operator socket address behind the dashboard, never a forged header', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);

  // An inquiry with one uploaded image, whose view the API audits as `file.viewed`.
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-client-address-${randomUUID()}`,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  const flow = flowApi(stack.apiUrl, resumed.meta['session-token']);
  const session = await flow.session();
  const consent = session.flow.steps.find((step) => step.type === 'consent');
  await flow.consent(consent?.type === 'consent' ? consent.textKeys : []);
  const verificationId = await flow.createVerification('government-id');
  const fileId = await flow.upload(verificationId, 'front', FIXTURES.idFront);

  // The reviewer (who holds pii:view) opens the image through the dashboard's file proxy.
  const token = await sessionTokenAs(stack, 'reviewer');
  const status = await getFrom(OPERATOR_ADDRESS, `${stack.dashboardUrl}/files/${fileId}/content`, {
    cookie: `${SESSION_COOKIE}=${token}`,
    ...FORGED,
  });
  expect(status).toBe(200);

  const { data: entries } = await client.userAuditLogs.list({
    filter: { action: 'file.viewed', 'resource-id': fileId },
  });
  expect(entries.map((entry) => entry.attributes['ip-address'])).toEqual([OPERATOR_ADDRESS]);
});
