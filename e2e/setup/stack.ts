/**
 * Starts the private e2e stack and stops it again.
 *
 * 1. Random secrets and free ports go to the gitignored `e2e/.env.e2e`.
 * 2. The compose infrastructure (Postgres, Valkey, RustFS and its bucket init, Mailpit) starts
 *    as its own project, `openverify-e2e`. The developer's `openverify` project and its volumes
 *    are never touched; teardown removes only this project's containers and volumes.
 * 3. Every model in `models/manifest.json`, every data file in `data/manifest.json` (C56), the
 *    public-domain faces and the blank federal forms are fetched (pinned SHA-256), the filtered
 *    variant groups are built from the rigour file (C78.3, F14), and the
 *    synthetic fixtures (the ID, the camera clips, the proof-of-address set and the chip portrait,
 *    C36, C65.2, C65.3) are generated when a file a spec reads is missing or the generator's stamp
 *    differs (it names the day, so the documents stay current).
 * 4. Migrations and the dev seed run (`--mfa-admin`): one operator per built-in role, the
 *    sandbox and production environments, and a TOTP-enrolled admin. The seed prints the API
 *    key and the TOTP secret once, as JSON.
 * 5. The flow is built against this API, the dashboard is built into its own output
 *    (`apps/dashboard/.next/e2e`), the embed client `@openverify/js` is built into the artifacts,
 *    and the vision service, API, worker, flow (its flow server, `apps/flow/server.ts`, which
 *    computes every entry's headers, C157) and dashboard (its custom server, `server.ts`, C21)
 *    start as local processes, each logging to `e2e/.artifacts/logs/<name>.log`. Specs open the
 *    dashboard on `localhost`, the WebAuthn origin of the run.
 * 6. The customer page of `e2e/fixtures/embed-page/` is served with the built client from a
 *    loopback port of its own (C178.4), so a spec embeds the flow from `http://127.0.0.1:<port>`
 *    (which it allows in the sandbox) and from `http://localhost:<port>` (which it does not).
 *
 * The images mode (`OPENVERIFY_E2E_IMAGES=1`, C257.3; e2e/src/images-mode.ts): steps 4 and 5 run
 * the five production images instead (`openverify/<name>:11c-local`, built beforehand) through
 * `e2e/setup/docker-compose.images.yml` over the same compose project, on the host's network and
 * the same ports: `migrate` applies the migrations, the API image's compiled `seed:dev` seeds, and
 * only the embed client is built here. On stop each container's log is written to
 * `e2e/.artifacts/logs/<service>.log` before the project goes down. The per-push e2e keeps the host
 * processes (review F03).
 */
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  E2E_API_RATE_LIMIT_PER_MINUTE,
  E2E_COMPOSE_PROJECT,
  dashboardOrigin,
  formatEnvFile,
  generateE2eEnv,
  type E2ePorts,
} from '../src/env.js';
import {
  BUILD_VARIANT_GROUPS_ARGS,
  FETCH_DATA_ARGS,
  FETCH_MODELS_ARGS,
  GENERATOR_VERSION_ARGS,
  needsRegeneration,
  readStamp,
} from '../src/assets.js';
import { waitForBucketInit } from '../src/bucket-init.js';
import { composeUpWithRetry } from '../src/compose-retry.js';
import { demoWebBuildArgs } from '../src/demo-web.js';
import {
  E2E_APP_SERVICES,
  E2E_IMAGES,
  IMAGES_SEED_ARGS,
  IMAGES_UP_ARGS,
  composeFileArgs,
  imagesModeEnv,
  imagesModeRequested,
  missingImagesMessage,
  unreachableImagesMessage,
} from '../src/images-mode.js';
import { startEmbedPageServer, type EmbedPageServer } from '../src/embed-page.js';
import {
  ARTIFACTS_DIR,
  ENV_FILE,
  FIXTURES,
  RECEIVER_TLS,
  REPO_ROOT,
  generatedInputs,
} from '../src/paths.js';
import { freePorts } from '../src/ports.js';
import {
  childEnvironment,
  runCommand,
  startService,
  tail,
  waitForHttp,
  waitForLog,
  type Service,
} from '../src/processes.js';
import { writeReceiverCertificate } from '../src/receiver-certificate.js';
import type { StackInfo } from '../src/stack-info.js';

