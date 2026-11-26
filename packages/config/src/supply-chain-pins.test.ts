import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Workflow 11C Stage 1a (contracts-11c), checkpoint "deps": every tool, plugin and dependency 11C
 * adopts is pinned where it is used, carries a licence row with its version, release date and
 * licence (read on 2026-11-14, each released at least 14 days before), and nothing excluded by
 * rule 4 enters. The installers that use the binary pins are scanners-11c's; this file holds the
 * records they rest on (C258.3, C282; review F09, F28, F29).
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const licences = () => read('THIRD_PARTY_LICENSES.md');

/** C258.3's tools: name as the row names it, version, release date, licence. */
const TOOLS = [
  ['Trivy', '0.76.0', '2026-10-14', 'Apache-2.0'],
  ['osv-scanner', '2.7.0', '2026-10-12', 'Apache-2.0'],
  ['Grype', '0.120.1', '2026-10-06', 'Apache-2.0'],
  ['Syft', '1.54.1', '2026-10-06', 'Apache-2.0'],
  ['zizmor', '1.31.1', '2026-10-15', 'MIT'],
  ['pip-audit', '2.10.1', '2026-06-10', 'Apache-2.0'],
  ['cosign', '3.1.3', '2026-08-06', 'Apache-2.0'],
  ['Helm', '4.3.1', '2026-10-15', 'Apache-2.0'],
  ['Helm', '3.22.1', '2026-10-15', 'Apache-2.0'],
  ['helm-unittest', '1.2.1', '2026-10-03', 'MIT'],
  ['kubeconform', '0.8.0', '2026-06-04', 'Apache-2.0'],
  ['chart-testing (`ct`)', '3.15.0', '2026-10-06', 'Apache-2.0'],
  ['kind', '0.33.0', '2026-08-26', 'Apache-2.0'],
  ['kubectl', '1.35.9', '2026-09-23', 'Apache-2.0'],
  ['CycloneDX Gradle plugin (`org.cyclonedx.bom`)', '3.5.1', '2026-10-09', 'Apache-2.0'],
  ['eslint-plugin-security', '4.2.0', '2026-10-01', 'Apache-2.0'],
  ['actions/attest-build-provenance', 'v4.2.2', '2026-08-06', 'MIT'],
  ['slsa-framework/slsa-github-generator', 'v2.1.0', '2025-02-24', 'Apache-2.0'],
  // Workflow 11D (contracts-11d's pin, held here by fix-11d): the load harness's generator.
  ['vegeta', '12.13.0', '2025-10-31', 'MIT'],
] as const;

/** C282's Excluded entries for 11C's tools, and the not-adopted ones. */
const EXCLUDED = [
  'Semgrep Community Edition engine',
  'Semgrep registry rules',
  'Opengrep',
  'yamllint',
  'Bitnami charts and images',
] as const;
// Workflow 11G (contracts-11g): CodeQL left this list for section 1 under Q1 (Q9 declined);
// `release-11g-pins.test.ts` holds its row.
const NOT_ADOPTED = ['eslint-plugin-no-unsanitized', 'cdxgen'] as const;

/** `name` and `version` of every package a uv lockfile resolves, but the project itself. */
function lockedPackages(lockfile: string): [string, string][] {
  const packages = read(lockfile).split('\n[[package]]\n').slice(1);
  return packages
    .map((block) => [
      /^name = "([^"]+)"/m.exec(block)?.[1],
      /^version = "([^"]+)"/m.exec(block)?.[1],
    ])
    .filter((pair): pair is [string, string] => pair[0] !== undefined && pair[1] !== undefined)
    .filter(([name]) => !name.startsWith('openverify-'));
}

describe('the Workflow 11C tool pins and their licence rows (C258.3, C282)', () => {
  it.each(TOOLS)('records %s %s, released %s, under %s', (name, version, date, licence) => {
    expect(licences()).toContain(`| ${name} | ${version} (${date}) | ${licence} |`);
  });

  it("holds vegeta's ledger row to its installer's release, asset and checksum file", () => {
    const installer = readFileSync(
      new URL('../../../infra/scripts/install-vegeta.sh', import.meta.url),
      'utf8',
    );
    const sha = /vegeta_12\.13\.0_checksums\.txt \(SHA-256 ([0-9a-f]{64})\)/u.exec(installer)?.[1];
    expect(installer).toContain('vegeta_12.13.0_linux_amd64.tar.gz');
    expect(sha).toBeDefined();
    const row = licences()
      .split('\n')
      .find((line) => line.startsWith('| vegeta | 12.13.0 ('));
    expect(row).toContain('`vegeta_12.13.0_checksums.txt`');
    expect(row).toContain(`SHA-256 \`${sha?.slice(0, 8) ?? ''}…${sha?.slice(-4) ?? ''}\``);
  });

  it.each(EXCLUDED)('excludes %s', (name) => {
    const excluded = licences().slice(licences().indexOf('## Excluded components'));
    expect(excluded).toContain(`| ${name} |`);
  });

  it.each(NOT_ADOPTED)('records %s as not adopted', (name) => {
    const notAdopted = licences().slice(licences().indexOf('## Not adopted'));
    expect(licences()).toContain('## Not adopted');
    expect(notAdopted).toContain(`| ${name} |`);
  });

  it('says that published images redistribute their base distribution (C257.5)', () => {
    expect(licences()).toContain('redistribute the packages of their base distribution');
  });
});

