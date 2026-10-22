#!/usr/bin/env node
// IAN LEARNS EVERY NIGHT — the root half. Root's crontab, 06:30 Aruba.
//
// The openclaw half (premanifest-bot/ianCoach.js, 05:00) leaves reviewer-approved learnings lines in
// premanifest-bot/reports/ian/review-<date>.json. This decides whether they reach members:
//
//   1. re-check every approved line here (length, date, no link/email/phone/figure-dump, no
//      instruction-shaped text): the lines are data from another user, never trusted as written
//   2. replay ~30 questions (replay.ts) on the real model with the CANDIDATE learnings.md: the
//      deployed one plus tonight's lines -- or, when no replay of the deployed one exists yet, the
//      deployed one alone, so tomorrow has a baseline
//   3. apply only when the replay is complete and its pass rate on the cases both nights share did
//      not drop against the last replay of what is deployed now; then Ian's unit tests, a commit of
//      learnings.md alone, and `supabase functions deploy concierge`
//
// The eval history the gate reads lives in /root/logs/ian-eval (root's), not in the openclaw
// reports folder, which only gets a copy for the coach and the Monday board.
// Spend: replay.ts refuses when its estimate passes $0.25 (a card says so) and stops mid-run at it.
//
//   node nightly.mjs            the whole thing
//   node nightly.mjs --dry      decide and say what it would do; no replay, no write, no deploy
import { createHash, createDecipheriv } from 'node:crypto';
import { chownSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import process from 'node:process';

const BOT = '/home/openclaw/premanifest-bot';
const IAN = join(BOT, 'reports', 'ian');
const HIST = '/root/logs/ian-eval';
const FN = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(FN, '../../..');
const LEARNINGS = join(FN, 'learnings.md');
const CAP = 0.25;
const MIN_SHARED = 10;
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const arubaDay = (now = Date.now()) => new Date(now - 4 * 36e5).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The approved lines, re-checked here. Anything doubtful is dropped, never repaired. */
export function sanitize(items, day) {
  const dated = `${Number(day.slice(8))} ${MON[Number(day.slice(5, 7)) - 1]}`;
  const out = [];
  for (const it of items || []) {
    if (!it || it.approved !== true || typeof it.line !== 'string') continue;
    let l = it.line.replace(/\s+/g, ' ').trim().replace(/^-\s*/, '');
    if (!l || l.length > 300) continue;
    if (/https?:|www\.|@|\+\d[\d\s().-]{7,}\d|\b\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\b|`|<|>|\$\s?\d/i.test(l)) continue;   // links, contacts, prices, markup
    if (/ignore (all|any|previous|the above)|system prompt|you are now|disregard|override/i.test(l)) continue;
    if (!/^\d{1,2} [A-Z][a-z]{2}/.test(l)) l = `${dated}, from the nightly review: ${l}`;
    out.push(`- ${l}`);
    if (out.length === 5) break;
  }
  return out;
}

/** learnings.md with tonight's lines under their own heading at the end. */
export function withLines(deployed, lines) {
  if (!lines.length) return deployed;
  const head = '## What the nightly review added';
  const base = deployed.includes(head) ? deployed.replace(/\s*$/, '\n') : `${deployed.replace(/\s*$/, '\n')}\n${head}\n\n`;
  return `${base}${lines.join('\n')}\n`;
}

/** The last complete replay of exactly what is deployed. */
export function baselineFor(history, deployedSha) {
  return history.filter((e) => e && e.complete && e.candidateSha === deployedSha).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

/** The gate. Pass rate on the cases both replays ran; no drop, or nothing changes. */
export function decide({ result, baseline, lines }) {
  if (!lines.length) return { apply: false, why: 'nothing approved tonight' };
  if (!baseline) return { apply: false, why: 'no replay of the deployed learnings yet; tonight\'s replay is that baseline, so the lines wait a night' };
  if (!result || !result.complete) return { apply: false, why: 'the replay did not finish (cap or failure)' };
  const prev = new Map(baseline.cases.map((c) => [c.id, c.pass]));
  const shared = result.cases.filter((c) => prev.has(c.id));
  if (shared.length < MIN_SHARED) return { apply: false, why: `only ${shared.length} cases shared with the baseline (need ${MIN_SHARED})` };
  const rate = shared.filter((c) => c.pass).length / shared.length;
  const baseRate = shared.filter((c) => prev.get(c.id)).length / shared.length;
  const r = (x) => `${Math.round(x * 100)}%`;
  return rate >= baseRate
    ? { apply: true, why: `${r(rate)} on ${shared.length} shared cases, against ${r(baseRate)} on ${baseline.date}: no drop`, rate, baseRate, shared: shared.length }
    : { apply: false, why: `${r(rate)} on ${shared.length} shared cases, against ${r(baseRate)} on ${baseline.date}: a drop, so nothing is applied`, rate, baseRate, shared: shared.length };
}

function readJson(p, dflt = null) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return dflt; } }

/** The card path is premanifest-bot's alerts.js, and the dashboard reads the file as openclaw. */
function card(key, title, detail) {
  try {
    const alerts = createRequire(import.meta.url)(join(BOT, 'alerts.js'));
    if (title) alerts.raise(key, title, detail); else alerts.clear(key);
    if (existsSync(alerts.FILE)) { const d = statSync(dirname(alerts.FILE)); chownSync(alerts.FILE, d.uid, d.gid); }
  } catch (e) { log(`could not reach the dashboard: ${e.message}`); }
}

function anthropicKey() {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync('/home/openclaw/.openclaw/agents/main/agent/openclaw-agent.sqlite', { readOnly: true });
  return JSON.parse(db.prepare('select store_json from auth_profile_store where store_key = ?').get('primary').store_json).profiles['anthropic:default'].key;
}

function supabaseToken() {
  const key = readFileSync('/home/openclaw/.premanifest-secret.key');
  const buf = readFileSync(join(BOT, 'credentials', 'openclaw.enc'));
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8').trim();
}

async function main() {
  const dry = process.argv.includes('--dry');
  const day = arubaDay();
  mkdirSync(HIST, { recursive: true, mode: 0o700 });
  const review = readJson(join(IAN, `review-${day}.json`), { items: [] });
  const lines = sanitize(review.items, day);
  const deployed = readFileSync(LEARNINGS, 'utf8');
  const history = readdirSync(HIST).filter((f) => /^eval-.*\.json$/.test(f)).map((f) => readJson(join(HIST, f)));
  const baseline = baselineFor(history, sha(deployed));
  const candidate = baseline ? withLines(deployed, lines) : deployed;
  const cases = (readJson(join(IAN, 'cases.json'), []) || []).filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string' && c.text.length <= 300).slice(0, 16);
  const last = history.filter((e) => e && e.turns).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const perTurn = last ? Math.max(last.costUsd / last.turns, 0.0005) : 0.0013;
  log(`${lines.length} approved line(s) pass the re-check; baseline ${baseline ? baseline.date : 'none'}; replaying ${baseline && lines.length ? 'the candidate' : 'what is deployed'} with ${cases.length} member questions`);
  if (dry) { log('--dry: no replay, nothing written'); return; }

  // 2. the replay, in a scratch folder this job owns
  const tmp = mkdtempSync(join(tmpdir(), 'ian-nightly-'));
  writeFileSync(join(tmp, 'learnings.md'), candidate);
  writeFileSync(join(tmp, 'cases.json'), JSON.stringify(cases));
  const out = join(tmp, 'eval.json');
  const r = spawnSync('deno', ['run', '--allow-read', '--allow-write', '--allow-net=api.anthropic.com', '--allow-env',
    join(FN, 'replay.ts'), '--learnings', join(tmp, 'learnings.md'), '--cases', join(tmp, 'cases.json'), '--out', out,
    '--cap', String(CAP), '--trials', '3', '--estimate', String(perTurn)],
  { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: anthropicKey(), NO_COLOR: '1' }, timeout: 30 * 60e3 });
  log(`replay: ${(r.stdout || '').trim().split('\n').pop()}${r.status ? ` (exit ${r.status}) ${(r.stderr || '').slice(-300)}` : ''}`);
  const result = readJson(out);
  rmSync(tmp, { recursive: true, force: true });
  if (!result) { card('ian-eval', "Ian's nightly replay did not run", (r.stderr || 'no output').slice(-300)); process.exitCode = 1; return; }
  if (result.skipped) card('ian-eval', "Ian's nightly replay was skipped: it would cost more than the cap", `${result.skipped}. Nothing was applied tonight.`);
  else if (!result.complete) card('ian-eval', "Ian's nightly replay stopped at the spending cap", `It stopped at $${result.costUsd} of $${CAP}. Nothing was applied tonight.`);
  else card('ian-eval', null);

  // 3. the gate. The lines were only in the candidate when a baseline existed.
  const tried = baseline ? lines : [];
  const verdict = decide({ result, baseline, lines: tried });
  if (!baseline && lines.length) verdict.why = 'no replay of the deployed learnings yet; tonight\'s replay is that baseline, so the lines wait a night';
  const record = { ...result, lines: tried, baseline: baseline ? baseline.date : null, gate: verdict };
  log(`gate: ${verdict.apply ? 'APPLY' : 'hold'} — ${verdict.why}`);

  if (verdict.apply) {
    writeFileSync(LEARNINGS, candidate);
    const test = spawnSync('deno', ['test', '-A', FN], { cwd: REPO, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 15 * 60e3 });
    if (test.status !== 0) {
      writeFileSync(LEARNINGS, deployed);
      record.gate = { ...verdict, apply: false, why: `${verdict.why}; but Ian's unit tests failed with the new lines, so learnings.md was put back` };
      card('ian-apply', "Ian's new learnings failed his tests and were not applied", (test.stdout || '').split('\n').filter((l) => /FAILED|failed|error/i.test(l)).slice(0, 4).join(' | '));
    } else {
      execFileSync('git', ['-C', REPO, '-c', 'user.name=Ian nightly review', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m', `Ian learned (nightly review ${day})`, '-m', `${lines.join('\n')}\n\nReplay: ${verdict.why}.`, '--', LEARNINGS]);
      const dep = spawnSync('supabase', ['functions', 'deploy', 'concierge', '--project-ref', 'cdkopyphjvfxjqhasrae', '--use-api'],
        { cwd: REPO, encoding: 'utf8', env: { ...process.env, SUPABASE_ACCESS_TOKEN: supabaseToken() }, timeout: 10 * 60e3 });
      record.deployed = dep.status === 0;
      if (dep.status === 0) { card('ian-apply', null); log(`deployed: ${lines.length} line(s) now reach members`); } else {
        card('ian-apply', "Ian's new learnings are committed but NOT deployed",
          `supabase functions deploy failed: ${(dep.stderr || dep.stdout || '').slice(-300)}. Members still get the old file. Redeploy by hand (DEPLOY.md).`);
        process.exitCode = 1;
      }
    }
  }

  // The record: root's copy for the gate, openclaw's copy for the coach and the Monday board.
  writeFileSync(join(HIST, `eval-${day}.json`), JSON.stringify(record, null, 1));
  if (existsSync(IAN)) {
    copyFileSync(join(HIST, `eval-${day}.json`), join(IAN, `eval-${day}.json`));
    const d = statSync(IAN); chownSync(join(IAN, `eval-${day}.json`), d.uid, d.gid);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