const INFRA_SERVICES = ['postgres', 'redis', 'objectstore', 'objectstore-init', 'mailpit'];
const LOGS_DIR = path.join(ARTIFACTS_DIR, 'logs');
const FLOW_DIST = path.join(ARTIFACTS_DIR, 'flow-dist');
const EMBED_CLIENT_DIST = path.join(ARTIFACTS_DIR, 'embed-client');
const DEMO_WEB_DIST = path.join(ARTIFACTS_DIR, 'demo-web');
const DEMO_WEB_DIR = path.join(REPO_ROOT, 'apps', 'demo-web');
const EMBED_PAGE_DIR = path.join(REPO_ROOT, 'e2e', 'fixtures', 'embed-page');
const SDK_JS_DIR = path.join(REPO_ROOT, 'packages', 'sdk-js');
const API_DIR = path.join(REPO_ROOT, 'apps', 'api');
const FLOW_DIR = path.join(REPO_ROOT, 'apps', 'flow');
const DASHBOARD_DIR = path.join(REPO_ROOT, 'apps', 'dashboard');
const VISION_DIR = path.join(REPO_ROOT, 'services', 'vision');
const MINUTE = 60_000;

export interface RunningStack {
  info: StackInfo;
  /** Stops every process, then removes the e2e compose project with its volumes. */
  stop(): Promise<void>;
}

const startedAt = Date.now();
function log(message: string): void {
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`[e2e +${seconds}s] ${message}\n`);
}

/** `compose ps --format json`: one object per line (Compose 2.21+) or one array (older). */
function composeStates(output: string): { State?: string; ExitCode?: number }[] {
  const text = output.trim();
  if (text === '') {
    return [];
  }
  if (text.startsWith('[')) {
    return JSON.parse(text) as { State?: string; ExitCode?: number }[];
  }
  return text.split('\n').map((line) => JSON.parse(line) as { State?: string; ExitCode?: number });
}

async function missing(files: readonly string[]): Promise<string[]> {
  const absent: string[] = [];
  for (const file of files) {
    await access(file).catch(() => absent.push(file));
  }
  return absent;
}

/** C257.3: the images mode starts prebuilt images only, and fails at once naming each missing build. */
async function requireImages(): Promise<void> {
  const absent: string[] = [];
  for (const image of E2E_IMAGES) {
    await runCommand('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
      cwd: REPO_ROOT,
      timeoutMs: MINUTE,
      label: `docker image inspect ${image}`,
    }).catch(() => absent.push(image));
  }
  if (absent.length > 0) {
    throw new Error(missingImagesMessage(absent));
  }
}

/**
 * Each app container's log, written where the host mode writes its processes' logs. The log is
 * streamed to its file, never held in one string: a 6.6-hour images-mode stack's API log passed
 * V8's string limit and killed the holder before its `compose down` (Workflow 11F).
 */
