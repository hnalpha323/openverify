'use client';

import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { Button } from '@openverify/ui';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { RenditionImage } from '../../rendition-image';

export interface CompareImage {
  readonly id: string;
  /** The console route of the rendition (C135.3): never an original, never a storage URL. */
  readonly src: string;
  /** Names the image's role, never the person (1.1.1). */
  readonly alt: string;
  readonly caption: string;
}

/** The step of a zoom button or key, and of a pan, in CSS pixels. */
export const ZOOM_STEP = 0.25;
export const PAN_STEP = 40;
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
/** The viewer's own keys, active only while it has focus (2.1.4). */
const VIEWER_KEYS = '+ - 0 ArrowUp ArrowDown ArrowLeft ArrowRight R';

interface View {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

const START: View = { scale: 1, x: 0, y: 0, rotation: 0 };

type Command =
  | { readonly kind: 'zoom'; readonly by: 1 | -1 }
  | { readonly kind: 'pan'; readonly x: number; readonly y: number }
  | { readonly kind: 'reset' }
  | { readonly kind: 'rotate' };

function stateWords(view: View): string {
  return `Zoom ${String(Math.round(view.scale * 100))}%, offset ${String(Math.round(view.x))}, ${String(Math.round(view.y))}, rotated ${String(view.rotation)}°`;
}

/** The key's command, for keys pressed on the viewer itself; anything else passes. */
function commandOf(event: KeyboardEvent<HTMLElement>): Command | null {
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  switch (event.key) {
    case '+':
    case '=':
      return { kind: 'zoom', by: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', by: -1 };
    case '0':
      return { kind: 'reset' };
    case 'ArrowLeft':
      return { kind: 'pan', x: -PAN_STEP, y: 0 };
    case 'ArrowRight':
      return { kind: 'pan', x: PAN_STEP, y: 0 };
    case 'ArrowUp':
      return { kind: 'pan', x: 0, y: -PAN_STEP };
    case 'ArrowDown':
      return { kind: 'pan', x: 0, y: PAN_STEP };
    case 'r':
    case 'R':
      return { kind: 'rotate' };
    default:
      return null;
  }
}

/** A viewer's controller: panzoom on its stage, and the rotation on its image. */
interface Controller {
  readonly apply: (command: Command) => View;
  readonly set: (view: View) => View;
}

/** Whether a viewer's controller is attached, as a store `useSyncExternalStore` reads. */
class Attachment {
  private attached = false;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly isAttached = (): boolean => this.attached;
  set(attached: boolean): void {
    this.attached = attached;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const NOT_ATTACHED = () => false;

/**
 * The viewer's controller, and whether it is attached: until then (on the server, before hydration,
 * and until this effect ran) a key pressed on the viewer would reach no handler and be lost (2.1.1).
 */
function useController(
  stage: RefObject<HTMLDivElement | null>,
  onChange: (view: View) => void,
): readonly [RefObject<Controller | null>, boolean] {
  const controller = useRef<Controller | null>(null);
  const [attachment] = useState(() => new Attachment());
  useEffect(() => {
    const element = stage.current;
    if (element === null) {
      return undefined;
    }
    // CSSOM writes only (no style element, no inline markup), so a nonce style-src holds.
    const panzoom: PanzoomObject = Panzoom(element, {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      step: ZOOM_STEP,
      animate: false,
      cursor: 'grab',
    });
    let rotation = 0;
    const current = (): View => {
      const { x, y } = panzoom.getPan();
      return { scale: panzoom.getScale(), x, y, rotation };
    };
    const rotate = () => {
      const image = element.firstElementChild;
      if (image instanceof HTMLElement) {
        image.style.transform = rotation === 0 ? '' : `rotate(${String(rotation)}deg)`;
      }
    };
    controller.current = {
      apply: (command) => {
        switch (command.kind) {
          case 'zoom':
            if (command.by === 1) panzoom.zoomIn({ animate: false });
            else panzoom.zoomOut({ animate: false });
            break;
          case 'pan':
            panzoom.pan(command.x, command.y, { relative: true, animate: false });
            break;
          case 'reset':
            panzoom.reset({ animate: false });
            rotation = 0;
            rotate();
            break;
          case 'rotate':
            rotation = (rotation + 90) % 360;
            rotate();
            break;
        }
        return current();
      },
      set: (view) => {
        panzoom.zoom(view.scale, { animate: false });
        panzoom.pan(view.x, view.y, { animate: false, force: true });
        return current();
      },
    };
    const changed = () => {
      onChange(current());
    };
    element.addEventListener('panzoomchange', changed);
    attachment.set(true);
    return () => {
      element.removeEventListener('panzoomchange', changed);
      panzoom.destroy();
      controller.current = null;
      attachment.set(false);
    };
  }, [stage, onChange, attachment]);
  const ready = useSyncExternalStore(attachment.subscribe, attachment.isAttached, NOT_ATTACHED);
  return [controller, ready];
}

interface ViewerProps {
  readonly image: CompareImage;
  readonly filter: string;
  readonly view: View;
  readonly onCommand: (command: Command) => void;
  readonly register: (controller: RefObject<Controller | null>) => void;
  readonly onPointerChange: (view: View) => void;
}

/** One image in its viewer: a focusable group with its own buttons and keys. */
function Viewer({ image, filter, view, onCommand, register, onPointerChange }: ViewerProps) {
  const stage = useRef<HTMLDivElement>(null);
  const imageBox = useRef<HTMLDivElement>(null);
  const help = useId();
  const [controller, ready] = useController(stage, onPointerChange);
  useEffect(() => {
    register(controller);
  }, [register, controller]);
  useEffect(() => {
    // A viewing aid: a CSS filter set through the CSSOM, never stored, never sent.
    if (imageBox.current !== null) {
      imageBox.current.style.filter = filter;
    }
  }, [filter]);
  // A symbol that is no word (+, an arrow) shows with the name as its label; a button without one
  // shows its name, so what a speech user reads off it is what it is called (2.5.3).
  const button = (label: string, command: Command, symbol?: string) => (
    <button
      type="button"
      aria-label={symbol === undefined ? undefined : label}
      onClick={() => {
        onCommand(command);
      }}
      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-control px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {symbol === undefined ? label : <span aria-hidden="true">{symbol}</span>}
    </button>
  );
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-2">
      <div
        role="group"
        aria-label={`${image.caption} viewer`}
        aria-keyshortcuts={VIEWER_KEYS}
        aria-describedby={help}
        // Focusable only once its keys act; busy until then (K8-36).
        tabIndex={ready ? 0 : undefined}
        aria-busy={ready ? undefined : true}
        onKeyDown={(event) => {
          const command = commandOf(event);
          if (command !== null) {
            event.preventDefault();
            onCommand(command);
          }
        }}
        className="flex flex-col gap-2 rounded-lg border border-line p-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <div className="h-72 overflow-hidden rounded bg-canvas">
          <div ref={stage} className="flex h-full w-full items-center justify-center">
            <div ref={imageBox} className="max-h-full max-w-full">
              <RenditionImage
                src={image.src}
                alt={image.alt}
                className="max-h-72 max-w-full object-contain"
              />
            </div>
          </div>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-ink-muted">
          {stateWords(view)}
        </p>
        <div className="flex flex-wrap gap-1 print:hidden">
          {button('Zoom in', { kind: 'zoom', by: 1 }, '+')}
          {button('Zoom out', { kind: 'zoom', by: -1 }, '−')}
          {button('Move left', { kind: 'pan', x: -PAN_STEP, y: 0 }, '←')}
          {button('Move right', { kind: 'pan', x: PAN_STEP, y: 0 }, '→')}
          {button('Move up', { kind: 'pan', x: 0, y: -PAN_STEP }, '↑')}
          {button('Move down', { kind: 'pan', x: 0, y: PAN_STEP }, '↓')}
          {button('Rotate', { kind: 'rotate' }, '⟳')}
          {button('Reset', { kind: 'reset' })}
        </div>
        <p id={help} className="sr-only">
          While this viewer has focus: plus and minus zoom, 0 resets, the arrows move the image, and
          R rotates it by 90 degrees.
        </p>
      </div>
      <figcaption className="text-xs text-ink-muted">{image.caption}</figcaption>
    </figure>
  );
}

/**
 * The compare panel's viewers (C142.3, editor note 7): the images side by side above 1,024 px and
 * stacked below, each zoomed and panned with `@panzoom/panzoom` through our own buttons and keys,
 * the keys active only while its viewer has focus. "Link views" applies one zoom and pan to both.
 * Rotation, brightness, contrast and grayscale are viewing aids: they change nothing stored and send
 * nothing. The side poses show on request.
 */
export function CompareViewer({
  images,
  extra = [],
}: {
  readonly images: readonly CompareImage[];
  readonly extra?: readonly CompareImage[];
}) {
  const [linked, setLinked] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [grayscale, setGrayscale] = useState(false);
  const shown = showExtra ? [...images, ...extra] : images;
  const [views, setViews] = useState<Readonly<Record<string, View>>>({});
  const controllers = useRef(new Map<string, RefObject<Controller | null>>());

  const filter =
    brightness === 100 && contrast === 100 && !grayscale
      ? ''
      : `brightness(${String(brightness / 100)}) contrast(${String(contrast / 100)}) grayscale(${grayscale ? '1' : '0'})`;

  const commandFor = (id: string) => (command: Command) => {
    const own = controllers.current.get(id)?.current;
    if (own === null || own === undefined) {
      return;
    }
    const view = own.apply(command);
    const next: Record<string, View> = { ...views, [id]: view };
    if (linked && command.kind !== 'rotate') {
      for (const [otherId, other] of controllers.current) {
        if (otherId !== id && other.current !== null) {
          const otherView =
            command.kind === 'reset' ? other.current.apply(command) : other.current.set(view);
          next[otherId] = otherView;
        }
      }
    }
    setViews(next);
  };

  const registerFor = useCallback(
    (id: string) => (controller: RefObject<Controller | null>) => {
      controllers.current.set(id, controller);
    },
    [],
  );
  const pointerFor = useCallback(
    (id: string) => (view: View) => {
      setViews((current) => {
        const before = current[id];
        return before?.scale === view.scale &&
          before.x === view.x &&
          before.y === view.y &&
          before.rotation === view.rotation
          ? current
          : { ...current, [id]: view };
      });
    },
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row">
        {shown.map((image) => (
          <StableViewer
            key={image.id}
            image={image}
            filter={filter}
            view={views[image.id] ?? START}
            onCommand={commandFor(image.id)}
            registerFor={registerFor}
            pointerFor={pointerFor}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <Button
          variant="secondary"
          aria-pressed={linked}
          onClick={() => {
            setLinked((current) => !current);
          }}
        >
          Link views
        </Button>
        <Button
          variant="secondary"
          aria-pressed={grayscale}
          onClick={() => {
            setGrayscale((current) => !current);
          }}
        >
          Grayscale
        </Button>
        <label className="flex flex-col gap-1 text-sm">
          Brightness
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={brightness}
            onChange={(event) => {
              setBrightness(Number(event.target.value));
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contrast
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={contrast}
            onChange={(event) => {
              setContrast(Number(event.target.value));
            }}
          />
        </label>
        {extra.length > 0 && (
          <Button
            variant="secondary"
            aria-expanded={showExtra}
            onClick={() => {
              setShowExtra((current) => !current);
            }}
          >
            {showExtra ? 'Hide the side poses' : 'Show the side poses'}
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Viewing aids only: rotation, brightness, contrast and grayscale change nothing stored and no
        check result.
      </p>
    </div>
  );
}

/** A viewer whose registration callbacks keep their identity across renders. */
function StableViewer({
  image,
  registerFor,
  pointerFor,
  ...props
}: Omit<ViewerProps, 'register' | 'onPointerChange'> & {
  readonly registerFor: (id: string) => (controller: RefObject<Controller | null>) => void;
  readonly pointerFor: (id: string) => (view: View) => void;
}) {
  const [register] = useState(() => registerFor(image.id));
  const [onPointerChange] = useState(() => pointerFor(image.id));
  return <Viewer {...props} image={image} register={register} onPointerChange={onPointerChange} />;
}
