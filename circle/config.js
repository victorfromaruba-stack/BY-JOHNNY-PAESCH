// Backend configuration. GitHub Pages serves this file as-is, so keep secrets out:
// the Supabase publishable key is designed to be public; row-level security does the guarding.
//
//   backend: 'local'     → everything runs in this browser (demo / trial mode, seeded data)
//   backend: 'supabase'  → real accounts, magic-link sign-in, live approvals (apply supabase/schema.sql first)
export const CONFIG = {
  backend: 'local',
  supabaseUrl: '',          // e.g. 'https://abcdefgh.supabase.co'
  supabaseKey: '',          // e.g. 'sb_publishable_...'
};