describe('eslint-plugin-security, the SAST plugin (C260.1; review F28)', () => {
  it('is pinned exactly in the root package beside eslint-plugin-regexp', () => {
    const manifest = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['eslint-plugin-security']).toBe('4.2.0');
    expect(manifest.devDependencies['eslint-plugin-regexp']).toBe('3.3.1');
  });

  it('locks one version, the pinned 4.2.0, with its two dependencies', () => {
    const lock = read('pnpm-lock.yaml');
    expect(new Set(lock.match(/^ {2}eslint-plugin-security@[\d.]+/gm))).toEqual(
      new Set(['  eslint-plugin-security@4.2.0']),
    );
    expect(lock).toMatch(/^ {2}safe-regex@2\.1\.1:/m);
    expect(lock).toMatch(/^ {2}regexp-tree@0\.1\.27:/m);
  });

  it('adds no release-age exclusion and no build script', () => {
    const workspace = read('pnpm-workspace.yaml');
    expect(workspace).not.toContain('minimumReleaseAgeExclude');
    expect(workspace).not.toMatch(/^ {2}(eslint-plugin-security|safe-regex|regexp-tree):/m);
  });
});

describe.each([
  ['security/pip-audit', 'pip-audit==2.10.1'],
  ['security/python', 'pyyaml==6.0.3'],
  // Workflow 11D Stage 1a (contracts-11d; C268.1, C258.3): the load harness's project, httpx's newest
  // release dated on or before 2026-10-15, read on 2026-11-16. Locust is absent while Q12 is pending.
  ['load', 'httpx==0.28.1'],
])('the uv tool project %s (C258.2, C261.2; review F09)', (dir, pin) => {
  it('pins its tool exactly and takes only releases at least 14 days old', () => {
    const project = read(`${dir}/pyproject.toml`);
    expect(project).toContain(`"${pin}"`);
    expect(project).toContain('exclude-newer = "14 days"');
    expect(read(`${dir}/.python-version`).trim()).toBe('3.12');
  });

  it('commits a hashed lockfile', () => {
    const lock = read(`${dir}/uv.lock`);
    expect(lock).toContain('exclude-newer-span = "P14D"');
    expect(lock).toMatch(/hash = "sha256:[0-9a-f]{64}"/);
  });

  it('records the licence of every package its lockfile resolves', () => {
    const missing = lockedPackages(`${dir}/uv.lock`).filter(
      ([name, version]) => !licences().includes(`| ${name} | ${version} (`),
    );
    expect(missing).toEqual([]);
  });
});

describe('the CycloneDX Gradle plugin (C261.1; review F29; spike (c))', () => {
  const PUBLISHED = [
    ['openverify-sdk', 'androidRuntimeClasspath'],
    ['openverify-nfc', 'releaseRuntimeClasspath'],
    ['openverify-face', 'releaseRuntimeClasspath'],
  ] as const;

  it('is pinned in the version catalog and resolved from the plugin portal for its groups only', () => {
    const catalog = read('android/gradle/libs.versions.toml');
    expect(catalog).toContain('cyclonedx = "3.5.1"');
    expect(catalog).toContain(
      'cyclonedx = { id = "org.cyclonedx.bom", version.ref = "cyclonedx" }',
    );
    const settings = read('android/settings.gradle.kts');
    expect(settings).toMatch(
      /gradlePluginPortal \{\s*content \{\s*includeGroup\("org\.cyclonedx\.bom"\)\s*includeGroup\("org\.cyclonedx"\)\s*\}\s*\}/,
    );
  });

  it.each(PUBLISHED)(
    'gives %s an SBOM of its release runtime classpath (%s) only',
    (module, configuration) => {
      const build = read(`android/${module}/build.gradle.kts`);
      expect(build).toContain('alias(libs.plugins.cyclonedx)');
      expect(build).toContain(`includeConfigs.set(listOf("${configuration}"))`);
    },
  );

  it('keeps aopalliance (a public-domain declaration rule 4 does not list) off the build classpath', () => {
    expect(read('android/build.gradle.kts')).toContain(
      'exclude(group = "aopalliance", module = "aopalliance")',
    );
    const metadata = read('android/gradle/verification-metadata.xml');
    expect(metadata).toContain(
      '<component group="org.cyclonedx" name="cyclonedx-gradle-plugin" version="3.5.1">',
    );
    expect(metadata).not.toContain('group="aopalliance"');
  });

  it('applies to no module that is not published and to no consumer-check build', () => {
    expect(read('android/demo-app/build.gradle.kts')).not.toContain('cyclonedx');
    expect(read('android/consumer-check/build.gradle.kts')).not.toContain('cyclonedx');
  });
});

describe('the web package skeletons (C266; sdk-web-11c builds them)', () => {
  it('declares @openverify/react with React 19 as a peer and the embed client as its one dependency', () => {
    const manifest = JSON.parse(read('packages/sdk-react/package.json')) as {
      name: string;
      peerDependencies: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(manifest.name).toBe('@openverify/react');
    expect(manifest.peerDependencies).toEqual({ react: '^19.0.0' });
    expect(manifest.dependencies).toEqual({ '@openverify/js': 'workspace:*' });
  });

  it('declares apps/demo-web, private and never published, over the three client packages', () => {
    const manifest = JSON.parse(read('apps/demo-web/package.json')) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
    };
    expect(manifest).toMatchObject({ name: '@openverify/demo-web', private: true });
    for (const name of ['@openverify/js', '@openverify/node', '@openverify/react']) {
      expect(manifest.dependencies[name]).toBe('workspace:*');
    }
  });

  it.each(['packages/sdk-react', 'apps/demo-web'])('starts %s from an empty entry point', (dir) => {
    expect(existsSync(new URL(`${dir}/src/index.ts`, root))).toBe(true);
    expect(read(`${dir}/vitest.config.ts`)).toContain('createVitestConfig(');
  });
});
