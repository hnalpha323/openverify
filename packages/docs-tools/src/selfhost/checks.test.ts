/**
 * The guide's record checks over fixture trees (C277; Workflow 11E rules 21 and 22). The real tree
 * is held by `index.test.ts`' "holds over the repository".
 */
import { describe, expect, it } from 'vitest';
import { DOCS_TREE, draftMarker } from '../docs-tree.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { DOCS_SWITCHES } from '../switches.js';
import type { CheckResult } from '../types.js';
import {
  PENDING_PAGES,
  checkCommands,
  checkLinks,
  checkPages,
  checkPublishSwitch,
  checkQuotedFacts,
  checkRepositoryPaths,
  checkVariableNames,
} from './checks.js';

const PAGE = 'docs/self-hosting/example.md';

/** Each finding as `rule line message`, for compact assertions. */
const brief = (result: CheckResult): string[] =>
  result.findings.map(
    (finding) => `${finding.rule} ${String(finding.line ?? '-')} ${finding.message}`,
  );

describe('variables (rule 22: only names config-registry.ts holds)', () => {
  const compose = 'services:\n  x:\n    ports: ["${OPENVERIFY_BIND_ADDRESS:-127.0.0.1}:1:1"]\n';

  it('passes registered names, their _FILE forms, pattern names, compose and repository variables', () => {
    const repo = createMemoryRepository({
      'infra/docker-compose.yml': compose,
      [PAGE]: [
        'Set `OPENVERIFY_KEK` or `OPENVERIFY_KEK_FILE`, and `DATABASE_URL`.',
        'Bind `OPENVERIFY_PROVIDER_SMS_SANDBOX` (the pattern `OPENVERIFY_PROVIDER_{KIND}_{MODE}`).',
        '`OPENVERIFY_SEED_ADMIN_PASSWORD_FILE`, `OPENVERIFY_BIND_ADDRESS` and `OPENVERIFY_PUBLISH`.',
      ].join('\n'),
    });
    const result = checkVariableNames(repo);

    expect(result.status).toBe('built');
    expect(brief(result)).toEqual([]);
  });

  it('refuses an unregistered name and the _FILE form of a name that has none, by line', () => {
    const repo = createMemoryRepository({
      'infra/docker-compose.yml': compose,
      [PAGE]: 'Fine: OPENVERIFY_KEK.\nSet OPENVERIFY_NOT_A_THING.\nAnd OPENVERIFY_API_PORT_FILE.\n',
    });

    expect(brief(checkVariableNames(repo))).toEqual([
      'variable 2 names OPENVERIFY_NOT_A_THING, which apps/api/src/config-registry.ts does not hold',
      'variable 3 names OPENVERIFY_API_PORT_FILE, which apps/api/src/config-registry.ts does not hold',
    ]);
  });
});

describe('commands (rule 22: package scripts and the API image’s compiled commands)', () => {
  const files = {
    'apps/api/package.json': JSON.stringify({
      name: '@openverify/api',
      scripts: { 'kek:rewrap': 'x', 'db:migrate': 'x' },
    }),
    'packages/docs-tools/package.json': JSON.stringify({
      name: '@openverify/docs-tools',
      scripts: { 'docs:selfhost': 'x' },
    }),
    'apps/api/tsconfig.commands.json': JSON.stringify({
      files: ['scripts/kek-rewrap.ts', 'scripts/db-migrate.ts'],
    }),
  };

  it('passes the scripts and compiled commands that exist', () => {
    const repo = createMemoryRepository({
      ...files,
      [PAGE]: [
        'pnpm --filter @openverify/api kek:rewrap --dry-run',
        'pnpm --filter @openverify/api run db:migrate',
        'pnpm --filter @openverify/docs-tools docs:selfhost',
        'docker compose run --rm migrate node dist/commands/kek-rewrap.js',
      ].join('\n'),
    });

    expect(brief(checkCommands(repo))).toEqual([]);
  });

  it('refuses a missing script, an unknown package and a command the image does not compile', () => {
    const repo = createMemoryRepository({
      ...files,
      [PAGE]: [
        'pnpm --filter @openverify/api nope:cmd',
        'pnpm --filter @openverify/missing build',
        'node dist/commands/graph-benchmark.js',
      ].join('\n'),
    });

    expect(brief(checkCommands(repo))).toEqual([
      'command 1 runs nope:cmd, which @openverify/api has no script for',
      'command 2 names the package @openverify/missing, which the repository does not hold',
      'command 3 runs dist/commands/graph-benchmark.js, which apps/api/tsconfig.commands.json does not compile',
    ]);
  });
});

