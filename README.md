# Verofax Finance Management Platform

Internal, confidential payroll + leave + benefits platform for Verofax finance and HR teams. Built with Next.js 16 + Supabase. **Not public.**

## Status — Phase 1

What's built right now:

- ✅ Email/password login (Supabase Auth)
- ✅ Hard allowlist — only users in `finance_users` table can access ANY route
- ✅ 4-role RBAC: `admin`, `finance`, `hr`, `viewer` (matrix in `src/lib/auth.ts`)
- ✅ Executive dashboard with live KPI queries (employees, payroll, bonus, leave)
- ✅ Employees list (sortable, search-ready)
- ✅ Employee profile (basic info, compensation, salary history, leave, benefits)
- ✅ Audit log table + triggers (every mutation recorded)
- ✅ Multi-currency support with AED equivalent column
- ✅ Strict security headers (X-Frame DENY, no robots index)
- ✅ Row-Level Security on every table

Coming next (planned phases):
- Phase 2 — Salary CRUD + leave balance management
- Phase 3 — Excel import/export
- Phase 4 — PDF payslip generation
- Phase 5 — Reports + filterable analytics
- Phase 6 — Mobile polish + edge cases

---

## First-time setup

### 1. Create a brand-new Supabase project

**Do NOT reuse the growth-os Supabase.** Go to https://supabase.com and create a new project — name it something like `verofax-finance`.

After creation, grab:
- **Project URL** (Settings → API → Project URL)
- **Anon Key** (Settings → API → Project API keys → `anon` `public`)

### 2. Run the SQL schema

In the Supabase dashboard, open the **SQL Editor** and run, in order:

1. `supabase/schema.sql` — creates all tables, RLS policies, audit triggers
2. `supabase/seed.sql` *(optional)* — loads 8 dummy employees so you can test

### 3. Create your auth account

In Supabase dashboard → **Authentication → Users → Add user**, create a user with email `verofax1@gmail.com` and a password of your choice. (The schema already pre-adds this email to the `finance_users` allowlist as an admin.)

To add more users later, run:
```sql
insert into finance_users (email, full_name, role, active)
values ('saleem@verofax.com', 'Saleem Lalani', 'finance', true);
```
Then create their Supabase auth account too.

### 4. Local development

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open http://localhost:3000 — you should be redirected to `/login`. Sign in with `verofax1@gmail.com`.

### 5. Deploy to Vercel (when ready)

1. Push this repo to GitHub (private repo recommended)
2. Import into Vercel as a **new project** (separate from growth-os)
3. Add the two `NEXT_PUBLIC_*` env vars in Vercel project settings
4. Add custom domain `finance.verofax.com`
5. Configure Supabase Auth → URL Configuration:
   - Site URL: `https://finance.verofax.com`
   - Redirect URLs: `https://finance.verofax.com/auth/callback`

---

## Roles

| Role     | Can see                                                  | Can edit                                    |
|----------|----------------------------------------------------------|---------------------------------------------|
| admin    | Everything + Audit Logs + Settings                       | Everything                                  |
| finance  | Dashboard, Employees, Payroll, Payslips, Bonus, Reports  | Salary, payslips, bonus, dues               |
| hr       | Dashboard, Employees, Leave, Benefits, Reports           | Employee profiles, leave, benefits          |
| viewer   | Dashboard, Reports                                       | Nothing                                     |

Permissions are enforced in **three places** (defence in depth):
1. **Proxy / middleware** (`src/proxy.ts`) — every request is gated by `finance_users.active`
2. **Server components** (`requirePermission()` in `src/lib/auth.ts`) — pages re-check
3. **Supabase RLS** (`schema.sql`) — even if a page bug leaks, the DB refuses

---

## Security model

- **Hard separation from growth-os.** Different Supabase project, different DB, different deployment, different auth users. No shared data.
- **Allowlist-first.** New Supabase auth users are *not* automatically allowed in — they must be added to `finance_users` first.
- **Audit everything.** Every insert/update/delete on employees, salary, leave, benefits, bonus is logged with who/when/before/after.
- **RLS on by default.** Every table requires `is_finance_user()` to read. Sensitive tables (salary, bonus) require specific roles.
- **No indexing.** `robots: noindex` + private repo + (when deployed) Vercel password protection until ready.

---

## Tech stack

- Next.js 16 (App Router, RSC)
- Supabase (Auth + Postgres + RLS)
- Tailwind CSS
- TypeScript (strict)
- Designed to add later: `pdf-lib` (payslips), `xlsx` (Excel I/O), `recharts` (report charts)
