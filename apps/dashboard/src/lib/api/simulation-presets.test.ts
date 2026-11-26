// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import {
  PREVIEW_IDS,
  PRESETS_PATH,
  builtinPreset,
  ownPreset,
  presetList,
} from '../../testing/routes/preview';
import { SESSION_COOKIE } from '../session-cookie';
import {
  createSimulationPreset,
  deleteSimulationPreset,
  listSimulationPresets,
} from './simulation-presets';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the simulation presets API (C156.4)', () => {
  it('lists the built-ins first, then mine, as the API answers', async () => {
    const presets = [builtinPreset('selfie', 'passed'), ownPreset(null)];
    api.replyTo(`GET ${PRESETS_PATH}`, 200, presetList(presets));

    await expect(listSimulationPresets()).resolves.toEqual(presets);
    expect(api.last().path).toBe(`/api/v1${PRESETS_PATH}`);
  });

  it('saves a named scope in the body', async () => {
    const preset = ownPreset();
    api.replyTo(`POST ${PRESETS_PATH}`, 201, { data: preset });
    const scope = { verifications: { id_card: { status: 'failed' as const } } };

    await expect(createSimulationPreset('Synthetic failed capture', scope)).resolves.toEqual(
      preset,
    );
    expect(api.last().body).toEqual({
      data: {
        type: 'simulation-preset',
        attributes: { name: 'Synthetic failed capture', scope },
      },
    });
    expect([...api.last().query]).toEqual([]);
  });

  it('deletes one of mine', async () => {
    api.replyTo(`DELETE ${PRESETS_PATH}/${PREVIEW_IDS.preset}`, 204);

    await expect(deleteSimulationPreset(PREVIEW_IDS.preset)).resolves.toBeUndefined();
  });

  it('never sends a delete for a built-in or a malformed id', async () => {
    await expect(deleteSimulationPreset('builtin:selfie-passed')).rejects.toBeInstanceOf(TypeError);
    await expect(deleteSimulationPreset('ssp_../x')).rejects.toBeInstanceOf(TypeError);
    expect(api.requests).toEqual([]);
  });
});
