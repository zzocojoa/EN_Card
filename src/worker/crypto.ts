import { appError } from './types';

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(''));
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export function randomToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function digest(value: string, secret: string): Promise<string> {
  if (secret.length < 32)
    throw appError(503, 'SECRET_CONFIG', 'SESSION_SECRET에 32자 이상의 난수를 설정하세요.');
  const key: CryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))),
  );
}
async function encryptionKey(secret: string): Promise<CryptoKey> {
  const bytes: Uint8Array<ArrayBuffer> = base64ToBytes(secret);
  if (bytes.length !== 32)
    throw appError(
      503,
      'SECRET_CONFIG',
      'TOKEN_ENCRYPTION_KEY는 base64로 인코딩한 32바이트 키여야 합니다.',
    );
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value: string, secret: string): Promise<string> {
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
  const cipher: ArrayBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('en-card:credentials:v1') },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}
export async function decrypt(value: string, secret: string): Promise<string> {
  const parts: string[] = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw appError(
      503,
      'TOKEN_CIPHER',
      '저장된 토큰 형식이 잘못되었습니다. 카카오 연결을 다시 설정하세요.',
    );
  const plain: ArrayBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(parts[0]),
      additionalData: new TextEncoder().encode('en-card:credentials:v1'),
    },
    await encryptionKey(secret),
    base64ToBytes(parts[1]),
  );
  return new TextDecoder().decode(plain);
}
