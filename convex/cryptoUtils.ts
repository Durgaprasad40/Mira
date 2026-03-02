/**
 * Crypto utilities for private room password handling.
 * Uses Web Crypto API (SHA-256 hashing, AES-256-GCM encryption).
 * Compatible with Convex runtime (no Node APIs).
 */

// Environment variable for encryption key (must be 32 bytes / 64 hex chars)
// Access via process.env in Convex runtime
const getPrivateRoomSecret = (): string => {
  const secret = process.env.PRIVATE_ROOM_SECRET;
  if (!secret) {
    throw new Error(
      '[CRYPTO] PRIVATE_ROOM_SECRET environment variable is not set. ' +
      'Please configure it in your Convex dashboard (Settings > Environment Variables). ' +
      'It must be a 64-character hex string (32 bytes).'
    );
  }
  if (secret.length !== 64) {
    throw new Error(
      '[CRYPTO] PRIVATE_ROOM_SECRET must be exactly 64 hex characters (32 bytes). ' +
      `Current length: ${secret.length}`
    );
  }
  return secret;
};

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Hash a password using SHA-256.
 * Returns hex-encoded hash.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const attemptHash = await hashPassword(password);
  return attemptHash === storedHash;
}

/**
 * Get the encryption key as CryptoKey.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = getPrivateRoomSecret();
  const keyBytes = hexToBytes(secret);
  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a password using AES-256-GCM.
 * Returns a JSON string containing iv and ciphertext (with authTag appended).
 */
export async function encryptPassword(password: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(password);

  // Web Crypto GCM mode appends authTag to ciphertext
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return JSON.stringify({
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  });
}

/**
 * Decrypt an encrypted password.
 * Input is the JSON string from encryptPassword.
 * Returns the original password.
 */
export async function decryptPassword(encryptedData: string): Promise<string> {
  const key = await getEncryptionKey();
  const { iv, ciphertext } = JSON.parse(encryptedData);

  const ivBytes = base64ToBytes(iv);
  const ciphertextBytes = base64ToBytes(ciphertext);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
    key,
    ciphertextBytes.buffer as ArrayBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
