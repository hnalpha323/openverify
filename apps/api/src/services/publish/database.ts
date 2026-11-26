/**
 * C50.4, C54.1 (H28): the publish rule of a `database` step that needs server state. In a
 * production environment a database step whose `database` provider is unbound is published only
 * when the type sets `accept-review-without-provider: true`, because every lookup would end in
 * review (`provider_not_configured`, ADR 0002 §3e); otherwise `provider_not_configured`, pointing
 * at the step. A sandbox environment publishes it as it is: no lookup there decides a person.
 * The AAMVA rule (`aamva.ts`) is the same over the `aamva` provider.
 */
import { toApiVerificationType, type SupportedVerificationType } from '@openverify/contracts';
import type { FlowStepType } from '@openverify/flow-spec';
import type { BoundProviders } from '../../ports.js';
import type { PublishContext, PublishHook, PublishHookProblem } from './index.js';

/**
 * A publish hook: in production, each step of `stepType` whose `kind` provider is unbound is a
 * problem unless the type of `verificationType` accepts review without a provider.
 */
export function providerPublishRule(rule: {
  stepType: FlowStepType;
  verificationType: SupportedVerificationType;
  kind: keyof BoundProviders;
}): PublishHook {
  return {
    problems(ctx: PublishContext): Promise<PublishHookProblem[]> {
      const apiType = toApiVerificationType(rule.verificationType);
      if (
        ctx.environment.kind !== 'production' ||
        ctx.deps.providers.production[rule.kind] !== undefined ||
        ctx.config[apiType]?.['accept-review-without-provider'] === true
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        ctx.flow.steps.flatMap((step, index) =>
          step.type === rule.stepType
            ? [
                {
                  code: 'provider_not_configured' as const,
                  pointer: `/flow/steps/${String(index)}`,
                  detail:
                    `No ${rule.kind} provider is configured for production, so every ${apiType} ` +
                    'verification would go to review; set accept-review-without-provider to ' +
                    'publish it anyway.',
                },
              ]
            : [],
        ),
      );
    },
  };
}

export const databasePublish = providerPublishRule({
  stepType: 'database',
  verificationType: 'database',
  kind: 'database',
});
