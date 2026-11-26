/**
 * C238.4, C238.6, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the web flow at a
 * `share_consent` step against the mocked server. The screen shows the text the server composed, the
 * recipient, the source and the categories in words and the separate unticked biometric box; "I
 * agree" posts the SHA-256 of each text it displayed and the tick, "Do not share" posts nothing else,
 * and the flow then shows the position the server moved to (a destination side's accept waits while
 * the redemption runs). A text whose digest is not the one served is never reported shown. Every
 * later screen and the completion screen offer the withdrawal of an accepted share, which never
 * moves the flow. Each state goes through axe, in English at 320 CSS px light and in Arabic at 320
 * CSS px dark (Chromium only). Every value is synthetic; no id but the step's reaches a URL.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { registerMockFlowExtension, type MockFlowApi } from './support/mock-flow-api';
import { at, serve, type ServedPosition } from './support/mock-flow-renderer';
import { DONE, ON_EVERY_KIND, openAt } from './support/screens';

const NARROW = { width: 320, height: 720 };
const digest = (text: string) =>
  createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

const BODY =
  'Example Source asks for your agreement to share the details it verified about you with Example Partner.\n\nWhat is shared: your identity details and biometric data.\n\nTo withdraw your agreement, email privacy@example.com.';
const BIOMETRIC = 'I agree that Example Source shares my biometric data with Example Partner.';
const VIEW = {
  id: 'share_back',
  type: 'share_consent',
  side: 'source',
  recipientName: 'Example Partner',
  sourceName: 'Example Source',
  categories: ['identity-fields', 'biometric'],
  text: { locale: 'en', body: BODY, sha256: digest(BODY), keys: ['share.consent.source'] },
  biometric: { body: BIOMETRIC, sha256: digest(BIOMETRIC) },
};
const ON_SHARE: ServedPosition = { position: at('share_back', 'active', 'consent'), step: VIEW };
const WITHDRAWABLE = {
  'step-id': 'share_back',
  side: 'source',
  'recipient-name': 'Example Partner',
};

interface Script {
  /** Where an accept or a decline moves the session. */
  next: ServedPosition | null;
  /** The session's `withdrawable-share-consents`, left out while empty. */
  withdrawable: (typeof WITHDRAWABLE)[];
  /** An accept makes its step withdrawable, as the server's record does. */
  withdrawableOnAccept: boolean;
}

const SCRIPTS = new WeakMap<MockFlowApi, Script>();

// The spec's "server": it moves the position on an accept or a decline and keeps the withdrawable
// list; the mock itself records each exit (`shareConsentExits`) and answers the session.
registerMockFlowExtension('share-consent-spec', {
  session: (session, mock) => {
    const script = SCRIPTS.get(mock);
    return script === undefined || script.withdrawable.length === 0
      ? session
      : { ...session, 'withdrawable-share-consents': script.withdrawable };
  },
  route: ({ mock, method, path }) => {
    const exit = /^\/share-consents\/([a-z][a-z0-9_-]{0,63})\/(accept|decline|withdraw)$/u.exec(
      path,
    );
    const script = SCRIPTS.get(mock);
    if (method === 'POST' && exit !== null && script !== undefined) {
      if (exit[2] === 'withdraw') {
        script.withdrawable = script.withdrawable.filter((entry) => entry['step-id'] !== exit[1]);
      } else {
        if (exit[2] === 'accept' && script.withdrawableOnAccept) {
          script.withdrawable = [WITHDRAWABLE];
        }
        if (script.next !== null) {
          serve(mock, script.next);
        }
      }
    }
    return Promise.resolve(false);
  },
});

async function openShare(
  page: Page,
  served: ServedPosition,
  script: Partial<Script> = {},
  options: { readonly language?: 'ar'; readonly styleVariant?: 'dark' } = {},
): Promise<MockFlowApi> {
  return openAt(page, served, {
    ...options,
    configure: (mock) => {
      SCRIPTS.set(mock, { next: null, withdrawable: [], withdrawableOnAccept: false, ...script });
    },
  });
}

const agree = (page: Page) => page.getByRole('button', { name: 'I agree' });
const biometricBox = (page: Page) => page.getByRole('checkbox', { name: BIOMETRIC });
const withdraw = (page: Page) =>
  page.getByRole('button', { name: 'Withdraw my agreement to share with Example Partner' });

