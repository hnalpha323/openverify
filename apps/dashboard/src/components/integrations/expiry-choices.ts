/**
 * When an API key expires, as the console offers it (C12 `expire` takes 0 to 30 days in
 * seconds). Shared by the key form, the expire dialog and the server actions that check them.
 */
export interface ExpiryChoice {
  readonly seconds: number;
  readonly label: string;
}

export const EXPIRY_CHOICES: readonly ExpiryChoice[] = [
  { seconds: 60 * 60, label: 'In 1 hour' },
  { seconds: 24 * 60 * 60, label: 'In 1 day' },
  { seconds: 7 * 24 * 60 * 60, label: 'In 7 days' },
  { seconds: 30 * 24 * 60 * 60, label: 'In 30 days' },
];

/** `expire` with 0 seconds: the key stops working at once. */
export const EXPIRE_NOW: ExpiryChoice = { seconds: 0, label: 'Now' };

/**
 * The creation form's choice of an expiry at a date and time (UTC), posted as `expires-at`; the
 * action turns it into `expires-in-seconds` (C25.5).
 */
export const CUSTOM_EXPIRY = 'custom';

/**
 * C169.1: how long a rotated key's old token keeps working, as the rotation offers it (0 to 30
 * days, `API_KEY_ROTATE_PREVIOUS_MAX_SECONDS`): now, or after one of the expiry choices.
 */
export const ROTATION_CHOICES: readonly number[] = [
  EXPIRE_NOW.seconds,
  ...EXPIRY_CHOICES.map((choice) => choice.seconds),
];
