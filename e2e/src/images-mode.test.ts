import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  E2E_APP_SERVICES,
  E2E_IMAGES,
  E2E_IMAGES_OVERRIDE,
  IMAGES_SEED_ARGS,
  IMAGES_UP_ARGS,
  composeFileArgs,
  imagesModeEnv,
  imagesModeRequested,
  missingImagesMessage,
  unreachableImagesMessage,
} from './images-mode.js';

describe('the images mode (C257.3)', () => {
  it('is requested only by OPENVERIFY_E2E_IMAGES=1; unset or 0 keeps the host processes', () => {
    expect(imagesModeRequested({ OPENVERIFY_E2E_IMAGES: '1' })).toBe(true);
    expect(imagesModeRequested({})).toBe(false);
    expect(imagesModeRequested({ OPENVERIFY_E2E_IMAGES: '' })).toBe(false);
    expect(imagesModeRequested({ OPENVERIFY_E2E_IMAGES: '0' })).toBe(false);
  });

  it('refuses any other value rather than guessing a mode', () => {
    expect(() => imagesModeRequested({ OPENVERIFY_E2E_IMAGES: 'true' })).toThrow(
      /OPENVERIFY_E2E_IMAGES must be 1 or 0/,
    );
  });

  it("adds the ports the override reads beside the env file's own, and the mode itself", () => {
    expect(imagesModeEnv({ flow: 41001, dashboard: 41002, vision: 41003 })).toEqual({
      OPENVERIFY_E2E_IMAGES: '1',
      OPENVERIFY_E2E_FLOW_PORT: '41001',
      OPENVERIFY_E2E_DASHBOARD_PORT: '41002',
      OPENVERIFY_E2E_VISION_PORT: '41003',
    });
  });

  it('runs compose on the base file alone in the host mode', () => {
    expect(composeFileArgs('/repo', {})).toEqual([
      '--file',
      path.join('/repo', 'infra', 'docker-compose.yml'),
    ]);
  });

  it("adds images-11c's override and the app profile when the env file names the images mode", () => {
    expect(composeFileArgs('/repo', { OPENVERIFY_E2E_IMAGES: '1' })).toEqual([
      '--file',
      path.join('/repo', 'infra', 'docker-compose.yml'),
      '--file',
      path.join('/repo', E2E_IMAGES_OVERRIDE),
      '--profile',
      'app',
    ]);
  });

  it('starts the seven app services from the prebuilt images, never building one', () => {
    expect(E2E_APP_SERVICES).toEqual([
      'migrate',
      'api',
      'worker',
      'vision',
      'flow',
      'dashboard',
      'code-runner',
    ]);
    expect(IMAGES_UP_ARGS).toEqual([
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '300',
      '--no-build',
      ...E2E_APP_SERVICES,
    ]);
  });

  it('seeds through the API image with the compiled seed:dev, as the host mode seeds', () => {
    expect(IMAGES_SEED_ARGS).toEqual([
      'run',
      '--rm',
      '--no-deps',
      'migrate',
      'node',
      'dist/commands/seed-dev.js',
      '--json',
      '--mfa-admin',
      '--connect',
    ]);
  });

  it('needs the five production images at the local tag contracts-11c froze', () => {
    expect(E2E_IMAGES).toEqual([
      'openverify/api:11c-local',
      'openverify/dashboard:11c-local',
      'openverify/flow:11c-local',
      'openverify/vision:11c-local',
      'openverify/code-runner:11c-local',
    ]);
  });

  it('names each missing image with the command that builds it', () => {
    const message = missingImagesMessage([
      'openverify/vision:11c-local',
      'openverify/flow:11c-local',
    ]);
    expect(message).toContain('openverify/vision:11c-local');
    expect(message).toContain(
      'docker build --build-context repo=. -t openverify/vision:11c-local services/vision',
    );
    expect(message).toContain(
      'docker build -f infra/docker/flow.Dockerfile -t openverify/flow:11c-local .',
    );
    expect(message).not.toContain('openverify/api:11c-local');
  });

  it('says why healthy containers can be unreachable: Docker Desktop without host networking', () => {
    const message = unreachableImagesMessage('http://127.0.0.1:41000/ready');
    expect(message).toContain('http://127.0.0.1:41000/ready');
    expect(message).toContain('network_mode: host');
    expect(message).toContain('Docker Desktop');
    expect(message).toContain('Enable host networking');
  });
});
