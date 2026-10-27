import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client for the data sync.
 *
 * This is the one place the project uses the database service-role key, and it exists
 * because the harvested open-data tables are deliberately readable by nobody: RLS is on,
 * forced, with zero policies, so an authenticated farmer's session cannot write a WFP price
 * row — nor should it. The key is read from a NON-`NEXT_PUBLIC` variable, so Next.js cannot
 * inline it into a browser bundle, and this module refuses to run in a client component.
 *
 * Rules this file enforces:
 *  - never log, return, or embed the key anywhere, including error messages;
 *  - never import this from client code (the `window` guard makes that a loud failure);
 *  - if the credentials are absent, report `not_configured` rather than pretending.
 */

let client: SupabaseClient | null = null;

export function isSyncConfigured(): { ok: true } | { ok: false; reason: string } {
  if (typeof window !== 'undefined') {
    return { ok: false, reason: 'The service-role client must never run in a browser.' };
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ok: false, reason: 'NEXT_PUBLIC_SUPABASE_URL is not set on the server.' };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' };
  }
  return { ok: true };
}

/**
 * Throws instead of returning null: a caller that reaches this without credentials has
 * already been turned away by `isSyncConfigured`, so getting here is a bug worth a stack.
 * The error text names the variables, never their values.
 */
export function getSyncClient(): SupabaseClient {
  const status = isSyncConfigured();
  if (!status.ok) throw new Error(`Data sync is not configured: ${status.reason}`);

  if (client) return client;
  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    // A sync run is one-shot server work: no session storage, no refresh timers.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
