/**
 * C156.2, C156.3 (Workflow 9A, `flow-server-embed`): the console's preview of a draft. It has no
 * session and makes no network call (`connect-src 'none'`); the console posts it the resolved
 * preview document (`POST .../preview`'s answer) and any theme assets, and it renders every
 * renderable step through the live flow's own components (`StaticStep` of `flow-renderer`), with no
 * client: a submit does nothing. A step that needs the camera or the API is a still placeholder.
 *
 * Messages: from the exact console origin and `window.parent` only (`readConsoleMessage`); to the
 * exact console origin only: `ready` on start, `navigated` when the shown step changes, `error`
 * (`malformed-document`, `asset-refused`). The chrome (the banner, the placeholders) is the
 * console's, in English (decision 33), marked `lang="en"`; the steps follow the document's locale.
 */
import {
  templatePreviewDocumentSchema,
  type ConsoleToPreviewMessage,
  type PreviewToConsoleMessage,
} from '@openverify/contracts';
import type { ClientStepView } from '@openverify/flow-spec';
import { Card } from '@openverify/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import type { z } from 'zod';
import { createI18n } from '../i18n/create-i18n';
import { syncDocumentLanguage } from '../i18n/document-language';
import { translateKey } from '../i18n/translate-key';
import { isPreviewable, StaticStep } from '../screens/step-registry';
import { loadPreviewAssets, PREVIEW_FONT_FAMILY, type PreviewAssetDeps } from './assets';
import { readConsoleMessage } from './protocol';

/** The browser globals the preview reads (`window` in `start.ts`; injected in tests). */
export interface PreviewHost {
  readonly parent: unknown;
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
}

export interface PreviewAppProps {
  readonly consoleOrigin: string | null;
  readonly host: PreviewHost;
  readonly assetDeps: PreviewAssetDeps;
  /** The document element, for `color-scheme`, `lang` and `dir`. */
  readonly root: HTMLElement;
}

type PreviewAttributes = z.infer<typeof templatePreviewDocumentSchema>['data']['attributes'];
type Outcome = Extract<ConsoleToPreviewMessage, { type: 'set-outcome' }>['outcome'];
type Viewport = Extract<ConsoleToPreviewMessage, { type: 'set-viewport' }>['width'];

/** C156.7: what the preview does not do, said on every state. */
const BANNER =
  'Preview: no camera, no uploads, no checks, and outcomes are simulated. The server-side validations (patterns, field writes, consent digests) do not run here.';
const WAITING = 'Waiting for the console to send the draft.';

interface Poster {
  postMessage(message: unknown, targetOrigin: string): void;
}
const isPoster = (value: unknown): value is Poster =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Partial<Poster>).postMessage === 'function';

/** The built-in catalog a preview locale reads (a pseudo-locale reads its source). */
const languageOf = (locale: PreviewAttributes['locale']) =>
  locale.startsWith('ar') ? 'ar' : locale.slice(0, 2);

function Placeholder({
  step,
  outcome,
}: {
  readonly step: ClientStepView;
  readonly outcome?: Outcome;
}) {
  return (
    <Card
      title={<span lang="en">{`Step ${step.id} (${step.type.replaceAll('_', ' ')})`}</span>}
      headingLevel={1}
    >
      <p lang="en">
        This step is drawn as a still placeholder in the preview: the camera, uploads and checks run
        only in a live flow.
      </p>
      {outcome === undefined ? null : (
        <p lang="en">{`Simulated outcome: ${outcome.replaceAll('_', ' ')}`}</p>
      )}
    </Card>
  );
}

