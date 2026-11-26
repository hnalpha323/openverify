/**
 * Test support for the browser collector (never part of the browser entry): a fake window built
 * from plain objects, with the few browser APIs the collector may read, and a recorder that logs
 * every property read, `in` check, key listing, call and construction made through it. Tests hand
 * the collector a recorded fake and assert exactly which APIs it read, and when (plan C94.3, P14).
 *
 * Every value is synthetic: no real device, canvas or user agent is read.
 */
import type { BrowserWindow } from './types.js';

/** A path such as `window.navigator.webdriver`, `window._selenium?` (an `in` check),
 * `window.*` (a key listing), `window.document.createElement()` (a call) or
 * `window.navigator.__proto__` (a prototype read). Descriptor reads are not logged: the get trap
 * itself reads descriptors, through nested recorders too. */
export type ReadLog = string[];

/**
 * Arrays, promises, buffers and other built-ins with internal slots are returned as they are. The
 * tag is read with `Object.prototype.toString`, which reads no string key of a recorded proxy (an
 * `instanceof` would read its prototype and log it).
 */
const NOT_WRAPPED = /^\[object (?:\w*Array|Promise|ArrayBuffer|Date|RegExp|Map|Set)\]$/;

function wrappable(value: unknown): value is object {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    !NOT_WRAPPED.test(Object.prototype.toString.call(value))
  );
}

/**
 * Wraps `target` so that every read through it (and through every object or function reached
 * from it) is pushed to `log` as a path from `name`. Methods run on the unwrapped object, so fakes
 * and real objects with internal slots (`SubtleCrypto`) keep working.
 */
export function recording<T extends object>(target: T, name: string, log: ReadLog): T {
  const proxies = new WeakMap<object, object>();
  const targets = new WeakMap<object, object>();
  const unwrap = (value: unknown): unknown =>
    typeof value === 'object' || typeof value === 'function'
      ? ((value !== null && targets.get(value)) ?? value)
      : value;

  const wrap = (value: unknown, at: string): unknown => {
    if (!wrappable(value)) {
      return value;
    }
    const known = proxies.get(value);
    if (known !== undefined) {
      return known;
    }
    const proxy = new Proxy(value, {
      get(object, key) {
        const result: unknown = Reflect.get(object, key);
        if (typeof key === 'symbol') {
          return result;
        }
        log.push(`${at}.${key}`);
        // A proxy must return a frozen member as it is (`Function.prototype`); reads beyond it
        // are not recorded.
        const own = Reflect.getOwnPropertyDescriptor(object, key);
        return own?.configurable === false && own.writable === false
          ? result
          : wrap(result, `${at}.${key}`);
      },
      has(object, key) {
        if (typeof key !== 'symbol') {
          log.push(`${at}.${key}?`);
        }
        return Reflect.has(object, key);
      },
      ownKeys(object) {
        log.push(`${at}.*`);
        return Reflect.ownKeys(object);
      },
      getPrototypeOf(object) {
        log.push(`${at}.__proto__`);
        return wrap(Reflect.getPrototypeOf(object), `${at}.__proto__`) as object | null;
      },
      apply(fn, self, args: unknown[]) {
        log.push(`${at}()`);
        return wrap(
          Reflect.apply(fn as (...a: unknown[]) => unknown, unwrap(self), args),
          `${at}()`,
        );
      },
      construct(fn, args: unknown[]) {
        log.push(`new ${at}`);
        return wrap(
          Reflect.construct(fn as new (...a: unknown[]) => object, args),
          `new ${at}`,
        ) as object;
      },
    });
    proxies.set(value, proxy);
    targets.set(proxy, value);
    return proxy;
  };
  return wrap(target, name) as T;
}

/** The fake 2D context records each drawing operation, so tests can check the drawing is fixed. */
export type DrawingLog = (readonly [string, ...unknown[]])[];

