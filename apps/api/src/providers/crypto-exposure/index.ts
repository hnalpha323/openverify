/**
 * C83: the `cryptoExposure` provider, `sandbox` only in Phase 6 (no analytics vendor is built;
 * Chainalysis, TRM and Elliptic are later adapters). The crypto job's optional exposure step
 * (`jobs/report-types/crypto-address-watchlist.ts`, `api-reports`) calls it through its port.
 *
 * The sandbox (sandbox environments only, ADR 0002 §3d) calls nothing and answers deterministically
 * by the canonical address (C82.4):
 *
 * | Address | Answer |
 * |---|---|
 * | EVM, ending in `dead` | rated: `sanctioned_entity`, indirect exposure 0.25 (two hops away), direct 0 |
 * | EVM, ending in `beef` | rated: `sanctioned_entity`, direct exposure 1 (in the cluster itself) |
 * | any other EVM address | rated: no category, no exposure |
 * | any other chain or format | `unavailable`, `unsupported_chain` (never a pass) |
 *
 * An address is EVM when its chain is `eip155:<n>`, or when the query named no chain (`unknown`,
 * C79.3) and the address is 20 bytes of hex. The endings are matched case-insensitively.
 */
import type { CryptoExposureProvider, CryptoExposureResult } from '../../ports.js';
import type { ReportProviderOptions } from '../report-options.js';

/** C82.4: the sandbox's magic endings. */
export const SANDBOX_CRYPTO_EXPOSURE = Object.freeze({
  indirect: { ending: 'dead', share: 0.25 },
  direct: { ending: 'beef', share: 1 },
});

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/iu;

function isEvm(chainId: string, address: string): boolean {
  return EVM_ADDRESS.test(address) && (chainId.startsWith('eip155:') || chainId === 'unknown');
}

/** The sandbox provider (C82.4): it calls nothing. */
function createSandboxCryptoExposureProvider(): CryptoExposureProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    exposure({ chainId, address }): Promise<CryptoExposureResult> {
      if (!isEvm(chainId, address)) {
        return Promise.resolve({ outcome: 'unavailable', reason: 'unsupported_chain' });
      }
      const ending = address.toLowerCase();
      const { indirect, direct } = SANDBOX_CRYPTO_EXPOSURE;
      if (ending.endsWith(direct.ending)) {
        return Promise.resolve({
          outcome: 'rated',
          categories: ['sanctioned_entity'],
          direct: direct.share,
          indirect: 0,
        });
      }
      if (ending.endsWith(indirect.ending)) {
        return Promise.resolve({
          outcome: 'rated',
          categories: ['sanctioned_entity'],
          direct: 0,
          indirect: indirect.share,
        });
      }
      return Promise.resolve({ outcome: 'rated', categories: [], direct: 0, indirect: 0 });
    },
  };
}

/** Each name the kind takes and how it is built; the sandbox reads no option. */
const PROVIDERS: Readonly<
  Record<'sandbox', (options: ReportProviderOptions) => CryptoExposureProvider>
> = { sandbox: () => createSandboxCryptoExposureProvider() };

/** The provider `name` binds (C83): the sandbox, the only one this version ships. */
export function createCryptoExposureProvider(
  name: 'sandbox',
  options: ReportProviderOptions = {},
): CryptoExposureProvider {
  return PROVIDERS[name](options);
}
