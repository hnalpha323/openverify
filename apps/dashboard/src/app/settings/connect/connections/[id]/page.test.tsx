import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGREEMENT_REFERENCE,
  CONNECTION_IDS,
  connection,
} from '../../../../../components/connect/connect-fixtures';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { rscPayloadOf } from '../../../../../testing/rsc-payload';
import { expectNotFound } from '../../../../../testing/next-errors';
import ConnectionPage, { metadata } from './page';

vi.mock('../../actions', () => ({
  activateConnectionAction: vi.fn(),
  deactivateConnectionAction: vi.fn(),
  reactivateConnectionAction: vi.fn(),
  changeSharePolicyAction: vi.fn(),
  startConnectStepUpWebauthn: vi.fn(),
}));
vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const ADMIN: readonly Permission[] = PERMISSIONS;
const READER: readonly Permission[] = ['connect-connections:read'];
const as = (permissions: readonly Permission[]) => api.me({ permissions });
const serve = (resource: ReturnType<typeof connection>) =>
  api.on('GET', `/connect/connections/${resource.id}`, 200, { data: resource });
const element = (id: string) => ConnectionPage({ params: Promise.resolve({ id }) });
const page = async (id: string) => render(<ToastProvider>{await element(id)}</ToastProvider>);
const detail = (term: string) =>
  screen.getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('a connection’s page (C242.1)', () => {
  it('is titled Connection', () => {
    expect(metadata.title).toBe('Connection');
  });

  it('shows the destination the source, the status, the versions and the agreement reference, without pii:view', async () => {
    as(READER);
    serve(connection('inbound'));

    await page(CONNECTION_IDS.inbound);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Example Source');
    expect(detail('Direction')).toHaveTextContent('Inbound: you receive shares');
    expect(detail('Status')).toHaveTextContent('Active');
    expect(detail('Policy version')).toHaveTextContent('Version 1');
    expect(detail('Accepted version')).toHaveTextContent('Version 1');
    expect(detail('Agreement reference')).toHaveTextContent(AGREEMENT_REFERENCE);
  });

  it('states the policy in words', async () => {
    as(READER);
    serve(connection('inbound'));

    await page(CONNECTION_IDS.inbound);

    const policy = screen.getByRole('region', { name: 'Share policy, version 1' });
    expect(within(policy).getByText('Verification types', { selector: 'dt' })).toBeInTheDocument();
    expect(policy).toHaveTextContent('Government ID, selfie and database');
    expect(policy).toHaveTextContent('Face templates are never shared.');
  });

  it('never shows the source an agreement reference, and says the destination is named once it activates', async () => {
    as(ADMIN);
    serve(connection('outbound', { status: 'pending', destinationName: null }));

    await page(CONNECTION_IDS.outbound);

    expect(screen.queryByText('Agreement reference', { selector: 'dt' })).toBeNull();
    expect(detail('Destination')).toHaveTextContent('Named once the destination activates');
    expect(detail('Accepted version')).toHaveTextContent('Not accepted yet');
  });

  it('says that a changed policy waits for the destination, and that the earlier version is not served', async () => {
    as(ADMIN);
    serve(connection('inbound', { status: 'pending', version: 2, acceptedVersion: 1 }));

    await page(CONNECTION_IDS.inbound);

    expect(
      screen.getByText(
        'The source changed the policy: version 2 waits for your acceptance. You accepted version 1.',
      ),
    ).toBeInTheDocument();
  });

  it('offers the destination’s admin the activation, showing the policy before the confirmation (C231.3)', async () => {
    as(ADMIN);
    serve(connection('inbound', { status: 'pending' }));
    const user = userEvent.setup();

    await page(CONNECTION_IDS.inbound);
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    const dialog = screen.getByRole('dialog', {
      name: 'Activate the connection from Example Source',
    });
    expect(dialog).toHaveTextContent('You accept version 1 of this share policy');
    expect(within(dialog).getByText('Biometric data', { selector: 'dt' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Agreement reference/ })).toBeRequired();
    expect(
      within(dialog).getByRole('checkbox', { name: /I accept this policy/ }),
    ).not.toBeChecked();
    expect(within(dialog).getByRole('textbox', { name: /code/i })).toBeInTheDocument();
  });

  it('offers no activation to the source, to an operator without the permission, or once active', async () => {
    as(ADMIN);
    serve(connection('outbound', { status: 'pending', destinationName: null }));
    const { unmount } = await page(CONNECTION_IDS.outbound);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    unmount();

    as(PERMISSIONS.filter((permission) => permission !== 'connect-connections:activate'));
    serve(connection('inbound', { status: 'pending' }));
    const second = await page(CONNECTION_IDS.inbound);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.getByText(/Only an administrator of your organization/)).toBeInTheDocument();
    second.unmount();

    as(ADMIN);
    serve(connection('inbound'));
    await page(CONNECTION_IDS.inbound);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('lets the source change the policy and either side deactivate an active connection', async () => {
    as(ADMIN);
    serve(connection('outbound'));
    const { unmount } = await page(CONNECTION_IDS.outbound);
    expect(screen.getByRole('button', { name: 'Change the policy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull();
    unmount();

    serve(connection('inbound'));
    await page(CONNECTION_IDS.inbound);
    expect(screen.queryByRole('button', { name: 'Change the policy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('lets only the source reactivate an inactive connection, and says who deactivated it', async () => {
    as(ADMIN);
    serve(connection('outbound', { status: 'inactive', deactivatedBy: 'destination' }));
    const { unmount } = await page(CONNECTION_IDS.outbound);
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
    expect(detail('Deactivated')).toHaveTextContent('by the destination');
    unmount();

    serve(connection('inbound', { status: 'inactive' }));
    await page(CONNECTION_IDS.inbound);
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull();
  });

  it('offers no change to a reader', async () => {
    as(READER);
    serve(connection('self'));

    await page(CONNECTION_IDS.self);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the policy change with the current policy as JSON', async () => {
    as(ADMIN);
    serve(connection('outbound'));
    const user = userEvent.setup();

    await page(CONNECTION_IDS.outbound);
    await user.click(screen.getByRole('button', { name: 'Change the policy' }));

    const editor = screen.getByRole('textbox', { name: 'Share policy (JSON)' });
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(
      connection('outbound').attributes['share-policy'].body,
    );
  });

  it('answers not found for an id that is not a connection’s, without calling the API', async () => {
    as(ADMIN);

    await expectNotFound(element('inq_01M5CN0000000000000011A100'));
    expect(api.all('GET', '/connect/connections/inq_01M5CN0000000000000011A100')).toHaveLength(0);
  });

  it('answers not found for the one generic 404 (C232.8)', async () => {
    as(ADMIN);
    api.onProblem('GET', `/connect/connections/${CONNECTION_IDS.inbound}`, 404);

    await expectNotFound(element(CONNECTION_IDS.inbound));
  });
});

describe('what the connection page sends the browser (C242.5)', () => {
  it('sends the destination its agreement reference without pii:view, and the source never one', async () => {
    as(READER);
    serve(connection('inbound'));
    expect(await rscPayloadOf(await element(CONNECTION_IDS.inbound))).toContain(
      AGREEMENT_REFERENCE,
    );

    as(ADMIN);
    serve(connection('outbound'));
    const payload = await rscPayloadOf(await element(CONNECTION_IDS.outbound));
    expect(payload).not.toContain(AGREEMENT_REFERENCE);
    expect(payload).not.toContain('agreement-reference');
  });
});
