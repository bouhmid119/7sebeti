import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for provider credentials stored in the database.
 * Format: base64(iv).base64(tag).base64(ciphertext)
 */
export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = parseKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [iv, tag, ciphertext] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !ciphertext) throw new Error('Malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', parseKey(keyBase64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function parseKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}
