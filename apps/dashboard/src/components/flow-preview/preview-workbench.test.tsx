import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { PREVIEW_IDS, previewDocument } from '../../testing/routes/preview';
import { PreviewWorkbench, type PreviewWorkbenchProps } from './preview-workbench';

type Resolve = PreviewWorkbenchProps['resolve'];
type Answer = Awaited<ReturnType<Resolve>>;

const ok = (locale = 'en'): Answer => ({
  ok: true,
  data: previewDocument({ locale: locale as 'en' }),
});

let resolve: ReturnType<typeof vi.fn<Resolve>>;

beforeEach(() => {
  vi.useFakeTimers();
  resolve = vi.fn<Resolve>((input) => Promise.resolve(ok(input.body.meta.locale)));
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderWorkbench(props: Partial<PreviewWorkbenchProps> = {}) {
  render(
    <PreviewWorkbench
      templateId={PREVIEW_IDS.template}
      versionId={PREVIEW_IDS.version}
      flowOrigin="http://127.0.0.1:5173"
      locales={['en', 'fr']}
      defaultLocale="en"
      resolve={resolve}
      {...props}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

const languageSelect = () => screen.getByLabelText(PREVIEW_COPY.controls.locale);

async function choose(select: HTMLElement, value: string, wait = 0) {
  fireEvent.change(select, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(wait);
  });
}

describe('the preview workbench (C156.2)', () => {
  it('resolves the version in its default locale at once, and shows the frame', async () => {
    await renderWorkbench();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[0]).toEqual({
      'version-id': PREVIEW_IDS.version,
      body: { meta: { locale: 'en' } },
    });
    expect(screen.getByTitle(PREVIEW_COPY.frame.title)).toBeInTheDocument();
  });

  it('offers the enabled locales and both pseudo-locales', async () => {
    await renderWorkbench();

    const options = within(languageSelect())
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['en', 'fr', 'en-XA', 'ar-XB']);
  });

  it('resolves again in the chosen locale, at most once per interval', async () => {
    await renderWorkbench();

    await choose(languageSelect(), 'en-XA');
    await choose(languageSelect(), 'ar-XB');
    expect(resolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]?.[0].body.meta.locale).toBe('ar-XB');
  });

  it('sends the unsaved members it is given', async () => {
    await renderWorkbench({ unsaved: { 'theme-set-id': PREVIEW_IDS.themeSet } });

    expect(resolve.mock.calls[0]?.[0].body).toEqual({
      data: { attributes: { 'theme-set-id': PREVIEW_IDS.themeSet } },
      meta: { locale: 'en' },
    });
  });

  it('puts a refused locale beside the language menu, and the rest in the problems', async () => {
    resolve.mockResolvedValue({
      ok: false,
      problem: {
        title: 'Unprocessable',
        status: 422,
        errors: [
          { pointer: '/meta/locale', detail: 'Synthetic: fr is not enabled.' },
          { pointer: '/data/attributes/theme-set-id', detail: 'Synthetic: archived set.' },
        ],
      },
    });

    await renderWorkbench();

    expect(languageSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Synthetic: fr is not enabled.')).toBeVisible();
    const problems = screen.getByRole('region', { name: PREVIEW_COPY.problems.heading });
    expect(within(problems).getByText(/Synthetic: archived set\./)).toBeVisible();
    expect(within(problems).getByText(new RegExp(PREVIEW_COPY.problems.themeSet))).toBeVisible();
  });

  it('says so when previews are rate limited', async () => {
    resolve.mockResolvedValue({ ok: false, problem: { title: 'Too many requests', status: 429 } });

    await renderWorkbench();

    expect(screen.getByText(PREVIEW_COPY.problems.rateLimited)).toBeVisible();
  });

  it('says when the palette fails the contrast gate, and what the gate proves', async () => {
    resolve.mockResolvedValue({
      ok: true,
      data: previewDocument({
        contrast: {
          status: 'failed',
          findings: [
            {
              pointer: '/data/attributes/styles/light/palette/ink',
              foreground: 'ink',
              background: 'surface',
              ratio: 3.1,
              required: 4.5,
              level: 'fail',
            },
          ],
        },
      }),
    });

    await renderWorkbench();

    expect(screen.getByText(PREVIEW_COPY.contrast.failed)).toBeVisible();
    expect(screen.getByText(PREVIEW_COPY.contrast.scope)).toBeVisible();
  });

  it('changes the width and the scheme with labelled radio buttons', async () => {
    await renderWorkbench();

    fireEvent.click(screen.getByRole('radio', { name: PREVIEW_COPY.controls.viewportOption(320) }));
    expect(screen.getByTitle(PREVIEW_COPY.frame.title).className).toContain('w-[320px]');
    const dark = screen.getByRole('radio', { name: PREVIEW_COPY.controls.schemes.dark });
    fireEvent.click(dark);
    expect(dark).toBeChecked();
  });

  it('lists the document’s steps, and offers a simulated outcome for a capture step only', async () => {
    await renderWorkbench();

    const step = screen.getByLabelText(PREVIEW_COPY.controls.step);
    expect(
      within(step)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'consent (consent)',
      'id_card (government id)',
      'extra_details (screen)',
      'done (completion)',
    ]);
    expect(screen.queryByLabelText(PREVIEW_COPY.controls.outcome)).toBeNull();

    await choose(step, 'id_card');
    const outcome = screen.getByLabelText(PREVIEW_COPY.controls.outcome);
    await choose(outcome, 'failed');
    expect(outcome).toHaveValue('failed');
  });
});
