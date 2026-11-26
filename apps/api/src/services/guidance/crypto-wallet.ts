/**
 * C52.2, C54.1: the `crypto-wallet` verification's flow view: `guidance` names the chains the
 * verification offers (the pinned step's, within the type's `allowed-chains`, C57.2) and the
 * signing methods the step allows; `null` without a crypto wallet step or an offered chain.
 */
import { offeredCryptoChains } from '../crypto-challenges/rules.js';
import type { VerificationGuidanceHook } from './index.js';

export const cryptoWalletGuidance: VerificationGuidanceHook = {
  flowAttributes({ step, config }) {
    if (step?.type !== 'crypto_wallet') {
      return Promise.resolve({ guidance: null });
    }
    const chains = offeredCryptoChains(step, config);
    return Promise.resolve({
      guidance: chains.length === 0 ? null : { chains, signing: [...step.signing] },
    });
  },
};
