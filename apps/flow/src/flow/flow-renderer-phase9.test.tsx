import type { ClientStepView, ScreenClientView } from '@openverify/flow-spec';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { FlowLayout } from '../components/flow-layout';
import { RequestedLanguagesContext } from '../session/requested-languages';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID } from '../testing/flow-fixtures';
import { at, rendererScript, serve, type ServedPosition } from '../testing/flow-renderer';
import { SessionThemeContext } from '../theme/session-theme';
import { renderWithFlow } from '../test-utils';
import { reportEmbedCancel } from '../embed/bridge';
import { FlowRenderer } from './flow-renderer';

// C159.4: the embed bridge is told of a confirmed cancel; the rest of the bridge is real.
vi.mock('../embed/bridge', async (original) => ({
  ...(await original<typeof import('../embed/bridge')>()),
  reportEmbedCancel: vi.fn(),
}));

// Workflow 9A (flow-renderer): the web flow on the server's position (C151.5), the screen step
// (C148), the waiting and halted states (C150.5, C151.2), the completion's announcement and
// "Continue" (C158.5), the contest route on the failed screen (C150.7), the session's copy (C162.5)
// and languages (C161.2), and the theme hook (C160.9).

const ABOUT: ScreenClientView = {
  id: 'about_you',
  type: 'screen',
  components: [
    { id: 'title', kind: 'text', variant: 'title', copyKey: 'about_you.title.body' },
    {
      id: 'name',
      kind: 'text_input',
      field: 'name_first',
      labelKey: 'about_you.name.label',
      required: true,
    },
    { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    {
      id: 'skip',
      kind: 'button',
      labelKey: 'about_you.skip.button',
      action: 'submit',
      port: 'skip',
    },
  ],
};
const ABOUT_COPY = {
  messages: {
    en: {
      'about_you.title.body': 'About you',
      'about_you.name.label': 'First name',
      'about_you.skip.button': 'Skip',
      'about_you.stop.button': 'Stop',
    },
    es: {
      'about_you.title.body': 'Sobre usted',
      'about_you.name.label': 'Nombre',
      'about_you.skip.button': 'Omitir',
    },
  },
};
const ON_ABOUT: ServedPosition = {
  position: at('about_you', 'active', 'consent'),
  step: ABOUT,
  values: { name_first: '' },
  copy: ABOUT_COPY,
};
const DONE: ServedPosition = {
  position: at('done', 'ended', 'about_you'),
  step: { id: 'done', type: 'completion' },
};

function fakeAt(served: ServedPosition): FakeFlowApi {
  const api = new FakeFlowApi();
  api.consent = { textKeys: ['consent.biometric'], locale: 'en' };
  serve(api, served);
  return api;
}

function renderFlow(api: FakeFlowApi) {
  return renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);
}

