// A card on Victor's dashboard while Ian, the Circle's concierge, is resting at the club's ceiling.
//
// The ceiling itself is enforced in the database (concierge_allow): past settings.concierge_daily_usd
// for the day, every member is told "Ian is resting until tomorrow" and nothing is spent. This only
// makes sure a person knows, through the same alerts module the watcher's Interval card uses. It reads
// concierge_today() with the watcher's own robot login (no role, no service key), raises the card while
// Ian is resting, and takes it down once he is not: tomorrow, or the minute Victor raises the ceiling.
//
// Run every 10 minutes from cron (see supabase/functions/concierge/DEPLOY.md). Alerting must never
// break anything, so every failure is one log line and an exit.

import { createRequire } from 'node:module';
import { existsSync, statSync, chownSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnv } from './dotenv.mjs';
import { Circle } from './circle.mjs';

loadEnv(new URL('.env', import.meta.url).pathname);
const KEY = 'circle-ian';
try {
  const alerts = createRequire(import.meta.url)(process.env.ALERTS_MODULE || '/home/openclaw/premanifest-bot/alerts.js');
  const circle = new Circle({ url: process.env.CIRCLE_URL, key: process.env.CIRCLE_KEY, username: process.env.CIRCLE_USER, password: process.env.CIRCLE_PASS });
  const t = await circle.rpc('concierge_today', {});
  const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
  if (t?.resting) {
    alerts.raise(KEY, `Ian is resting: ${usd(t.spent_usd)} of the ${usd(t.ceiling_usd)} daily ceiling spent`,
      `Members asking Ian today are told he is resting until tomorrow (${t.turns} turns on ${t.model}). To wake him, raise settings.concierge_daily_usd.`,
      { since: t.resting_since || undefined });
    console.log(`${new Date().toISOString()} resting: card up (${usd(t.spent_usd)} of ${usd(t.ceiling_usd)})`);
  } else {
    if (alerts.clear(KEY)) console.log(`${new Date().toISOString()} awake: card down`);
  }
  // The watcher runs as root; the dashboard reads the file as its owner.
  if (existsSync(alerts.FILE)) { const d = statSync(dirname(alerts.FILE)); chownSync(alerts.FILE, d.uid, d.gid); }
} catch (err) {
  console.log(`${new Date().toISOString()} could not check Ian's ceiling: ${err.message}`);
}
