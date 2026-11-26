import { describe, expect, it } from 'vitest';
import {
  previewDocument,
  previewDocumentWithAssets,
  PREVIEW_IDS,
} from '../../testing/routes/preview';
import {
  assetsMessageOf,
  consoleMessages,
  fitsMessage,
  framePlanOf,
  readPreviewMessage,
  themeAssetsOf,
} from './preview-protocol';

const FLOW = 'http://127.0.0.1:5173';
const CONSOLE = 'http://localhost:3001';
const frame = { name: 'the iframe’s contentWindow' };
const ready = { source: 'openverify-preview', version: 1, type: 'ready' };

describe('the preview’s messages, as the console accepts them (C156.2)', () => {
  it('accepts a message of the frame’s window from the flow origin, parsed', () => {
    expect(
      readPreviewMessage({ data: ready, origin: FLOW, source: frame }, { flowOrigin: FLOW, frame }),
    ).toEqual(ready);
    const navigated = { ...ready, type: 'navigated', 'step-id': 'id_card' };
    expect(
      readPreviewMessage(
        { data: navigated, origin: FLOW, source: frame },
        { flowOrigin: FLOW, frame },
      ),
    ).toEqual(navigated);
  });

  it('ignores a message from another origin', () => {
    for (const origin of [CONSOLE, 'http://127.0.0.1:5174', 'https://127.0.0.1:5173', 'null']) {
      expect(
        readPreviewMessage({ data: ready, origin, source: frame }, { flowOrigin: FLOW, frame }),
      ).toBeNull();
    }
  });

  it('ignores a message from another window, even from the flow origin', () => {
    for (const source of [{ name: 'another frame' }, null, undefined]) {
      expect(
        readPreviewMessage({ data: ready, origin: FLOW, source }, { flowOrigin: FLOW, frame }),
      ).toBeNull();
    }
    expect(
      readPreviewMessage(
        { data: ready, origin: FLOW, source: frame },
        { flowOrigin: FLOW, frame: null },
      ),
    ).toBeNull();
  });

  it('ignores a message over 1 MiB', () => {
    const oversized = {
      ...ready,
      type: 'error',
      code: 'unknown',
      padding: 'x'.repeat(1024 * 1024),
    };
    expect(
      readPreviewMessage(
        { data: oversized, origin: FLOW, source: frame },
        { flowOrigin: FLOW, frame },
      ),
    ).toBeNull();
  });

  it('ignores a malformed message: another source, version, type or member', () => {
    for (const data of [
      { ...ready, source: 'openverify-flow' },
      { ...ready, version: 2 },
      { ...ready, type: 'set-viewport', width: 320 },
      { ...ready, extra: true },
      { ...ready, type: 'navigated', 'step-id': 'Not a step id!' },
      { ...ready, type: 'error', code: 'something-else' },
      'ready',
      null,
      [ready],
    ]) {
      expect(
        readPreviewMessage({ data, origin: FLOW, source: frame }, { flowOrigin: FLOW, frame }),
      ).toBeNull();
    }
  });

  it('ignores a message whose size cannot be measured (a cycle)', () => {
    const data: Record<string, unknown> = { ...ready };
    data.self = data;
    expect(
      readPreviewMessage({ data, origin: FLOW, source: frame }, { flowOrigin: FLOW, frame }),
    ).toBeNull();
  });
});

describe('where the frame comes from (C156.2)', () => {
  it('frames the flow origin’s /preview', () => {
    expect(framePlanOf(FLOW, CONSOLE)).toEqual({
      kind: 'frame',
      origin: FLOW,
      src: `${FLOW}/preview`,
    });
  });

  it('refuses to frame the console’s own origin: a configuration error', () => {
    expect(framePlanOf(CONSOLE, CONSOLE)).toEqual({ kind: 'same-origin' });
  });

  it('refuses without a configured flow origin', () => {
    expect(framePlanOf(null, CONSOLE)).toEqual({ kind: 'not-configured' });
  });
});

describe('the console’s messages to the frame', () => {
  it('builds each message in the contract’s shape', () => {
    expect(consoleMessages.document(previewDocument())).toEqual({
      source: 'openverify-console',
      version: 1,
      type: 'preview-document',
      document: previewDocument(),
    });
    expect(consoleMessages.selectStep('id_card')).toMatchObject({
      type: 'select-step',
      'step-id': 'id_card',
    });
    expect(consoleMessages.outcome('id_card', 'needs_review')).toMatchObject({
      type: 'set-outcome',
      'step-id': 'id_card',
      outcome: 'needs_review',
    });
    expect(consoleMessages.viewport(320)).toMatchObject({ type: 'set-viewport', width: 320 });
    expect(consoleMessages.scheme('dark')).toMatchObject({ type: 'set-scheme', scheme: 'dark' });
  });

  it('measures a message as JSON and refuses one over 1 MiB', () => {
    expect(fitsMessage(consoleMessages.document(previewDocument()))).toBe(true);
    const huge = previewDocument({ copy: { big: 'x'.repeat(1024 * 1024) } });
    expect(fitsMessage(consoleMessages.document(huge))).toBe(false);
  });

  it('reads the theme’s logo and uploaded font, and nothing for the built-in theme', () => {
    expect(themeAssetsOf(previewDocument())).toEqual([]);
    expect(themeAssetsOf(previewDocumentWithAssets())).toEqual([
      { assetId: PREVIEW_IDS.logo, kind: 'logo' },
      { assetId: PREVIEW_IDS.font, kind: 'font' },
    ]);
  });

  it('transfers the assets’ buffers, at most 1 MiB in all', () => {
    const logo = new ArrayBuffer(200 * 1024);
    const font = new ArrayBuffer(500 * 1024);
    const built = assetsMessageOf([
      { assetId: PREVIEW_IDS.logo, kind: 'logo', bytes: logo },
      { assetId: PREVIEW_IDS.font, kind: 'font', bytes: font },
    ]);
    expect(built?.message).toEqual({
      source: 'openverify-console',
      version: 1,
      type: 'preview-assets',
      assets: [
        { 'asset-id': PREVIEW_IDS.logo, kind: 'logo', bytes: logo },
        { 'asset-id': PREVIEW_IDS.font, kind: 'font', bytes: font },
      ],
    });
    expect(built?.transfer).toEqual([logo, font]);

    expect(
      assetsMessageOf([
        { assetId: PREVIEW_IDS.logo, kind: 'logo', bytes: new ArrayBuffer(600 * 1024) },
        { assetId: PREVIEW_IDS.font, kind: 'font', bytes: new ArrayBuffer(500 * 1024) },
      ]),
    ).toBeNull();
    expect(assetsMessageOf([])).toBeNull();
  });
});
