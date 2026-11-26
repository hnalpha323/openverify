import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { CompletionScreen, ExpiredScreen, FailureScreen } from './outcome-screens';

describe('CompletionScreen', () => {
  it('thanks the user with the step’s message', () => {
    renderWithI18n(
      <CompletionScreen
        step={{ id: 'completion', type: 'completion', messageKey: 'flow.completion' }}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible();
    expect(screen.getByText(en.flow.completion)).toBeVisible();
  });

  it.each([
    ['no step', null],
    ['a step without a message', { id: 'done', type: 'completion' } as const],
    [
      'a message this version does not have',
      { id: 'done', type: 'completion', messageKey: 'flow.custom_thanks' } as const,
    ],
  ])('uses the default message for %s', (_label, step) => {
    renderWithI18n(<CompletionScreen step={step} />);

    expect(screen.getByText(en.flow.completion)).toBeVisible();
  });

  it('is translated', () => {
    renderWithI18n(<CompletionScreen step={null} />, 'es');

    expect(screen.getByRole('heading', { level: 1, name: 'Verificación enviada' })).toBeVisible();
  });
});

describe('FailureScreen', () => {
  it('tells the user who to contact, without saying why', () => {
    renderWithI18n(
      <FailureScreen step={{ id: 'failure', type: 'failure', messageKey: 'flow.failure' }} />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Verification not completed' }),
    ).toBeVisible();
    expect(screen.getByText(en.flow.failure)).toBeVisible();
  });

  it('uses the default message when the step has none', () => {
    renderWithI18n(<FailureScreen step={null} />);

    expect(screen.getByText(en.flow.failure)).toBeVisible();
  });
});

describe('ExpiredScreen', () => {
  it('asks for a new link', () => {
    renderWithI18n(<ExpiredScreen />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'This verification link has expired' }),
    ).toBeVisible();
    expect(screen.getByText(en.expired.message)).toBeVisible();
  });
});

describe('the contest route of a decline (C128.7; P40)', () => {
  const route = {
    url: 'https://contest.example.com/review',
    host: 'contest.example.com',
    contact: 'review@example.com',
  };

  it('shows the host before the link, and the contact', () => {
    renderWithI18n(<CompletionScreen step={null} contestRoute={route} />);

    const host = screen.getByText(/contest\.example\.com$/);
    const link = screen.getByRole('link', { name: 'Ask for a review' });
    expect(link).toHaveAttribute('href', route.url);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(host.compareDocumentPosition(link)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/review@example\.com/)).toBeInTheDocument();
  });

  it('shows a contact alone', () => {
    renderWithI18n(
      <CompletionScreen step={null} contestRoute={{ url: null, host: null, contact: 'Support' }} />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Support/)).toBeInTheDocument();
  });

  it('shows nothing of the kind without a route, as every other finished inquiry reads', () => {
    renderWithI18n(<CompletionScreen step={null} contestRoute={null} />);

    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
  });

  it('speaks Spanish in Spanish', () => {
    renderWithI18n(<CompletionScreen step={null} contestRoute={route} />, 'es');

    expect(screen.getByRole('link', { name: 'Solicitar una revisión' })).toBeInTheDocument();
  });

  // K9-33 (9A Stage 3 amendment 61): the framing words come from the five built-in catalogs,
  // machine-drafted like the rest of each catalog, never English in another language.
  it.each([
    ['fr', 'Demander un réexamen'],
    ['de', 'Überprüfung anfordern'],
    ['ar', 'طلب مراجعة'],
  ] as const)('speaks %s in its own words on the terminal screen', (language, words) => {
    renderWithI18n(<FailureScreen step={null} contestRoute={route} />, language);

    expect(screen.getByRole('region', { name: words })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: words })).toHaveAttribute('href', route.url);
    // None of the English framing words (the route's own contact may be any text).
    expect(document.body.textContent).not.toMatch(
      /Ask for a review|If you disagree|This link opens|You can also reach/,
    );
  });

  it('isolates the host and the contact, each in its own direction (C161.3)', () => {
    renderWithI18n(<CompletionScreen step={null} contestRoute={route} />, 'ar');

    expect(screen.getByText(route.host).tagName).toBe('BDI');
    expect(screen.getByText(route.contact).tagName).toBe('BDI');
  });
});
