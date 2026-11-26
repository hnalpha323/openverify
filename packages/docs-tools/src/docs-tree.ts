/**
 * The docs tree (contracts-11e): every document Workflow 11E writes, with its owner, its contract
 * and whether it is generated, frozen here so evidence paths across agents resolve from the
 * start. Each file was created at Stage 1a as a stub holding {@link DRAFT_MARKER_PREFIX} and its
 * owner; every owner replaces its stubs, and integration-11e fails the Workflow if a marker
 * remains ({@link draftsRemaining}).
 */
import { DOCS_SWITCHES, migrationPagePath } from './switches.js';
import type { Repository } from './types.js';

export interface DocsTreeEntry {
  /** Repository-relative path. */
  readonly path: string;
  readonly title: string;
  /** The 11E agent that writes it. */
  readonly owner: string;
  /** The contract (and item) it meets. */
  readonly contract: string;
  /** Rendered by a generator (re-rendered by its area's script), or hand-written with a record test. */
  readonly generated: boolean;
}

/** The marker line every stub holds, followed by its owner. */
export const DRAFT_MARKER_PREFIX = 'Draft: written in Workflow 11E by ';

/** The marker line for `owner`. */
export function draftMarker(owner: string): string {
  return `${DRAFT_MARKER_PREFIX}${owner}`;
}

const entry = (
  path: string,
  title: string,
  owner: string,
  contract: string,
  generated = false,
): DocsTreeEntry => Object.freeze({ path, title, owner, contract, generated });

const selfhost = (file: string, title: string, contract: string, generated = false) =>
  entry(`docs/self-hosting/${file}`, title, 'docs-selfhost', contract, generated);
const connect = (file: string, title: string, generated = false) =>
  entry(`docs/connect/${file}`, title, 'docs-catalog', 'C281.1', generated);

