/** C281: the sharing guide's record test, over the committed pages and over fixtures. */
import { EVENT_NAMES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { DOCS_TREE, DRAFT_MARKER_PREFIX } from '../docs-tree.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { CONNECT_GUIDE_PAGES, connectGuideFindings } from './connect-guide.js';

const repo = createRepository(REPOSITORY_ROOT);
const connectEvents = (EVENT_NAMES as readonly string[]).filter(
  (name) => name.startsWith('connect/') || name.startsWith('consent-record.'),
);

describe('the sharing guide pages', () => {
  it('are the hand-written C281.1 pages of the docs tree', () => {
    expect([...CONNECT_GUIDE_PAGES].sort()).toEqual(
      DOCS_TREE.filter((entry) => entry.path.startsWith('docs/connect/') && !entry.generated)
        .map((entry) => entry.path)
        .sort(),
    );
    expect(CONNECT_GUIDE_PAGES).toHaveLength(9);
  });

  it('holds every record rule in the committed guide', () => {
    expect(connectGuideFindings(repo)).toEqual([]);
  });

  it('carries no draft marker, and names every Connect event on the events page', () => {
    for (const page of CONNECT_GUIDE_PAGES) {
      expect(repo.readText(page), page).not.toContain(DRAFT_MARKER_PREFIX);
    }
    const events = repo.readText('docs/connect/events-and-workflows.md');
    for (const name of connectEvents) {
      expect(events).toContain(`\`${name}\``);
    }
  });
});

describe('connectGuideFindings over fixtures', () => {
  const page = (text: string): Record<string, string> =>
    Object.fromEntries(CONNECT_GUIDE_PAGES.map((path) => [path, text]));

  it('names a stub, an unknown event, scope or variable, a missing statement and a broken link', () => {
    const fixture = createMemoryRepository({
      ...page('# Page\n\nWritten.\n'),
      'docs/connect/README.md': '# Page\n\nDraft: written in Workflow 11E by docs-catalog\n',
      'docs/connect/consent.md':
        '# Consent\n\nSee `connect/share-token.made-up`, `connect-share-tokens:fly`, `OPENVERIFY_MADE_UP` and [x](nowhere.md).\n\n**Ours** the label without its reason.\n',
    });
    const messages = connectGuideFindings(fixture).map((finding) => finding.message);
    expect(messages).toContain('docs/connect/README.md is still a stub');
    expect(messages).toContain(
      'docs/connect/consent.md names an unknown event connect/share-token.made-up',
    );
    expect(messages).toContain(
      'docs/connect/consent.md names an unknown scope connect-share-tokens:fly',
    );
    expect(messages).toContain(
      'docs/connect/consent.md names an unknown variable OPENVERIFY_MADE_UP',
    );
    expect(messages).toContain('docs/connect/consent.md links nowhere.md, which does not exist');
    expect(messages).toContain('docs/connect/consent.md has an "Ours" label without its reason');
    expect(messages).toContain('docs/connect/consent.md does not say "not legal advice"');
    expect(messages).toContain('docs/connect/limits.md does not state "No report sharing"');
    expect(messages).toContain('docs/connect/client-side.md does not state "biometric.body"');
    expect(messages).toContain('docs/connect/provenance.md does not state "C235.8"');
  });
});
