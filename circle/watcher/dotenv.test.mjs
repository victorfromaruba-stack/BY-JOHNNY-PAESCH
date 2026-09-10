import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, loadEnv } from './dotenv.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('a trailing comment is not part of the value — so a switch turned off is really off', () => {
  const e = parseEnv('WATCH_MUST_BEAT_OURS=false   # only post what undercuts\nWATCH_EVERY_MIN=30 # how often');
  assert.equal(e.WATCH_MUST_BEAT_OURS, 'false');
  assert.equal(e.WATCH_EVERY_MIN, '30');
});

test('a quoted value keeps everything inside the quotes, # included', () => {
  const e = parseEnv(`CIRCLE_PASS="p#ss word"\nWATCH_CONTACT='a@b.c # not a comment'\nEMPTY=`);
  assert.equal(e.CIRCLE_PASS, 'p#ss word');
  assert.equal(e.WATCH_CONTACT, 'a@b.c # not a comment');
  assert.equal(e.EMPTY, '');
});

test('comments, blank lines and lower-case junk are ignored', () => {
  const e = parseEnv('# a comment\n\nlower=case\nOK=yes');
  assert.deepEqual(e, { OK: 'yes' });
});

test('the environment wins over the file, and a missing file is nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunto-env-'));
  const f = join(dir, '.env');
  writeFileSync(f, 'WATCH_BROWSER=firefox\nWATCH_INTERVAL=on\n');
  const env = { WATCH_BROWSER: 'chromium' };
  loadEnv(f, env);
  assert.equal(env.WATCH_BROWSER, 'chromium');
  assert.equal(env.WATCH_INTERVAL, 'on');
  assert.deepEqual(loadEnv(join(dir, 'nope'), env), {});
});
