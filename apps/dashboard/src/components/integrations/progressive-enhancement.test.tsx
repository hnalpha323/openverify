import { describe, expect, it, vi } from 'vitest';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { serverRenderedForms, submitsSafelyBeforeHydration } from '../../testing/server-render';
import { CreateApiKeyForm } from './api-key-form';
import { ReplayEventsForm } from './replay-events-form';
import { SimulateEventForm } from './simulate-event-form';
import { INTEGRATION_IDS } from './testing-fixtures';
import { CreateWebhookForm, EditWebhookForm } from './webhook-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const GROUPS = [{ label: 'Inquiry', names: ['inquiry.created', 'inquiry.approved'] }];
const VERSIONS = ['2026-10-01'];
const never = () => new Promise<never>(() => undefined);

describe('integration forms submitted before hydration (Workflow 2D F004)', () => {
  it.each([
    [
      'CreateApiKeyForm',
      <CreateApiKeyForm
        key="key"
        action={never}
        scopes={['inquiries:read']}
        apiVersions={VERSIONS}
        piiMasked={false}
        environmentId={ENVIRONMENTS.sandbox.id}
      />,
    ],
    [
      'CreateWebhookForm',
      <CreateWebhookForm
        key="create"
        action={never}
        groups={GROUPS}
        apiVersions={VERSIONS}
        environmentId={ENVIRONMENTS.sandbox.id}
      />,
    ],
    [
      'EditWebhookForm',
      <EditWebhookForm
        key="edit"
        action={never}
        webhookId={INTEGRATION_IDS.webhook}
        groups={GROUPS}
        apiVersions={VERSIONS}
        defaults={{
          url: 'https://hooks.example.test/openverify',
          enabledEvents: ['inquiry.approved'],
          apiVersion: '2026-10-01',
          inquiryTemplateIds: [],
          accountTypeIds: [],
          attributeBlocklist: [],
          customHeaderNames: ['Authorization'],
        }}
      />,
    ],
    [
      'SimulateEventForm',
      <SimulateEventForm
        key="simulate"
        webhookId={INTEGRATION_IDS.webhook}
        groups={GROUPS}
        action={never}
        canSeeEvents
      />,
    ],
    [
      'ReplayEventsForm',
      <ReplayEventsForm key="replay" webhookId={INTEGRATION_IDS.webhook} action={never} />,
    ],
  ])(
    '%s never sends its fields, custom header values included, in a GET query',
    (_name, element) => {
      const forms = serverRenderedForms(element);

      expect(forms).not.toHaveLength(0);
      for (const form of forms) {
        expect(form, JSON.stringify(form)).toSatisfy(submitsSafelyBeforeHydration);
      }
    },
  );
});
