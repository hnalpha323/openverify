/**
 * C156.2, C156.3 (Workflow 9A, flow-server-embed): the preview renders the console's posted document
 * through the live flow's own step components with no network call, capture steps as still
 * placeholders, and answers `ready`, `navigated` and `error` to the exact console origin only. Every
 * value is synthetic; the console origin is a reserved name.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_FONT_FAMILY } from './assets';
import { PreviewApp, type PreviewHost } from './preview-app';

const CONSOLE = 'https://console.example.com';
const LOGO_ID = 'tsa_01M5CJXHG07XPHF3HRM6NREDH7';

interface Document {
  data: { attributes: Record<string, unknown> & { steps: Record<string, unknown>[] } };
}

/** The golden preview document (`contracts/fixtures/api/template-preview.json`), changed per test. */
function previewDocument(
  change: (attributes: Document['data']['attributes']) => void = () => undefined,
) {
  const document = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../contracts/fixtures/api/template-preview.json',
      ),
      'utf8',
    ),
  ) as Document;
  change(document.data.attributes);
  return document;
}

interface TestHost extends PreviewHost {
  readonly parent: { postMessage: ReturnType<typeof vi.fn> };
  readonly target: EventTarget;
}

function host(): TestHost {
  const target = new EventTarget();
  return {
    target,
    parent: { postMessage: vi.fn() },
    addEventListener: target.addEventListener.bind(target) as Window['addEventListener'],
    removeEventListener: target.removeEventListener.bind(target) as Window['removeEventListener'],
  };
}

function deliver(
  on: TestHost,
  data: Record<string, unknown>,
  origin = CONSOLE,
  source: unknown = on.parent,
) {
  const event = new Event('message');
  Object.defineProperties(event, {
    data: { value: { source: 'openverify-console', version: 1, ...data } },
    origin: { value: origin },
    source: { value: source },
  });
  act(() => {
    on.target.dispatchEvent(event);
  });
}

