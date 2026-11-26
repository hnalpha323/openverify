import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIRECTORY, fixtureFiles } from './fixture-files.js';
import { normalisedImportText } from './normalised.js';
import { openverifySandboxList, openverifySandboxPepList } from './sandbox.js';
import {
  SANDBOX_PEP_CLASS_QIDS,
  pepImportAnswers,
  pepSparqlAnswer,
  sandboxPepSparqlFacts,
  sparqlResultsText,
} from './sparql.js';

const WRITE = process.env.OPENVERIFY_WRITE_FIXTURES === '1';

describe('packages/watchlist/fixtures', () => {
  const files = fixtureFiles();

  if (WRITE) {
    mkdirSync(FIXTURES_DIRECTORY, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(new URL(name, FIXTURES_DIRECTORY), text);
    }
  }

  it('lists the sandbox lists and their monitoring versions', () => {
    expect(files['openverify-sandbox.json']).toBe(normalisedImportText(openverifySandboxList(1)));
    expect(files['openverify-sandbox.v2.json']).toBe(
      normalisedImportText(openverifySandboxList(2)),
    );
    expect(files['openverify-sandbox.v3.json']).toBe(
      normalisedImportText(openverifySandboxList(3)),
    );
    expect(files['openverify-sandbox.v4.json']).toBe(
      normalisedImportText(openverifySandboxList(4)),
    );
    expect(files['openverify-sandbox-pep.json']).toBe(
      normalisedImportText(openverifySandboxPepList()),
    );
  });

  it('lists the synthetic Wikidata answer for a wikidata-pep import', () => {
    expect(files['wikidata-pep.synthetic.sparql.json']).toBe(
      sparqlResultsText(pepSparqlAnswer(sandboxPepSparqlFacts())),
    );
  });

  it('lists the synthetic answers document a wikidata-pep import reads, with the pep-positions classes (C89.2)', () => {
    expect(files['wikidata-pep.synthetic.answers.json']).toBe(
      `${JSON.stringify(pepImportAnswers(sandboxPepSparqlFacts(SANDBOX_PEP_CLASS_QIDS)), null, 2)}\n`,
    );
  });

  it('commits each file exactly as the generators write it today', () => {
    for (const [name, text] of Object.entries(files)) {
      const committed = readFileSync(new URL(name, FIXTURES_DIRECTORY), 'utf8');
      expect(JSON.parse(committed), name).toEqual(JSON.parse(text));
    }
  });

  it('holds no other JSON file', () => {
    const committed = readdirSync(FIXTURES_DIRECTORY).filter((name) => name.endsWith('.json'));
    expect(committed.sort()).toEqual(
      Object.keys(files)
        .filter((name) => name.endsWith('.json'))
        .sort(),
    );
  });
});
