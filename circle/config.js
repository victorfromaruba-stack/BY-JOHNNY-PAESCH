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
};
