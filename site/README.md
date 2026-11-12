# Schema Map landing page and waitlist

One static page (`index.html`, `style.css`, `join.js`) and one Vercel function (`api/join.js`).
No framework, no build step, no trackers, no cookies, no third-party requests. The page's
Content-Security-Policy is `default-src 'self'` with no inline script.

## Test locally with a real Supabase

Needs Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
The table lives in `supabase/migrations/` (the single source of the schema, also used for production).

```
cd site
npm ci
npm run local:up            # starts local Supabase, then serves http://127.0.0.1:4173
npm run test:integration    # real signups, duplicates, honeypot, anon-key limits, no-JS post
npx supabase stop           # when finished
```

`local:up` reads the URL and keys from `supabase status` at runtime and passes them to the
server's environment. They are never printed or written to a file. Read local rows with
`supabase status` for the Studio-less DB URL, e.g. `psql "$(supabase status -o env | grep ^DB_URL | cut -d'"' -f2)" -c 'select * from waitlist'`.

## Production setup

### Supabase (once)

1. Create a project at <https://supabase.com> (free plan is fine).
2. Open **SQL Editor > New query**, paste all of `site/supabase/migrations/20261111000000_waitlist.sql`, and run it.
   It creates the `waitlist` table, turns row level security on, and allows the public `anon`
   role to INSERT only. Nobody can read, change or delete rows through the API.
3. Open **Project Settings > API** and copy two values: the **Project URL** and the **anon public** key.
   Never use the `service_role` key here.
4. Read signups any time in **Table Editor > waitlist**.

### Vercel (once)

1. Import the GitHub repository at <https://vercel.com/new>.
2. Set **Root Directory** to `site`, **Framework Preset** to `Other`, and leave the build
   command empty. Set **Output Directory** to `.` (a dot).
3. Under **Settings > Environment Variables** add, for Production and Preview:

   | Name                | Value                       |
   | ------------------- | --------------------------- |
   | `SUPABASE_URL`      | the Project URL from step 3 |
   | `SUPABASE_ANON_KEY` | the `anon public` key       |

4. Deploy. Then submit the form once from the live page and check the row appears in Supabase.
   Submit the same email again: you should see the same thank-you message and no second row.

## Develop (mocked)

```
cd site
npm ci
npm run lint
npm test                        # unit tests for api/join, Supabase mocked
npx playwright install chromium
npm run e2e                     # serves the folder locally, mocks /api/join
```

## Screenshots

`site/assets/*.png` come from the real viewer on maps the real CLI made (AdventureWorks and a
synthetic 2,000-table database). To regenerate them:

```
uv run tools/build_viewer.py        # needs `npm ci && npm run build` in viewer/ first
cd viewer && npm run site:shots
cd .. && uv run tools/site_shots.py
```

## Notes

- `api/join` never logs an email or anything Supabase sends back.
- A duplicate email and a honeypot hit both return the normal success message.
- There is no rate limit yet. If the form is abused, add Vercel's firewall rate limit for `/api/join`.
