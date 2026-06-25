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
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. In Supabase Dashboard → Settings → API, copy the 'service_role' secret (long key starting with eyJ...) and paste it into .env.local",
    );
  }
  // Detect the placeholder text so users get a real error instead of a silent
  // auth failure that returns no data.
  if (key.startsWith("PASTE_") || key.includes("your-service-role")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY still contains the placeholder text. Replace it with the real key from Supabase → Settings → API → service_role secret.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
