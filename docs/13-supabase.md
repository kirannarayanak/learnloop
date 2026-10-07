# 13 — Supabase and auth

Everything here is built and tested against a local Postgres. What is **not** done is
creating the Supabase project, because that needs your account, a region decision, and a
billing choice. This is that checklist.

## What you have to do

**1. Create the project.** supabase.com → new project. Free tier.

- **Region matters more than usual.** Pick the one nearest your learners, not nearest you.
  Database latency shows up on every page of a lesson, and the free tier has no read
  replicas to paper over a bad choice. For the India-heavy beachheads that is
  `ap-south-1` (Mumbai).
- Save the database password somewhere real. It is shown once.

**2. Copy four values** from Project Settings into `web/.env.local` and your worker env:

| Variable | Where | Who uses it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | API settings | Browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API settings | Browser and server — **public by design**, constrained by RLS |
| `DATABASE_URL` | Database settings → connection string (session pooler) | Migrations, the pipeline, the review tool |
| `SUPABASE_SERVICE_ROLE_KEY` | API settings | **Server only.** Bypasses RLS entirely |

> The service role key bypasses every policy in `db/migrations/006-rls.sql`. It belongs in
> the pipeline and nowhere near a browser. If it ever appears in a `NEXT_PUBLIC_` variable,
> every learner's data is readable by every visitor.

**3. Run the migrations.**

```bash
export DATABASE_URL='<the session pooler string>'
npm run migrate
```

The local auth shim detects Supabase's existing `auth` schema and skips itself, so the
same command works against both.

**4. Configure the email redirect.** Authentication → URL Configuration → add your site
URL and `<site>/auth/callback` to the redirect allow-list. Sign-in links fail silently
without this, which looks like a broken email rather than a missing setting.

**5. Make yourself a reviewer.** Sign in once so the account exists, then in the SQL editor:

```sql
select public.grant_platform_role('you@example.org', 'reviewer');
```

This is deliberately a database action rather than a button. Approving is the only route
high-risk content has to publication, so granting that power should require deliberate
access, not something a person can be talked into clicking.

**6. Check the free-tier limits you will actually hit first.** 500MB database, and projects
**pause after ~7 days of inactivity** — harmless, one click to resume, but it will confuse
you at 11pm if you have not read this.

## How auth works here

**Emailed sign-in links, no passwords.** A password is one more thing to be breached,
reset and forgotten, and for learners on shared and borrowed devices the reset flow is the
part that actually fails. A link to an inbox they already have works on a borrowed phone.

**Signing in is optional for learners.** Everything works signed out; progress stays in
that browser. An account is what carries it across devices. Requiring an account before
the first lesson is a conversion cliff, and the first lesson is where we find out whether
anyone finishes anything.

**A new sign-up gets a profile and a streak row automatically**
(`db/migrations/009-profile-on-signup.sql`). Without that trigger a new user has an auth
record but no profile, so every policy denies them and the app looks broken rather than
empty.

**Sessions refresh in middleware** on every request. Supabase access tokens are
short-lived; without the refresh a learner is signed out mid-lesson, which means losing an
answer they just gave.

**`getUser()`, never `getSession()`, for access decisions.** `getSession()` reads a cookie
the client could have tampered with. `getUser()` revalidates against the auth server.

## The dev token, and why it disappears

`REVIEW_TOKEN` lets the review tool run locally with no Supabase project. It is a shared
secret, not identity, so reviews are recorded with a **null reviewer** — a made-up reviewer
id would be worse than none, because "who approved this" has to stay honestly answerable.

**The token path is refused the moment Supabase is configured.** Not preferred — refused.
A credential-free route to the approve button sitting alongside real auth is the kind of
backdoor nobody notices, because everything appears to work. Verified: with both set, the
tool asks you to sign in.

## Two paths to the database, and only one is RLS-protected

This is worth internalising before adding a query.

| Path | Used by | RLS? |
| --- | --- | --- |
| Supabase client with the user's JWT | `web/lib/supabase/*`, the reviewer role check | **Yes** |
| Direct Postgres (`web/lib/review-store.ts`) | Content reads, the review tool, `/api/sync`, the pipeline | **No — connects as the database owner** |

The direct path is intentional: the pipeline must write content, and the review tool must
see unpublished lessons, neither of which RLS permits. But it means **the trust boundary on
that path is the session check in the calling route, not the database.** So:

- Never pass a user-supplied id into a direct query. Derive it from the session —
  `/api/sync` takes the user id from `currentUser()` and ignores the body, because a
  client that could name whose progress it writes could write anyone's.
- Reads served to anonymous visitors must filter themselves. `listPublishedPaths()` does.
  A new query that forgets will happily serve a draft.
- Prefer the Supabase client where either would work, so RLS is a second line of defence
  rather than absent.

## What is still open

- **The signed-in sync flow is unverified end to end.** The store side has contract tests
  against a real Postgres, the endpoint returns the right codes, and the client queues and
  flushes — but nobody has actually signed in and watched a streak move between two
  devices, because that needs a Supabase project. Do this first after provisioning.
- **No org/cohort management UI.** The policies are written and tested; the screens are
  wave 3.
- **The minors data-protection policy is still not settled** (`docs/00-decisions.md`). Auth
  existing makes school cohorts technically possible, which makes this the next blocker
  rather than a later one. Do not onboard a school before it exists.
