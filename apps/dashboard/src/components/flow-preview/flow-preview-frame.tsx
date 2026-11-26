'use client';

/**
 * C156.2 (Workflow 9C, `dashboard-preview`): the preview frame. It frames `{flow origin}/preview`
 * (`sandbox="allow-scripts allow-same-origin"`, no referrer), refuses to when the flow origin is the
 * console's own or is not configured (a configuration error shown in the page), and talks to it only
 * through the versioned protocol of `preview-protocol.ts`: nothing is posted before the preview says
 * `ready`, every message goes to the flow origin alone, and only the frame's own messages from that
 * origin are read. The theme's logo and font are read from the console (`assetUrl`) and posted as
 * transferred buffers, at most 1 MiB in all. No inline style: the width is a class (C170).
 */
import type { templatePreviewDocumentSchema } from '@openverify/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { z } from 'zod';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import {
  assetsMessageOf,
  consoleMessages,
  fitsMessage,
  framePlanOf,
  readPreviewMessage,
  themeAssetsOf,
  type PreviewAsset,
  type PreviewOutcome,
  type PreviewScheme,
  type PreviewViewport,
} from './preview-protocol';

export type { PreviewOutcome, PreviewScheme, PreviewViewport } from './preview-protocol';

type TemplatePreviewDocument = z.output<typeof templatePreviewDocumentSchema>;

export interface FlowPreviewFrameProps {
  /** The flow origin (`previewFlowOrigin()`, read on the server), or `null` when not configured. */
  readonly flowOrigin: string | null;
  /** The answer of `POST /inquiry-template-versions/:id/preview` to show, or `null` for none yet. */
  readonly document: TemplatePreviewDocument | null;
  /** The console URL a theme asset's bytes are read from (`previewAssetUrl(templateId)`). */
  readonly assetUrl: (assetId: string) => string;
  /** C156.2's viewport presets, in CSS px; 375 by default. */
  readonly viewport?: PreviewViewport;
  /** Light, dark or automatic (the preview's `color-scheme`); automatic by default. */
  readonly scheme?: PreviewScheme;
  /** The step to show; the preview starts at the first. */
  readonly stepId?: string | null;
  /** A simulated outcome per capture step, which the preview's placeholder states. */
  readonly outcomes?: Readonly<Record<string, PreviewOutcome>>;
  /** Called with the step the preview shows whenever it changes. */
  readonly onNavigated?: (stepId: string) => void;
}

const WIDTH_CLASS: Readonly<Record<PreviewViewport, string>> = {
  320: 'w-[320px]',
  375: 'w-[375px]',
  768: 'w-[768px]',
};

const ERROR_WORDS = {
  'malformed-document': PREVIEW_COPY.frame.malformed,
  'asset-refused': PREVIEW_COPY.frame.assetRefused,
  unknown: PREVIEW_COPY.frame.unknownError,
} as const;

const NO_OUTCOMES: Readonly<Record<string, PreviewOutcome>> = {};
const subscribe = () => () => undefined;
const consoleOriginOf = () => window.location.origin;
const noOriginOnTheServer = () => null;

