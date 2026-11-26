import { describe, expect, it } from 'vitest';
import { staleFiles } from '../fresh-render.js';
import { dataClassification } from '../records/classification.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import { renderCompliance } from './index.js';
import { COUNSEL_LINE, RECORD_OF_PROCESSING_PAGE } from './pages.js';
import { PROVIDER_FACTS } from './provider-facts.js';
import { RECIPIENT_DETAILS } from './recipients.js';
import { renderRecordOfProcessing } from './record-of-processing.js';

const repo = createRepository(REPOSITORY_ROOT);
const classification = dataClassification(repo);
const page = renderRecordOfProcessing(classification, PROVIDER_FACTS);

describe('the record-of-processing template (C278.5)', () => {
  it('opens with both lines and carries no draft marker', () => {
    const opening = page.split('\n## ')[0] ?? '';
    expect(opening).toContain('This is not legal advice.');
    expect(opening).toContain(COUNSEL_LINE);
    expect(page).not.toContain('Draft: written in Workflow 11E');
  });

  it('has one section per data class of the classification, in its order', () => {
    const headings = [...page.matchAll(/^### `([a-z-]+)`: /gm)].map((match) => match[1]);
    expect(headings).toEqual(classification.classes.map((entry) => entry.id));
  });

  it("states each class's sealed-column count and its retention settings with their defaults", () => {
    for (const entry of classification.classes) {
      expect(page).toContain(`- **Sealed columns:** ${String(entry.columns.length)} (`);
      for (const setting of entry.retentionDefaults) {
        const value = typeof setting.default === 'number' ? String(setting.default) : 'unset';
        expect(page).toContain(`\`${setting.key}\` (default ${value})`);
      }
    }
  });

  it('lists every real provider as a possible recipient, with what it receives', () => {
    for (const [name, detail] of Object.entries(RECIPIENT_DETAILS)) {
      expect(page).toContain(`| \`${name}\` |`);
      expect(page).toContain(detail.receives);
    }
  });

  it("leaves the controller's own answers to fill, item by item of Article 30(1)", () => {
    for (const field of [
      'Controller and contact details',
      'Purposes of the processing',
      'Categories of data subjects',
      'Transfers to a third country',
      'Security measures',
    ]) {
      expect(page).toContain(field);
    }
  });

  it('renders the same bytes twice', () => {
    expect(renderRecordOfProcessing(classification, PROVIDER_FACTS)).toBe(page);
  });

  it('is committed exactly as a fresh render', () => {
    const files = renderCompliance(repo).files;
    expect(files.map((file) => file.path)).toContain(RECORD_OF_PROCESSING_PAGE);
    expect(staleFiles(repo, files)).toEqual([]);
  });
});
