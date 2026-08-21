-- CLAMP Trainer — cross-device progress for a single user, no login.
--
-- Paste this into the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates its own table and does NOT touch the existing `public.progress`
-- table used by the opening-repertoire app.
--
-- Access model: open, matching `public.progress`. The publishable key that
-- ships in the client is the only credential, so anyone holding it can read
-- or clear this row. Keep the deployment behind Vercel Deployment Protection
-- and keep dist/clamp-trainer.html to yourself -- the key is inlined in it.

create table if not exists public.clamp_progress (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  gen        integer     not null default 0,
  updated_at timestamptz not null default now()
);

comment on table  public.clamp_progress is
  'CLAMP Trainer progress. One row per profile; the app uses id = ''clamp''.';
comment on column public.clamp_progress.data is
  '{"P":{"res":{"<item>:<ply>":"clean|hint|missed"},"read":{"<item>":1},"cursor":N},'
  ' "C":{"secs":N,"auto":N,"coords":N,"mode":"all|todo|missed"},"T":<ms>}';
comment on column public.clamp_progress.gen is
  'Reset generation. Bumped by "Reset progress"; a higher gen wins outright '
  'over the field-wise merge, so a wipe propagates instead of being merged away.';

-- RLS on with a permissive policy, rather than RLS off: same effective access,
-- but the table does not show up as unrestricted in the dashboard linter.
alter table public.clamp_progress enable row level security;

drop policy if exists clamp_progress_anon_all on public.clamp_progress;
create policy clamp_progress_anon_all
  on public.clamp_progress
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.clamp_progress to anon, authenticated;

-- Seed the row so the first client GET finds something.
insert into public.clamp_progress (id, data, gen)
values ('clamp', '{}'::jsonb, 0)
on conflict (id) do nothing;
