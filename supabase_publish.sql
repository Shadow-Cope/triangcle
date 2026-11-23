-- =====================================================================
-- Triancle Studio publishing  (run once in the Supabase SQL editor)
-- Adds the fields Triancle Studio > File > Publish to Triancle writes,
-- and lets players publish/update only their own games.
-- =====================================================================

alter table custom_games add column if not exists description  text;
alter table custom_games add column if not exists max_players  integer not null default 12;
alter table custom_games add column if not exists updated_at   timestamptz not null default now();
alter table custom_games add column if not exists created_by   uuid references auth.users(id) on delete set null;

create index if not exists custom_games_created_by_idx on custom_games (created_by);
create index if not exists custom_games_updated_at_idx on custom_games (updated_at desc);

-- everyone can read the published list; authors manage their own rows
alter table custom_games enable row level security;

drop policy if exists custom_games_read on custom_games;
create policy custom_games_read on custom_games
  for select using (true);

drop policy if exists custom_games_insert_own on custom_games;
create policy custom_games_insert_own on custom_games
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists custom_games_update_own on custom_games;
create policy custom_games_update_own on custom_games
  for update to authenticated
  using (created_by = auth.uid() or public.is_staff())
  with check (created_by = auth.uid() or public.is_staff());

drop policy if exists custom_games_delete_own on custom_games;
create policy custom_games_delete_own on custom_games
  for delete to authenticated
  using (created_by = auth.uid() or public.is_staff());

-- =====================================================================
-- ONE-TIME RESET: delete every game published so far.
-- Comment this line out (or delete it) after running the file once, so
-- re-running the script later doesn't wipe the new games.
-- =====================================================================
delete from custom_games;
