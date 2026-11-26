import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createRepository } from './repository.js';
import {
  DOCS_SWITCHES,
  MIGRATION_PAGES,
  PUBLISH_VARIABLE,
  RELEASE_WORKFLOW,
  migrationPagePath,
  publishGatedByVariable,
  publishJobOf,
} from './switches.js';
import { PROGRESS_PATH, ownerStates } from './release/progress.js';

const WORKFLOW = [
  'name: release',
  'jobs:',
  '  stage:',
  '    runs-on: ubuntu-latest',
  '    if: always()',
  '  publish:',
  '    name: publish (owner-gated)',
  '    needs: stage',
  "    if: vars.OPENVERIFY_PUBLISH == 'true'",
  '    environment: release',
  '    steps:',
  '      - run: echo',
  '  after:',
  '    environment: other',
].join('\n');

describe('the switches (Q8 granted 2026-11-21; Q1-Q4 granted, publishWired set by publish-11g)', () => {
  it('turn vendor naming on and publishWired on', () => {
    expect(DOCS_SWITCHES).toEqual({ vendorNaming: true, publishWired: true });
    expect(Object.isFrozen(DOCS_SWITCHES)).toBe(true);
  });

  it('name the vendor exactly when PROGRESS records Q8 granted (C289, C280.6)', () => {
    const progress = createRepository(REPOSITORY_ROOT).readText(PROGRESS_PATH);
    expect(ownerStates(progress).get('Q8')?.state).toBe('granted');
    expect(DOCS_SWITCHES.vendorNaming).toBe(ownerStates(progress).get('Q8')?.state === 'granted');
  });

  it('select the vendor-named migration page while vendor naming is on', () => {
    expect(MIGRATION_PAGES).toEqual({
      neutral: 'docs/migration/from-hosted-api.md',
      vendorNamed: 'docs/migration/from-persona.md',
    });
    expect(migrationPagePath()).toBe('docs/migration/from-persona.md');
    expect(migrationPagePath({ vendorNaming: false, publishWired: false })).toBe(
      MIGRATION_PAGES.neutral,
    );
  });
});

describe("release.yml's publish job", () => {
  it('reads the job its if: and environment: from the workflow text', () => {
    expect(publishJobOf(WORKFLOW)).toEqual({
      condition: "vars.OPENVERIFY_PUBLISH == 'true'",
      environment: 'release',
    });
    expect(publishJobOf('jobs:\n  publish:\n    runs-on: x\n')).toEqual({
      condition: null,
      environment: null,
    });
    expect(publishJobOf('jobs:\n  build:\n    if: x\n')).toBeNull();
  });

  it('is gated only when it names the variable and runs in the release environment', () => {
    expect(publishGatedByVariable(publishJobOf(WORKFLOW))).toBe(true);
    expect(publishGatedByVariable(null)).toBe(false);
    expect(publishGatedByVariable({ condition: 'always()', environment: 'release' })).toBe(false);
    expect(
      publishGatedByVariable({ condition: "vars.OPENVERIFY_PUBLISH == 'true'", environment: null }),
    ).toBe(false);
  });

  it('still names OPENVERIFY_PUBLISH in the release environment while publishWired is on (wired is not published)', () => {
    const workflow = createRepository(REPOSITORY_ROOT).readText(RELEASE_WORKFLOW);

    expect(PUBLISH_VARIABLE).toBe('OPENVERIFY_PUBLISH');
    expect(RELEASE_WORKFLOW).toBe('.github/workflows/release.yml');
    expect(publishJobOf(workflow)).toEqual({
      condition: "vars.OPENVERIFY_PUBLISH == 'true' && github.ref == 'refs/heads/main'",
      environment: 'release',
    });
    expect(publishGatedByVariable(publishJobOf(workflow))).toBe(true);
    expect(DOCS_SWITCHES.publishWired).toBe(true);
  });
});
