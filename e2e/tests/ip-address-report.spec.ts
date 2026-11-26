/**
 * C106.1, C93.3, C93.6 (Workflow 7A): the `ip-address` report, full stack, once per sandbox address
 * of C93.6 against the synthetic network data `seed:dev` imports (`openverify-sandbox-network`,
 * `origin: import`) and the sandbox `ipReputation` the stack binds. Budget: 90 s.
 *
 * - `192.0.2.10`, a Tor exit: `tor-exit-node` MATCHED, flagged;
 * - `192.0.2.20`, the fictional provider `example-cloud`: `datacenter-ip` and `service-type`
 *   DATACENTER from the provider range, flagged;
 * - `192.0.2.30`, VPN AS64500: `vpn-detected` (H, with its confidence), flagged;
 * - `192.0.2.40`, a proxy through the sandbox adapter: `proxy-detected`, flagged;
 * - `192.0.2.50`, hosting AS64503 only: `hosting-asn`, which never reaches the public datacenter
 *   fields and does not flag (H13, decision 42);
 * - `198.51.100.7`, AS64501 "Example Residential": the exit list answers CLEARED, nothing flags;
 * - `2001:db8::7`, IPv6: `tor-exit-node` is `null` with `ipv6_not_covered`, never CLEARED (H07).
 * `has-match` is always `false` (review model `none`). No publisher is called; every address is
 * from the documentation ranges and every ASN fictional.
 */
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';
import {
  attributesOf,
  seededTemplateId,
  waitForReport,
  type ReportAttributes,
} from './support/reports.js';

async function reportOn(
  client: OpenVerifyClient,
  templateId: string,
  address: string,
): Promise<ReportAttributes> {
  const { data } = await client.reports.create(
    'report/ip-address',
    { 'report-template-id': templateId, query: { 'ip-address': address } },
    { 'auto-create-account': false },
  );
  return attributesOf(await waitForReport(client, data.id));
}

const unavailable = (attributes: ReportAttributes, field: string) =>
  (attributes['unavailable-fields'] as { field: string; reason: string }[]).find(
    (entry) => entry.field === field,
  )?.reason;

test('the ip-address report answers each sandbox address from the imported network data, with null where the data cannot answer (C106.1, C93.6)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const templateId = await seededTemplateId(client, 'ip-address');
  const addresses = [
    '192.0.2.10',
    '192.0.2.20',
    '192.0.2.30',
    '192.0.2.40',
    '192.0.2.50',
    '198.51.100.7',
    '2001:db8::7',
  ] as const;
  const reports = Object.fromEntries(
    await Promise.all(
      addresses.map(async (address) => [address, await reportOn(client, templateId, address)]),
    ),
  ) as Record<(typeof addresses)[number], ReportAttributes>;

  for (const address of addresses) {
    const report = reports[address];
    expect(report.status, address).toBe('ready');
    expect(report['has-match'], address).toBe(false);
    expect(report['country-code'], address).toBe('ZZ');
    expect(report.sources, address).toEqual([
      expect.objectContaining({ 'source-id': 'openverify-sandbox-network', origin: 'import' }),
    ]);
  }

  expect(reports['192.0.2.10']).toMatchObject({ 'tor-exit-node': 'MATCHED', flagged: true });
  expect(reports['192.0.2.20']).toMatchObject({
    'datacenter-ip': true,
    'service-type': 'DATACENTER',
    'tor-exit-node': 'CLEARED',
    flagged: true,
  });
  expect(reports['192.0.2.30']).toMatchObject({ 'vpn-detected': true, flagged: true });
  expect(
    (
      reports['192.0.2.30']['field-details'] as Record<
        string,
        { tier: string; confidence?: number }
      >
    )['vpn-detected'],
  ).toMatchObject({ tier: 'H', confidence: expect.any(Number) });
  expect(reports['192.0.2.40']).toMatchObject({ 'proxy-detected': true, flagged: true });
  // H13: a hosting ASN alone is ours; the public datacenter fields stay provider ranges only.
  expect(reports['192.0.2.50']).toMatchObject({
    'hosting-asn': true,
    'datacenter-ip': null,
    'service-type': null,
    flagged: false,
  });
  expect(unavailable(reports['192.0.2.50'], 'datacenter-ip')).toBe('not_in_known_ranges');
  expect(reports['198.51.100.7']).toMatchObject({
    'tor-exit-node': 'CLEARED',
    isp: 'Example Residential',
    flagged: false,
    'vpn-detected': null,
    'datacenter-ip': null,
  });
  // H07: the exit list has no IPv6 exits, so an IPv6 address is never CLEARED.
  expect(reports['2001:db8::7']).toMatchObject({ 'tor-exit-node': null, flagged: false });
  expect(unavailable(reports['2001:db8::7'], 'tor-exit-node')).toBe('ipv6_not_covered');
});