export interface FakeBrowserOptions {
  readonly webdriver?: boolean;
  readonly userAgent?: string;
  readonly userAgentData?: unknown;
  readonly languages?: unknown;
  readonly pluginCount?: number | null;
  readonly mimeTypeCount?: number | null;
  /** `null`: the browser has no `navigator.pdfViewerEnabled` (Firefox before 99, Safari before 16.4). */
  readonly pdfViewerEnabled?: boolean | null;
  readonly outerWidth?: number;
  readonly outerHeight?: number;
  readonly focused?: boolean;
  readonly timeZone?: string | (() => string);
  /** Extra own properties of the window and the document (driver globals). */
  readonly windowGlobals?: readonly string[];
  readonly documentGlobals?: readonly string[];
  /** A navigator whose prototype carries these getters written in script (tampered). */
  readonly scriptedNavigatorGetters?: readonly string[];
  readonly bindMissing?: boolean;
  readonly screen?: { width: number; height: number; colorDepth: number } | null;
  readonly devicePixelRatio?: number;
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
  readonly maxTouchPoints?: number;
  /** Successive answers of 2D `toDataURL`; `null` makes `getContext('2d')` answer `null`. */
  readonly canvasReadbacks?: readonly string[] | null;
  readonly webgl?: {
    readonly vendor: string;
    readonly renderer: string;
    readonly unmaskedVendor?: string;
    readonly unmaskedRenderer?: string;
  } | null;
  /** `false` takes `crypto.subtle` away, as on an insecure origin. */
  readonly subtle?: boolean;
  readonly hidden?: boolean;
}

interface Registered {
  readonly target: 'window' | 'document';
  readonly type: string;
  readonly listener: (event: unknown) => void;
  readonly options: unknown;
}

export interface FakeBrowser {
  /** The fake, unrecorded. */
  readonly window: BrowserWindow;
  /** Moves the fake monotonic clock (`performance.now`) forward. */
  advance(milliseconds: number): void;
  /** Calls every listener the collector registered for `type` on `target`. */
  dispatch(target: 'window' | 'document', event: Record<string, unknown> & { type: string }): void;
  /** Sets `document.visibilityState` and dispatches `visibilitychange`. */
  setHidden(hidden: boolean): void;
  /** The listeners registered and not removed. */
  listenerCount(): number;
  /** Every `addEventListener` call made so far. */
  readonly added: Registered[];
  /** Every 2D drawing operation, per canvas. */
  readonly drawings: DrawingLog[];
  /** Whether the WebGL context was released. */
  webglReleased(): boolean;
}

const VENDOR = 0x1f00;
const RENDERER = 0x1f01;
const UNMASKED_VENDOR = 0x9245;
const UNMASKED_RENDERER = 0x9246;

