# Ian (the concierge): deploy

Live on project `cdkopyphjvfxjqhasrae` since 22 Oct 2026. Run from `circle/`.
The access token is the `openclaw` secret in the web app's locked box. Pass it only as
`SUPABASE_ACCESS_TOKEN` for the one command that needs it.

1. **SQL.** `supabase/migrations/20261023_concierge.sql`, then `20261024_ian_fixes.sql`. Both are safe to run twice.
   Apply the second and deploy the function back to back: the gate's signature changes, so the old function
   and the new gate (or the reverse) answer "not switched on" until both are in.
   Paste it into the SQL editor, or POST it as `{"query": …}` to
   `https://api.supabase.com/v1/projects/cdkopyphjvfxjqhasrae/database/query`.
2. **Function.** `supabase functions deploy concierge --project-ref cdkopyphjvfxjqhasrae --use-api`.
   `supabase/config.toml` lists `learnings.md` as a static file. Without that line Ian runs with no
   house knowledge, and the dry run (`{dryRun: true}`) reports `learnings_chars: 0`.
   **Redeploy after any change to `learnings.md` or `prompt.ts`.**
3. **Key.** `ANTHROPIC_API_KEY` (the WhatsApp bot's `anthropic:default` key). The CLI's
   `secrets set` takes it as a plain argument, so use the Management API instead:
   `POST /v1/projects/cdkopyphjvfxjqhasrae/secrets` with `[{"name":"ANTHROPIC_API_KEY","value":…}]`.
   Until the key is set, the app says "Ian is not switched on yet."
4. **Log key.** Only the function may log what a turn cost (`log_concierge_turn` checks an HMAC).
   Make one random 64-hex key and put the same value in two places, without printing it: the
   `concierge_key` row (`insert into concierge_key(id, secret) values (1, '<key>') on conflict (id)
   do update set secret = excluded.secret`) and the function secret `CONCIERGE_LOG_KEY`. If either
   is missing, Ian answers "not switched on yet" and nothing is spent.
5. **Dashboard card.** Add this to root's crontab:
   `*/10 * * * * cd /root/circle/circle/watcher && /usr/bin/node concierge-card.mjs >> /var/log/circle-ian-card.log 2>&1`

Settings live in the `settings` row:
- `concierge_model`: `claude-haiku-5-5` (the default) or `claude-sonnet-5-5`.
- `concierge_daily_usd`: 5.00. This is a hard stop. When it is reached, members see
  "Ian is resting until tomorrow" and the card goes up on the dashboard.

Check: `deno test -A supabase/functions/concierge/` (unit tests, and both migrations run in PGlite).

## Nightly learning (since 23 Oct 2026)

`learnings.md` grows only through a gate:

- 05:00, openclaw: `premanifest-bot/ianCoach.js` reads yesterday's `concierge_turns` (read-only query
  endpoint), keeps up to 16 real member questions in `reports/ian/cases.json`, runs the `ian-coach` agent
  (report + `proposals-<date>.json`) and the `reviewer` agent (`review-<date>.json`).
- 06:30, root: `nightly.mjs` (root's crontab, log `/var/log/ian-nightly.log`) re-checks the approved
  lines, replays about 30 questions with `replay.ts` on claude-haiku-5-5 (3 trials each, every check in
  code, $0.25 cap), and applies the lines only when the pass rate on the shared cases did not drop against
  the last replay of the deployed file. Then `deno test`, a commit of `learnings.md` alone, and step 2.
  Eval history: `/root/logs/ian-eval/` (the gate's), copied to `reports/ian/eval-<date>.json`.
- `node nightly.mjs --dry` says what it would do. `prompt.ts`, `tools.ts` and `compare.ts` proposals are
  reported for a person; nothing applies them automatically.