/** Reads the assets through the console; `null` when one cannot be read. */
async function readAssets(
  document: TemplatePreviewDocument,
  assetUrl: (assetId: string) => string,
): Promise<PreviewAsset[] | null> {
  const refs = themeAssetsOf(document);
  const answers = await Promise.all(
    refs.map(async (ref) => {
      const response = await fetch(assetUrl(ref.assetId), {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      return response.ok ? { ...ref, bytes: await response.arrayBuffer() } : null;
    }),
  );
  return answers.every((answer) => answer !== null) ? answers : null;
}

export function FlowPreviewFrame({
  flowOrigin,
  document,
  assetUrl,
  viewport = 375,
  scheme = 'auto',
  stepId = null,
  outcomes = NO_OUTCOMES,
  onNavigated,
}: FlowPreviewFrameProps) {
  const consoleOrigin = useSyncExternalStore(subscribe, consoleOriginOf, noOriginOnTheServer);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** How many times the preview said `ready`: every message is posted again after each. */
  const [readyCount, setReadyCount] = useState(0);
  const [status, setStatus] = useState<string>(PREVIEW_COPY.frame.waiting);
  /** A note about the assets of one document, shown only while that document is. */
  const [assetNote, setAssetNote] = useState<{
    readonly document: TemplatePreviewDocument;
    readonly text: string;
  } | null>(null);
  const shownRef = useRef<string | null>(null);
  const onNavigatedRef = useRef(onNavigated);

  useEffect(() => {
    onNavigatedRef.current = onNavigated;
  }, [onNavigated]);

  const tooLarge = useMemo(
    () => document !== null && !fitsMessage(consoleMessages.document(document)),
    [document],
  );
  const plan = consoleOrigin === null ? null : framePlanOf(flowOrigin, consoleOrigin);
  const origin = plan?.kind === 'frame' ? plan.origin : null;

  const post = useCallback(
    (message: Parameters<typeof fitsMessage>[0], transfer: Transferable[] = []) => {
      const target = frameRef.current?.contentWindow;
      if (origin !== null && target !== null && target !== undefined) {
        target.postMessage(message, origin, transfer);
      }
    },
    [origin],
  );

  useEffect(() => {
    if (origin === null) {
      return undefined;
    }
    const onMessage = (event: MessageEvent) => {
      const message = readPreviewMessage(event, {
        flowOrigin: origin,
        frame: frameRef.current?.contentWindow ?? null,
      });
      switch (message?.type) {
        case 'ready':
          setStatus(PREVIEW_COPY.frame.ready);
          setReadyCount((count) => count + 1);
          return;
        case 'navigated':
          shownRef.current = message['step-id'];
          setStatus(PREVIEW_COPY.frame.navigated(message['step-id']));
          onNavigatedRef.current?.(message['step-id']);
          return;
        case 'error':
          setStatus(ERROR_WORDS[message.code]);
          return;
        default:
          return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [origin]);

  useEffect(() => {
    if (readyCount === 0 || document === null || tooLarge) {
      return;
    }
    shownRef.current = null;
    post(consoleMessages.document(document));
  }, [readyCount, document, tooLarge, post]);

  useEffect(() => {
    if (readyCount === 0 || document === null) {
      return undefined;
    }
    let current = true;
    if (themeAssetsOf(document).length === 0) {
      return undefined;
    }
    void readAssets(document, assetUrl)
      .catch(() => null)
      .then((assets) => {
        if (!current) {
          return;
        }
        if (assets === null) {
          setAssetNote({ document, text: PREVIEW_COPY.assets.notReadable });
          return;
        }
        const built = assetsMessageOf(assets);
        if (built === null) {
          setAssetNote({ document, text: PREVIEW_COPY.assets.tooLarge });
          return;
        }
        post(built.message, built.transfer);
      });
    return () => {
      current = false;
    };
  }, [readyCount, document, assetUrl, post]);

  useEffect(() => {
    if (readyCount > 0) {
      post(consoleMessages.viewport(viewport));
    }
  }, [readyCount, viewport, post]);

  useEffect(() => {
    if (readyCount > 0) {
      post(consoleMessages.scheme(scheme));
    }
  }, [readyCount, scheme, post]);

  useEffect(() => {
    if (readyCount > 0 && document !== null && stepId !== null && stepId !== shownRef.current) {
      post(consoleMessages.selectStep(stepId));
    }
  }, [readyCount, document, stepId, post]);

  useEffect(() => {
    if (readyCount === 0) {
      return;
    }
    for (const [id, outcome] of Object.entries(outcomes)) {
      post(consoleMessages.outcome(id, outcome));
    }
  }, [readyCount, outcomes, post]);

  if (plan === null) {
    return <p className="text-sm text-ink-muted">{PREVIEW_COPY.frame.waiting}</p>;
  }
  if (plan.kind !== 'frame') {
    return (
      <div role="alert" className="rounded-md border border-danger bg-surface p-4 text-sm">
        <p className="font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {PREVIEW_COPY.frame.configurationError}
        </p>
        <p className="mt-1 text-ink">
          {plan.kind === 'same-origin'
            ? PREVIEW_COPY.frame.sameOrigin
            : PREVIEW_COPY.frame.notConfigured}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-line bg-canvas p-2">
        <iframe
          ref={frameRef}
          src={plan.src}
          title={PREVIEW_COPY.frame.title}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className={`mx-auto block h-[640px] max-w-full border-0 bg-surface ${WIDTH_CLASS[viewport]}`}
        />
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {readyCount > 0 && tooLarge ? PREVIEW_COPY.frame.tooLarge : status}
      </p>
      {assetNote?.document !== document ? null : (
        <p className="text-sm text-ink">{assetNote.text}</p>
      )}
    </div>
  );
}
