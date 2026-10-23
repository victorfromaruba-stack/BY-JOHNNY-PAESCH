import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store, emptyState } from './store.js';

const mk = () => { const s = new Store(); s.state = emptyState(); s.state.members = [{ id: 'm1', name: 'Ana Test', status: 'active' }, { id: 'm2', name: 'Luis Test', status: 'active' }]; s.commit = async () => {}; return s; };

test('a new watch e-mails by default; the member can switch it off, pause it, and only the member can', async () => {
  const s = mk();
  const w = await s.addWatch({ memberId: 'm1', from: '2026-11-10', to: '2026-11-25', nights: 5 });
  assert.equal(w.emailMe, true); assert.equal(w.paused, false);
  assert.equal((await s.addWatch({ memberId: 'm1', from: '2026-12-01', to: '2026-12-09', nights: 5, emailMe: false })).emailMe, false);
  await s.setWatch(w.id, 'm1', { emailMe: false }); assert.equal(s.watch(w.id).emailMe, false);
  await s.setWatch(w.id, 'm1', { paused: true }); assert.equal(s.watch(w.id).paused, true); assert.equal(s.watch(w.id).emailMe, false);
  await assert.rejects(s.setWatch(w.id, 'm2', { paused: false }), /not your watch/);
});

test('the migration: the toggle defaults on, the target list is the watcher\'s alone and carries a first name, not the member row', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261028_watch_mail.sql', import.meta.url), 'utf8');
  assert.match(sql, /email_me boolean not null default true/);
  for (const fn of ['watch_mail_targets', 'watch_mail_sent', 'log_watch_mail']) {
    assert.ok(sql.slice(sql.indexOf(`function ${fn}`), sql.indexOf(`function ${fn}`) + 400).includes('current_is_bot()'), `${fn} is the watcher's alone`);
    assert.match(sql, new RegExp(`revoke all on function ${fn}`));
  }
  assert.match(sql, /split_part\(trim\(m\.name\), ' ', 1\)/);
  assert.match(sql, /not w\.paused/);
  assert.match(sql, /p_member <> |w\.member_id <> current_member_id\(\)/);
});
