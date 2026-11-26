import type { ServedAuditActor } from '@openverify/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditActorValue, actorEntriesHref } from './audit-actor';
import { API_KEY_ID, USER_IDS } from './test-fixtures';

const SYSTEM: ServedAuditActor = { type: 'system', id: null };

describe('AuditActorValue (C15, K7A-8)', () => {
  it('reads a system entry as "System", with no id', () => {
    render(<AuditActorValue actor={SYSTEM} directory={null} />);

    expect(screen.getByText('System')).toBeVisible();
    expect(document.querySelector('code')).toBeNull();
  });

  it('names a user from the directory, with the id', () => {
    render(
      <AuditActorValue
        actor={{ type: 'user', id: USER_IDS.admin }}
        directory={
          new Map([[USER_IDS.admin, { name: 'Synthetic Admin', email: 'admin@example.test' }]])
        }
      />,
    );

    expect(screen.getByText('Synthetic Admin (admin@example.test)')).toBeVisible();
    expect(screen.getByText(USER_IDS.admin)).toBeVisible();
  });

  it('reads an API key as such, with the id', () => {
    render(<AuditActorValue actor={{ type: 'api-key', id: API_KEY_ID }} directory={null} />);

    expect(screen.getByText('API key')).toBeVisible();
    expect(screen.getByText(API_KEY_ID)).toBeVisible();
  });
});

describe('AuditActorValue for a workflow run (C121.1)', () => {
  it('reads "Workflow run" with its id, never "User"', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    render(<AuditActorValue actor={{ type: 'workflow-run', id: run }} directory={new Map()} />);

    expect(screen.getByText('Workflow run')).toBeVisible();
    expect(screen.getByText(run)).toBeVisible();
    expect(screen.queryByText('User')).toBeNull();
  });

  it('links its id to the run page (C141.6)', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    render(<AuditActorValue actor={{ type: 'workflow-run', id: run }} directory={new Map()} />);

    expect(screen.getByRole('link', { name: run })).toHaveAttribute(
      'href',
      `/workflows/runs/${run}`,
    );
  });

  it('links no other actor’s id', () => {
    render(<AuditActorValue actor={{ type: 'api-key', id: API_KEY_ID }} directory={new Map()} />);

    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('actorEntriesHref', () => {
  it('filters the entries of a workflow run by its id', () => {
    const run = 'wfr_01M5CJXHG07XPHF3HRM6NREDH8';
    expect(actorEntriesHref({ type: 'workflow-run', id: run })).toBe(`/audit-logs?actor=${run}`);
  });

  it('links the entries of a user or an API key', () => {
    expect(actorEntriesHref({ type: 'user', id: USER_IDS.admin })).toBe(
      `/audit-logs?actor=${USER_IDS.admin}`,
    );
    expect(actorEntriesHref({ type: 'api-key', id: API_KEY_ID })).toBe(
      `/audit-logs?actor=${API_KEY_ID}`,
    );
  });

  it('offers no "Entries by this actor" for the system', () => {
    expect(actorEntriesHref(SYSTEM)).toBeNull();
  });
});
