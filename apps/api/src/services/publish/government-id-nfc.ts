/**
 * C50.4, C54.1 (H28): the publish rule of an `nfc` step that needs server state. In a production
 * environment an `nfc` step is published only while the trust store holds a non-sandbox anchor
 * that an enabled source lists (`hasNonSandboxTrustAnchor`), because every chip would otherwise
 * end in review (`trust_anchor_unavailable`), or when the type sets
 * `accept-review-without-provider: true`; otherwise `provider_not_configured`, pointing at the
 * step. The seed's Utopia anchor is sandbox-only and never counts. A sandbox environment
 * publishes it as it is.
 */
import { hasNonSandboxTrustAnchor } from '@openverify/db';
import type { PublishHook } from './index.js';

export const governmentIdNfcPublish: PublishHook = {
  async problems(ctx) {
    if (
      ctx.environment.kind !== 'production' ||
      ctx.config['government-id-nfc']?.['accept-review-without-provider'] === true ||
      (await hasNonSandboxTrustAnchor(ctx.db))
    ) {
      return [];
    }
    return ctx.flow.steps.flatMap((step, index) =>
      step.type === 'nfc'
        ? [
            {
              code: 'provider_not_configured' as const,
              pointer: `/flow/steps/${String(index)}`,
              detail:
                'The trust store holds no anchor a production environment can verify a chip ' +
                'against (run trust-anchors:sync), so every government-id-nfc verification ' +
                'would go to review; set accept-review-without-provider to publish it anyway.',
            },
          ]
        : [],
    );
  },
};
