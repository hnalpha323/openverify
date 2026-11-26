/**
 * C284.2's version rule (docs-release; KP11-47 (a); 11E decisions item 20): the root and published
 * `package.json`s, `Chart.yaml`'s `version` and `appVersion`, `android/gradle.properties`'
 * `openverifyVersion`, the Node client's fixed `User-Agent` and the Android changelog's newest
 * entry all carry the checklist's release version, and the changelog's entry is dated with its
 * minimum server, minSdk and compileSdk. No 11E agent changes a version: a disagreement is reported
 * with the exact change to make (an `owner` finding the default mode exits 0 on, and `--tag`
 * refuses).
 */
import type { CheckFinding, Repository } from '../types.js';

/** One place a version string lives. */
export interface VersionSource {
  readonly path: string;
  readonly label: string;
  /** The version it holds and the line it is on, or `null` when it cannot be read. */
  readonly read: (text: string) => { readonly version: string; readonly line: number } | null;
}

function lineOf(text: string, pattern: RegExp): { version: string; line: number } | null {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index] ?? '');
    if (match?.[1] !== undefined) {
      return { version: match[1], line: index + 1 };
    }
  }
  return null;
}

const packageVersion = (text: string): { version: string; line: number } | null =>
  lineOf(text, /^ {2}"version": "([^"]+)"/);

export const ANDROID_CHANGELOG = 'android/CHANGELOG.md';

export const VERSION_SOURCES: readonly VersionSource[] = [
  { path: 'package.json', label: 'the root package.json', read: packageVersion },
  { path: 'packages/node/package.json', label: '@openverify/node', read: packageVersion },
  { path: 'packages/sdk-js/package.json', label: '@openverify/js', read: packageVersion },
  { path: 'packages/sdk-react/package.json', label: '@openverify/react', read: packageVersion },
  {
    path: 'packages/node/src/transport.ts',
    label: "@openverify/node's CLIENT_USER_AGENT",
    read: (text) => lineOf(text, /CLIENT_USER_AGENT = 'openverify-node\/([^']+)'/),
  },
  {
    path: 'deploy/helm/openverify/Chart.yaml',
    label: "the chart's version",
    read: (text) => lineOf(text, /^version: ['"]?([^'"\s]+)['"]?\s*$/),
  },
  {
    path: 'deploy/helm/openverify/Chart.yaml',
    label: "the chart's appVersion",
    read: (text) => lineOf(text, /^appVersion: ['"]?([^'"\s]+)['"]?\s*$/),
  },
  {
    path: 'android/gradle.properties',
    label: "the Android SDK's openverifyVersion",
    read: (text) => lineOf(text, /^openverifyVersion=(\S+)$/),
  },
  {
    path: ANDROID_CHANGELOG,
    label: "the Android changelog's newest entry",
    read: (text) => {
      const heading = lineOf(text, /^## (\S.*)$/);
      if (heading === null) {
        return null;
      }
      const dated = /^(\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)$/.exec(heading.version);
      if (dated?.[1] !== undefined) {
        return { version: dated[1], line: heading.line };
      }
      const body = text.split('\n').slice(heading.line);
      const stated = lineOf(body.join('\n'), /^Version (\d+\.\d+\.\d+)\./);
      return stated === null ? null : { version: stated.version, line: heading.line + stated.line };
    },
  },
];

const owner = (message: string, path: string, line?: number): CheckFinding => ({
  rule: 'version',
  path,
  ...(line === undefined ? {} : { line }),
  message,
  severity: 'owner',
});

/** The lines an Android changelog entry must name (the plan's version line). */
const CHANGELOG_FACTS: readonly [RegExp, string][] = [
  [/minimum server/i, 'its minimum server'],
  [/minSdk/, 'its minSdk'],
  [/compile/i, 'its compileSdk'],
];

/** C284.2's version rule against `release` (the checklist's release version). */
export function versionFindings(repo: Repository, release: string | null): readonly CheckFinding[] {
  if (release === null) {
    return [];
  }
  const findings: CheckFinding[] = [];
  for (const source of VERSION_SOURCES) {
    if (!repo.exists(source.path)) {
      findings.push({
        rule: 'version',
        path: source.path,
        message: `${source.label}: ${source.path} does not exist`,
        severity: 'error',
      });
      continue;
    }
    const found = source.read(repo.readText(source.path));
    if (found === null) {
      findings.push({
        rule: 'version',
        path: source.path,
        message: `${source.label}: no version string found`,
        severity: 'error',
      });
    } else if (found.version !== release) {
      findings.push(
        owner(
          `orchestrator: ${source.label} is ${found.version}, not the release's ${release}: change ${source.path}:${String(found.line)} from "${found.version}" to "${release}"`,
          source.path,
          found.line,
        ),
      );
    }
  }
  if (repo.exists(ANDROID_CHANGELOG)) {
    const text = repo.readText(ANDROID_CHANGELOG);
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line.startsWith('## '));
    if (start >= 0) {
      const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
      const entry = lines.slice(start, end < 0 ? undefined : end).join('\n');
      if (!/^## \d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/.test(lines[start] ?? '')) {
        findings.push(
          owner(
            `orchestrator, at the tag: date the changelog's entry: change "${lines[start] ?? ''}" to "## ${release} (<the tag's date>)"`,
            ANDROID_CHANGELOG,
            start + 1,
          ),
        );
      }
      for (const [pattern, what] of CHANGELOG_FACTS) {
        if (!pattern.test(entry)) {
          findings.push({
            rule: 'version',
            path: ANDROID_CHANGELOG,
            line: start + 1,
            message: `the changelog's newest entry does not state ${what}`,
            severity: 'error',
          });
        }
      }
    }
  }
  return findings;
}
