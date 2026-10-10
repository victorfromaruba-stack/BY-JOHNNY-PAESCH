// Backend configuration. GitHub Pages serves this file as-is, so it holds nothing secret:
// the Supabase publishable key is designed to be public, and row-level security does the
// guarding. The service-role key must NEVER appear here or anywhere in this repository.
//
//   backend: 'supabase'  → real accounts, real passwords, one shared database
//   backend: 'local'     → preview data in this browser only, for development
export const CONFIG = {
  backend: 'supabase',
  supabaseUrl: 'https://cdkopyphjvfxjqhasrae.supabase.co',
  supabaseKey: 'sb_publishable_9th0PfSraqrnnD5cTcQqxA_oqH6bwqn',
  // God's Eye View on Victor's worker server, reachable only over his Tailscale network
  // (ai-hq: scripts/install-gods-eye.sh). Change it here and in index.html's connect-src.
  godsEyeUrl: 'https://worker.tail542c3e.ts.net:10000/',
};