async function saveContainerLogs(
  compose: (
    args: readonly string[],
    timeoutMs?: number,
    outputFile?: string,
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<void> {
  for (const service of E2E_APP_SERVICES) {
    await compose(
      ['logs', '--no-color', '--timestamps', service],
      MINUTE,
      path.join(LOGS_DIR, `${service}.log`),
    ).catch((error: unknown) => {
      process.stderr.write(`[e2e] the log of ${service}: ${(error as Error).message}\n`);
    });
  }
}

export async function startStack(): Promise<RunningStack> {
  await rm(LOGS_DIR, { recursive: true, force: true });
  await mkdir(LOGS_DIR, { recursive: true });

  const [
    postgres,
    redis,
    s3,
    s3Console,
    mailpitSmtp,
    mailpitUi,
    api,
    vision,
    flow,
    dashboard,
    embedPage,
  ] = await freePorts(11);
  const ports: E2ePorts = {
    postgres: postgres ?? 0,
    redis: redis ?? 0,
    s3: s3 ?? 0,
    s3Console: s3Console ?? 0,
    mailpitSmtp: mailpitSmtp ?? 0,
    mailpitUi: mailpitUi ?? 0,
    api: api ?? 0,
    vision: vision ?? 0,
    flow: flow ?? 0,
    dashboard: dashboard ?? 0,
  };
  const images = imagesModeRequested(process.env);
  if (images) {
    await requireImages();
  }
  const env = { ...generateE2eEnv(ports), ...(images ? imagesModeEnv(ports) : {}) };
  await writeFile(ENV_FILE, formatEnvFile(env), { mode: 0o600 });
  const childEnv = childEnvironment(env);
  // The weights scripts/fetch_models.py downloads; the vision service loads them lazily.
  childEnv.OPENVERIFY_VISION_MODELS_DIR = path.join(REPO_ROOT, 'models');
  // C41.4: ONNX Runtime's Linux builds send Microsoft telemetry unless this is set.
  childEnv.ORT_DISABLE_TELEMETRY = '1';
  const url = (port: number) => `http://127.0.0.1:${String(port)}`;

  const compose = (args: readonly string[], timeoutMs = 5 * MINUTE, outputFile?: string) =>
    runCommand(
      'docker',
      [
        'compose',
        '--project-name',
        E2E_COMPOSE_PROJECT,
        ...composeFileArgs(REPO_ROOT, env),
        '--env-file',
        ENV_FILE,
        ...args,
      ],
      {
        cwd: REPO_ROOT,
        env: childEnv,
        timeoutMs,
        label: `docker compose ${args[0] ?? ''}`,
        ...(outputFile === undefined ? {} : { outputFile }),
      },
    );

  const services: Service[] = [];
  let embedPageServer: EmbedPageServer | undefined;
  const start = (name: string, command: string, args: readonly string[], cwd: string) => {
    const service = startService({
      name,
      command,
      args,
      cwd,
      env: childEnv,
      logFile: path.join(LOGS_DIR, `${name}.log`),
    });
    services.push(service);
    return service;
  };

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      log('stopping the services');
      if (images) {
        await saveContainerLogs(compose);
      }
      await Promise.allSettled([
        ...services.toReversed().map((service) => service.stop()),
        embedPageServer?.close(),
      ]);
      log(`removing the ${E2E_COMPOSE_PROJECT} compose project and its volumes`);
      await compose(['down', '--volumes', '--remove-orphans']).catch((error: unknown) => {
        process.stderr.write(`[e2e] compose down failed: ${(error as Error).message}\n`);
      });
    })());

  try {
    log(`starting the ${E2E_COMPOSE_PROJECT} compose project (${INFRA_SERVICES.join(', ')})`);
    // Leftovers of an interrupted run of this project only; other projects are untouched.
    await compose(['down', '--volumes', '--remove-orphans']);
    // P5-5: once more after a Docker Desktop port-allocation error, the project taken down first.
    await composeUpWithRetry({
      up: () => compose(['up', '--detach', '--wait', '--wait-timeout', '240', ...INFRA_SERVICES]),
      down: () => compose(['down', '--volumes', '--remove-orphans']),
      pause: () => new Promise((resolve) => setTimeout(resolve, 5_000)),
      log,
    });
    // `up --wait` does not wait for the one-shot bucket init; its exit code must be 0. On a
    // failure its log is kept before the project goes down (KP11-68).
    const initLog = path.join(LOGS_DIR, 'objectstore-init.log');
    await waitForBucketInit({
      wait: () => compose(['wait', 'objectstore-init']),
      exitCodes: async () =>
        composeStates(
          (await compose(['ps', '--all', '--format', 'json', 'objectstore-init'])).stdout,
        ).map((state) => state.ExitCode),
      saveLog: async () => {
        await compose(['logs', '--no-color', '--timestamps', 'objectstore-init'], MINUTE, initLog);
        return tail(await readFile(initLog, 'utf8'), 20);
      },
    });

    await writeReceiverCertificate(RECEIVER_TLS);
    log('fetching every model weight and the public-domain faces (pinned SHA-256)');
    await runCommand('python3', FETCH_MODELS_ARGS, {
      cwd: REPO_ROOT,
      env: childEnv,
      timeoutMs: 10 * MINUTE,
      label: 'fetch_models.py',
    });
    log('fetching every data file (pinned SHA-256): the disposable email list');
    await runCommand('python3', FETCH_DATA_ARGS, {
      cwd: REPO_ROOT,
      env: childEnv,
      timeoutMs: 5 * MINUTE,
      label: 'fetch_data.py',
    });
    // C78.3 (F14): the filtered variant groups, so seed:dev imports the synthetic sandbox lists
    // and the person-name reports screen; refused unless its digest is the shipped one.
    log('building the filtered variant groups (data/variant-groups.json)');
    await runCommand('pnpm', BUILD_VARIANT_GROUPS_ARGS, {
      cwd: REPO_ROOT,
      env: childEnv,
      timeoutMs: 3 * MINUTE,
      label: 'build:variant-groups',
    });
    await runCommand('python3', ['scripts/fetch_fixtures.py'], {
      cwd: REPO_ROOT,
      env: childEnv,
      timeoutMs: 10 * MINUTE,
      label: 'fetch_fixtures.py',
    });
    const generated = generatedInputs();
    const version = await runCommand('uv', GENERATOR_VERSION_ARGS, {
      cwd: VISION_DIR,
      env: childEnv,
      timeoutMs: 5 * MINUTE,
      label: 'make_synthetic_fixtures.py --print-version',
    });
    if (
      needsRegeneration({
        missing: await missing(generated),
        stamp: await readStamp(FIXTURES.generatorStamp),
        version: version.stdout,
      })
    ) {
      log(
        'generating the synthetic fixtures: the ID, the camera clips, the bills, the chip portrait',
      );
      await runCommand('uv', ['run', 'python', 'tools/make_synthetic_fixtures.py'], {
        cwd: VISION_DIR,
        env: childEnv,
        timeoutMs: 10 * MINUTE,
        label: 'make_synthetic_fixtures.py',
      });
    }

    interface SeedOutput {
      apiKey: { token: string };
      template: { id: string };
      environments: { sandbox: string; production: string };
      mfaAdmin?: { totp: { secret: string } };
      connect?: {
        organizationId: string;
        environments: { sandbox: string; production: string };
        users: { role: string; email: string }[];
        connection: { id: string };
      };
    }
    const parseSeed = (stdout: string) => {
      const parsed = JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as SeedOutput;
      if (parsed.connect === undefined) {
        throw new Error('seed-dev --connect printed no connect member');
      }
      return { ...parsed, connect: parsed.connect };
    };
    const buildEmbedClient = () =>
      runCommand(
        'pnpm',
        [
          'exec',
          'vite',
          'build',
          '--outDir',
          EMBED_CLIENT_DIST,
          '--emptyOutDir',
          '--logLevel',
          'warn',
        ],
        {
          cwd: SDK_JS_DIR,
          env: childEnv,
          timeoutMs: 5 * MINUTE,
          label: 'vite build (embed client)',
        },
      );

    // C266.3: the sample site, built in the stack (e2e/src/demo-web.ts says why it is not started).
    const buildDemoWeb = () =>
      runCommand('pnpm', demoWebBuildArgs(DEMO_WEB_DIST), {
        cwd: DEMO_WEB_DIR,
        env: childEnv,
        timeoutMs: 5 * MINUTE,
        label: 'vite build (demo-web)',
      });

    // The host mode (the per-push e2e): seed with tsx, build the flow and the dashboard against
    // this API, and start each service as a local process.
    const startHostProcesses = async () => {
      log('migrating and seeding the database');
      const seeded = await runCommand(
        'pnpm',
        [
          'exec',
          'tsx',
          '--conditions=@openverify/source',
          'scripts/seed-dev.ts',
          '--json',
          '--mfa-admin',
          // C244.1 (Workflow 11A integration-11a): the sample partner and its pending connection.
          '--connect',
        ],
        { cwd: API_DIR, env: childEnv, timeoutMs: 3 * MINUTE, label: 'seed-dev.ts' },
      );
      const hostSeed = parseSeed(seeded.stdout);

      // The dashboard builds into OPENVERIFY_DASHBOARD_DIST_DIR (childEnv), never the shared .next.
      log(
        'building the flow against this API, the embed client, the sample site and the dashboard',
      );
      await Promise.all([
        buildEmbedClient(),
        buildDemoWeb(),
        runCommand(
          'pnpm',
          ['exec', 'vite', 'build', '--outDir', FLOW_DIST, '--emptyOutDir', '--logLevel', 'warn'],
          { cwd: FLOW_DIR, env: childEnv, timeoutMs: 5 * MINUTE, label: 'vite build' },
        ),
        runCommand('pnpm', ['exec', 'next', 'build'], {
          cwd: DASHBOARD_DIR,
          env: childEnv,
          timeoutMs: 10 * MINUTE,
          label: 'next build',
        }),
      ]);

      log('starting vision, API, worker, flow and dashboard');
      const visionService = start(
        'vision',
        'uv',
        [
          'run',
          'uvicorn',
          'openverify_vision.app:create_app',
          '--factory',
          '--host',
          '127.0.0.1',
          '--port',
          String(ports.vision),
        ],
        VISION_DIR,
      );
      const apiService = start(
        'api',
        'pnpm',
        ['exec', 'tsx', '--conditions=@openverify/source', 'src/server.ts'],
        API_DIR,
      );
      const workerService = start(
        'worker',
        'pnpm',
        ['exec', 'tsx', '--conditions=@openverify/source', 'src/worker.ts'],
        API_DIR,
      );
      // C157.3: the flow server, as the compose app profile runs it, over this run's flow build.
      const flowService = start(
        'flow',
        'node',
        [
          '--conditions=@openverify/source',
          'server.ts',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(ports.flow),
          '--dist',
          FLOW_DIST,
        ],
        FLOW_DIR,
      );
      // The custom server records each request's socket peer for the BFF's client address (C21).
      const dashboardService = start(
        'dashboard',
        'pnpm',
        ['exec', 'node', 'server.ts', '--hostname', '127.0.0.1', '--port', String(ports.dashboard)],
        DASHBOARD_DIR,
      );

      const ready = { timeoutMs: 2 * MINUTE };
      await Promise.all([
        waitForHttp(`${url(ports.vision)}/health`, { ...ready, service: visionService }),
        waitForHttp(`${url(ports.api)}/health`, { ...ready, service: apiService }),
        waitForLog(workerService, /"msg":"worker started"/, ready),
        waitForHttp(`${url(ports.flow)}/`, { ...ready, service: flowService }),
        waitForHttp(`${url(ports.dashboard)}/login`, { ...ready, service: dashboardService }),
      ]);
      return hostSeed;
    };

    let seed: ReturnType<typeof parseSeed>;
    if (images) {
      // C257.3: the production images over this project's infrastructure; `up --wait` returns once
      // migrate has exited 0 and every app service's healthcheck passes (the API's /ready, the
      // worker's heartbeat probe, the runner's --health).
      log(
        'starting the production images: migrate, API, worker, vision, flow, dashboard, code runner',
      );
      await compose(IMAGES_UP_ARGS, 8 * MINUTE);
      log("seeding the database with the API image's compiled seed:dev");
      seed = parseSeed((await compose(IMAGES_SEED_ARGS, 3 * MINUTE)).stdout);
      // The healthchecks passed inside the containers; if this host cannot reach their ports,
      // say why within seconds rather than after the two-minute waits below.
      await waitForHttp(`${url(ports.api)}/ready`, { timeoutMs: 20_000 }).catch(() => {
        throw new Error(unreachableImagesMessage(`${url(ports.api)}/ready`));
      });
      log('building the embed client and the sample site');
      await Promise.all([buildEmbedClient(), buildDemoWeb()]);
      const ready = { timeoutMs: 2 * MINUTE };
      await Promise.all([
        waitForHttp(`${url(ports.vision)}/health`, ready),
        waitForHttp(`${url(ports.api)}/ready`, ready),
        waitForHttp(`${url(ports.flow)}/`, ready),
        waitForHttp(`${url(ports.dashboard)}/login`, ready),
      ]);
    } else {
      seed = await startHostProcesses();
    }
    const partner = seed.connect;

    embedPageServer = await startEmbedPageServer(
      {
        pageDir: EMBED_PAGE_DIR,
        clientFile: path.join(EMBED_CLIENT_DIST, 'openverify.iife.js'),
      },
      { host: '127.0.0.1', port: embedPage ?? 0 },
    );
    log(`stack ready; logs in ${path.relative(REPO_ROOT, LOGS_DIR)}`);

    const operator = (prefix: string) => ({
      email: env[`${prefix}_EMAIL`] ?? '',
      password: env[`${prefix}_PASSWORD`] ?? '',
    });
    return {
      info: {
        apiUrl: url(ports.api),
        flowUrl: url(ports.flow),
        embedPageUrl: url(embedPageServer.port),
        dashboardUrl: dashboardOrigin(ports),
        mailpitUrl: url(ports.mailpitUi),
        apiKey: seed.apiKey.token,
        admin: operator('OPENVERIFY_SEED_ADMIN'),
        operators: {
          admin: operator('OPENVERIFY_SEED_ADMIN'),
          developer: operator('OPENVERIFY_SEED_DEVELOPER'),
          reviewer: operator('OPENVERIFY_SEED_REVIEWER'),
          viewer: operator('OPENVERIFY_SEED_VIEWER'),
        },
        mfaAdmin: {
          ...operator('OPENVERIFY_SEED_MFA_ADMIN'),
          totpSecret: seed.mfaAdmin?.totp.secret ?? '',
        },
        connect: {
          partnerOrganizationId: partner.organizationId,
          partnerEnvironments: partner.environments,
          seededConnectionId: partner.connection.id,
          // The partner's admin reuses the dev admin's password (C244.1).
          partnerAdmin: {
            email: partner.users.find((user) => user.role === 'admin')?.email ?? '',
            password: operator('OPENVERIFY_SEED_ADMIN').password,
          },
        },
        apiRateLimitPerMinute: E2E_API_RATE_LIMIT_PER_MINUTE,
        defaultTemplateId: seed.template.id,
        environments: seed.environments,
        databaseUrl: env.DATABASE_URL ?? '',
        s3: {
          endpoint: url(ports.s3),
          region: env.S3_REGION ?? '',
          bucket: env.S3_BUCKET ?? '',
          accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
        },
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
