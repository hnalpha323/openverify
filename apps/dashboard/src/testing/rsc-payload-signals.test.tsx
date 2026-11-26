/**
 * C108 (rule 9): what the Phase 7 signal surfaces send to the browser for a principal without
 * `pii:view`. The API masks every personal value for such a principal; the console renders what it
 * returned and never unmasks on its own, so the RSC payload holds no IP address, coordinate,
 * fingerprint, user agent, list value, compared value or dismissal reason. The device class is
 * not PII (C91.2, Stage 1a amendment 19) and stays.
 */
import type { Permission } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../app/accounts/[id]/page';
import InquiryPage from '../app/inquiries/[id]/page';
import NetworkSourcesPage from '../app/network-sources/page';
import ReportPage from '../app/reports/[id]/page';
import { SESSION_COOKIE } from '../lib/session-cookie';
import { SESSION_TOKEN } from './api-fixtures';
import { routeApi, type RouteApi } from './api-routes';
import { fakeRequest } from './fake-request';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  inquiry,
  inquiryDocument,
  inquiryList,
  relations,
  single,
} from './lifecycle-fixtures';
import { REPORT_IDS, dashboardReport, report } from './report-fixtures';
import { rscPayloadOf } from './rsc-payload';
import { serveNetworkSources } from './routes/network';
import {
  BROWSER_FINGERPRINT,
  DEVICE_CLASS,
  PHONE_IP,
  POINT,
  SESSION_IP,
  SESSION_USER_AGENT,
  computedSignals,
  device,
  ipRangeMatch,
  listMatch,
  maskedDevice,
  maskedMatch,
  maskedNetwork,
  maskedSession,
  matchList,
  network,
  networkSources,
  phase7Session,
  phoneSession,
  sessionDocument,
  SIGNAL_IDS,
} from './signals-fixtures';
import { serveDecisions } from './routes/workflows';

vi.mock('next/headers', () => import('./fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** Every Phase 7 read, every write, and no `pii:view`. */
const WITHOUT_PII: Permission[] = [
  'inquiries:read',
  'inquiries:write',
  'inquiry-sessions:read',
  'inquiry-sessions:write',
  'accounts:read',
  'lists:read',
  'lists:write',
  'reports:read',
  'settings:read',
];

/** The personal values the fixtures hold, none of which may reach the browser unmasked. */
const PERSONAL = [
  SESSION_IP,
  PHONE_IP,
  SESSION_USER_AGENT,
  BROWSER_FINGERPRINT,
  String(POINT.latitude),
  'Example Region',
  'listed@example.test',
  'Synthetic dismissal reason',
];

const DISMISSED = {
  status: 'dismissed',
  'dismissed-at': '2026-10-20T05:00:00.000Z',
  reason: 'Synthetic dismissal reason',
} as const;

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.me({ permissions: WITHOUT_PII });
  api.on('GET', '/dashboard/reports', 200, { data: [], links: { next: null } });
});

afterEach(() => {
  api.restore();
});

const expectNoPersonalValue = (payload: string) => {
  for (const value of PERSONAL) {
    expect(payload, value).not.toContain(value);
  }
  expect(payload).not.toMatch(/\b(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}\b/);
};

describe('the RSC payload of the Phase 7 surfaces without pii:view (C108)', () => {
  it('holds no personal value on the inquiry Sessions, Signals and List matches sections', async () => {
    const desktop = maskedSession(phase7Session());
    const phone = maskedSession(phoneSession());
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument(computedSignals()));
    api.on('GET', '/inquiry-sessions', 200, { data: [desktop, phone], links: { next: null } });
    api.on(
      'GET',
      `/inquiry-sessions/${desktop.id}`,
      200,
      sessionDocument(desktop, [maskedDevice(device()), maskedNetwork(network())]),
    );
    api.on(
      'GET',
      `/inquiry-sessions/${phone.id}`,
      200,
      sessionDocument(phone, [
        maskedNetwork(network({}, SIGNAL_IDS.phoneNetwork, SIGNAL_IDS.phoneSession)),
      ]),
    );
    api.on(
      'GET',
      '/list-matches',
      200,
      matchList([maskedMatch(listMatch()), maskedMatch(ipRangeMatch(DISMISSED))]),
    );

    const payload = await rscPayloadOf(
      await InquiryPage({
        params: Promise.resolve({ id: IDS.inquiry }),
        searchParams: Promise.resolve({}),
      }),
    );

    expectNoPersonalValue(payload);
    expect(payload).toContain(DEVICE_CLASS);
    expect(payload).toContain('12 of 100: no automation artefacts found');
    expect(payload).toContain(SIGNAL_IDS.match);
  });

  it('holds no personal value on the account Signals and List matches sections', async () => {
    api.on('GET', `/accounts/${IDS.account}`, 200, single(account()));
    api.on('GET', `/accounts/${IDS.account}/relations`, 200, relations([]));
    api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
    api.on('GET', '/inquiries', 200, inquiryList([inquiry(computedSignals())]));
    api.on('GET', '/list-matches', 200, matchList([maskedMatch(listMatch(DISMISSED))]));

    const payload = await rscPayloadOf(
      await AccountPage({
        params: Promise.resolve({ id: IDS.account }),
        searchParams: Promise.resolve({}),
      }),
    );

    expectNoPersonalValue(payload);
    expect(payload).toContain(SIGNAL_IDS.match);
  });

  it('holds no personal value on a custom-list report', async () => {
    api.on(
      'GET',
      `/dashboard/reports/${REPORT_IDS.report}`,
      200,
      dashboardReport(report('custom-list', { masked: true })),
    );

    const payload = await rscPayloadOf(
      await ReportPage({ params: Promise.resolve({ id: REPORT_IDS.report }) }),
    );

    expectNoPersonalValue(payload);
    expect(payload).toContain('lst_01M5CK3190XEVBM5ZXA76E1JSN');
  });

  it('holds no address on the network sources page', async () => {
    serveNetworkSources(api, networkSources());

    const payload = await rscPayloadOf(await NetworkSourcesPage());

    expectNoPersonalValue(payload);
    // K8-5: the positive control, so an empty payload cannot pass.
    expect(payload).toContain('openverify-sandbox-network');
  });
});
