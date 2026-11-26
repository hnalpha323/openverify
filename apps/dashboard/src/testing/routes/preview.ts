/**
 * C156 (Workflow 9C, `dashboard-preview`): the console route fixtures of the preview area, for the
 * route-matching API of `testing/api-routes.ts`. Every value is synthetic: step ids, copy, colours
 * and preset names are invented, and no preset holds a person's value.
 *
 *     const api = routeApi();
 *     previewRoutes(api);                      // preview, simulate and the presets of IDS.draft
 *     api.on('POST', previewPath(), 200, previewDocument({ locale: 'en-XA' }));
 */
import type {
  SimulationPresetResource,
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
} from '@openverify/contracts';
import type { z } from 'zod';
import type { RouteApi } from '../api-routes';
import { LIFECYCLE_IDS } from '../lifecycle-fixtures';

export type TemplatePreviewDocument = z.output<typeof templatePreviewDocumentSchema>;
export type TemplateSimulationDocument = z.output<typeof templateSimulationDocumentSchema>;

export const PREVIEW_IDS = {
  template: LIFECYCLE_IDS.template,
  version: LIFECYCLE_IDS.draft,
  logo: 'tsa_01JB0000000000000000000P01',
  font: 'tsa_01JB0000000000000000000P02',
  themeSet: 'theset_01JB0000000000000000000P01',
  preset: 'ssp_01JB0000000000000000000P01',
} as const;

export const previewPath = (versionId: string = PREVIEW_IDS.version) =>
  `/inquiry-template-versions/${versionId}/preview`;
export const simulatePath = (versionId: string = PREVIEW_IDS.version) =>
  `/inquiry-template-versions/${versionId}/simulate`;
export const PRESETS_PATH = '/dashboard/simulation-presets';
export const assetContentPath = (assetId: string) => `/theme-sets/assets/${assetId}/content`;

/** The built-in light palette's twelve tokens (`BUILTIN_PALETTES.light`), as hex. */
export const PREVIEW_LIGHT_PALETTE = {
  primary: '#1447e6',
  'primary-hover': '#193cb8',
  'on-primary': '#ffffff',
  danger: '#c10007',
  'danger-hover': '#9f0712',
  surface: '#ffffff',
  canvas: '#f9fafb',
  ink: '#101828',
  'ink-muted': '#4a5565',
  line: '#d1d5dc',
  control: '#6a7282',
  focus: '#000000',
} as const;

type PreviewAttributes = TemplatePreviewDocument['data']['attributes'];

