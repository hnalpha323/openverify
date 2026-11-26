/**
 * C135.3 (decision 63): an image the console shows as a rendition. While the API is still making it
 * the rendition route answers 202 with `Retry-After`; the image says it is being prepared, in a
 * polite status, and asks again after that many seconds. Every other answer is said in words.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RENDITION_ATTEMPTS, RenditionImage } from './rendition-image';

const SRC = '/files/file_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z/rendition';

function answer(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers });
}

function stubFetch(...answers: (Response | Error)[]) {
  const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => {
    const next = answers.shift();
    if (next === undefined) {
      return Promise.reject(new Error('no answer queued'));
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const image = () => screen.getByRole('img', { name: 'Government ID, front' });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RenditionImage', () => {
  it('shows the rendition through the console route, and asks nothing else when it loads', () => {
    const fetch = stubFetch();
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    expect(image()).toHaveAttribute('src', SRC);
    fireEvent.load(image());

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says "preparing" while the rendition is made, and shows it once the retry loads', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(answer(202, { 'retry-after': '2' }));
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${SRC}?attempt=1`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the image');
    expect(screen.queryByRole('img')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(image()).toHaveAttribute('src', `${SRC}?attempt=2`);
    fireEvent.load(image());
    expect(screen.queryByText(/Preparing the image/)).toBeNull();
  });

  it('keeps a page of a PDF in the retried path', async () => {
    vi.useFakeTimers();
    stubFetch(answer(202, { 'retry-after': '1' }));
    render(<RenditionImage src={`${SRC}?page=2`} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(image()).toHaveAttribute('src', `${SRC}?page=2&attempt=2`);
  });

  it(`stops after ${String(RENDITION_ATTEMPTS)} answers of "preparing", and offers to try again`, async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(
      ...Array.from({ length: RENDITION_ATTEMPTS + 1 }, () => answer(202, { 'retry-after': '1' })),
    );
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    for (let attempt = 0; attempt < RENDITION_ATTEMPTS; attempt += 1) {
      await act(async () => {
        fireEvent.error(image());
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }

    expect(fetch).toHaveBeenCalledTimes(RENDITION_ATTEMPTS);
    expect(screen.getByRole('status')).toHaveTextContent('The image is still being prepared.');
    expect(screen.queryByRole('img')).toBeNull();
    vi.useRealTimers();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(image()).toHaveAttribute('src', `${SRC}?attempt=${String(2 * RENDITION_ATTEMPTS)}`);
  });

  it.each([
    [422, 'The image could not be prepared.'],
    [404, 'No image to show.'],
    [403, 'Hidden: your role cannot view personal data.'],
    [410, 'Redacted'],
  ])('says what a %i means, without offering to try again', async (status, words) => {
    vi.useFakeTimers();
    stubFetch(answer(status));
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('status')).toHaveTextContent(words);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it.each([
    ['an unexpected answer', answer(502)],
    ['no answer', new TypeError('fetch failed')],
  ])('offers to try again after %s', async (_name, failure) => {
    vi.useFakeTimers();
    stubFetch(failure);
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('status')).toHaveTextContent('The image could not be loaded.');
    vi.useRealTimers();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(image()).toHaveAttribute('src', `${SRC}?attempt=2`);
  });

  it('shows the image when the check finds it ready after all', async () => {
    vi.useFakeTimers();
    stubFetch(answer(200, { 'content-type': 'image/jpeg' }));
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(image()).toHaveAttribute('src', `${SRC}?attempt=2`);
  });

  it('stops when the route answers an image the browser cannot show, instead of asking again without end (R013)', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(
      answer(200, { 'content-type': 'image/jpeg' }),
      answer(200, { 'content-type': 'image/jpeg' }),
      answer(200, { 'content-type': 'image/jpeg' }),
    );
    render(<RenditionImage src={SRC} alt="Government ID, front" />);

    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.error(image());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('status')).toHaveTextContent('The image could not be loaded.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks the route when the image already failed before the page was hydrated, whose error React never saw', async () => {
    vi.useFakeTimers();
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const fetch = stubFetch(answer(202, { 'retry-after': '2' }));

    await act(async () => {
      render(<RenditionImage src={SRC} alt="Government ID, front" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    complete.mockRestore();

    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${SRC}?attempt=1`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Preparing the image…');
  });
});
