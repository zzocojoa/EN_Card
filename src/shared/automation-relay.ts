// This existing Site owns the provider secrets. Never accept a destination from card data.
export const RELAY_ORIGIN = 'https://wordgrain-oxford-study.hoihou-o.chatgpt.site';
export const RELAY_PATH = '/api/card-automation';
const encoder = new TextEncoder();
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, '0')).join('');
const keyBytes = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
async function hmacKey(bytes: Uint8Array<ArrayBuffer>, usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
export async function deriveRelayKey(secret: string, owner: string): Promise<string> {
  if (secret.length < 32 || !owner) throw new Error('RELAY_CONFIG');
  const key = await hmacKey(encoder.encode(secret), ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`en-card:ai-relay:v1:${owner}`)));
}
export async function signedRelayHeaders(
  key: string,
  body: string,
  now = Date.now(),
): Promise<Headers> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('RELAY_CONFIG');
  const time = String(now),
    nonce = crypto.randomUUID();
  const signature = hex(
    await crypto.subtle.sign(
      'HMAC',
      await hmacKey(keyBytes(key), ['sign']),
      encoder.encode(`POST\n${RELAY_PATH}\n${time}\n${nonce}\n${body}`),
    ),
  );
  return new Headers({
    'Content-Type': 'application/json',
    'X-Card-Time': time,
    'X-Card-Nonce': nonce,
    'X-Card-Signature': signature,
  });
}
export async function verifyRelaySignature(
  request: Request,
  body: string,
  key: string,
  now = Date.now(),
): Promise<boolean> {
  if (!validRelayHeaders(request, now) || !/^[a-f0-9]{64}$/.test(key)) return false;
  const time = request.headers.get('X-Card-Time') ?? '';
  const nonce = request.headers.get('X-Card-Nonce') ?? '';
  const signature = request.headers.get('X-Card-Signature') ?? '';
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(keyBytes(key), ['verify']),
    keyBytes(signature),
    encoder.encode(`POST\n${RELAY_PATH}\n${time}\n${nonce}\n${body}`),
  );
}
export function validRelayHeaders(request: Request, now = Date.now()): boolean {
  const time = request.headers.get('X-Card-Time') ?? '';
  const nonce = request.headers.get('X-Card-Nonce') ?? '';
  const signature = request.headers.get('X-Card-Signature') ?? '';
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(now - Number(time)) > 60000 ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return true;
}
