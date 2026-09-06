// Passwords, for the preview backend that has no server.
//
// When the club runs on Supabase, Supabase holds the passwords and none of this is used —
// see supabase-store.js. This exists so that the browser-only mode is a real lock rather
// than a doorway anyone can walk through, and so a first password can be generated for
// someone without ever writing it down anywhere it could be committed.
//
// PBKDF2-SHA256 at 210,000 iterations, which is the OWASP figure for PBKDF2-HMAC-SHA256.
// The hash lives in localStorage: good enough to stop a passer-by picking up your phone,
// and honest about not being more than that. Real multi-device auth needs the backend.

const ITERATIONS = 210000;
const KEY_BITS = 256;

// No 0/O/1/l/I — the whole point of a generated password is that it can be read off a
// screen and typed on a phone without a mistake.
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * A strong password a person can actually read off a screen and type: four groups of four
 * from an unambiguous alphabet. That is 16 characters over 56 symbols — about 93 bits,
 * far past anything guessable, and it survives being read aloud over the phone.
 */
export function generatePassword(groups = 4, size = 4) {
  const need = groups * size;
  const bytes = new Uint32Array(need);
  crypto.getRandomValues(bytes);
  const chars = [];
  for (let i = 0; i < need; i++) {
    // Rejection-free modulo bias is negligible at 2^32 over 56, but take the high bits anyway.
    chars.push(ALPHABET[Math.floor((bytes[i] / 4294967296) * ALPHABET.length)]);
  }
  return Array.from({ length: groups }, (_, g) => chars.slice(g * size, (g + 1) * size).join('')).join('-');
}

/** How much guessing a password would take, so the form can say something useful. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: '', ok: false };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(s)).length;
  const bits = Math.round(s.length * Math.log2(10 + classes * 16));
  const ok = s.length >= 12;
  const label = !ok ? 'Too short — twelve characters at least'
    : bits < 60 ? 'Workable, but a longer one would be better'
    : bits < 80 ? 'Good' : 'Strong';
  return { score: Math.min(1, bits / 90), label, ok, bits };
}

export async function hashPassword(password, saltB64 = null) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, KEY_BITS);
  return { hash: toB64(bits), salt: saltB64 || toB64(salt), iterations: ITERATIONS, algo: 'PBKDF2-SHA256' };
}

/** Constant-time compare, so a wrong password takes as long as a right one. */
export async function verifyPassword(password, record) {
  if (!record?.hash || !record?.salt) return false;
  const got = await hashPassword(password, record.salt);
  const a = fromB64(got.hash), b = fromB64(record.hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