describe('repository paths and links', () => {
  const repo = createMemoryRepository({
    'docs/network/README.md': '# Network\n',
    'apps/api/src/x.ts': '',
    'infra/scripts/a.sh': '',
    'docs/self-hosting/other.md': '# Other\n',
    [PAGE]: [
      'See `docs/network/README.md#memory`, `apps/api/src/x.ts:12-14`, `infra/scripts/` and `<dir>/x`.',
      'Not there: `docs/nope.md` and `apps/api/src/y.ts:3`.',
      '[a](other.md), [b](../network/README.md#memory), [c](https://example.com), [d](#top)',
      '[e](missing.md) and [f](../nowhere/)',
    ].join('\n'),
  });

  it('refuses a cited path that does not exist', () => {
    expect(brief(checkRepositoryPaths(repo))).toEqual([
      'repository-path 2 cites docs/nope.md, which does not exist',
      'repository-path 2 cites apps/api/src/y.ts, which does not exist',
    ]);
  });

  it('refuses a relative link that does not resolve', () => {
    expect(brief(checkLinks(repo))).toEqual([
      'link 4 links missing.md, which does not resolve from docs/self-hosting/',
      'link 4 links ../nowhere/, which does not resolve from docs/self-hosting/',
    ]);
  });
});

describe('the publish switch (C277.1, review H16; 11E decisions item 18)', () => {
  const gated = [
    'jobs:',
    '  stage:',
    '    runs-on: ubuntu-latest',
    '  publish:',
    "    if: vars.OPENVERIFY_PUBLISH == 'true'",
    '    environment: release',
    '',
  ].join('\n');
  const page = 'docs/self-hosting/verify-artifacts.md';
  const unsigned = 'No artifact of this release is signed.\n';

  it('holds an unsigned page while the job is gated and the switch is off', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': gated,
      [page]: unsigned,
    });
    expect(brief(checkPublishSwitch(repo, { vendorNaming: false, publishWired: false }))).toEqual(
      [],
    );
  });

  it('refuses a verify command or a missing statement while off, and an ungated job', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': gated.replace('vars.OPENVERIFY_PUBLISH', 'true'),
      [page]: 'Run cosign verify on each image.\n',
    });
    expect(brief(checkPublishSwitch(repo, { vendorNaming: false, publishWired: false }))).toEqual([
      'publish-switch - says nothing of "No artifact of this release is signed" while publishWired is off',
      'publish-switch 1 gives a cosign verify command while publishWired is off',
      "publish-switch - .github/workflows/release.yml's publish job is no longer gated by OPENVERIFY_PUBLISH in the release environment",
    ]);
  });

  // Workflow 11G (publish-11g; Q1-Q4 granted): once the switch is on, the page gives each check for
  // the wired sub-parts with the release workflow's own identity, and the workflow must hold them.
  const on = { vendorNaming: false, publishWired: true } as const;
  const wired = [
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      dry-run:',
    '        required: false',
    '        default: true',
    '        type: boolean',
    'jobs:',
    '  stage:',
    '    runs-on: ubuntu-latest',
    '  publish:',
    "    if: vars.OPENVERIFY_PUBLISH == 'true'",
    '    environment: release',
    '    steps:',
    '      - run: |',
    '          cosign sign --yes "$repository@$digest"',
    '          cosign attest --yes --type cyclonedx --predicate "$sbom" "$repository@$digest"',
    '          helm push "$chart" "oci://ghcr.io/$owner/charts"',
    '      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2',
    '      - run: pnpm publish "$tarball" --provenance --access public --no-git-checks',
    '',
  ].join('\n');
  const manifest = (dir: string): string =>
    JSON.stringify({
      name: `@openverify/${dir}`,
      repository: {
        type: 'git',
        url: 'git+https://github.com/example-owner/openverify.git',
        directory: `packages/${dir}`,
      },
    });
  const manifests = {
    'packages/sdk-js/package.json': manifest('sdk-js'),
    'packages/node/package.json': manifest('node'),
    'packages/sdk-react/package.json': manifest('sdk-react'),
  };
  const identity =
    'https://github.com/example-owner/openverify/.github/workflows/release.yml@refs/heads/main';
  const issuer = 'https://token.actions.githubusercontent.com';
  const complete = [
    'Staged workflow artifacts are unsigned. Signatures exist from the first approved publication on; until it, no artifact of this release is signed.',
    '```bash',
    `cosign verify --certificate-identity ${identity} \\`,
    `  --certificate-oidc-issuer ${issuer} ghcr.io/example-owner/openverify-api@sha256:x`,
    `cosign verify-attestation --type cyclonedx --certificate-identity ${identity} --certificate-oidc-issuer ${issuer} ghcr.io/x@sha256:x`,
    'gh attestation verify oci://ghcr.io/example-owner/openverify-api@sha256:x --repo example-owner/openverify',
    'npm audit signatures',
    '```',
    '',
  ].join('\n');

  it('holds a page that gives every wired check with the workflow identity once the switch is on', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': wired,
      [page]: complete,
      ...manifests,
    });
    expect(brief(checkPublishSwitch(repo, on))).toEqual([]);
  });

  it('asks for each check and statement once the switch is on, with the identity of the repository the packages name', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': wired,
      [page]: `${unsigned}Run cosign verify on each image.\n`,
      ...manifests,
    });
    expect(brief(checkPublishSwitch(repo, on))).toEqual([
      `publish-switch - gives no cosign verify command with --certificate-identity ${identity} and --certificate-oidc-issuer ${issuer} while publishWired is on`,
      `publish-switch - gives no cosign verify-attestation --type cyclonedx command with --certificate-identity ${identity} and --certificate-oidc-issuer ${issuer} while publishWired is on`,
      'publish-switch - gives no gh attestation verify command with --repo example-owner/openverify while publishWired is on',
      'publish-switch - gives no npm audit signatures check while publishWired is on',
      'publish-switch - says nothing of "Staged workflow artifacts are unsigned" while publishWired is on',
      'publish-switch - says nothing of "from the first approved publication on" while publishWired is on',
    ]);
  });

  it('keeps the unsigned statement while on, since nothing is signed until the first approved publication (rule 10)', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': wired,
      [page]: complete.replace(
        'until it, no artifact of this release is signed.',
        'every artifact is signed.',
      ),
      ...manifests,
    });
    expect(brief(checkPublishSwitch(repo, on))).toEqual([
      'publish-switch - says nothing of "No artifact of this release is signed" while publishWired is on',
    ]);
  });

  it('refuses the switch on while release.yml lacks a wired sub-part, or the packages name no single repository', () => {
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': gated,
      [page]: complete,
      'packages/node/package.json': manifest('node').replace('example-owner', 'someone-else'),
    });
    expect(brief(checkPublishSwitch(repo, on))).toEqual([
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks the dry-run input defaulting to true",
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks cosign's keyless signature of each image",
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks cosign's SBOM attestation of each image",
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks the chart pushed as an OCI artifact",
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks actions/attest-build-provenance",
      "publish-switch - publishWired is on, but .github/workflows/release.yml's publish job lacks pnpm publish with provenance and public access",
      'publish-switch - the published packages (packages/sdk-js/package.json, packages/node/package.json, packages/sdk-react/package.json) name no single GitHub repository, so the certificate identity cannot be stated',
    ]);
  });

  it('refuses an ungated job whichever the switch says', () => {
    const ungated = wired.replace('vars.OPENVERIFY_PUBLISH', 'true');
    const repo = createMemoryRepository({
      '.github/workflows/release.yml': ungated,
      [page]: complete,
      ...manifests,
    });
    expect(brief(checkPublishSwitch(repo, on))).toEqual([
      "publish-switch - .github/workflows/release.yml's publish job is no longer gated by OPENVERIFY_PUBLISH in the release environment",
    ]);
  });
});

