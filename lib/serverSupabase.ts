import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

export type Caller =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 503; code: 'unauthenticated' | 'auth_unavailable'; message: string };

/**
 * A fresh client per request: supabase-js keeps auth state on the instance, so a
 * cached client could carry one caller's session into another caller's request.
 */
function createRequestClient(): SupabaseClient | null {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Server auth unavailable: missing ${missing.join(', ')}`);
    return null;
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  // Only a real bearer credential counts; `Basic ...` or a bare `Bearer` with no
  // value must not be forwarded to the Auth server as if it were a token.
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  if (!match) return null;
  return match[1].trim();
}

/**
 * Identity is taken only from a token the Auth server confirms. Failures to reach
 * the Auth server deny access rather than allowing it.
 */
export async function verifyCaller(request: Request): Promise<Caller> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Authentication required' };
  }

  const client = createRequestClient();
  if (!client) {
    return { ok: false, status: 503, code: 'auth_unavailable', message: 'Unable to verify credentials' };
  }

  let userId: string | undefined;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      // Network-level failures are not the caller's fault; both paths deny access.
      const retryable = error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError';
      console.error(`Token verification ${retryable ? 'unreachable' : 'rejected'}: ${error.name}`);
      return retryable
        ? { ok: false, status: 503, code: 'auth_unavailable', message: 'Unable to verify credentials' }
        : { ok: false, status: 401, code: 'unauthenticated', message: 'Authentication required' };
    }
    userId = data.user?.id;
  } catch (err) {
    console.error(`Token verification threw: ${err instanceof Error ? err.name : 'unknown'}`);
    return { ok: false, status: 503, code: 'auth_unavailable', message: 'Unable to verify credentials' };
  }

  if (!userId) {
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Authentication required' };
  }

  return { ok: true, userId };
}
