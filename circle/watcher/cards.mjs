// The card on Victor's dashboard, through premanifest-bot's alerts module: one file for everything
// that needs a person, one entry per source. That module is CommonJS in a directory only openclaw
// (and root) can open, so this reaches it by path. The service runs as root, and a root write
// would leave needs-human.json owned by root for the next writer, so the file is handed back to
// the directory's owner. A card that cannot be put up is said in the log and never stops the pass:
// alerting must not break the thing it alerts about.
//
// It was putCard() in index.mjs. It is a module because the Interval scan raises a card too, and
// its proof has to be able to point ALERTS_MODULE at a stand-in and read the card back.

import { createRequire } from 'node:module';
import { statSync, chownSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** Put up the card for `key`, or take it down when `card` is falsy. Read at call time, so the env can move. */
export function putCard(key, card, log = () => {}) {
  try {
    const alerts = createRequire(import.meta.url)(process.env.ALERTS_MODULE || '/home/openclaw/premanifest-bot/alerts.js');
    if (card) alerts.raise(key, card.title, card.detail, { since: card.since });
    else alerts.clear(key);
    if (existsSync(alerts.FILE)) { const d = statSync(dirname(alerts.FILE)); chownSync(alerts.FILE, d.uid, d.gid); }
  } catch (err) { log(`  could not reach the alerts module (${err.message}) — no card either way`); }
}
