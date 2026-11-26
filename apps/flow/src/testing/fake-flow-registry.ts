/**
 * Workflow 9A Stage 1b (F; review F11): the registration hook of the in-memory flow API
 * (`fake-flow-api.ts`), so each Stage 3 owner keeps its fake answers in its own
 * `src/testing/<area>.ts` and never edits the shared fake. An area registers once, at import:
 *
 * ```ts
 * registerFakeFlowExtension('renderer', {
 *   session: (session, fake) => ({ ...session, position: positionOf(fake) }),
 *   client: (fake) => ({ submitScreen: vi.fn(...) }),
 * });
 * ```
 *
 * Every `FakeFlowApi` made afterwards applies each registered extension in registration order:
 * `session` rewrites every session answer, and `client` adds (or replaces) client methods,
 * built once per fake. Registering an area again replaces its extension.
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import type { FakeFlowApi, MockedClient } from './fake-flow-api';

export interface FakeFlowExtension {
  /** Rewrites each session answer the fake serves (the area's own members, such as `position`). */
  readonly session?: (session: FlowSessionResponse, fake: FakeFlowApi) => FlowSessionResponse;
  /** Client methods the area adds or replaces, built once per fake. */
  readonly client?: (fake: FakeFlowApi) => Partial<MockedClient>;
}

const extensions = new Map<string, FakeFlowExtension>();

/** Registers `area`'s extension (replacing an earlier one); answers a function that removes it. */
export function registerFakeFlowExtension(area: string, extension: FakeFlowExtension): () => void {
  extensions.set(area, extension);
  return () => {
    if (extensions.get(area) === extension) {
      extensions.delete(area);
    }
  };
}

/** The registered extensions, in registration order. */
export function fakeFlowExtensions(): readonly FakeFlowExtension[] {
  return [...extensions.values()];
}