test.describe('in English at 320 CSS px, light', () => {
  test.use({ viewport: NARROW, colorScheme: 'light' });

  test('accepting sends the digests of the texts shown and the tick, then the flow goes on', async ({
    page,
  }) => {
    const mock = await openShare(page, ON_SHARE, {
      next: ON_EVERY_KIND,
      withdrawableOnAccept: true,
    });

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Share your verified details with Example Partner',
      }),
    ).toBeVisible();
    for (const paragraph of BODY.split('\n\n')) {
      await expect(page.getByText(paragraph)).toBeVisible();
    }
    await expect(page.getByText('Example Source', { exact: true })).toBeVisible();
    await expect(
      page.getByText('your identity details, such as your name and date of birth'),
    ).toBeVisible();
    await expect(biometricBox(page)).not.toBeChecked();
    await expect(page.locator('main')).not.toContainText(/\{\{|cnst_|cxn_|cnsr_/u);
    await expectAccessible(page, { where: 'share-consent arrival (en, 320, light)' });

    // The tick is asked for at the box before anything is sent.
    await agree(page).click();
    await expect(page.getByRole('alert')).toContainText('Tick the box');
    await expect(biometricBox(page)).toBeFocused();
    await expectAccessible(page, { where: 'share-consent tick missing (en, 320, light)' });
    expect(mock.shareConsentExits).toEqual([]);

    await biometricBox(page).check();
    await agree(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
    expect(mock.shareConsentExits).toEqual([
      {
        stepId: 'share_back',
        exit: 'accept',
        body: {
          'text-sha256': digest(BODY),
          'biometric-text-sha256': digest(BIOMETRIC),
          'explicit-biometric': true,
        },
      },
    ]);
    // The accepted share is withdrawable from every later screen.
    await expect(withdraw(page)).toBeVisible();
    await expectAccessible(page, { where: 'share-consent withdrawable (en, 320, light)' });
  });

  test('declining sends nothing else, and the flow goes on', async ({ page }) => {
    const mock = await openShare(page, ON_SHARE, { next: ON_EVERY_KIND });

    await page.getByRole('button', { name: 'Do not share' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
    expect(mock.shareConsentExits).toEqual([{ stepId: 'share_back', exit: 'decline', body: {} }]);
    await expect(withdraw(page)).toHaveCount(0);
  });

  test('a destination side’s accept waits while the server fills the inquiry', async ({ page }) => {
    const destination = {
      ...VIEW,
      side: 'destination',
      text: { ...VIEW.text, keys: ['share.consent.destination'] },
    };
    const mock = await openShare(
      page,
      { ...ON_SHARE, step: destination },
      {
        next: { position: at('share_back', 'waiting', 'consent') },
      },
    );

    await biometricBox(page).check();
    await agree(page).click();

    await expect(page.getByRole('heading', { level: 1, name: 'One moment' })).toBeVisible();
    expect(mock.shareConsentExits.map((exit) => exit.exit)).toEqual(['accept']);
    serve(mock, DONE);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
  });

  test('a text that is not the one served is never reported shown', async ({ page }) => {
    const changed = { ...VIEW, text: { ...VIEW.text, sha256: digest('another text') } };
    const mock = await openShare(page, { ...ON_SHARE, step: changed });

    await biometricBox(page).check();
    await agree(page).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'This step is not available here' }),
    ).toBeVisible();
    expect(mock.shareConsentExits).toEqual([]);
  });

  test('withdrawing on the completion screen keeps the person there and says so', async ({
    page,
  }) => {
    const mock = await openShare(page, DONE, { withdrawable: [WITHDRAWABLE] });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'share-consent withdrawable on completion (en, 320)' });
    await withdraw(page).click();

    await expect(page.getByRole('status')).toContainText(
      'You withdrew your agreement to share with Example Partner.',
    );
    await expect(withdraw(page)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(mock.shareConsentExits).toEqual([{ stepId: 'share_back', exit: 'withdraw', body: {} }]);
    await expectAccessible(page, { where: 'share-consent withdrawn (en, 320, light)' });
  });
});

test.describe('in Arabic at 320 CSS px, dark', () => {
  test.use({ viewport: NARROW, colorScheme: 'dark' });

  test('the screen reads right to left, the English text keeps its language', async ({ page }) => {
    const mock = await openShare(
      page,
      ON_SHARE,
      { next: ON_EVERY_KIND },
      { language: 'ar', styleVariant: 'dark' },
    );

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { level: 1, name: /^مشاركة بياناتك التي جرى التحقق منها مع/u }),
    ).toBeVisible();
    await expect(page.locator('[data-share-consent-text]')).toHaveAttribute('lang', 'en');
    await expectAccessible(page, { where: 'share-consent arrival (ar, 320, dark)' });

    await page.getByRole('button', { name: 'عدم المشاركة' }).click();

    await expect.poll(() => mock.shareConsentExits.length).toBe(1);
    expect(mock.shareConsentExits[0]?.exit).toBe('decline');
  });
});