const assetDeps = () => ({
  createObjectURL: vi.fn(() => 'blob:https://flow.example.com/logo'),
  revokeObjectURL: vi.fn(),
  loadFont: vi.fn(() => Promise.resolve()),
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;

function renderPreview(on = host(), deps = assetDeps()) {
  const view = render(
    <PreviewApp
      consoleOrigin={CONSOLE}
      host={on}
      assetDeps={deps}
      root={document.documentElement}
    />,
  );
  return { on, deps, view };
}

/** Each message posted to the console, with its target checked. */
const posted = (on: TestHost) =>
  on.parent.postMessage.mock.calls.map(([message, target]) => {
    expect(target).toBe(CONSOLE);
    return message as Record<string, unknown>;
  });

afterEach(() => {
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  document.documentElement.style.colorScheme = '';
});

describe('the preview (C156.2, C156.3)', () => {
  it('says ready to the console origin, and says what differs from a live flow', () => {
    const { on } = renderPreview();
    expect(posted(on)).toEqual([{ source: 'openverify-preview', version: 1, type: 'ready' }]);
    expect(screen.getByText(/no camera/i)).toBeInTheDocument();
  });

  it("renders the posted document's first step, and the step the console selects", async () => {
    const { on } = renderPreview();
    deliver(on, { type: 'preview-document', document: previewDocument() });
    deliver(on, { type: 'select-step', 'step-id': 'extra_details' });

    expect(await screen.findByText('[Á ƒéŵ ɱöŕé ðéţåîļš]')).toBeInTheDocument();
    expect(posted(on).at(-1)).toEqual({
      source: 'openverify-preview',
      version: 1,
      type: 'navigated',
      'step-id': 'extra_details',
    });
  });

  it('draws a capture step as a still placeholder with its simulated outcome', async () => {
    const { on } = renderPreview();
    deliver(on, { type: 'preview-document', document: previewDocument() });
    deliver(on, { type: 'select-step', 'step-id': 'id_card' });
    deliver(on, { type: 'set-outcome', 'step-id': 'id_card', outcome: 'failed' });

    expect(await screen.findByText(/still placeholder/i)).toBeInTheDocument();
    expect(screen.getByText(/simulated outcome: failed/i)).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });

  it('answers malformed-document for a document outside the frozen schema, and keeps the last one', async () => {
    const { on } = renderPreview();
    deliver(on, { type: 'preview-document', document: previewDocument() });
    deliver(on, { type: 'select-step', 'step-id': 'extra_details' });
    deliver(on, {
      type: 'preview-document',
      document: previewDocument((attributes) => {
        attributes.steps = [{ id: 'x', type: 'branch' }];
      }),
    });

    expect(posted(on).at(-1)).toMatchObject({ type: 'error', code: 'malformed-document' });
    expect(await screen.findByText('[Á ƒéŵ ɱöŕé ðéţåîļš]')).toBeInTheDocument();
  });

  it('ignores a step it does not hold and any message from another origin or window', () => {
    const { on } = renderPreview();
    deliver(on, { type: 'preview-document', document: previewDocument() });
    const before = on.parent.postMessage.mock.calls.length;
    deliver(on, { type: 'select-step', 'step-id': 'missing' });
    deliver(on, { type: 'select-step', 'step-id': 'extra_details' }, 'https://evil.example.com');
    deliver(on, { type: 'select-step', 'step-id': 'extra_details' }, CONSOLE, {});

    expect(on.parent.postMessage.mock.calls.length).toBe(before);
    expect(screen.queryByText('[Á ƒéŵ ɱöŕé ðéţåîļš]')).not.toBeInTheDocument();
  });

  it('sets the viewport width and the colour scheme', () => {
    const { on } = renderPreview();
    deliver(on, { type: 'set-viewport', width: 320 });
    deliver(on, { type: 'set-scheme', scheme: 'dark' });

    expect(screen.getByTestId('preview-viewport').style.maxWidth).toBe('320px');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    deliver(on, { type: 'set-scheme', scheme: 'auto' });
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it("shows a screen's image from a posted logo, and loads a posted font", async () => {
    const { on, deps } = renderPreview();
    deliver(on, {
      type: 'preview-document',
      document: previewDocument((attributes) => {
        const screenStep = attributes.steps.find((step) => step.id === 'extra_details');
        (screenStep?.components as Record<string, unknown>[]).unshift({
          id: 'logo',
          kind: 'image',
          assetId: LOGO_ID,
          decorative: true,
        });
      }),
    });
    deliver(on, { type: 'select-step', 'step-id': 'extra_details' });
    deliver(on, {
      type: 'preview-assets',
      assets: [{ 'asset-id': LOGO_ID, kind: 'logo', bytes: PNG }],
    });

    await vi.waitFor(() => {
      expect(document.querySelector('img')?.getAttribute('src')).toBe(
        'blob:https://flow.example.com/logo',
      );
    });
    expect(deps.createObjectURL).toHaveBeenCalledTimes(1);

    const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]).buffer;
    deliver(on, {
      type: 'preview-assets',
      assets: [{ 'asset-id': 'tsa_01M5CK16P0D13FXHZSS4TCFBVH', kind: 'font', bytes: WOFF2 }],
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId('preview-viewport').style.fontFamily).toContain(
        PREVIEW_FONT_FAMILY,
      );
    });
  });

  it('answers asset-refused for a buffer of the wrong type', async () => {
    const { on, deps } = renderPreview();
    deliver(on, {
      type: 'preview-assets',
      assets: [
        {
          'asset-id': LOGO_ID,
          kind: 'logo',
          bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x2f, 0x3e]).buffer,
        },
      ],
    });
    await vi.waitFor(() => {
      expect(posted(on).at(-1)).toMatchObject({ type: 'error', code: 'asset-refused' });
    });
    expect(deps.createObjectURL).not.toHaveBeenCalled();
  });

  it('takes the document locale for lang and dir', async () => {
    const { on } = renderPreview();
    deliver(on, {
      type: 'preview-document',
      document: previewDocument((attributes) => {
        attributes.locale = 'ar-XB';
      }),
    });
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    });
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('stops listening once unmounted', () => {
    const { on, view } = renderPreview();
    view.unmount();
    deliver(on, { type: 'set-scheme', scheme: 'dark' });
    expect(document.documentElement.style.colorScheme).toBe('');
  });
});
