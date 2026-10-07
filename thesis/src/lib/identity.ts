/**
 * Who is asking, without asking anyone to sign up.
 *
 * Every visitor gets an id on their first request, carried in an httpOnly
 * cookie signed with HMAC-SHA256. Nothing is stored server-side to create it:
 * the signature is what makes the id trustworthy, so a forged or edited cookie
 * is simply treated as absent and replaced.
 *
 * There is no login screen on purpose. A judge or a first-time visitor clicks
 * the link and lands on a working desk; a wall in front of it means most of
 * them never see the product. The id is upgraded to a portable identity by
 * connecting Telegram (see telegram/signin.ts), not by a form.
 *
 * Web Crypto only, so the same code runs in the proxy and in route handlers.
 */

export const IDENTITY_COOKIE = 'thesis_uid';

/** A year. The id is the only key to a person's theses on this browser. */
export const IDENTITY_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Owner ids start with this, which is how a legacy browser id is told apart. */
export const OWNER_PREFIX = 'u_';

export function isOwnerId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^u_[A-Za-z0-9_-]{16,64}$/.test(value);
}

export function newOwnerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return OWNER_PREFIX + base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * THESIS_SESSION_SECRET when set. Otherwise derived from a secret the
 * deployment already holds, so turning this on did not need a new variable
 * before it could ship. Set THESIS_SESSION_SECRET to rotate it independently.
 */
function secret(): string {
  const explicit = process.env.THESIS_SESSION_SECRET;
  if (explicit) return explicit;
  const borrowed =
    process.env.TG_WEBHOOK_SECRET ??
    process.env.RECHECK_SECRET ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN;
  if (borrowed) return `thesis-identity:${borrowed}`;
  // Local development with no secrets at all. Ids still work; they are just
  // forgeable, which on a laptop with no shared store does not matter.
  return 'thesis-identity:development-only';
}

let keyPromise: Promise<CryptoKey> | null = null;
let keyFor: string | null = null;

function hmacKey(): Promise<CryptoKey> {
  const s = secret();
  if (!keyPromise || keyFor !== s) {
    keyFor = s;
    keyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(s),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }
  return keyPromise;
}

async function mac(id: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(id));
  return base64url(new Uint8Array(sig));
}

/** `id.signature`, the cookie's value. */
export async function signOwnerId(id: string): Promise<string> {
  return `${id}.${await mac(id)}`;
}

/** The id inside a cookie value, or null if it is missing, malformed or forged. */
export async function verifyOwnerCookie(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!isOwnerId(id)) return null;
  const expected = await mac(id);
  // Length first, then a constant-time compare: the signature must not be
  // guessable one character at a time from response timing.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? id : null;
}

export const IDENTITY_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: IDENTITY_MAX_AGE_S,
};

/** Read the caller's id from a raw Cookie header. For route handlers. */
export async function ownerFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === IDENTITY_COOKIE) return verifyOwnerCookie(decodeURIComponent(rest.join('=')));
  }
  return null;
}
