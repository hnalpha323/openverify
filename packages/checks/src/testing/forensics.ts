/** Test helpers: the golden card with its forensic scores changed. Test-only. */
import type { ForensicsInput } from '../phase1/inputs.js';
import { goldenAnalysis, type FullAnalysis } from './fixtures.js';

type Patch = Partial<Omit<ForensicsInput, 'chroma' | 'exif' | 'jpeg'>> & {
  chroma?: Partial<ForensicsInput['chroma']>;
  exif?: Partial<ForensicsInput['exif']>;
  jpeg?: Partial<NonNullable<ForensicsInput['jpeg']>> | null;
};

/** The golden card, its front forensics patched (`null` removes them); the back's too if given. */
export function withForensics(front: Patch | null, back?: Patch | null): FullAnalysis {
  const analysis = goldenAnalysis();
  const apply = (forensics: ForensicsInput | null, patch: Patch | null | undefined) => {
    if (patch === undefined) {
      return forensics;
    }
    if (patch === null || forensics === null) {
      return null;
    }
    const { chroma, exif, jpeg, ...rest } = patch;
    return {
      ...forensics,
      ...rest,
      chroma: { ...forensics.chroma, ...chroma },
      exif: { ...forensics.exif, ...exif },
      jpeg: jpeg === null ? null : forensics.jpeg === null ? null : { ...forensics.jpeg, ...jpeg },
    };
  };
  analysis.sides.front.forensics = apply(analysis.sides.front.forensics, front);
  if (analysis.sides.back !== null) {
    analysis.sides.back.forensics = apply(analysis.sides.back.forensics, back);
  }
  return analysis;
}
