// .env, read plainly. No dependency for a dozen lines of parsing.
//
// Shared by the watcher and its tests, so a test picks up the same WATCH_BROWSER the service
// runs with rather than a default the box does not have. Values already in the environment
// win over the file, the way a shell override should.
//
// The trailing comments matter: .env.example writes `WATCH_MUST_BEAT_OURS=true   # only post…`,
// and taking the rest of the line whole would make the value "false   # …", which is not the
// string "false" — so turning a switch off would silently leave it on. An unquoted value ends
// at the first #; a quoted one keeps whatever is inside the quotes.

import { readFileSync, existsSync } from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const raw = m[2].trim();
    const quoted = raw.match(/^(["'])([\s\S]*?)\1/);
    out[m[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
  }
  return out;
}

/** Read `file` into `env` (process.env by default) without overwriting what is already set. */
export function loadEnv(file, env = process.env) {
  if (!existsSync(file)) return {};
  const read = parseEnv(readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(read)) if (!env[k]) env[k] = v;
  return read;
}
