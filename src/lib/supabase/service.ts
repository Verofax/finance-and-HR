import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Use ONLY in server-side code for
// public-facing flows (leave submission, manager approval) where no auth user
// is present. Never expose to the browser.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase dashboard →
// Settings → API → service_role key, the "secret" one).
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY not set. Add it to .env.local from Supabase → Settings → API → service_role secret.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
