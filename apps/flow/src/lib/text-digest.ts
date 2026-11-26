/**
 * C162.9 (reviews P04, H10, V01): the SHA-256 of a consent text exactly as the person was shown it
 * (placeholders filled), NFC-normalised, as lowercase hex. The server takes its own candidates (the
 * version's custom copy, or every released built-in text in `consent-texts.json`), fills, normalises
 * and hashes them the same way, so the record identifies the words without storing them again.
 */
export async function textSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.normalize('NFC'));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
