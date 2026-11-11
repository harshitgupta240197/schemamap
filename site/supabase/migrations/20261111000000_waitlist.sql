-- Schema Map waitlist. This migration is the single source of truth: `supabase start` applies it
-- locally, and for production paste it into the Supabase SQL editor (Project > SQL Editor > New query).
--
-- The website's function connects with the public "anon" key, so anyone who finds that key can
-- do whatever this file allows the anon role to do. It allows exactly one thing: add a row.
-- Nobody can read, change or delete rows through the API. You read the list in the Supabase
-- dashboard (Table Editor), which uses a different, private role.

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique
             check (length(email) <= 254 and email = lower(email)),
  role       text not null
             check (role in ('DBA', 'BI developer', 'Data engineer', 'Other')),
  wants_call boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Start from nothing, then give back only INSERT.
revoke all on public.waitlist from anon, authenticated;
grant insert on public.waitlist to anon;

drop policy if exists "anon can insert" on public.waitlist;
create policy "anon can insert"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- No SELECT, UPDATE or DELETE policy exists, so those are refused for anon.
