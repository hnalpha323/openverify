/**
 * Workflow 10B Stage 1b (I) (C211.4, C221.5; Phase 5 C63; `foundation-10b`): the provider kind
 * `deviceIntegrity`, after Phase 8's kinds, configured as `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_*`,
 * taking `play-integrity` or `sandbox`, read by both processes (the API reads the binding for the
 * session's `integrity` member, the worker decodes). Production refuses the sandbox; an unbound kind
 * binds no provider, which means no request (C211.1). The providers are built by `api-integrity`
 * (`services/device-integrity/providers.test.ts` covers their answers).
 */
import { describe, expect, it } from 'vitest';
import type { ProviderKind, ProviderName, ProviderSettings } from './index.js';
import {
  createProviderBindings,
  NO_PROVIDERS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES,
  PROVIDER_NAMES_BY_KIND,
} from './index.js';

const KIND = 'deviceIntegrity';

const settingsWith = (sandbox: string | null, production: string | null = null): ProviderSettings =>
  ({
    sandbox: { ...NO_PROVIDERS.sandbox, [KIND]: sandbox },
    production: { ...NO_PROVIDERS.production, [KIND]: production },
  }) as unknown as ProviderSettings;

describe('the deviceIntegrity provider kind (C211.4)', () => {
  it("is the last kind, after Phase 8's, with its variable prefix", () => {
    const kinds = PROVIDER_KINDS as readonly string[];
    expect(kinds.at(-1)).toBe(KIND);
    expect(kinds.indexOf(KIND)).toBe(kinds.indexOf('attachmentScanner') + 1);
    expect((PROVIDER_ENV_PREFIXES as Record<string, string>)[KIND]).toBe(
      'OPENVERIFY_PROVIDER_DEVICE_INTEGRITY',
    );
  });

  it('takes play-integrity or the sandbox, and play-integrity is a provider name', () => {
    expect((PROVIDER_NAMES_BY_KIND as Record<string, readonly string[]>)[KIND]).toEqual([
      'play-integrity',
      'sandbox',
    ]);
    expect(PROVIDER_NAMES as readonly string[]).toContain('play-integrity');
  });

  it('is read by the API (the session member) and by the worker (the decode)', () => {
    expect(PROCESS_PROVIDER_KINDS.api as readonly string[]).toContain(KIND);
    expect(PROCESS_PROVIDER_KINDS.worker as readonly string[]).toContain(KIND);
  });

  it('binds the sandbox for a sandbox environment and nothing when unbound', () => {
    const bound = createProviderBindings(settingsWith('sandbox')) as unknown as Record<
      string,
      Record<string, { id: string; sandbox: boolean; name: string } | undefined>
    >;

    expect(bound.sandbox?.[KIND]).toMatchObject({ id: 'sandbox', sandbox: true, name: 'sandbox' });
    expect(bound.production?.[KIND]).toBeUndefined();
  });

  it('binds play-integrity for production and refuses the sandbox there', () => {
    const bound = createProviderBindings(settingsWith(null, 'play-integrity')) as unknown as Record<
      string,
      Record<string, { sandbox: boolean; name: string } | undefined>
    >;

    expect(bound.production?.[KIND]).toMatchObject({ sandbox: false, name: 'play-integrity' });
    expect(() => createProviderBindings(settingsWith(null, 'sandbox'))).toThrow(/sandbox/);
    expect(() => createProviderBindings(settingsWith('mmdb-file'))).toThrow(
      /deviceIntegrity cannot be bound to mmdb-file/,
    );
  });

  it('binds the built sandbox, which decodes a magic token', async () => {
    const bound = createProviderBindings(settingsWith('sandbox')) as unknown as Record<
      string,
      Record<string, { decode(request: { token: string; requestHash: string }): Promise<unknown> }>
    >;

    await expect(
      bound.sandbox?.[KIND]?.decode({ token: 'sandbox-strong', requestHash: 'A'.repeat(43) }),
    ).resolves.toMatchObject({ outcome: 'decoded', 'app-recognition': 'PLAY_RECOGNIZED' });
  });
});

// Keep the imported types in use: the kind and its names stay in the exported unions.
export type _Kinds = ProviderKind | ProviderName;
