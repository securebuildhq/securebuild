export async function encryptPassword(password: string): Promise<string> {
  const secretEncoded = process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
  if (!secretEncoded) {
    throw new Error('EXTERNAL_REGISTRY_ENCRYPTION_SECRET environment variable is required');
  }
  const secret = Buffer.from(secretEncoded, 'base64').toString('utf-8');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(password),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(combined).toString('base64');
}

export async function decryptPassword(encryptedPassword: string): Promise<string> {
  const secretEncoded = process.env.EXTERNAL_REGISTRY_ENCRYPTION_SECRET;
  if (!secretEncoded) {
    throw new Error('EXTERNAL_REGISTRY_ENCRYPTION_SECRET environment variable is required');
  }
  const secret = Buffer.from(secretEncoded, 'base64').toString('utf-8');
  const combined = Buffer.from(encryptedPassword, 'base64');
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const keyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}
