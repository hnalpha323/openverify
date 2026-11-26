/**
 * C46.1: the TypeScript YuNet decoder reproduces OpenCV's `FaceDetectorYN` on the raw outputs the
 * vision service recorded (`contracts/fixtures/vision/yunet-decode.json`, a drawn synthetic face).
 */
import { describe, expect, it } from 'vitest';
import fixture from '../../../../contracts/fixtures/vision/yunet-decode.json';
import {
  YUNET_STRIDES,
  decodeYunet,
  type YunetOutputName,
  type YunetOutputs,
  type YunetStride,
} from './yunet-decode';

const FIXTURE_OPTIONS = {
  paddedWidth: fixture.input.padded_width,
  paddedHeight: fixture.input.padded_height,
  scoreThreshold: fixture.score_threshold,
  nmsThreshold: fixture.nms_threshold,
};

function key(head: 'cls' | 'obj' | 'bbox' | 'kps', stride: YunetStride): YunetOutputName {
  return `${head}_${String(stride)}` as YunetOutputName;
}

/** Outputs of a `size` x `size` padded input with no face anywhere. */
function emptyOutputs(size: number): Record<YunetOutputName, number[]> {
  const outputs = {} as Record<YunetOutputName, number[]>;
  for (const stride of YUNET_STRIDES) {
    const anchors = (size / stride) ** 2;
    outputs[key('cls', stride)] = new Array<number>(anchors).fill(0);
    outputs[key('obj', stride)] = new Array<number>(anchors).fill(0);
    outputs[key('bbox', stride)] = new Array<number>(anchors * 4).fill(0);
    outputs[key('kps', stride)] = new Array<number>(anchors * 10).fill(0);
  }
  return outputs;
}

interface Anchor {
  readonly stride: YunetStride;
  readonly row: number;
  readonly col: number;
  readonly cls: number;
  readonly obj: number;
  readonly bbox?: readonly [number, number, number, number];
}

/** Puts a face on one anchor of a 64 x 64 padded input (8 columns at stride 8). */
function withAnchors(...anchors: readonly Anchor[]): Record<YunetOutputName, number[]> {
  const size = 64;
  const outputs = emptyOutputs(size);
  for (const { stride, row, col, cls, obj, bbox = [0, 0, 0, 0] } of anchors) {
    const index = row * (size / stride) + col;
    outputs[key('cls', stride)][index] = cls;
    outputs[key('obj', stride)][index] = obj;
    outputs[key('bbox', stride)].splice(index * 4, 4, ...bbox);
    outputs[key('kps', stride)].splice(
      index * 10,
      10,
      ...[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    );
  }
  return outputs;
}

const SMALL = { paddedWidth: 64, paddedHeight: 64, scoreThreshold: 0.6, nmsThreshold: 0.3 };

describe('decodeYunet (C46.1)', () => {
  it('reproduces the faces OpenCV found on the golden outputs', () => {
    const faces = decodeYunet(fixture.outputs satisfies YunetOutputs, FIXTURE_OPTIONS);

    expect(faces).toHaveLength(fixture.expected.length);
    faces.forEach((face, index) => {
      const expected = fixture.expected[index];
      expect(expected).toBeDefined();
      face.box.forEach((value, k) => {
        expect(value).toBeCloseTo(expected?.box[k] ?? Number.NaN, 2);
      });
      expect(face.landmarks).toHaveLength(5);
      face.landmarks.forEach(([x, y], k) => {
        expect(x).toBeCloseTo(expected?.landmarks[k]?.[0] ?? Number.NaN, 2);
        expect(y).toBeCloseTo(expected?.landmarks[k]?.[1] ?? Number.NaN, 2);
      });
      expect(face.score).toBeCloseTo(expected?.score ?? Number.NaN, 3);
    });
  });

  it('finds no face where the golden outputs score below the threshold', () => {
    expect(
      decodeYunet(fixture.outputs satisfies YunetOutputs, {
        ...FIXTURE_OPTIONS,
        scoreThreshold: 0.95,
      }),
    ).toEqual([]);
  });

  it('places the box and landmarks on the anchor grid of each stride', () => {
    const bbox = [0.5, 0.25, Math.log(2), Math.log(3)] as const;
    const [face] = decodeYunet(
      withAnchors({ stride: 16, row: 2, col: 1, cls: 0.81, obj: 1, bbox }),
      SMALL,
    );

    // Centre ((col + dx) * stride, (row + dy) * stride), size exp(dw, dh) * stride.
    expect(face?.box[0]).toBeCloseTo(24 - 16, 6);
    expect(face?.box[1]).toBeCloseTo(36 - 24, 6);
    expect(face?.box[2]).toBeCloseTo(32, 6);
    expect(face?.box[3]).toBeCloseTo(48, 6);
    // Landmark k at ((col + kx) * stride, (row + ky) * stride).
    expect(face?.landmarks[0]?.[0]).toBeCloseTo((1 + 0.1) * 16, 6);
    expect(face?.landmarks[0]?.[1]).toBeCloseTo((2 + 0.2) * 16, 6);
    expect(face?.landmarks[4]?.[0]).toBeCloseTo((1 + 0.9) * 16, 6);
    expect(face?.landmarks[4]?.[1]).toBeCloseTo((2 + 1.0) * 16, 6);
    // The score is sqrt(cls * obj).
    expect(face?.score).toBeCloseTo(0.9, 6);
  });

  it('clamps cls and obj to [0, 1] before scoring', () => {
    expect(
      decodeYunet(withAnchors({ stride: 8, row: 0, col: 0, cls: 1.7, obj: 1.2 }), SMALL)[0]?.score,
    ).toBe(1);
    expect(decodeYunet(withAnchors({ stride: 8, row: 0, col: 0, cls: -1, obj: 1 }), SMALL)).toEqual(
      [],
    );
  });

  it('drops a face below the score threshold', () => {
    // sqrt(0.35 * 1) = 0.59 < 0.6
    expect(
      decodeYunet(withAnchors({ stride: 32, row: 1, col: 1, cls: 0.35, obj: 1 }), SMALL),
    ).toEqual([]);
  });

  it('keeps the better of two overlapping faces, and both of two apart, best first', () => {
    const faces = decodeYunet(
      withAnchors(
        { stride: 8, row: 2, col: 2, cls: 0.7, obj: 1, bbox: [0, 0, 1, 1] },
        { stride: 8, row: 2, col: 3, cls: 0.9, obj: 1, bbox: [0, 0, 1, 1] },
        { stride: 8, row: 7, col: 7, cls: 0.8, obj: 1, bbox: [0, 0, 0, 0] },
      ),
      SMALL,
    );

    expect(faces.map((face) => face.score)).toEqual([
      expect.closeTo(Math.sqrt(0.9), 6),
      expect.closeTo(Math.sqrt(0.8), 6),
    ]);
  });

  it('keeps a face whose overlap equals the NMS threshold', () => {
    // Two 8 x 8 boxes side by side touch without overlapping: IoU 0, kept at a threshold of 0.
    const faces = decodeYunet(
      withAnchors(
        { stride: 8, row: 0, col: 0, cls: 0.9, obj: 1 },
        { stride: 8, row: 0, col: 1, cls: 0.8, obj: 1 },
      ),
      { ...SMALL, nmsThreshold: 0 },
    );

    expect(faces).toHaveLength(2);
  });
});
