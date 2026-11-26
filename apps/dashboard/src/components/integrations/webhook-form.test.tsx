import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { INTEGRATION_IDS, webhookSecret } from './testing-fixtures';
import { CreateWebhookForm, EditWebhookForm, type CreatedWebhook } from './webhook-form';
import { ENVIRONMENTS } from '../../testing/api-mock';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const GROUPS = [{ label: 'Inquiry', names: ['inquiry.created', 'inquiry.approved'] }];
const VERSIONS = ['2026-10-01'];

type CreateAction = (
  state: ActionState<CreatedWebhook>,
  formData: FormData,
) => Promise<ActionResult<CreatedWebhook>>;
type EditAction = (state: ActionState, formData: FormData) => Promise<ActionResult>;

afterEach(() => {
  router.push.mockReset();
});

describe('CreateWebhookForm', () => {
  it('creates the webhook, shows its secret once, then opens it', async () => {
    const secret = webhookSecret();
    const action = vi.fn<CreateAction>(() =>
      Promise.resolve({ ok: true, data: { id: INTEGRATION_IDS.webhook, secret } }),
    );
    render(
      <CreateWebhookForm
        action={action}
        groups={GROUPS}
        apiVersions={VERSIONS}
        environmentId={ENVIRONMENTS.sandbox.id}
      />,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: /Endpoint URL/ }),
      'https://hooks.example.test/openverify',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'inquiry.approved' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Inquiry template IDs' }),
      INTEGRATION_IDS.template,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Attribute blocklist' }), 'fields');
    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 1 name' }), 'X-Team');
    await userEvent.type(screen.getByRole('textbox', { name: 'Header 1 value' }), 'change-me');
    await userEvent.click(screen.getByRole('button', { name: 'Create webhook' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('url')).toBe('https://hooks.example.test/openverify');
    expect(sent?.getAll('enabled-events')).toEqual(['inquiry.approved']);
    expect(sent?.get('api-version')).toBe('2026-10-01');
    expect(sent?.get('inquiry-template-ids')).toBe(INTEGRATION_IDS.template);
    expect(sent?.get('attribute-blocklist')).toBe('fields');
    expect(sent?.getAll('header-name')).toEqual(['X-Team']);
    expect(sent?.getAll('header-value')).toEqual(['change-me']);

    const dialog = await screen.findByRole('dialog', { name: 'Webhook created' });
    expect(within(dialog).getByRole('textbox', { name: 'Signing secret' })).toHaveValue(secret);
    expect(dialog).toHaveTextContent('OpenVerify-Signature');
    expect(router.push).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(document.body.innerHTML).not.toContain(secret);
    expect(router.push).toHaveBeenCalledExactlyOnceWith(`/webhooks/${INTEGRATION_IDS.webhook}`);
  });

  it('keeps what was typed and points at the fields to correct', async () => {
    render(
      <CreateWebhookForm
        environmentId={ENVIRONMENTS.sandbox.id}
        action={() =>
          Promise.resolve({
            ok: false,
            problem: {
              title: 'Check the values you entered',
              errors: [
                { pointer: '/data/attributes/url', detail: 'Invalid URL' },
                { pointer: '/data/attributes/enabled-events', detail: 'Choose an event' },
                { pointer: '/data/attributes/filters/inquiry-template-ids/0', detail: 'Bad ID' },
                { pointer: '/data/attributes/attribute-blocklist/0', detail: 'Not kebab-case' },
                { pointer: '/data/attributes/api-version', detail: 'Unknown version' },
                { pointer: '/data/attributes/custom-headers', detail: 'Name every header' },
              ],
            },
          })
        }
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );
    const url = screen.getByRole('textbox', { name: /Endpoint URL/ });
    await userEvent.type(url, 'ftp://nope');

    await userEvent.click(screen.getByRole('button', { name: 'Create webhook' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(url).toHaveValue('ftp://nope');
    expect(url).toHaveAccessibleDescription(expect.stringContaining('Invalid URL'));
    expect(screen.getByRole('group', { name: 'Events' })).toHaveAccessibleDescription(
      'Choose an event',
    );
    expect(
      screen.getByRole('textbox', { name: 'Inquiry template IDs' }),
    ).toHaveAccessibleDescription(expect.stringContaining('Bad ID'));
    expect(
      screen.getByRole('textbox', { name: 'Attribute blocklist' }),
    ).toHaveAccessibleDescription(expect.stringContaining('Not kebab-case'));
    expect(screen.getByRole('combobox', { name: 'API version' })).toHaveAccessibleDescription(
      expect.stringContaining('Unknown version'),
    );
    expect(screen.getByRole('group', { name: 'Custom headers' })).toHaveAccessibleDescription(
      expect.stringContaining('Name every header'),
    );
  });
});

describe('EditWebhookForm', () => {
  const defaults = {
    url: 'https://hooks.example.test/openverify',
    enabledEvents: ['inquiry.approved'],
    apiVersion: '2026-10-01',
    inquiryTemplateIds: [INTEGRATION_IDS.template],
    accountTypeIds: [INTEGRATION_IDS.accountType],
    attributeBlocklist: ['fields', 'reference-id'],
    customHeaderNames: ['Authorization'],
  };

  it("starts from the webhook's configuration and saves it", async () => {
    const action = vi.fn<EditAction>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <EditWebhookForm
        action={action}
        webhookId={INTEGRATION_IDS.webhook}
        defaults={defaults}
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );

    expect(screen.getByRole('textbox', { name: /Endpoint URL/ })).toHaveValue(defaults.url);
    expect(screen.getByRole('checkbox', { name: 'inquiry.approved' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'inquiry.created' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'API version' })).toHaveValue('2026-10-01');
    expect(screen.getByRole('textbox', { name: 'Inquiry template IDs' })).toHaveValue(
      INTEGRATION_IDS.template,
    );
    expect(screen.getByRole('textbox', { name: 'Account type IDs' })).toHaveValue(
      INTEGRATION_IDS.accountType,
    );
    expect(screen.getByRole('textbox', { name: 'Attribute blocklist' })).toHaveValue(
      'fields, reference-id',
    );
    expect(screen.getByText('Authorization. Their values are never shown again.')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(action.mock.calls[0]?.[1].get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
    expect(action.mock.calls[0]?.[1].get('replace-custom-headers')).toBeNull();
  });

  it('shows the problem of a failed save', async () => {
    render(
      <EditWebhookForm
        action={() =>
          Promise.resolve({ ok: false, problem: { title: 'Invalid Transition', detail: 'No.' } })
        }
        webhookId={INTEGRATION_IDS.webhook}
        defaults={defaults}
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Transition');
  });
});

describe('the webhook forms: Workflow 9C (C169.5, C169.6)', () => {
  it('asks a new webhook for a required name, a description and its failure alert', () => {
    render(
      <CreateWebhookForm
        action={vi.fn<CreateAction>()}
        groups={GROUPS}
        apiVersions={VERSIONS}
        environmentId={ENVIRONMENTS.sandbox.id}
      />,
    );

    expect(screen.getByRole('textbox', { name: /^Name/ })).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeVisible();
    const alert = screen.getByRole('group', { name: 'Failure alert' });
    expect(
      within(alert).getByRole('checkbox', { name: 'Alert when first attempts fail' }),
    ).not.toBeChecked();
    expect(within(alert).getByRole('spinbutton', { name: 'Failed first attempts' })).toHaveValue(5);
    expect(within(alert).getByRole('spinbutton', { name: 'Within (minutes)' })).toHaveValue(60);
    expect(alert).toHaveTextContent(
      'Counts failed first attempts in the window, not retries. Notifies, at most once a window, the users with webhooks:read who chose webhook failure notifications.',
    );
  });

  it('starts an edit from the stored name, description and alert', () => {
    render(
      <EditWebhookForm
        action={vi.fn<EditAction>()}
        webhookId={INTEGRATION_IDS.webhook}
        defaults={{
          url: 'https://hooks.example.test/openverify',
          enabledEvents: ['inquiry.approved'],
          apiVersion: '2026-10-01',
          inquiryTemplateIds: [],
          accountTypeIds: [],
          attributeBlocklist: [],
          customHeaderNames: [],
          name: 'Fulfilment',
          description: 'Approvals to fulfilment.',
          failureAlert: { enabled: true, threshold: 3, 'window-minutes': 15 },
        }}
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );

    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Fulfilment');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Approvals to fulfilment.',
    );
    expect(screen.getByRole('checkbox', { name: 'Alert when first attempts fail' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Failed first attempts' })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: 'Within (minutes)' })).toHaveValue(15);
  });
});