/** A fake browser window. Every option has a clean, synthetic default. */
export function fakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  let clock = 1_000;
  let hidden = options.hidden ?? false;
  let readback = 0;
  let released = false;
  const listeners: Registered[] = [];
  const added: Registered[] = [];
  const drawings: DrawingLog[] = [];

  const register = (target: Registered['target']) => ({
    addEventListener(type: string, listener: (event: unknown) => void, options?: unknown) {
      const entry = { target, type, listener, options };
      listeners.push(entry);
      added.push(entry);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      const index = listeners.findIndex(
        (entry) => entry.target === target && entry.type === type && entry.listener === listener,
      );
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
  });

  const context2d = (drawing: DrawingLog): object =>
    new Proxy(
      {},
      {
        get: (_object, key) =>
          typeof key === 'string'
            ? (...args: unknown[]) => {
                drawing.push([key, ...args]);
              }
            : undefined,
        set: (_object, key, value: unknown) => {
          drawing.push([`${String(key)}=`, value]);
          return true;
        },
      },
    );

  const webgl = options.webgl;
  const gl =
    webgl === undefined || webgl === null
      ? null
      : {
          VENDOR,
          RENDERER,
          getExtension(name: string) {
            if (name === 'WEBGL_debug_renderer_info' && webgl.unmaskedVendor !== undefined) {
              return {
                UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR,
                UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER,
              };
            }
            if (name === 'WEBGL_lose_context') {
              return {
                loseContext() {
                  released = true;
                },
              };
            }
            return null;
          },
          getParameter(parameter: number) {
            return {
              [VENDOR]: webgl.vendor,
              [RENDERER]: webgl.renderer,
              [UNMASKED_VENDOR]: webgl.unmaskedVendor,
              [UNMASKED_RENDERER]: webgl.unmaskedRenderer,
            }[parameter];
          },
        };

  const readbacks =
    options.canvasReadbacks === undefined
      ? ['data:image/png;base64,AAAA']
      : options.canvasReadbacks;
  const createCanvas = () => {
    const drawing: DrawingLog = [];
    return {
      width: 300,
      height: 150,
      getContext(kind: string) {
        if (kind === '2d') {
          if (readbacks === null) {
            return null;
          }
          drawings.push(drawing);
          return context2d(drawing);
        }
        return kind === 'webgl' ? gl : null;
      },
      toDataURL() {
        const answer = readbacks?.[Math.min(readback, (readbacks.length || 1) - 1)] ?? '';
        readback += 1;
        return answer;
      },
    };
  };

  const navigatorPrototype: object = {};
  for (const getter of options.scriptedNavigatorGetters ?? []) {
    Object.defineProperty(navigatorPrototype, getter, {
      get: () => false,
      configurable: true,
    });
  }
  // Own data members first, then the prototype: a scripted getter on it is shadowed, as in a
  // tampered page, and still found by its descriptor.
  const navigator: object = {
    webdriver: options.webdriver ?? false,
    userAgent:
      options.userAgent ??
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    userAgentData: options.userAgentData,
    languages: options.languages ?? ['en-US', 'en'],
    plugins: options.pluginCount === null ? undefined : { length: options.pluginCount ?? 5 },
    mimeTypes: options.mimeTypeCount === null ? undefined : { length: options.mimeTypeCount ?? 2 },
    pdfViewerEnabled:
      options.pdfViewerEnabled === null ? undefined : (options.pdfViewerEnabled ?? true),
    hardwareConcurrency: options.hardwareConcurrency ?? 8,
    deviceMemory: options.deviceMemory,
    maxTouchPoints: options.maxTouchPoints ?? 0,
  };
  Object.setPrototypeOf(navigator, navigatorPrototype);

  const FakeFunction = options.bindMissing
    ? Object.assign(
        function FakeFunction() {
          // A function realm whose prototype lost `bind`, as PhantomJS's did.
        },
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the realm's own toString, called with .call
        { prototype: { toString: Function.prototype.toString } },
      )
    : Function;

  const document = {
    ...register('document'),
    hasFocus: () => options.focused ?? true,
    get visibilityState() {
      return hidden ? 'hidden' : 'visible';
    },
    createElement: (tag: string) => {
      if (tag !== 'canvas') {
        throw new Error(`the collector created a <${tag}>`);
      }
      return createCanvas();
    },
  };
  for (const name of options.documentGlobals ?? []) {
    Object.defineProperty(document, name, { value: true, enumerable: false, configurable: true });
  }

  const timeZone = options.timeZone ?? 'Etc/UTC';
  const window: Record<string, unknown> = {
    ...register('window'),
    navigator,
    document,
    outerWidth: options.outerWidth ?? 1280,
    outerHeight: options.outerHeight ?? 800,
    screen:
      options.screen === null
        ? undefined
        : (options.screen ?? { width: 1280, height: 800, colorDepth: 24 }),
    devicePixelRatio: options.devicePixelRatio ?? 1,
    performance: { now: () => clock },
    crypto: options.subtle === false ? {} : { subtle: globalThis.crypto.subtle },
    Intl: {
      DateTimeFormat: () => ({
        resolvedOptions: () => ({
          timeZone: typeof timeZone === 'function' ? timeZone() : timeZone,
        }),
      }),
    },
    Function: FakeFunction,
  };
  for (const name of options.windowGlobals ?? []) {
    window[name] = true;
  }

  const fake: FakeBrowser = {
    window: window as unknown as BrowserWindow,
    advance(milliseconds) {
      clock += milliseconds;
    },
    dispatch(target, event) {
      for (const entry of listeners.filter(
        (item) => item.target === target && item.type === event.type,
      )) {
        entry.listener(event);
      }
    },
    setHidden(value) {
      hidden = value;
      fake.dispatch('document', { type: 'visibilitychange', isTrusted: true });
    },
    listenerCount: () => listeners.length,
    added,
    drawings,
    webglReleased: () => released,
  };
  return fake;
}

/** A synthetic DOM event with the given facts (trusted unless stated). */
export function fakeEvent(
  type: string,
  facts: Record<string, unknown> = {},
): Record<string, unknown> & { type: string } {
  return { type, isTrusted: true, target: { matches: () => false }, ...facts };
}
