import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_ID,
  AUDIT_IDS,
  INQUIRY_ID,
  USER_IDS,
  allUsers,
  auditLog,
  listOf,
} from '../../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import AuditLogPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

function signedIn(permissions: readonly Permission[]): MockApi {
  return api.reply(200, meDocument({ permissions }));
}

async function renderEntry(id: string = AUDIT_IDS.first) {
  render(await AuditLogPage({ params: Promise.resolve({ id }) }));
}

const details = () => within(screen.getByRole('region', { name: 'Details' }));

describe('audit log entry page', () => {
  it('shows every member of the entry, with the actor named and the resource linked', async () => {
    signedIn([...PERMISSIONS])
      .reply(200, { data: auditLog() })
      .reply(200, listOf(allUsers()));

    await renderEntry();

    expect(screen.getByRole('heading', { level: 1, name: 'inquiry.approved' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Audit logs' })).toHaveAttribute('href', '/audit-logs');
    expect(details().getByText('Oct 20, 2026, 4:35 AM')).toBeVisible();
    expect(details().getByText('Synthetic Reviewer (reviewer@example.test)')).toBeVisible();
    expect(details().getByText(USER_IDS.reviewer)).toBeVisible();
    expect(details().getByText('inquiry')).toBeVisible();
    expect(details().getByRole('link', { name: INQUIRY_ID })).toHaveAttribute(
      'href',
      `/inquiries/${INQUIRY_ID}`,
    );
    expect(details().getByText('192.0.2.10')).toBeVisible();
    expect(details().getByText('Synthetic Browser/1.0')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Metadata' })).toHaveTextContent(
      '"from": "needs_review"',
    );
    expect(screen.getByRole('link', { name: 'Entries by this actor' })).toHaveAttribute(
      'href',
      `/audit-logs?actor=${USER_IDS.reviewer}`,
    );
    expect(screen.getByRole('link', { name: 'Entries about this resource' })).toHaveAttribute(
      'href',
      `/audit-logs?resource-id=${INQUIRY_ID}`,
    );
    expect(api.requests[1]).toMatchObject({
      path: `/api/v1/dashboard/audit-logs/${AUDIT_IDS.first}`,
    });
  });

  it('shows a system entry with no actor id and no link to entries by its actor (K7A-8, C15)', async () => {
    signedIn(['audit-logs:read']).reply(200, {
      data: auditLog({
        action: 'handoff.issued',
        actor: { type: 'system', id: null },
        'ip-address': null,
        'user-agent': null,
      }),
    });

    await renderEntry();

    expect(details().getByText('System')).toBeVisible();
    expect(details().queryByText(/^(usr|key)_/u)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Entries by this actor' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entries about this resource' })).toBeVisible();
  });

  it('shows masked addresses as hidden, an API key actor, and no resource', async () => {
    signedIn(['audit-logs:read']).reply(200, {
      data: auditLog({
        actor: { type: 'api-key', id: API_KEY_ID },
        'resource-type': null,
        'resource-id': null,
        'ip-address': null,
        'user-agent': null,
        metadata: {},
      }),
    });

    await renderEntry();

    expect(details().getAllByText('Hidden')).toHaveLength(2);
    expect(details().getByText('API key')).toBeVisible();
    expect(details().getByText(API_KEY_ID)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Metadata' })).toHaveTextContent('No metadata.');
    expect(
      screen.queryByRole('link', { name: 'Entries about this resource' }),
    ).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(2);
  });

  it('links an API key resource to its page', async () => {
    signedIn(['audit-logs:read']).reply(200, {
      data: auditLog({ 'resource-type': 'api-key', 'resource-id': API_KEY_ID }),
    });

    await renderEntry();

    expect(details().getByRole('link', { name: API_KEY_ID })).toHaveAttribute(
      'href',
      `/api-keys/${API_KEY_ID}`,
    );
  });

  it.each([
    ['workflow-run', 'wfr_01M5CJXHG07XPHF3HRM6NREDH8', '/workflows/runs'],
    ['workflow', 'wfl_01M5CJXHG07XPHF3HRM6NREDH8', '/workflows'],
  ])('links a %s resource to its page (C141)', async (type, id, path) => {
    signedIn(['audit-logs:read']).reply(200, {
      data: auditLog({ 'resource-type': type, 'resource-id': id }),
    });

    await renderEntry();

    expect(details().getByRole('link', { name: id })).toHaveAttribute('href', `${path}/${id}`);
  });

  it('shows a resource of a type without a page as text', async () => {
    signedIn(['audit-logs:read']).reply(200, {
      data: auditLog({
        'resource-type': 'environment',
        'resource-id': 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51',
      }),
    });

    await renderEntry();

    expect(details().getByText('env_01J9ZK3M5Q7R8S9T0V1W2X3Y51')).toBeVisible();
    expect(
      details().queryByRole('link', { name: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51' }),
    ).not.toBeInTheDocument();
  });

  it('answers not found for a malformed id, without calling the API', async () => {
    await expectNotFound(AuditLogPage({ params: Promise.resolve({ id: 'aud_bad' }) }));
    expect(api.requests).toHaveLength(0);
  });

  it("answers not found for an entry of another environment (the API's 404)", async () => {
    signedIn(['audit-logs:read']).replyProblem(404);

    await expectNotFound(AuditLogPage({ params: Promise.resolve({ id: AUDIT_IDS.second }) }));
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Audit log entry');
  });
});