export function PreviewApp({ consoleOrigin, host, assetDeps, root }: PreviewAppProps) {
  const [document, setDocument] = useState<PreviewAttributes | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, Outcome>>>({});
  const [width, setWidth] = useState<Viewport | null>(null);
  const [logos, setLogos] = useState<ReadonlyMap<string, string>>(new Map());
  const [font, setFont] = useState(false);
  const documentRef = useRef<PreviewAttributes | null>(null);

  const post = useCallback(
    (message: PreviewToConsoleMessage) => {
      if (consoleOrigin !== null && isPoster(host.parent)) {
        host.parent.postMessage(message, consoleOrigin);
      }
    },
    [consoleOrigin, host],
  );

  const show = useCallback(
    (id: string) => {
      setStepId(id);
      post({ source: 'openverify-preview', version: 1, type: 'navigated', 'step-id': id });
    },
    [post],
  );

  useEffect(() => {
    post({ source: 'openverify-preview', version: 1, type: 'ready' });
  }, [post]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = readConsoleMessage(event as MessageEvent, {
        consoleOrigin,
        parent: host.parent,
      });
      const current = documentRef.current;
      const holds = (id: string) => current?.steps.some((step) => step.id === id) === true;
      switch (message?.type) {
        case 'preview-document': {
          const parsed = templatePreviewDocumentSchema.safeParse(message.document);
          if (!parsed.success) {
            post({
              source: 'openverify-preview',
              version: 1,
              type: 'error',
              code: 'malformed-document',
            });
            return;
          }
          const attributes = parsed.data.data.attributes;
          documentRef.current = attributes;
          setDocument(attributes);
          const first = attributes.steps[0]?.id;
          if (first !== undefined) {
            show(first);
          }
          return;
        }
        case 'select-step':
          if (holds(message['step-id'])) {
            show(message['step-id']);
          }
          return;
        case 'set-outcome':
          if (holds(message['step-id'])) {
            setOutcomes((all) => ({ ...all, [message['step-id']]: message.outcome }));
          }
          return;
        case 'set-viewport':
          setWidth(message.width);
          return;
        case 'set-scheme':
          root.style.colorScheme = message.scheme === 'auto' ? 'light dark' : message.scheme;
          return;
        case 'preview-assets':
          void loadPreviewAssets(message.assets, assetDeps).then((loaded) => {
            if (loaded.logos.size > 0) {
              setLogos((previous) => {
                const next = new Map(previous);
                for (const [id, url] of loaded.logos) {
                  const replaced = next.get(id);
                  if (replaced !== undefined) {
                    assetDeps.revokeObjectURL(replaced);
                  }
                  next.set(id, url);
                }
                return next;
              });
            }
            if (loaded.font) {
              setFont(true);
            }
            if (loaded.refused) {
              post({
                source: 'openverify-preview',
                version: 1,
                type: 'error',
                code: 'asset-refused',
              });
            }
          });
          return;
        default:
          return;
      }
    };
    host.addEventListener('message', onMessage);
    return () => {
      host.removeEventListener('message', onMessage);
    };
  }, [consoleOrigin, host, assetDeps, root, post, show]);

  const language = document === null ? 'en' : languageOf(document.locale);
  const i18n = useMemo(
    () =>
      createI18n(
        language === 'ar' || language === 'es' || language === 'fr' || language === 'de'
          ? language
          : 'en',
      ),
    [language],
  );
  useEffect(
    () => (document === null ? undefined : syncDocumentLanguage(i18n, root)),
    [document, i18n, root],
  );

  const copy = useCallback(
    (key: string) => document?.copy[key] ?? translateKey(i18n, key),
    [document, i18n],
  );
  const asset = useCallback((assetId: string) => logos.get(assetId) ?? null, [logos]);
  const step = document?.steps.find((candidate) => candidate.id === stepId);

  return (
    <I18nextProvider i18n={i18n}>
      <div className="flex flex-col gap-4 p-4">
        <p lang="en" className="text-sm text-ink-muted" role="note">
          {BANNER}
        </p>
        <div
          data-testid="preview-viewport"
          className="mx-auto w-full"
          style={{
            ...(width === null ? {} : { maxWidth: `${String(width)}px` }),
            ...(font ? { fontFamily: `"${PREVIEW_FONT_FAMILY}", system-ui, sans-serif` } : {}),
          }}
        >
          {step === undefined ? (
            <p lang="en">{WAITING}</p>
          ) : isPreviewable(step) ? (
            <StaticStep step={step} copy={copy} asset={asset} />
          ) : (
            <Placeholder
              step={step}
              {...(outcomes[step.id] === undefined ? {} : { outcome: outcomes[step.id] })}
            />
          )}
        </div>
      </div>
    </I18nextProvider>
  );
}
