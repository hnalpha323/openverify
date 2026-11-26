/**
 * The e2e stack's images mode (Phase 11, Workflow 11C, C257.3; review F03, decision 74).
 *
 * With `OPENVERIFY_E2E_IMAGES=1`, `startStack()` (e2e/setup/stack.ts) starts the five production
 * images (images-11c's `openverify/<name>:11c-local`, built beforehand, never here) in place of its
 * host processes, through images-11c's compose override `e2e/setup/docker-compose.images.yml` on
 * top of `infra/docker-compose.yml`'s `app` profile, in the same compose project `openverify-e2e`
 * as the run's infrastructure. Each app container joins the host's network and reads the run's
 * `e2e/.env.e2e`, so the specs see the same loopback URLs as in the host mode. The per-push e2e
 * stays on host processes (review F03); this mode runs only at 11C's checkpoints.
 */
import path from 'node:path';
import type { E2ePorts } from './env.js';

export const E2E_IMAGES_VARIABLE = 'OPENVERIFY_E2E_IMAGES';

/** images-11c's override, relative to the repository root. */
export const E2E_IMAGES_OVERRIDE = 'e2e/setup/docker-compose.images.yml';

/** The local tag contracts-11c froze (rule 19); release tags are release.yml's. */
export const E2E_IMAGE_TAG = '11c-local';

/** The app profile's services the mode starts; `migrate` runs the migrations once and exits. */
export const E2E_APP_SERVICES: readonly string[] = [
  'migrate',
  'api',
  'worker',
  'vision',
  'flow',
  'dashboard',
  'code-runner',
];

/** The command each production image is built with (images-11c's handoff). */
const BUILD_COMMANDS: Readonly<Record<string, string>> = {
  api: 'docker build -f infra/docker/api.Dockerfile -t openverify/api:11c-local .',
  dashboard:
    'docker build -f infra/docker/dashboard.Dockerfile -t openverify/dashboard:11c-local .',
  flow: 'docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .',
  vision: 'docker build --build-context repo=. -t openverify/vision:11c-local services/vision',
  'code-runner':
    'docker build -f infra/docker/code-runner.Dockerfile -t openverify/code-runner:11c-local .',
};

export const E2E_IMAGES: readonly string[] = Object.keys(BUILD_COMMANDS).map(
  (name) => `openverify/${name}:${E2E_IMAGE_TAG}`,
);

/** `up` for the app services: from the prebuilt images only, waiting for every healthcheck. */
export const IMAGES_UP_ARGS: readonly string[] = [
  'up',
  '--detach',
  '--wait',
  '--wait-timeout',
  '300',
  '--no-build',
  ...E2E_APP_SERVICES,
];

/** The seed the host mode runs with tsx, here the API image's compiled `seed:dev`. */
export const IMAGES_SEED_ARGS: readonly string[] = [
  'run',
  '--rm',
  '--no-deps',
  'migrate',
  'node',
  'dist/commands/seed-dev.js',
  '--json',
  '--mfa-admin',
  '--connect',
];

/**
 * @throws {Error} for a value other than `1`, `0` or empty, rather than guessing a mode.
 */
export function imagesModeRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[E2E_IMAGES_VARIABLE];
  if (value === undefined || value === '' || value === '0') {
    return false;
  }
  if (value === '1') {
    return true;
  }
  throw new Error(`${E2E_IMAGES_VARIABLE} must be 1 or 0 (it is "${value}")`);
}

/**
 * What the env file gains in the images mode: the mode itself (so `e2e:stack:down` takes the app
 * containers down too) and the three ports the override reads by name.
 */
export function imagesModeEnv(
  ports: Pick<E2ePorts, 'flow' | 'dashboard' | 'vision'>,
): Record<string, string> {
  return {
    [E2E_IMAGES_VARIABLE]: '1',
    OPENVERIFY_E2E_FLOW_PORT: String(ports.flow),
    OPENVERIFY_E2E_DASHBOARD_PORT: String(ports.dashboard),
    OPENVERIFY_E2E_VISION_PORT: String(ports.vision),
  };
}

/** The compose files (and profile) of a run, from its env file: the override only in the images mode. */
export function composeFileArgs(
  repoRoot: string,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const args = ['--file', path.join(repoRoot, 'infra', 'docker-compose.yml')];
  if (env[E2E_IMAGES_VARIABLE] === '1') {
    args.push('--file', path.join(repoRoot, E2E_IMAGES_OVERRIDE), '--profile', 'app');
  }
  return args;
}

/** The error for images that are not built, with the command that builds each. */
export function missingImagesMessage(missing: readonly string[]): string {
  const lines = missing.map((image) => {
    const name = image.replace(/^openverify\//, '').replace(/:.*$/, '');
    return `  ${image}: ${BUILD_COMMANDS[name] ?? 'not an image of this mode'}`;
  });
  return [
    `${E2E_IMAGES_VARIABLE}=1 starts prebuilt images, and these are missing (build each from the repository root, under the e2e lock):`,
    ...lines,
  ].join('\n');
}

/**
 * The error for images whose healthchecks passed while this host cannot reach their ports: each app
 * container runs with `network_mode: host`, which on Docker Desktop is its virtual machine's network
 * unless the owner enables Docker Desktop's host networking (measured on 2026-11-15, Workflow 11C).
 */
export function unreachableImagesMessage(url: string): string {
  return [
    `The images are up and healthy, but ${url} does not answer from this host.`,
    'Each app container runs with network_mode: host (e2e/setup/docker-compose.images.yml), so the',
    "specs reach it on this host's loopback. On Docker Desktop that is its virtual machine's network",
    'unless Docker Desktop host networking is on',
    '(Settings > Resources > Network > Enable host networking);',
    'on a Linux Docker engine (a CI runner) it is the host itself.',
  ].join('\n');
}
