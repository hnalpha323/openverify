/**
 * C81.5, C82.4: the sandbox `adverseMedia` provider (sandbox environments only, ADR 0002 §3d). It
 * calls nothing and takes no budget. A screened name holding the token `sandbox-media` (its query
 * tokens `sandbox` then `media`, or `sandboxmedia`) gets two synthetic articles under the reserved
 * `sandbox-news.example`, seen one and ten days before the clock's time, in English, from no known
 * country, each title naming the subject beside the template's first category term; any other
 * name gets none.
 */
import {
  systemClock,
  type AdverseMediaProvider,
  type AdverseMediaArticle,
  type Clock,
} from '../../ports.js';
import { searchNamesOf } from './request.js';

/** C82.4: the sandbox's magic token and where its articles live. */
export const SANDBOX_MEDIA_TOKEN = 'sandbox-media';
export const SANDBOX_MEDIA_DOMAIN = 'sandbox-news.example';

/** C81.5: what a sandbox result says of its articles. */
export const SANDBOX_MEDIA_CITATION =
  'Synthetic articles from the OpenVerify sandbox provider; no news service was asked.';

const DAY_MS = 86_400_000;

function holdsToken(tokens: readonly string[]): boolean {
  return tokens.some(
    (token, index) =>
      token === 'sandboxmedia' || (token === 'sandbox' && tokens[index + 1] === 'media'),
  );
}

/** The sandbox provider (C82.4): it calls nothing. */
export function createSandboxAdverseMediaProvider(
  clock: Clock = systemClock,
): AdverseMediaProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    search(request) {
      const name = searchNamesOf(request).find(holdsToken);
      if (name === undefined) {
        return Promise.resolve({ outcome: 'articles', articles: [], truncated: false });
      }
      const now = clock.now().getTime();
      const term = request.terms[0] ?? 'fraud';
      const article = (index: number, daysAgo: number): AdverseMediaArticle => ({
        url: `https://${SANDBOX_MEDIA_DOMAIN}/articles/synthetic-${String(index)}`,
        domain: SANDBOX_MEDIA_DOMAIN,
        seenAt: new Date(now - daysAgo * DAY_MS),
        language: 'en',
        sourceCountry: null,
        title: `${name.join(' ')} named in synthetic ${term} report ${String(index)}`.slice(0, 200),
      });
      return Promise.resolve({
        outcome: 'articles',
        articles: [article(1, 1), article(2, 10)],
        truncated: false,
      });
    },
  };
}
