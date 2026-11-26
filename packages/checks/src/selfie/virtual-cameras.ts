/**
 * The virtual-camera list of `selfie_liveness_detection` (C43): camera labels that virtual-camera
 * software reports by default. Data, verified names only, each with its source. A match is a
 * risk signal for review (`capture_device_suspicious`), never a failure: several such tools have
 * legitimate uses, and any label can be renamed. Phone-as-webcam apps are not listed, and the
 * names other tools report are left to field data rather than guessed (research §11.1).
 * `docs/checks/selfie.md` copies this list; a test keeps them equal.
 */

export interface VirtualCameraName {
  /** The label, compared case-insensitively after trimming. */
  name: string;
  /** `prefix`: the label starts with `name` (a driver may append a number or a suffix). */
  match: 'exact' | 'prefix';
  /** Where the default label was verified. */
  source: string;
}

export const VIRTUAL_CAMERA_NAMES: readonly VirtualCameraName[] = Object.freeze([
  Object.freeze({
    name: 'OBS Virtual Camera',
    match: 'prefix',
    source:
      'obs-studio @ 95d5223 (release 32.2.2): the Windows DirectShow filter, the macOS camera extension and the Linux v4l2loopback card_label all name it so (research §11.1)',
  }),
  Object.freeze({
    name: 'Dummy video device (0x',
    match: 'prefix',
    source:
      'v4l2loopback @ e27cd86: the default card label "Dummy video device (0x%04X)" when no card_label is set (research §11.1)',
  }),
] satisfies VirtualCameraName[]);

/** The list entry a camera label matches, or `null`. */
export function virtualCameraOf(label: string): VirtualCameraName | null {
  const normalised = label.trim().toLowerCase();
  if (normalised === '') {
    return null;
  }
  return (
    VIRTUAL_CAMERA_NAMES.find((entry) => {
      const name = entry.name.toLowerCase();
      return entry.match === 'exact' ? normalised === name : normalised.startsWith(name);
    }) ?? null
  );
}