describe('a screen at the server position (C148, C151.5)', () => {
  it('renders the served screen with the operator copy, and submits its values with the button key', async () => {
    const api = fakeAt(ON_ABOUT);
    rendererScript(api).onSubmit = () => DONE;
    renderFlow(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
    await userEvent.type(screen.getByRole('textbox', { name: 'First name' }), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(api.client.submitScreen).toHaveBeenCalledWith(
      'about_you',
      { values: { name_first: 'Sam' }, button: 'skip' },
      undefined,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
  });

  it('follows the branch the server takes after a submission, never one of its own', async () => {
    const api = fakeAt(ON_ABOUT);
    const other: ClientStepView = {
      id: 'more',
      type: 'screen',
      components: [
        { id: 'title', kind: 'text', variant: 'title', copyKey: 'screen.heading' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    };
    rendererScript(api).onSubmit = (_stepId, body) =>
      body.button === undefined ? { position: at('more'), step: other } : DONE;
    renderFlow(api);

    await userEvent.type(await screen.findByRole('textbox', { name: 'First name' }), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Your details' })).toBeVisible();
  });

  it('shows a field the server refused at its control', async () => {
    const api = fakeAt(ON_ABOUT);
    api.client.submitScreen.mockRejectedValueOnce(
      new FlowApiError('http', 'refused', {
        status: 422,
        problem: {
          type: 'https://docs.openverify.dev/problems/validation_failed',
          title: 'Validation failed',
          status: 422,
          detail: 'A value was not accepted.',
          instance: '/api/v1/flow/screens/about_you/submit',
          requestId: 'req-1',
          errors: [{ location: 'body', pointer: '/values/name_first', detail: 'too long' }],
        },
      }),
    );
    renderFlow(api);

    await userEvent.type(await screen.findByRole('textbox', { name: 'First name' }), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('textbox', { name: 'First name' })).toHaveAccessibleDescription(
      'This value was not accepted. Check it and try again.',
    );
  });

  it('reads the session again when the step is no longer current', async () => {
    const api = fakeAt(ON_ABOUT);
    api.client.submitScreen.mockImplementationOnce(() => {
      serve(api, DONE);
      return Promise.reject(
        new FlowApiError('http', 'not current', {
          status: 409,
          problem: {
            type: 'https://docs.openverify.dev/problems/flow_step_not_current',
            title: 'Not the current step',
            status: 409,
            detail: 'This step is not the current step.',
            instance: '/api/v1/flow/screens/about_you/submit',
            requestId: 'req-1',
            code: 'flow_step_not_current',
          },
        }),
      );
    });
    renderFlow(api);

    await userEvent.type(await screen.findByRole('textbox', { name: 'First name' }), 'Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
  });

  it('stops for now on a confirmed cancel, keeping the inquiry resumable', async () => {
    const api = fakeAt({
      ...ON_ABOUT,
      step: {
        ...ABOUT,
        components: [
          ...ABOUT.components,
          { id: 'stop', kind: 'button', labelKey: 'about_you.stop.button', action: 'cancel' },
        ],
      },
    });
    renderFlow(api);

    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, stop for now' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You stopped for now' }),
    ).toBeVisible();
    expect(api.client.submitScreen).not.toHaveBeenCalled();
    // C159.4: an embedding page hears the cancel (the bridge posts only after its handshake).
    expect(reportEmbedCancel).toHaveBeenCalledTimes(1);
  });
});

describe('the waiting and halted positions (C150.5, C151.2)', () => {
  it('shows the waiting state and reads the session until the server moves on', async () => {
    const api = fakeAt({ position: { ...at('age_route', 'waiting'), 'retry-after-ms': 1 } });
    renderFlow(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'One moment' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('We are getting the next step ready…');
    serve(api, DONE);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(api.client.getSession.mock.calls.length).toBeGreaterThan(1);
  });

  it('says the verification cannot continue once halted', async () => {
    renderFlow(fakeAt({ position: at('again', 'halted') }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This verification cannot continue' }),
    ).toBeVisible();
  });
});

describe('the end of the person part (C158.5, C150.7)', () => {
  it('announces the outcome and redirects only when the person presses Continue, never on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = fakeAt({
        ...DONE,
        completion: { 'redirect-url': 'https://shop.example.com/done?inquiry-id=inq_1' },
      });
      renderFlow(api);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Verification submitted' }),
      ).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Your part is done. Use Continue to go back to the website you came from.',
      );
      const link = screen.getByRole('link', { name: 'Continue' });
      expect(link).toHaveAttribute('href', 'https://shop.example.com/done?inquiry-id=inq_1');
      const before = window.location.href;
      await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
      expect(window.location.href).toBe(before);
      expect(screen.getByRole('link', { name: 'Continue' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no redirect when the server allows none', async () => {
    renderFlow(fakeAt({ ...DONE, completion: { 'redirect-url': null } }));

    await screen.findByRole('heading', { level: 1, name: 'Verification submitted' });
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('shows the contest route on the failed screen as the completion screen does', async () => {
    const api = fakeAt({
      position: at('refused', 'ended'),
      step: { id: 'refused', type: 'failure' },
      'decision-contest-route': {
        url: 'https://help.example.com/contest',
        host: 'help.example.com',
        contact: null,
      },
    });
    api.inquiryStatus = 'failed';
    renderFlow(api);

    await screen.findByRole('heading', { level: 1, name: 'Verification not completed' });
    expect(screen.getByRole('link', { name: 'Ask for a review' })).toHaveAttribute(
      'href',
      'https://help.example.com/contest',
    );
  });
});

describe('the session copy and languages (C161.2, C162.5)', () => {
  it('lays a custom text of a built-in key over the catalog', async () => {
    const api = new FakeFlowApi();
    serve(api, {
      position: at('consent'),
      step: { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      copy: { messages: { en: { 'consent.title': 'Before we start' } } },
    });
    renderFlow(api);

    expect(await screen.findByRole('heading', { level: 1, name: 'Before we start' })).toBeVisible();
  });

  it('chooses among the enabled locales, falling back to the version default', async () => {
    const api = fakeAt({ ...ON_ABOUT, locales: { enabled: ['es', 'fr'], default: 'es' } });
    const { i18n } = renderWithFlow(
      <RequestedLanguagesContext value={['de-AT']}>
        <FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />
      </RequestedLanguagesContext>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Sobre usted' })).toBeVisible();
    expect(i18n.language).toBe('es');
  });

  it('honours the requested language when the version enables it', async () => {
    const api = fakeAt({ ...ON_ABOUT, locales: { enabled: ['en', 'es'], default: 'en' } });
    renderWithFlow(
      <RequestedLanguagesContext value={['es-MX']}>
        <FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />
      </RequestedLanguagesContext>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Sobre usted' })).toBeVisible();
  });

  it('offers only the enabled locales in the language selector, after the step', async () => {
    const api = fakeAt({ ...ON_ABOUT, locales: { enabled: ['en', 'ar'], default: 'en' } });
    renderWithFlow(
      <MemoryRouter>
        <Routes>
          <Route element={<FlowLayout />}>
            <Route index element={<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'About you' });
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['English', 'العربية']);
    // C162.3 (3.2.6): the selector sits in the fixed slot after the step's content.
    const main = screen.getByRole('main');
    expect(main.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the session theme (C160.9)', () => {
  it('hands each session it reads to the page theme', async () => {
    const api = fakeAt(ON_ABOUT);
    const apply = vi.fn();
    renderWithFlow(
      <SessionThemeContext value={apply}>
        <FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />
      </SessionThemeContext>,
    );

    await screen.findByRole('heading', { level: 1, name: 'About you' });
    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ 'spec-version': 2 }),
        expect.anything(),
      );
    });
  });

  it('shows the version’s help and privacy links in the help slot, after the step (C162.3)', async () => {
    const api = fakeAt({
      ...ON_ABOUT,
      links: {
        'help-url': 'https://help.example.com/synthetic',
        'privacy-url': 'https://example.org/synthetic-privacy',
      },
    });
    renderWithFlow(
      <MemoryRouter>
        <Routes>
          <Route element={<FlowLayout />}>
            <Route index element={<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'About you' });
    const help = await screen.findByRole('link', { name: /Get help/ });
    expect(help).toHaveAttribute('href', 'https://help.example.com/synthetic');
    expect(screen.getByRole('link', { name: /Privacy notice/ })).toHaveAttribute(
      'href',
      'https://example.org/synthetic-privacy',
    );
  });

  it('applies the theme with a loader that reads the session’s theme assets (C160.6, C160.9)', async () => {
    const api = fakeAt(ON_ABOUT);
    const apply = vi.fn<(session: unknown, options?: unknown) => void>();
    renderWithFlow(
      <SessionThemeContext value={apply}>
        <FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />
      </SessionThemeContext>,
    );

    await screen.findByRole('heading', { level: 1, name: 'About you' });
    await waitFor(() => {
      const [, options] = apply.mock.lastCall ?? [];
      expect(options).toEqual({ loadAsset: expect.any(Function) as unknown });
    });
  });
});
