/**
 * `selfie_multiple_faces_detection` (v2, R, fraud, C43): on any prompted pose, a second face whose
 * box area is at least `min-secondary-face-area-ratio` of the primary face's fails
 * (`multiple_faces_present`). Boxes overlapping at IoU above 0.3 are merged first (one face
 * detected twice), and the area floor keeps distant bystanders and posters out. A pose without a
 * face has no second face (`selfie_image_quality_detection` reports it). A missing prompted file
 * answers `input_missing` unless another pose failed.
 */
import type { CheckResult } from '@openverify/core';
import type { VisionFaceInput } from '../phase1/inputs.js';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import type { SelfiePose } from './inputs.js';
import { byPose } from './values.js';

const CHECK_ID = 'selfie_multiple_faces_detection';
const KEY = 'min-secondary-face-area-ratio';
/** Boxes overlapping more than this are one face (C43). */
export const FACE_MERGE_IOU = 0.3;

type Rect = readonly [left: number, top: number, right: number, bottom: number];

const rectOf = ({ bbox }: VisionFaceInput): Rect => {
  const [x = 0, y = 0, width = 0, height = 0] = bbox;
  return [x, y, x + Math.max(0, width), y + Math.max(0, height)];
};
const areaOf = ([left, top, right, bottom]: Rect): number =>
  Math.max(0, right - left) * Math.max(0, bottom - top);

function iou(a: Rect, b: Rect): number {
  const overlap = areaOf([
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ]);
  const union = areaOf(a) + areaOf(b) - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/** The detected faces with overlapping boxes merged, largest first. */
export function mergeFaceBoxes(faces: readonly VisionFaceInput[]): VisionFaceInput[] {
  const kept: VisionFaceInput[] = [];
  const bySize = [...faces].sort((a, b) => areaOf(rectOf(b)) - areaOf(rectOf(a)));
  for (const face of bySize) {
    if (!kept.some((other) => iou(rectOf(other), rectOf(face)) > FACE_MERGE_IOU)) {
      kept.push(face);
    }
  }
  return kept;
}

/** Whether a pose shows a second face at least `ratio` of the primary face's area. */
function hasSecondFace(faces: readonly VisionFaceInput[], ratio: number): boolean {
  const [primary, ...others] = mergeFaceBoxes(faces);
  const primaryArea = primary === undefined ? 0 : areaOf(rectOf(primary));
  return primaryArea > 0 && others.some((face) => areaOf(rectOf(face)) / primaryArea >= ratio);
}

export function selfieMultipleFacesDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, [KEY], models === undefined ? {} : { models });
  const ratio = numberIn(config, KEY) ?? 0;
  const { prompts } = context.cascade;
  const missing: SelfiePose[] = prompts.filter((pose) => poseAnalysisOf(context, pose) === null);
  const withSecondFace = prompts.filter((pose) => {
    const entry = poseAnalysisOf(context, pose);
    return entry !== null && hasSecondFace(entry.faces, ratio);
  });
  const metadata = {
    face_count: poseAnalysisOf(context, 'center')?.faces.length ?? 0,
    'face-counts': byPose(prompts, (pose) => poseAnalysisOf(context, pose)?.faces.length),
  };
  if (withSecondFace.length > 0) {
    return checkResult(
      CHECK_ID,
      'failed',
      ['multiple_faces_present'],
      { ...metadata, 'secondary-face-poses': withSecondFace },
      options,
    );
  }
  if (missing.length > 0) {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['input_missing'],
      { ...metadata, 'missing-poses': missing },
      options,
    );
  }
  return checkResult(CHECK_ID, 'passed', [], metadata, options);
}
