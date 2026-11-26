import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from './empty-state';
import { ForbiddenPanel } from './forbidden-panel';
import { PageError } from './page-error';
import { PageHeader } from './page-header';
import { PageLoading } from './page-loading';
import { PageMain } from './page-main';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageMain', () => {
  it('is the page main landmark, wide by default', () => {
    render(
      <PageMain>
        <p>Body</p>
      </PageMain>,
    );

    expect(screen.getByRole('main')).toHaveClass('max-w-6xl');
  });

  it('can be narrow, for forms and messages', () => {
    render(<PageMain width="narrow">x</PageMain>);

    expect(screen.getByRole('main')).toHaveClass('max-w-3xl');
  });
});

describe('PageHeader', () => {
  it('heads the page, with a description and actions', () => {
    render(
      <PageHeader
        title="Accounts"
        description="People and businesses, with their inquiries."
        actions={<button type="button">New account</button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    expect(screen.getByText('People and businesses, with their inquiries.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New account' })).toBeVisible();
  });

  it('leads back with breadcrumbs, marking the current page', () => {
    render(
      <PageHeader
        title="Account"
        breadcrumbs={[{ label: 'Accounts', href: '/accounts' }, { label: 'acc_1' }]}
      />,
    );

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toContainElement(screen.getByRole('link', { name: 'Accounts' }));
    expect(screen.getByText('acc_1')).toHaveAttribute('aria-current', 'page');
  });

  it('marks only the last breadcrumb as the current page when a parent has no link (Workflow 2E E001)', () => {
    render(
      <PageHeader
        title="Verification"
        breadcrumbs={[{ label: 'Inquiries' }, { label: 'inq_1' }, { label: 'ver_1' }]}
      />,
    );

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).queryByRole('link')).not.toBeInTheDocument();
    expect(within(trail).getByText('Inquiries')).not.toHaveAttribute('aria-current');
    expect(within(trail).getByText('inq_1')).not.toHaveAttribute('aria-current');
    expect(within(trail).getByText('ver_1')).toHaveAttribute('aria-current', 'page');
  });
});

describe('EmptyState', () => {
  it('says what is missing and offers what to do', () => {
    render(
      <EmptyState title="No webhooks yet" action={<a href="/webhooks/new">Add a webhook</a>}>
        Webhooks send events to your servers.
      </EmptyState>,
    );

    expect(screen.getByRole('heading', { name: 'No webhooks yet' })).toBeVisible();
    expect(screen.getByText('Webhooks send events to your servers.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add a webhook' })).toBeVisible();
  });
});

describe('PageLoading', () => {
  it('announces that the page is loading', () => {
    render(<PageLoading label="Loading accounts…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…');
  });

  it('has a default label', () => {
    render(<PageLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});

describe('PageError', () => {
  it('explains the failure without internals, quotes the digest, and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3000'), {
      digest: 'synthetic-digest-1',
    });

    render(<PageError error={error} retry={retry} title="The accounts could not be loaded." />);

    expect(screen.getByRole('alert')).toHaveTextContent('The accounts could not be loaded.');
    expect(screen.getByText('synthetic-digest-1')).toBeVisible();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("logs only the error's kind and its digest, never its message or stack (KP11-80)", () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A client error's message is the component's own words, which can quote what the page shows.
    const error = Object.assign(new TypeError('Cannot read Synthetic Person of 1990-01-01'), {
      digest: 'synthetic-digest-2',
    });

    render(<PageError error={error} retry={vi.fn()} />);

    expect(log).toHaveBeenCalledExactlyOnceWith('The page could not be loaded', {
      error: 'TypeError',
      digest: 'synthetic-digest-2',
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Synthetic Person|1990|at /);
    vi.unstubAllEnvs();
  });

  it('has a default title and copes with a value that is not an Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<PageError error="synthetic" retry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be loaded.');
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });
});

describe('ForbiddenPanel', () => {
  it('says the operator has no access, naming the permissions when known', () => {
    render(<ForbiddenPanel permissions={['users:read', 'users:write']} headingLevel={1} />);

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(screen.getByText(/Permissions needed/)).toHaveTextContent(
      'Permissions needed: users:read, users:write',
    );
  });

  it('defaults to a section heading, without a permission list', () => {
    render(<ForbiddenPanel />);

    expect(screen.getByRole('heading', { level: 2 })).toBeVisible();
    expect(screen.queryByText(/needed/)).not.toBeInTheDocument();
  });
});
