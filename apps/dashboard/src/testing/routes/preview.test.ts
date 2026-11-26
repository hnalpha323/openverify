import {
  simulationPresetListDocumentSchema,
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  builtinPreset,
  ownPreset,
  presetList,
  previewDocument,
  previewDocumentWithAssets,
  simulationDocument,
} from './preview';

describe('the preview area’s route fixtures (C156)', () => {
  it('hold the contracts’ shapes', () => {
    expect(templatePreviewDocumentSchema.parse(previewDocument())).toEqual(previewDocument());
    expect(templatePreviewDocumentSchema.parse(previewDocumentWithAssets())).toEqual(
      previewDocumentWithAssets(),
    );
    expect(templateSimulationDocumentSchema.parse(simulationDocument())).toEqual(
      simulationDocument(),
    );
    const presets = presetList([builtinPreset('selfie', 'failed'), ownPreset(), ownPreset(null)]);
    expect(simulationPresetListDocumentSchema.parse(presets)).toEqual(presets);
  });

  it('label every preset synthetic, and give a built-in no values', () => {
    expect(builtinPreset('selfie', 'passed').attributes).toMatchObject({
      label: 'synthetic values only',
      'built-in': true,
      scope: null,
    });
    expect(ownPreset().attributes.label).toBe('synthetic values only');
  });
});