/** A preview of a draft with a consent, an ID capture, a screen and a completion. */
export function previewDocument(
  attributes: Partial<PreviewAttributes> = {},
  versionId: string = PREVIEW_IDS.version,
): TemplatePreviewDocument {
  return {
    data: {
      type: 'inquiry-template-preview',
      id: versionId,
      attributes: {
        locale: 'en',
        'spec-version': 2,
        steps: [
          { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
          {
            id: 'id_card',
            type: 'government_id',
            sides: 'front',
            maxAttempts: 1,
            captureMethods: ['camera'],
          },
          {
            id: 'extra_details',
            type: 'screen',
            components: [
              { id: 'title', kind: 'text', variant: 'title', copyKey: 'extra_details.title.body' },
              { id: 'go', kind: 'button', labelKey: 'extra_details.go.button', action: 'submit' },
            ],
          },
          { id: 'done', type: 'completion' },
        ],
        theme: {
          'theme-set-id': null,
          revision: null,
          mode: 'light',
          light: { ...PREVIEW_LIGHT_PALETTE },
          dark: null,
          radius: 8,
          font: { kind: 'system', platforms: ['web', 'android'] },
          logo: null,
          placement: 'header',
        },
        contrast: { status: 'passed', findings: [] },
        copy: { 'extra_details.title.body': 'A few more details' },
        guidance: { id_card: { sides: ['front'] } },
        ...attributes,
      },
    },
  };
}

/** The same preview with an uploaded logo and font. */
export function previewDocumentWithAssets(): TemplatePreviewDocument {
  const document = previewDocument();
  return previewDocument({
    theme: {
      ...document.data.attributes.theme,
      'theme-set-id': PREVIEW_IDS.themeSet,
      revision: 3,
      font: { kind: 'uploaded', 'asset-id': PREVIEW_IDS.font, platforms: ['web'] },
      logo: { 'asset-id': PREVIEW_IDS.logo, 'alt-key': 'brand.logo.alt', decorative: false },
    },
  });
}

type SimulationAttributes = TemplateSimulationDocument['data']['attributes'];
type SimulatedStep = SimulationAttributes['steps'][number];

const step = (stepId: string, stepType: string, extra: Partial<SimulatedStep> = {}) => ({
  'step-id': stepId,
  'step-type': stepType,
  port: 'next',
  route: null,
  waited: false,
  notes: [],
  facts: [],
  ...extra,
});

/**
 * A simulated path through a branch whose fact was null: `onNull` sent it to the fallback route,
 * then a completion that needs review.
 */
export function simulationDocument(
  attributes: Partial<SimulationAttributes> = {},
  versionId: string = PREVIEW_IDS.version,
): TemplateSimulationDocument {
  return {
    data: {
      type: 'inquiry-template-simulation',
      id: versionId,
      attributes: {
        simulated: true,
        steps: [
          step('consent', 'consent'),
          step('id_card', 'government_id', { port: 'exhausted' }),
          step('age_route', 'branch', {
            port: 'route:fallback',
            route: {
              key: 'fallback',
              'condition-result': null,
              'on-null': 'route:fallback',
              'null-paths': ['verifications.id_card.age-years'],
            },
            notes: ['on-null-route'],
            facts: [
              {
                path: 'verifications.id_card.age-years',
                tier: 'R/H',
                stage: 'beta',
                source: 'verification',
              },
            ],
          }),
          step('wait_review', 'action', { waited: true }),
          step('done', 'completion', { port: null }),
        ],
        outcome: {
          status: 'needs_review',
          'flow-outcome': {
            'verification-types-on-path': ['government-id'],
            'fallbacks-taken': ['age_route'],
            flags: ['unverified-path:age_route'],
          },
        },
        halted: null,
        ...attributes,
      },
    },
  };
}

/** A built-in preset: its scope is `null` (the API keeps the built-ins' values to itself). */
export function builtinPreset(type: string, result: 'passed' | 'failed'): SimulationPresetResource {
  return {
    type: 'simulation-preset',
    id: `builtin:${type}-${result}`,
    attributes: {
      name: `Synthetic ${type.replaceAll('-', ' ')} ${result === 'passed' ? 'passes' : 'fails'}`,
      label: 'synthetic values only',
      'built-in': true,
      scope: null,
      'created-at': null,
    },
  };
}

/** One of the operator's own presets; its scope is `null` when the reader lacks `pii:view`. */
export function ownPreset(
  scope: SimulationPresetResource['attributes']['scope'] = {
    verifications: { id_card: { status: 'failed' } },
    device: { kind: 'mobile-web' },
  },
  id: string = PREVIEW_IDS.preset,
  name = 'Synthetic failed capture on a phone',
): SimulationPresetResource {
  return {
    type: 'simulation-preset',
    id,
    attributes: {
      name,
      label: 'synthetic values only',
      'built-in': false,
      scope,
      'created-at': '2026-10-20T04:35:00.000Z',
    },
  };
}

export const presetList = (presets: readonly SimulationPresetResource[]) => ({
  data: presets,
  links: { next: null },
});

/** Registers the preview area's routes for `versionId` with passing synthetic answers. */
export function previewRoutes(api: RouteApi, versionId: string = PREVIEW_IDS.version): RouteApi {
  return api
    .on('POST', previewPath(versionId), 200, previewDocument({}, versionId))
    .on('POST', simulatePath(versionId), 200, simulationDocument({}, versionId))
    .on(
      'GET',
      PRESETS_PATH,
      200,
      presetList([
        builtinPreset('government-id', 'passed'),
        builtinPreset('government-id', 'failed'),
        ownPreset(),
      ]),
    );
}
