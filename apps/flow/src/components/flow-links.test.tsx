/**
 * C162.3 (Workflow 9B, api-flow-carry; 9A Stage 3 amendment 47, B43): once a session names the
 * version's links, the help slot after every step's content shows them (3.2.6), and a screen's
 * `link` button names one; before that, and for a link that is not an `https:` URL, nothing is shown.
 * Each link opens in a new browsing context with `rel="noopener noreferrer"`. Every URL is synthetic.
 */
import type { Component, ScreenClientView } from '@openverify/flow-spec';
import { act, screen as view, within } from '@testing-library/react';
import { use, useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ScreenStep } from '../screens/screen-step';
import { renderWithI18n } from '../test-utils';
import {
  FlowLinksContext,
  ReportFlowLinksContext,
  sessionLinksOf,
  useReportSessionLinks,
  type FlowLinks,
} from './flow-links';
import { FlowLayout } from './flow-layout';

const HELP = 'https://help.example.com/verify';
const PRIVACY = 'https://example.com/privacy';

describe('sessionLinksOf (C162.3)', () => {
  it('keeps each https: link and drops a missing one', () => {
    expect(sessionLinksOf({ 'help-url': HELP, 'privacy-url': PRIVACY })).toEqual({
      'help-url': HELP,
      'privacy-url': PRIVACY,
    });
    expect(sessionLinksOf({ 'help-url': null, 'privacy-url': PRIVACY })).toEqual({
      'privacy-url': PRIVACY,
    });
    expect(sessionLinksOf(undefined)).toEqual({});
  });

  it('fails closed on anything but an https: URL', () => {
    expect(
      sessionLinksOf({ 'help-url': 'http://help.example.com', 'privacy-url': 'javascript:void 0' }),
    ).toEqual({});
    expect(sessionLinksOf({ 'help-url': 'not a url', 'privacy-url': null })).toEqual({});
  });
});

let report: ((session: { links?: Parameters<typeof sessionLinksOf>[0] }) => void) | null = null;

/** A step that reports the session links the way the renderer does. */
function Reporter() {
  const reportLinks = useReportSessionLinks();
  useEffect(() => {
    report = reportLinks;
  }, [reportLinks]);
  return <p>Step content</p>;
}

function layout() {
  return renderWithI18n(
    <MemoryRouter>
      <Routes>
        <Route element={<FlowLayout />}>
          <Route index element={<Reporter />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const helpSlot = () => {
  const slot = document.querySelector<HTMLElement>('footer[data-slot="help"]');
  if (slot === null) throw new Error('the layout has no help slot');
  return slot;
};

describe('the help slot (C162.3, 3.2.6)', () => {
  it('shows no link until a session names one', () => {
    layout();
    expect(within(helpSlot()).queryByRole('link')).not.toBeInTheDocument();
    expect(within(helpSlot()).getByRole('combobox')).toBeInTheDocument();
  });

  it('shows the help and privacy links a session names, after the step, opened safely', () => {
    layout();
    act(() => {
      report?.({ links: { 'help-url': HELP, 'privacy-url': PRIVACY } });
    });
    const help = within(helpSlot()).getByRole('link', { name: 'Get help' });
    const privacy = within(helpSlot()).getByRole('link', { name: 'Privacy notice' });
    expect(help).toHaveAttribute('href', HELP);
    expect(privacy).toHaveAttribute('href', PRIVACY);
    for (const link of [help, privacy]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(
      view.getByText('Step content').compareDocumentPosition(help) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows only the links the newest session names, and none that is not https:', () => {
    layout();
    act(() => {
      report?.({ links: { 'help-url': HELP, 'privacy-url': PRIVACY } });
    });
    act(() => {
      report?.({ links: { 'help-url': 'http://help.example.com', 'privacy-url': PRIVACY } });
    });
    expect(within(helpSlot()).queryByRole('link', { name: 'Get help' })).not.toBeInTheDocument();
    expect(within(helpSlot()).getByRole('link', { name: 'Privacy notice' })).toBeInTheDocument();
    act(() => {
      report?.({});
    });
    expect(within(helpSlot()).queryByRole('link')).not.toBeInTheDocument();
  });

  it('gives the screens the links it knows', () => {
    function Reader() {
      const known: FlowLinks = use(FlowLinksContext);
      return (
        <>
          <output aria-label="known links">{JSON.stringify(known)}</output>
          <Reporter />
        </>
      );
    }
    renderWithI18n(
      <MemoryRouter>
        <Routes>
          <Route element={<FlowLayout />}>
            <Route index element={<Reader />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      report?.({ links: { 'help-url': HELP, 'privacy-url': null } });
    });
    expect(JSON.parse(view.getByLabelText('known links').textContent)).toEqual({
      'help-url': HELP,
    });
  });
});

describe('a screen’s link button (C148.2, C162.3)', () => {
  const links: Component[] = [
    { id: 'help', kind: 'button', labelKey: 'x.help', action: 'link', link: 'help-url' },
    { id: 'privacy', kind: 'button', labelKey: 'x.privacy', action: 'link', link: 'privacy-url' },
  ];
  const step: ScreenClientView = { id: 'x', type: 'screen', components: links };
  const copy = (key: string) => `Text of ${key}`;

  it('names the session’s link once the layout knows it, and stays out while it does not', () => {
    renderWithI18n(
      <ReportFlowLinksContext value={() => undefined}>
        <FlowLinksContext value={{ 'help-url': HELP }}>
          <ScreenStep step={step} copy={copy} onSubmit={() => Promise.resolve()} />
        </FlowLinksContext>
      </ReportFlowLinksContext>,
    );
    const help = view.getByRole('link', { name: 'Text of x.help' });
    expect(help).toHaveAttribute('href', HELP);
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    expect(view.queryByRole('link', { name: 'Text of x.privacy' })).not.toBeInTheDocument();
  });

  it('prefers the links the screen was given (the preview’s)', () => {
    renderWithI18n(
      <FlowLinksContext value={{ 'help-url': HELP }}>
        <ScreenStep
          step={step}
          copy={copy}
          onSubmit={() => Promise.resolve()}
          links={{ 'help-url': 'https://preview.example.com/help' }}
        />
      </FlowLinksContext>,
    );
    expect(view.getByRole('link', { name: 'Text of x.help' })).toHaveAttribute(
      'href',
      'https://preview.example.com/help',
    );
  });
});
