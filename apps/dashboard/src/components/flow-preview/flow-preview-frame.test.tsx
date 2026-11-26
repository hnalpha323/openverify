import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import {
  PREVIEW_IDS,
  previewDocument,
  previewDocumentWithAssets,
} from '../../testing/routes/preview';
import { FlowPreviewFrame, type FlowPreviewFrameProps } from './flow-preview-frame';

const FLOW = 'http://127.0.0.1:5173';
const assetUrl = (assetId: string) =>
  `/templates/${PREVIEW_IDS.template}/preview/assets/${assetId}`;

function renderFrame(props: Partial<FlowPreviewFrameProps> = {}) {
  const all: FlowPreviewFrameProps = {
    flowOrigin: FLOW,
    document: previewDocument(),
    assetUrl,
    ...props,
  };
  const view = render(<FlowPreviewFrame {...all} />);
  const frame = () => screen.getByTitle<HTMLIFrameElement>(PREVIEW_COPY.frame.title);
  return { ...view, frame, props: all };
}

/** Spies on the frame window's postMessage. */
function spyOnFrame(frame: HTMLIFrameElement) {
  const target = frame.contentWindow;
  if (target === null) {
    throw new Error('The frame has no window');
  }
  return { target, post: vi.spyOn(target, 'postMessage').mockImplementation(() => undefined) };
}

function fromFrame(source: unknown, data: unknown, origin = FLOW) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
  });
}

const READY = { source: 'openverify-preview', version: 1, type: 'ready' };

const posted = (post: ReturnType<typeof spyOnFrame>['post']) =>
  post.mock.calls.map(([message]) => (message as { type: string }).type);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(16), { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the preview frame (C156.2)', () => {
  it('frames the flow origin’s preview, sandboxed and without a referrer', () => {
    const { frame } = renderFrame({ viewport: 320 });

    expect(frame().getAttribute('src')).toBe(`${FLOW}/preview`);
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame().getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame().getAttribute('style')).toBeNull();
    expect(frame().className).toContain('w-[320px]');
  });

  it('refuses to render when the flow origin is the console’s own, and says so', () => {
    renderFrame({ flowOrigin: window.location.origin });

    expect(screen.queryByTitle(PREVIEW_COPY.frame.title)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(PREVIEW_COPY.frame.sameOrigin);
    expect(screen.getByRole('alert')).toHaveTextContent(PREVIEW_COPY.frame.configurationError);
  });

  it('refuses to render without a flow origin', () => {
    renderFrame({ flowOrigin: null });

    expect(screen.queryByTitle(PREVIEW_COPY.frame.title)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(PREVIEW_COPY.frame.notConfigured);
  });

  it('posts nothing before the preview is ready, then the document, width and scheme to the flow origin', () => {
    const { frame } = renderFrame({ viewport: 768, scheme: 'dark' });
    const { target, post } = spyOnFrame(frame());

    expect(post).not.toHaveBeenCalled();
    fromFrame(target, READY);

    expect(posted(post)).toEqual(['preview-document', 'set-viewport', 'set-scheme']);
    for (const call of post.mock.calls) {
      expect(call[1]).toBe(FLOW);
    }
    expect(post.mock.calls[0]?.[0]).toMatchObject({
      source: 'openverify-console',
      version: 1,
      document: previewDocument(),
    });
    expect(post.mock.calls[1]?.[0]).toMatchObject({ width: 768 });
    expect(post.mock.calls[2]?.[0]).toMatchObject({ scheme: 'dark' });
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_COPY.frame.ready);
  });

  it('ignores a ready message from another origin or another window', () => {
    const { frame } = renderFrame();
    const { target, post } = spyOnFrame(frame());

    fromFrame(target, READY, 'http://localhost:3001');
    fromFrame(window, READY);
    fromFrame(target, { ...READY, version: 2 });
    fromFrame(target, { ...READY, padding: 'x'.repeat(1024 * 1024) });

    expect(post).not.toHaveBeenCalled();
  });

  it('posts the theme’s logo and font read from the console, as transferred buffers', async () => {
    const { frame } = renderFrame({ document: previewDocumentWithAssets() });
    const { target, post } = spyOnFrame(frame());

    fromFrame(target, READY);

    await waitFor(() => {
      expect(posted(post)).toContain('preview-assets');
    });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url as string)).toEqual([
      assetUrl(PREVIEW_IDS.logo),
      assetUrl(PREVIEW_IDS.font),
    ]);
    const call: readonly unknown[] | undefined = post.mock.calls.find(
      ([message]) => (message as { type: string }).type === 'preview-assets',
    );
    expect(call?.[1]).toBe(FLOW);
    expect(call?.[2]).toHaveLength(2);
    expect(call?.[0]).toMatchObject({
      assets: [
        { 'asset-id': PREVIEW_IDS.logo, kind: 'logo' },
        { 'asset-id': PREVIEW_IDS.font, kind: 'font' },
      ],
    });
  });

  it('says so when an asset cannot be read, and still shows the preview', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));
    const { frame } = renderFrame({ document: previewDocumentWithAssets() });
    const { target, post } = spyOnFrame(frame());

    fromFrame(target, READY);

    expect(await screen.findByText(PREVIEW_COPY.assets.notReadable)).toBeVisible();
    expect(posted(post)).not.toContain('preview-assets');
    expect(posted(post)).toContain('preview-document');
  });

  it('refuses to post a document over 1 MiB, and says so', () => {
    const huge = previewDocument({ copy: { big: 'x'.repeat(1024 * 1024) } });
    const { frame } = renderFrame({ document: huge });
    const { target, post } = spyOnFrame(frame());

    fromFrame(target, READY);

    expect(posted(post)).not.toContain('preview-document');
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_COPY.frame.tooLarge);
  });

  it('follows the step and the outcomes it is given, and reposts a changed document', () => {
    const { frame, rerender, props } = renderFrame();
    const { target, post } = spyOnFrame(frame());
    fromFrame(target, READY);
    post.mockClear();

    rerender(
      <FlowPreviewFrame
        {...props}
        stepId="id_card"
        outcomes={{ id_card: 'failed' }}
        document={previewDocument({ locale: 'ar-XB' })}
      />,
    );

    expect(posted(post)).toEqual(
      expect.arrayContaining(['preview-document', 'select-step', 'set-outcome']),
    );
    expect(
      post.mock.calls.find(([m]) => (m as { type: string }).type === 'set-outcome')?.[0],
    ).toMatchObject({
      'step-id': 'id_card',
      outcome: 'failed',
    });
  });

  it('tells the page which step the preview shows, and announces the preview’s errors', () => {
    const onNavigated = vi.fn();
    const { frame } = renderFrame({ onNavigated });
    const { target } = spyOnFrame(frame());

    fromFrame(target, { ...READY, type: 'navigated', 'step-id': 'extra_details' });
    expect(onNavigated).toHaveBeenCalledWith('extra_details');
    expect(screen.getByRole('status')).toHaveTextContent(
      PREVIEW_COPY.frame.navigated('extra_details'),
    );

    fromFrame(target, { ...READY, type: 'error', code: 'malformed-document' });
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_COPY.frame.malformed);
    fromFrame(target, { ...READY, type: 'error', code: 'asset-refused' });
    expect(screen.getByRole('status')).toHaveTextContent(PREVIEW_COPY.frame.assetRefused);
  });
});