describe('the committed page and switch (Workflow 11G, publish-11g)', () => {
  it('turned the switch on with release.yml wired, and the committed page passes it', () => {
    const real = createRepository(REPOSITORY_ROOT);
    expect(DOCS_SWITCHES.publishWired).toBe(true);
    expect(brief(checkPublishSwitch(real))).toEqual([]);
  });
});

describe('the pages of the docs tree', () => {
  const pages = DOCS_TREE.filter((item) => item.owner === 'docs-selfhost').map((item) => item.path);
  const readme = pages
    .filter((path) => !path.endsWith('/README.md'))
    .map((path) => `- [x](${path.slice('docs/self-hosting/'.length)})`)
    .join('\n');
  const complete = Object.fromEntries(
    pages.map((path) => [path, path.endsWith('/README.md') ? readme : '# Page\n']),
  );

  it('holds when every page exists without its marker and the index links each', () => {
    expect(brief(checkPages(createMemoryRepository(complete)))).toEqual([]);
  });

  it('refuses a missing page, a remaining marker and a page the index does not link', () => {
    const repo = createMemoryRepository({
      ...Object.fromEntries(
        Object.entries(complete).filter(([path]) => path !== 'docs/self-hosting/sso.md'),
      ),
      'docs/self-hosting/README.md': readme.replace('- [x](sizing.md)', ''),
      'docs/self-hosting/valkey.md': `# Valkey\n\n${draftMarker('docs-selfhost')}\n`,
    });
    const findings = brief(checkPages(repo));

    expect(findings).toContain('page - is missing');
    expect(findings).toContain('page 3 still holds its draft marker');
    expect(findings).toContain('page - is not linked from docs/self-hosting/README.md');
  });

  it('lets only the pending pages keep their marker', () => {
    expect(PENDING_PAGES.every((path) => pages.includes(path))).toBe(true);
  });
});

