/**
 * C161.3 (the engineering note's 5.4): which of the flow's icons mirror in a right-to-left
 * language. Directional icons (back, next, the chevrons of a progress or a "continue") point along
 * the reading direction, so they flip with `rtl:-scale-x-100`; icons of physical things never do:
 * the selfie pose prompts ("turn left" means the person's own left in every language, so the
 * arrow points the same way on screen in Arabic as in English), the camera, check marks, document
 * outlines, logos and the QR code. Every icon the flow draws names its kind with `data-icon` and
 * takes its class from `iconDirectionClass` (`icon-direction.test.tsx` holds the source to it):
 *
 *     <svg data-icon="back" className={iconDirectionClass('back')} aria-hidden="true">…</svg>
 */
export const FLOW_ICONS = [
  'back',
  'next',
  'chevron-start',
  'chevron-end',
  'pose-left',
  'pose-right',
  'pose-center',
  'camera',
  'check',
  'document-outline',
  'logo',
  'qr-code',
] as const;
export type FlowIcon = (typeof FLOW_ICONS)[number];

/** The class that mirrors a directional icon when the page is right to left (`<html dir="rtl">`). */
export const MIRRORED_ICON_CLASS = 'rtl:-scale-x-100';

const MIRRORED: ReadonlySet<FlowIcon> = new Set<FlowIcon>([
  'back',
  'next',
  'chevron-start',
  'chevron-end',
]);

/** Whether `icon` points along the reading direction, and so mirrors right to left. */
export function isMirroredIcon(icon: FlowIcon): boolean {
  return MIRRORED.has(icon);
}

/** The class an icon of kind `icon` takes: the mirroring class, or none. */
export function iconDirectionClass(icon: FlowIcon): string {
  return isMirroredIcon(icon) ? MIRRORED_ICON_CLASS : '';
}