/** Every document 11E writes, sorted by path. */
export const DOCS_TREE: readonly DocsTreeEntry[] = Object.freeze(
  [
    entry('SECURITY.md', 'Security policy', 'docs-records', 'C276.4'),
    entry('docs/security/README.md', 'Security records', 'docs-records', 'C276.5'),
    entry('docs/security/threat-model.md', 'Threat model', 'docs-security', 'C273'),
    entry(
      'docs/security/asvs-5.0.0-l2.csv',
      'ASVS 5.0.0 Level 2 checklist',
      'docs-security',
      'C274.1',
    ),
    entry(
      'docs/security/asvs-5.0.0-l2-ids.txt',
      'ASVS 5.0.0 Level 2 ids',
      'contracts-11e',
      'C274.2',
      true,
    ),
    entry('docs/security/asvs-summary.md', 'ASVS summary', 'docs-security', 'C274.3', true),
    entry('docs/security/masvs-2.1.0.csv', 'MASVS v2.1.0 checklist', 'docs-security', 'C275.1'),
    entry('docs/security/masvs-2.1.0-ids.txt', 'MASVS v2.1.0 ids', 'contracts-11e', 'C275.2', true),
    entry(
      'docs/security/crypto-inventory.md',
      'Cryptographic inventory and key management',
      'docs-records',
      'C276.1',
    ),
    entry(
      'docs/security/data-classification.md',
      'Data classification',
      'docs-records',
      'C276.2',
      true,
    ),
    entry('docs/security/logging.md', 'Logging inventory', 'docs-records', 'C276.3'),
    entry(
      'docs/security/vulnerability-policy.md',
      'Vulnerability policy',
      'docs-records',
      'C276.4',
    ),
    selfhost('README.md', 'Self-hosting OpenVerify', 'C277.1'),
    selfhost('install-compose.md', 'Install with Docker Compose', 'C277.1'),
    selfhost('install-kubernetes.md', 'Install on Kubernetes', 'C277.1'),
    selfhost('requirements.md', 'Requirements', 'C277.1'),
    selfhost('configuration.md', 'Configuration reference', 'C277.2', true),
    selfhost('sizing.md', 'Sizing', 'C277.11'),
    selfhost('secrets-and-rotation.md', 'Secrets and rotation', 'C277.5'),
    selfhost('backups-and-restore.md', 'Backups and restore', 'C277.6'),
    selfhost('upgrades.md', 'Upgrades', 'C277.1'),
    selfhost('database.md', 'Database', 'C277.7'),
    selfhost('valkey.md', 'Valkey', 'C277.7'),
    selfhost('first-run.md', 'First run', 'C277.8'),
    selfhost('break-glass.md', 'Break-glass procedures', 'C277.9'),
    selfhost('monitoring.md', 'Monitoring', 'C277.10'),
    selfhost('sso.md', 'Single sign-on (OIDC)', 'C248'),
    selfhost('hardening-checklist.md', 'Hardening checklist', 'C277.1', true),
    selfhost('verify-artifacts.md', 'Verifying release artifacts', 'C277.1'),
    entry('docs/compliance/README.md', 'Compliance guide', 'docs-compliance', 'C278.1'),
    entry(
      'docs/compliance/roles.md',
      'Roles: controller and processor',
      'docs-compliance',
      'C278.1',
    ),
    entry(
      'docs/compliance/record-of-processing.md',
      'Record of processing (template)',
      'docs-compliance',
      'C278.5',
      true,
    ),
    entry('docs/checks/catalog.md', 'Check catalog', 'docs-catalog', 'C279.1', true),
    entry('docs/checks/limits.json', 'What each check does not detect', 'docs-catalog', 'C279.1'),
    entry('docs/api/README.md', 'API reference', 'docs-catalog', 'C279.3', true),
    // C280.5: the migration page the vendor-naming switch selects (Q8 granted 2026-11-21: the
    // vendor-named page; Workflow 11G records-11g).
    entry(
      migrationPagePath(),
      DOCS_SWITCHES.vendorNaming
        ? 'Migrating from the source vendor (vendor-named, Q8)'
        : 'Migrating from a hosted identity-verification API',
      'docs-catalog',
      'C280',
      true,
    ),
    connect('README.md', 'Sharing verifications (Connect)'),
    connect('connections.md', 'Connections'),
    connect('share-tokens.md', 'Share tokens'),
    connect('consent.md', 'Consent'),
    connect('peek-and-redeem.md', 'Peek and redeem'),
    connect('provenance.md', 'Provenance'),
    connect('client-side.md', 'Client-side redemption'),
    connect('events-and-workflows.md', 'Events and workflows'),
    connect('mapping.md', 'Mapping from the source API', true),
    connect('limits.md', 'Limits of sharing'),
    entry('docs/release/checklist.md', 'Release checklist', 'docs-release', 'C284.1'),
    entry('docs/release/notes.md', 'Release notes', 'docs-release', 'C284.4', true),
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
);

/** The text a stub holds: its title, the marker line and what the owner writes in its place. */
export function stubFor(item: DocsTreeEntry): string {
  const what = `${item.generated ? 'Generated by' : 'Written by'} \`${item.owner}\` (${item.contract})`;
  if (item.path.endsWith('.json')) {
    return `${JSON.stringify({ draft: draftMarker(item.owner), title: item.title }, null, 2)}\n`;
  }
  if (item.path.endsWith('.csv')) {
    return `${draftMarker(item.owner)}\n`;
  }
  return [
    `# ${item.title}`,
    '',
    draftMarker(item.owner),
    '',
    `${what} in Workflow 11E; this stub keeps the path resolving until then.`,
    '',
  ].join('\n');
}

/** The manifest entries whose file is missing. */
export function missingFromTree(repo: Repository): readonly DocsTreeEntry[] {
  return DOCS_TREE.filter((item) => !repo.exists(item.path));
}

/** The manifest entries whose file still holds a draft marker, with the owner the marker names. */
export function draftsRemaining(repo: Repository): readonly { path: string; marker: string }[] {
  return DOCS_TREE.flatMap((item) => {
    if (!repo.exists(item.path)) {
      return [];
    }
    const line = repo
      .readText(item.path)
      .split('\n')
      .find((candidate) => candidate.includes(DRAFT_MARKER_PREFIX));
    return line === undefined ? [] : [{ path: item.path, marker: line.trim() }];
  });
}
