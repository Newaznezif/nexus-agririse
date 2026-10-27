import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The browser client is created on first use, never at import time.
 *
 * Importing a module should not be able to break a page render: with no Supabase
 * configuration the auth provider resolves to "signed out" and every real call
 * still fails loudly here rather than silently returning empty data.
 */
let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  client = createClient(url, anonKey);
  return client;
}
