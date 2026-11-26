/**
 * C278.2's recipient list reads the provider registry (`apps/api/src/providers/index.ts`). That
 * module reaches most of the API, so it is loaded once with a dynamic `import()` of a computed path
 * (contracts-11e's input rule 5: a static import would make `tsc` check the whole API) and read
 * through the local {@link ProvidersModule} shape.
 */

/** The parts of the provider registry the recipient list reads. */
export interface ProvidersModule {
  readonly PROVIDER_KINDS: readonly string[];
  readonly PROVIDER_ENV_PREFIXES: Readonly<Record<string, string>>;
  readonly PROVIDER_NAMES_BY_KIND: Readonly<Record<string, readonly string[]>>;
  readonly PROCESS_PROVIDER_KINDS: Readonly<{ api: readonly string[]; worker: readonly string[] }>;
  readonly COMPANIES_HOUSE_KEY_ENV: Readonly<Record<string, string>>;
  readonly SEC_EDGAR_USER_AGENT_ENV: string;
  readonly SANDBOX_PROVIDER: string;
  readProviderSettings(env: Readonly<Record<string, string | undefined>>): {
    settings: { production: Readonly<Record<string, unknown>> };
  };
}

/** What the recipient list needs from the registry, as plain data. */
export interface ProviderFacts {
  /** Every kind, in the registry's order. */
  readonly kinds: readonly string[];
  /** Each kind's variable prefix (`_SANDBOX` or `_PRODUCTION` follows). */
  readonly prefixes: Readonly<Record<string, string>>;
  /** The names each kind takes, `sandbox` included. */
  readonly namesByKind: Readonly<Record<string, readonly string[]>>;
  /** The kinds the API reads (the worker reads every kind). */
  readonly apiKinds: readonly string[];
  /** What an unset variable binds in a production environment: `null`, a name or a list. */
  readonly unsetDefaults: Readonly<Record<string, unknown>>;
  /**
   * For each variable that widens a default (`businessRegistry`'s two optional registers), what an
   * unset kind binds with only that variable set.
   */
  readonly widenedDefaults: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** The deterministic provider's name. */
  readonly sandbox: string;
}

/** The plain facts of a loaded registry module. */
export function providerFactsOf(module: ProvidersModule): ProviderFacts {
  const widening = [
    module.COMPANIES_HOUSE_KEY_ENV.production ?? '',
    module.SEC_EDGAR_USER_AGENT_ENV,
  ]
    .filter((name) => name !== '')
    .sort();
  return {
    kinds: [...module.PROVIDER_KINDS],
    prefixes: { ...module.PROVIDER_ENV_PREFIXES },
    namesByKind: { ...module.PROVIDER_NAMES_BY_KIND },
    apiKinds: [...module.PROCESS_PROVIDER_KINDS.api],
    unsetDefaults: module.readProviderSettings({}).settings.production,
    widenedDefaults: Object.fromEntries(
      widening.map((name) => [
        name,
        module.readProviderSettings({ [name]: 'change-me-synthetic' }).settings.production,
      ]),
    ),
    sandbox: module.SANDBOX_PROVIDER,
  };
}

const REGISTRY_PATH = '../../../../apps/api/src/providers/index.ts';

/** The registry's facts, loaded once when this module is first imported. */
export const PROVIDER_FACTS: ProviderFacts = providerFactsOf(
  (await import(new URL(REGISTRY_PATH, import.meta.url).href)) as ProvidersModule,
);
