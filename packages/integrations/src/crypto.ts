import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Envelope encryption.
 *
 * - Master keys live outside the database, as a keyring "v1:<base64>;v2:<base64>" (last = current).
 *   Separate keyrings are used for integration secrets (ENCRYPTION_KEY) and personal data
 *   (DATA_MASTER_KEY), so one leak does not open the other.
 * - Each organization has its own data key, stored wrapped by the data master key.
 *   Deleting that wrapped key makes the organization's encrypted data unreadable.
 *
 * Ciphertext format: <keyId>.<base64 iv>.<base64 tag>.<base64 ciphertext> (AES-256-GCM).
 */

export interface Keyring {
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

export function parseKeyring(spec: string): Keyring {
  const entries = spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf(':');
      // A bare base64 key (no "id:") is accepted as version v1.
      const [id, b64] = sep === -1 ? ['v1', entry] : [entry.slice(0, sep), entry.slice(sep + 1)];
      return [id, decodeKey(b64)] as const;
    });
  const last = entries.at(-1);
  if (!last) throw new Error('Empty keyring');
  return { current: { id: last[0], key: last[1] }, byId: new Map(entries) };
}

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('Encryption keys must be 32 bytes, base64-encoded');
  return key;
}

export function encryptWithKey(plaintext: Buffer, key: Buffer, keyId = 'k'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [keyId, ...[iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64'))].join('.');
}

export function decryptWithKey(payload: string, key: Buffer): Buffer {
  const [, iv, tag, ciphertext] = payload.split('.').map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64')));
  if (!(iv instanceof Buffer) || !(tag instanceof Buffer) || !(ciphertext instanceof Buffer)) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptWithKeyring(plaintext: Buffer, keyring: Keyring): string {
  return encryptWithKey(plaintext, keyring.current.key, keyring.current.id);
}

export function decryptWithKeyring(payload: string, keyring: Keyring): Buffer {
  const keyId = payload.slice(0, payload.indexOf('.'));
  const key = keyring.byId.get(keyId);
  if (!key) throw new Error(`Unknown key id "${keyId}"`);
  return decryptWithKey(payload, key);
}

/** Integration credentials (OAuth tokens…), encrypted with the secrets keyring. */
export function encryptSecret(plaintext: string, keyringSpec: string): string {
  return encryptWithKeyring(Buffer.from(plaintext, 'utf8'), parseKeyring(keyringSpec));
}

export function decryptSecret(payload: string, keyringSpec: string): string {
  return decryptWithKeyring(payload, parseKeyring(keyringSpec)).toString('utf8');
}

// ─── Organization data keys ─────────────────────────────────────────────────

export function generateWrappedDataKey(masterKeyring: Keyring): string {
  return encryptWithKeyring(randomBytes(32), masterKeyring);
}

export function unwrapDataKey(wrapped: string, masterKeyring: Keyring): Buffer {
  return decryptWithKeyring(wrapped, masterKeyring);
}

/** Encrypt personal data (customer name…) with an organization data key. */
export function encryptField(value: string, dataKey: Buffer): string {
  return encryptWithKey(Buffer.from(value, 'utf8'), dataKey, 'org');
}

export function decryptField(payload: string, dataKey: Buffer): string {
  return decryptWithKey(payload, dataKey).toString('utf8');
}

/** Raw payloads are compressed first (ciphertext does not compress), then encrypted. */
export function sealPayload(value: unknown, dataKey: Buffer): string {
  return encryptWithKey(gzipSync(Buffer.from(JSON.stringify(value), 'utf8')), dataKey, 'org');
}

export function openPayload(payload: string, dataKey: Buffer): unknown {
  return JSON.parse(gunzipSync(decryptWithKey(payload, dataKey)).toString('utf8'));
}

/**
 * Keyed hash of a phone number, scoped to one organization: the same customer matches
 * across that merchant's orders, but hashes cannot be joined across merchants.
 */
export function hashPhone(normalizedPhone: string, dataKey: Buffer): string {
  const hmacKey = Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), 'phone-hmac', 32));
  return createHmac('sha256', hmacKey).update(normalizedPhone).digest('hex');
}

// ─── Fingerprints ───────────────────────────────────────────────────────────

/** JSON with sorted keys, so semantically equal payloads hash the same. */
export function canonicalJson(value: unknown, ignoreKeys: ReadonlySet<string> = new Set()): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .filter((k) => !ignoreKeys.has(k))
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

export function payloadHash(value: unknown, ignoreKeys?: ReadonlySet<string>): string {
  return createHash('sha256').update(canonicalJson(value, ignoreKeys)).digest('hex');
}