describe('the figures the pages quote', () => {
  const block = (rows: unknown[]): string =>
    [
      '<!-- openverify:calibration-summary:start -->',
      '```json',
      JSON.stringify({
        schema: 'openverify/calibration-summary@1',
        report: 'docs/calibration/load-phase11.md',
        workflow: '11D',
        status: 'published',
        'method-commit': 'ac3fc15583558d1ad256c44fb9e39eee7ebce871',
        base: 'd44e537dba0f84a4eafc45b313264de74c2b31a4',
        head: '2d3134755c0fd4412b052faa0f2c357dfb729a4d',
        machine: { cpu: 'x', 'logical-cpus': 1, 'memory-gib': 1, 'disk-class': 'x' },
        rows,
      }),
      '```',
      '<!-- openverify:calibration-summary:end -->',
    ].join('\n');
  const row = (id: string, median: number, unit: string) => ({
    id,
    title: id,
    contract: 'C272',
    owner: 'calibration-load-11d',
    budget: null,
    verdict: 'reported',
    median,
    unit,
    gap: null,
    configuration: 'default',
    takes: [],
  });
  const facts = (database: string, valkey: string) =>
    createMemoryRepository({
      'contracts/fixtures/calibration/summary.schema.json': JSON.stringify({ type: 'object' }),
      'docs/calibration/load-phase11.md': block([
        row('role-timeouts', 370, 's'),
        row('jit-comparison', 3.933, 'ratio'),
        row('pool-at-knee', 10, 'count'),
      ]),
      'docs/plans/phase-11.plan.md': 'Tested ACL (for 11E): `on >pw ~* -keys` (note).\n',
      'docs/self-hosting/database.md': database,
      'docs/self-hosting/valkey.md': valkey,
    });

  it('holds when database.md quotes C272 and valkey.md the tested ACL', () => {
    const repo = facts(
      'statement_timeout 370 s; jit off 3.93 times worse; 10 connections a process.',
      'user openverify on >pw ~* -keys',
    );
    expect(brief(checkQuotedFacts(repo))).toEqual([]);
  });

  it('refuses a page that does not quote the records', () => {
    const findings = brief(checkQuotedFacts(facts('nothing', 'nothing')));
    expect(findings).toEqual([
      'quoted-fact - does not quote "370 s" (role-timeouts, docs/calibration/load-phase11.md)',
      'quoted-fact - does not quote "3.93 times" (jit-comparison, docs/calibration/load-phase11.md)',
      'quoted-fact - does not quote "10 connections" (pool-at-knee, docs/calibration/load-phase11.md)',
      'quoted-fact - does not quote "on >pw ~* -keys" (the ACL Workflow 11B tested, docs/plans/phase-11.plan.md)',
    ]);
  });

  it('reports a record it cannot read', () => {
    const findings = brief(checkQuotedFacts(createMemoryRepository({})));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.startsWith('quoted-fact '))).toBe(true);
  });
});
