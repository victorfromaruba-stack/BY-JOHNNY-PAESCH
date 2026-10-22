// Ian, the Circle's concierge. The request itself is handler.ts; this only starts it, so tests can
// run the handler with stand-ins and nothing listens on a port when they import it.
import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { makeHandler } from './handler.ts';

Deno.serve(makeHandler({ createClient, env: (k) => Deno.env.get(k) }));
