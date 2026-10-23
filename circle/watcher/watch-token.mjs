// The signed "stop these e-mails" token (checked by supabase/functions/watch-unsub). Same HMAC, same 40 hex.
import { createHmac, timingSafeEqual } from 'node:crypto';
export const signMember = (memberId, key) => `${memberId}.${createHmac('sha256', key).update(`watch-unsub:${memberId}`).digest('hex').slice(0, 40)}`;
export function verifyToken(token, key) {
  const [id, mac] = String(token || '').split('.');
  if (!id || !mac) return null;
  const want = Buffer.from(signMember(id, key).split('.')[1]), got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
