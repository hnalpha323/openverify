/**
 * C50.4, C54.1 (H28): the publish rule of an `aamva` step that needs server state, whatever its
 * source: in a production environment, an AAMVA step whose `aamva` provider (C35) is unbound is
 * published only with `accept-review-without-provider: true`; otherwise
 * `provider_not_configured`, pointing at the step (see `database.ts`).
 */
import { providerPublishRule } from './database.js';

export const aamvaPublish = providerPublishRule({
  stepType: 'aamva',
  verificationType: 'aamva',
  kind: 'aamva',
});
