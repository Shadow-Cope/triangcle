-- =====================================================================
-- Triancle - full database schema (fresh install)
-- Rebuilt from the client code in this repo: every table, RPC, policy
-- and storage bucket the website + Studio actually call.
--
-- Run this ONCE in a brand-new Supabase project (SQL editor), in this order:
--   1) supabase_schema.sql      (this file)
--   2) supabase_publish.sql     (adds publishing fields; drop its DELETE line
--                                once you are past the first run)
--   3) supabase_clothing.sql    (clothing attach values + PNG uploads)
--
-- Accounts are usernames: the site signs up with <username>@players.bounded.app
-- (CFG.AUTH_EMAIL_DOMAIN) and logs in through login_email_for().
-- Turn OFF "Confirm email" in Authentication, or signup can't finish.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------
create table if not exists player_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null,
  display_name  text,
  about         text,
  body_colors   jsonb,
  player_number bigint generated always as identity,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists player_profiles_username_idx on player_profiles (lower(username));

create table if not exists badges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  badge      text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, badge)
);
create index if not exists badges_badge_idx on badges (badge);

create table if not exists badge_defs (
  key            text primary key,
  name           text not null,
  image          text,
  can_ugc        boolean not null default false,
  can_edit_items boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists wallet (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('purchase', 'sale', 'fee', 'other')),
  amount      bigint not null,
  description text not null default '',
  item_id     text,
  other_user  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists transactions_user_idx on transactions (user_id, created_at desc);

create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create table if not exists ugc_items (
  id           text primary key,
  name         text not null,
  description  text,
  attach       text not null,
  file_path    text not null,
  pos          jsonb not null default '[0,0,0]'::jsonb,
  rot          jsonb not null default '[0,0,0]'::jsonb,
  scale        numeric not null default 1,
  price        bigint not null default 0,
  sales        bigint not null default 0,
  creator      uuid not null references auth.users(id) on delete cascade,
  published    boolean not null default false,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ugc_items_attach_chk check (attach in ('Head','Torso','LeftArm','RightArm','LeftLeg','RightLeg','Shirt','Pants','Face'))
);
create index if not exists ugc_items_creator_idx on ugc_items (creator);
create index if not exists ugc_items_published_idx on ugc_items (published, attach);

create table if not exists ugc_inventory (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null references ugc_items(id) on delete cascade,
  equipped    boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index if not exists ugc_inventory_equipped_idx on ugc_inventory (user_id, equipped);

create table if not exists face_meta (
  item_id text primary key references ugc_items(id) on delete cascade,
  face_no integer not null,
  image   text
);

create table if not exists username_history (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  old_username text not null,
  changed_at   timestamptz not null default now()
);
create index if not exists username_history_user_idx on username_history (user_id, changed_at desc);

create table if not exists reports (
  id            bigint generated always as identity primary key,
  reporter      uuid references auth.users(id) on delete set null,
  reported_name text,
  reported_id   uuid,
  reason        text,
  details       text,
  created_at    timestamptz not null default now()
);

create table if not exists game_settings (
  id         text primary key,
  name       text,
  owner_name text,
  thumb      text,
  icon       text,
  about      text,
  btools     text default 'all',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists custom_games (
  id          text primary key,
  name        text not null,
  owner_name  text,
  thumb       text,
  icon        text,
  map         text not null,
  description text,
  max_players integer not null default 12,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists custom_games_creator_idx on custom_games (created_by);

create table if not exists play_sessions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sid        text not null,
  updated_at timestamptz not null default now()
);

create table if not exists friendships (
  requester  uuid not null references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee)
);
create index if not exists friendships_addressee_idx on friendships (addressee);

-- ---------------------------------------------------------------------
-- helpers (after the tables, so their bodies validate)
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from badges
     where user_id = auth.uid() and badge in ('owner', 'admin')
  );
$$;

create or replace function public.can_ugc()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from badges b join badge_defs d on d.key = b.badge
     where b.user_id = auth.uid() and d.can_ugc
  );
$$;

create or replace function public.wallet_add(p_user uuid, p_delta bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into wallet (user_id, balance) values (p_user, 0)
    on conflict (user_id) do nothing;
  update wallet set balance = balance + p_delta, updated_at = now()
   where user_id = p_user
   returning balance into v;
  return coalesce(v, 0);
end $$;

create or replace function public.tx_log(p_user uuid, p_kind text, p_amount bigint,
                                         p_desc text, p_item text default null, p_other uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into transactions (user_id, kind, amount, description, item_id, other_user)
  values (p_user, p_kind, p_amount, p_desc, p_item, p_other);
$$;

revoke all on function public.wallet_add(uuid, bigint) from public, anon, authenticated;
revoke all on function public.tx_log(uuid, text, bigint, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------
alter table player_profiles   enable row level security;
alter table badges            enable row level security;
alter table badge_defs        enable row level security;
alter table wallet            enable row level security;
alter table transactions      enable row level security;
alter table notifications     enable row level security;
alter table ugc_items         enable row level security;
alter table ugc_inventory     enable row level security;
alter table face_meta         enable row level security;
alter table username_history  enable row level security;
alter table reports           enable row level security;
alter table game_settings     enable row level security;
alter table custom_games      enable row level security;
alter table play_sessions     enable row level security;
alter table friendships       enable row level security;

drop policy if exists profiles_read on player_profiles;
create policy profiles_read on player_profiles for select using (true);
drop policy if exists profiles_insert_own on player_profiles;
create policy profiles_insert_own on player_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_own on player_profiles;
create policy profiles_update_own on player_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists badges_read on badges;
create policy badges_read on badges for select using (true);
drop policy if exists badges_write_staff on badges;
create policy badges_write_staff on badges for insert to authenticated with check (is_staff());
drop policy if exists badges_delete_staff on badges;
create policy badges_delete_staff on badges for delete to authenticated using (is_staff());

drop policy if exists badge_defs_read on badge_defs;
create policy badge_defs_read on badge_defs for select using (true);
drop policy if exists badge_defs_write_staff on badge_defs;
create policy badge_defs_write_staff on badge_defs for insert to authenticated with check (is_staff());
drop policy if exists badge_defs_update_staff on badge_defs;
create policy badge_defs_update_staff on badge_defs for update to authenticated using (is_staff()) with check (is_staff());
drop policy if exists badge_defs_delete_staff on badge_defs;
create policy badge_defs_delete_staff on badge_defs for delete to authenticated using (is_staff());

drop policy if exists wallet_read_own on wallet;
create policy wallet_read_own on wallet for select to authenticated using (user_id = auth.uid());

drop policy if exists tx_read_own on transactions;
create policy tx_read_own on transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists notif_read_own on notifications;
create policy notif_read_own on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update_own on notifications;
create policy notif_update_own on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete_own on notifications;
create policy notif_delete_own on notifications for delete to authenticated using (user_id = auth.uid());

drop policy if exists ugc_read on ugc_items;
create policy ugc_read on ugc_items for select using (published or creator = auth.uid() or is_staff());
drop policy if exists ugc_insert_own on ugc_items;
create policy ugc_insert_own on ugc_items for insert to authenticated with check (creator = auth.uid());
drop policy if exists ugc_update_own on ugc_items;
create policy ugc_update_own on ugc_items for update to authenticated using (creator = auth.uid() or is_staff()) with check (creator = auth.uid() or is_staff());
drop policy if exists ugc_delete_own on ugc_items;
create policy ugc_delete_own on ugc_items for delete to authenticated using (creator = auth.uid() or is_staff());

drop policy if exists inv_read_own on ugc_inventory;
create policy inv_read_own on ugc_inventory for select to authenticated using (user_id = auth.uid());

drop policy if exists face_meta_read on face_meta;
create policy face_meta_read on face_meta for select using (true);
drop policy if exists face_meta_write_staff on face_meta;
create policy face_meta_write_staff on face_meta for insert to authenticated with check (is_staff() or can_ugc());
drop policy if exists face_meta_update_staff on face_meta;
create policy face_meta_update_staff on face_meta for update to authenticated using (is_staff() or can_ugc()) with check (is_staff() or can_ugc());
drop policy if exists face_meta_delete_staff on face_meta;
create policy face_meta_delete_staff on face_meta for delete to authenticated using (is_staff() or can_ugc());

drop policy if exists history_read on username_history;
create policy history_read on username_history for select using (true);

drop policy if exists reports_insert on reports;
create policy reports_insert on reports for insert to authenticated with check (reporter = auth.uid());
drop policy if exists reports_read_staff on reports;
create policy reports_read_staff on reports for select to authenticated using (is_staff());

drop policy if exists game_settings_read on game_settings;
create policy game_settings_read on game_settings for select using (true);
drop policy if exists game_settings_write_staff on game_settings;
create policy game_settings_write_staff on game_settings for insert to authenticated with check (is_staff());
drop policy if exists game_settings_update_staff on game_settings;
create policy game_settings_update_staff on game_settings for update to authenticated using (is_staff()) with check (is_staff());

drop policy if exists custom_games_read on custom_games;
create policy custom_games_read on custom_games for select using (true);
drop policy if exists custom_games_insert_own on custom_games;
create policy custom_games_insert_own on custom_games for insert to authenticated with check (created_by = auth.uid());
drop policy if exists custom_games_update_own on custom_games;
create policy custom_games_update_own on custom_games for update to authenticated using (created_by = auth.uid() or is_staff()) with check (created_by = auth.uid() or is_staff());
drop policy if exists custom_games_delete_own on custom_games;
create policy custom_games_delete_own on custom_games for delete to authenticated using (created_by = auth.uid() or is_staff());

-- play_sessions is managed only by the RPCs below

drop policy if exists friendships_read on friendships;
create policy friendships_read on friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
drop policy if exists friendships_insert on friendships;
create policy friendships_insert on friendships for insert to authenticated
  with check (requester = auth.uid());
drop policy if exists friendships_update on friendships;
create policy friendships_update on friendships for update to authenticated
  using (requester = auth.uid() or addressee = auth.uid())
  with check (requester = auth.uid() or addressee = auth.uid());
drop policy if exists friendships_delete on friendships;
create policy friendships_delete on friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ---------------------------------------------------------------------
-- table privileges for the API roles (RLS still applies)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on player_profiles, badges, badge_defs, ugc_items, face_meta, username_history,
                 game_settings, custom_games to anon, authenticated;
grant insert, update on player_profiles to authenticated;
grant insert, update, delete on badges, badge_defs, ugc_items, face_meta, game_settings, custom_games to authenticated;
grant select, update, delete on notifications to authenticated;
grant select on wallet, transactions, ugc_inventory, reports to authenticated;
grant insert on reports to authenticated;
grant select, insert, update, delete on friendships to authenticated;
grant select on transactions, notifications, reports, username_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------
-- RPCs used by the client
-- ---------------------------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from player_profiles where lower(username) = lower(p_username))
     and not exists (select 1 from username_history where lower(old_username) = lower(p_username));
$$;

create or replace function public.login_email_for(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.email from player_profiles p
      join auth.users u on u.id = p.id
     where lower(p.username) = lower(p_username)
     limit 1
  ), '!');
$$;

create or replace function public.get_wallet()
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  insert into wallet (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select balance into v from wallet where user_id = auth.uid();
  return coalesce(v, 0);
end $$;

create or replace function public.equipped_items_by_users(p_users uuid[])
returns table (user_id uuid, item_id text)
language sql stable security definer set search_path = public as $$
  select i.user_id, i.item_id
    from ugc_inventory i
   where i.equipped and i.user_id = any(p_users)
   order by i.acquired_at;
$$;

create or replace function public.ugc_items_by_ids(p_ids text[])
returns setof ugc_items language sql stable security definer set search_path = public as $$
  select * from ugc_items
   where id = any(p_ids) and (published or creator = auth.uid() or is_staff());
$$;

create or replace function public.set_ugc_equipped(p_item text, p_on boolean)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_attach text;
  v_owned  boolean;
  v_count  int;
  v_ids    text[];
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  select it.attach into v_attach from ugc_items it where it.id = p_item;
  if v_attach is null then raise exception 'not_owned'; end if;
  select exists (select 1 from ugc_inventory where user_id = auth.uid() and item_id = p_item) into v_owned;
  if not v_owned and not exists (select 1 from ugc_items where id = p_item and creator = auth.uid()) then
    raise exception 'not_owned';
  end if;
  if p_on then
    if v_attach in ('Shirt', 'Pants') then
      update ugc_inventory i set equipped = false
        from ugc_items it
       where i.item_id = it.id and i.user_id = auth.uid() and i.equipped and it.attach = v_attach and it.id <> p_item;
    else
      select count(*) into v_count
        from ugc_inventory i join ugc_items it on it.id = i.item_id
       where i.user_id = auth.uid() and i.equipped and it.attach not in ('Shirt', 'Pants');
      if v_count >= 6 and not exists (
        select 1 from ugc_inventory i where i.user_id = auth.uid() and i.item_id = p_item and i.equipped
      ) then
        raise exception 'too_many_equipped';
      end if;
    end if;
    insert into ugc_inventory (user_id, item_id, equipped) values (auth.uid(), p_item, true)
      on conflict (user_id, item_id) do update set equipped = true;
  else
    update ugc_inventory set equipped = false where user_id = auth.uid() and item_id = p_item;
  end if;
  select coalesce(array_agg(item_id order by acquired_at), '{}') into v_ids
    from ugc_inventory where user_id = auth.uid() and equipped;
  return v_ids;
end $$;

create or replace function public.buy_ugc_item(p_item text, p_expected_price bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_item   ugc_items;
  v_bal    bigint;
  v_taxer  uuid;
  v_cut    bigint;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  select * into v_item from ugc_items where id = p_item;
  if v_item.id is null then raise exception 'not_for_sale'; end if;
  if v_item.creator = auth.uid() then raise exception 'own_item'; end if;
  if not v_item.published then raise exception 'not_for_sale'; end if;
  if v_item.price <> p_expected_price then raise exception 'price_changed'; end if;
  if exists (select 1 from ugc_inventory where user_id = auth.uid() and item_id = p_item) then
    raise exception 'already_owned';
  end if;
  insert into wallet (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select balance into v_bal from wallet where user_id = auth.uid();
  if coalesce(v_bal, 0) < v_item.price then raise exception 'insufficient_funds'; end if;

  v_cut := floor(v_item.price * 0.8);
  perform wallet_add(auth.uid(), -v_item.price);
  perform wallet_add(v_item.creator, v_cut);
  perform tx_log(auth.uid(), 'purchase', -v_item.price, 'Bought ' || v_item.name, v_item.id, v_item.creator);
  perform tx_log(v_item.creator, 'sale', v_cut, 'Sold ' || v_item.name, v_item.id, auth.uid());

  select id into v_taxer from player_profiles where lower(username) = lower('THETriancleTaxer') limit 1;
  if v_taxer is not null and v_item.price - v_cut > 0 then
    perform wallet_add(v_taxer, v_item.price - v_cut);
    perform tx_log(v_taxer, 'other', v_item.price - v_cut, 'Sale tax: ' || v_item.name, v_item.id, auth.uid());
  end if;

  insert into ugc_inventory (user_id, item_id) values (auth.uid(), p_item)
    on conflict (user_id, item_id) do nothing;
  update ugc_items set sales = sales + 1 where id = p_item;
  insert into notifications (user_id, title, body)
    values (v_item.creator, 'You sold an item', v_item.name || ' sold for ' || v_item.price || ' Shapes.');
  select balance into v_bal from wallet where user_id = auth.uid();
  return coalesce(v_bal, 0);
end $$;

create or replace function public.set_item_sale(p_item text, p_price bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_item ugc_items;
  v_bal  bigint;
  v_fee  bigint;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  select * into v_item from ugc_items where id = p_item;
  if v_item.id is null then raise exception 'not_found'; end if;
  if v_item.creator <> auth.uid() then raise exception 'not_owned'; end if;
  if p_price is not null and (p_price < 0 or p_price > 1000000) then raise exception 'bad_price'; end if;
  v_fee := floor(coalesce(p_price, v_item.price) * 0.15);
  if p_published and (v_item.price <> coalesce(p_price, v_item.price) or v_item.published is distinct from p_published) then
    select coalesce(balance, 0) into v_bal from wallet where user_id = auth.uid();
    if coalesce(v_bal, 0) < v_fee then raise exception 'insufficient_funds'; end if;
    if v_fee > 0 then
      perform wallet_add(auth.uid(), -v_fee);
      perform tx_log(auth.uid(), 'fee', -v_fee, 'Sale fee: ' || v_item.name, p_item, null);
    end if;
  end if;
  update ugc_items
     set price = coalesce(p_price, price),
         published = coalesce(p_published, published),
         published_at = case when coalesce(p_published, published) then coalesce(published_at, now()) else published_at end,
         updated_at = now()
   where id = p_item;
end $$;

create or replace function public.owner_update_item(p_item text, p_name text, p_desc text, p_price bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  select creator into v_creator from ugc_items where id = p_item;
  if v_creator is null then raise exception 'not_found'; end if;
  if v_creator <> auth.uid() and not is_staff() then raise exception 'not_allowed'; end if;
  update ugc_items
     set name = coalesce(nullif(trim(p_name), ''), name),
         description = p_desc,
         price = coalesce(p_price, price),
         published = coalesce(p_published, published),
         updated_at = now()
   where id = p_item;
end $$;

create or replace function public.owner_delete_item(p_item text)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  select creator into v_creator from ugc_items where id = p_item;
  if v_creator is null then return; end if;
  if v_creator <> auth.uid() and not is_staff() then raise exception 'not_allowed'; end if;
  delete from ugc_items where id = p_item;
end $$;

create or replace function public.owner_adjust_wallet(p_user uuid, p_delta bigint)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not_allowed'; end if;
  perform wallet_add(p_user, p_delta);
  if p_delta <> 0 then
    perform tx_log(p_user, 'other', p_delta, case when p_delta > 0 then 'Owner added Shapes' else 'Owner removed Shapes' end, null, null);
  end if;
  return (select balance from wallet where user_id = p_user);
end $$;

create or replace function public.owner_grandfather_faces()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not_allowed'; end if;
  -- the client inserts the Catalog faces itself; nothing else to award
end $$;

create or replace function public.transaction_summary(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sale',      coalesce(sum(amount) filter (where kind = 'sale'), 0),
    'purchase',  coalesce(sum(amount) filter (where kind = 'purchase'), 0),
    'fee',       coalesce(sum(amount) filter (where kind = 'fee'), 0),
    'other_in',  coalesce(sum(amount) filter (where kind = 'other' and amount > 0), 0),
    'other_out', coalesce(sum(amount) filter (where kind = 'other' and amount < 0), 0)
  )
  from transactions
  where user_id = auth.uid()
    and created_at >= now() - (greatest(1, least(365, p_days)) || ' days')::interval;
$$;

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update notifications set read = true where user_id = auth.uid() and not read;
$$;

create or replace function public.claim_play_session(p_sid text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_row play_sessions;
begin
  if auth.uid() is null then return false; end if;
  select * into v_row from play_sessions where user_id = auth.uid();
  if v_row.user_id is null then
    insert into play_sessions (user_id, sid) values (auth.uid(), p_sid);
    return true;
  end if;
  if v_row.sid = p_sid then
    update play_sessions set updated_at = now() where user_id = auth.uid();
    return true;
  end if;
  if v_row.updated_at < now() - interval '45 seconds' then
    update play_sessions set sid = p_sid, updated_at = now() where user_id = auth.uid();
    return true;
  end if;
  return false;
end $$;

create or replace function public.release_play_session(p_sid text)
returns void language sql security definer set search_path = public as $$
  delete from play_sessions where user_id = auth.uid() and sid = p_sid;
$$;

create or replace function public.change_username(p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old   text;
  v_bal   bigint;
  v_email text;
  v_dom   text;
  cost constant bigint := 150;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_new !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'invalid'; end if;
  select username into v_old from player_profiles where id = auth.uid();
  if v_old is null then raise exception 'no_profile'; end if;
  if lower(p_new) = lower(v_old) then raise exception 'same'; end if;
  if not username_available(p_new) then raise exception 'taken'; end if;
  select coalesce(balance, 0) into v_bal from wallet where user_id = auth.uid();
  if coalesce(v_bal, 0) < cost then raise exception 'not_enough'; end if;

  perform wallet_add(auth.uid(), -cost);
  perform tx_log(auth.uid(), 'fee', -cost, 'Username change', null, null);
  insert into username_history (user_id, old_username) values (auth.uid(), v_old);
  update player_profiles set username = p_new, updated_at = now() where id = auth.uid();

  select email into v_email from auth.users where id = auth.uid();
  v_dom := split_part(coalesce(v_email, ''), '@', 2);
  if v_dom = '' then v_dom := 'players.bounded.app'; end if;
  update auth.users set email = lower(p_new) || '@' || v_dom where id = auth.uid();

  return jsonb_build_object('username', p_new);
end $$;

-- ---------------------------------------------------------------------
-- UGC upload fee (5 for clothes, 150 for accessories; staff pay nothing)
-- ---------------------------------------------------------------------
create or replace function public.ugc_upload_fee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fee bigint;
  v_bal bigint;
begin
  if new.attach in ('Shirt', 'Pants') then v_fee := 5;
  elsif new.attach = 'Face' then v_fee := 0;
  else v_fee := 150;
  end if;
  if v_fee = 0 or exists (select 1 from badges where user_id = new.creator and badge in ('owner', 'admin', 'ugc')) then
    return new;
  end if;
  select coalesce(balance, 0) into v_bal from wallet where user_id = new.creator;
  if coalesce(v_bal, 0) < v_fee then raise exception 'insufficient_funds'; end if;
  perform wallet_add(new.creator, -v_fee);
  perform tx_log(new.creator, 'fee', -v_fee, 'Upload fee: ' || new.name, new.id, null);
  return new;
end $$;

drop trigger if exists ugc_items_upload_fee on ugc_items;
create trigger ugc_items_upload_fee before insert on ugc_items
  for each row execute function public.ugc_upload_fee();

-- ---------------------------------------------------------------------
-- built-in badges
-- ---------------------------------------------------------------------
insert into badge_defs (key, name, image, can_ugc, can_edit_items) values
  ('owner',     'Owner',          'assets/badges/owner.png',     true,  true),
  ('admin',     'Admin',          'assets/badges/admin.png',     true,  true),
  ('ugc',       'UGC Creator',    'assets/badges/ugc.png',       true,  false),
  ('alpha',     'Alpha Publisher','assets/badges/alpha.png',     false, false),
  ('mod',       'Moderator',      'assets/badges/mod.png',       false, false),
  ('bugfinder', 'Bug Finder',     'assets/badges/bugfinder.png', false, false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- storage buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('ugc', 'ugc', true)
  on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('badges', 'badges', true)
  on conflict (id) do update set public = true;

drop policy if exists tri_storage_read on storage.objects;
create policy tri_storage_read on storage.objects for select
  using (bucket_id in ('ugc', 'badges'));

drop policy if exists tri_storage_insert on storage.objects;
create policy tri_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('ugc', 'badges'));

drop policy if exists tri_storage_update on storage.objects;
create policy tri_storage_update on storage.objects for update to authenticated
  using (bucket_id in ('ugc', 'badges')) with check (bucket_id in ('ugc', 'badges'));

drop policy if exists tri_storage_delete on storage.objects;
create policy tri_storage_delete on storage.objects for delete to authenticated
  using (bucket_id in ('ugc', 'badges'));

-- ---------------------------------------------------------------------
-- grant the RPCs to signed-in players
-- ---------------------------------------------------------------------
grant execute on function
  public.username_available(text),
  public.login_email_for(text),
  public.get_wallet(),
  public.equipped_items_by_users(uuid[]),
  public.ugc_items_by_ids(text[]),
  public.set_ugc_equipped(text, boolean),
  public.buy_ugc_item(text, bigint),
  public.set_item_sale(text, bigint, boolean),
  public.owner_update_item(text, text, text, bigint, boolean),
  public.owner_delete_item(text),
  public.owner_adjust_wallet(uuid, bigint),
  public.owner_grandfather_faces(),
  public.transaction_summary(integer),
  public.mark_notifications_read(),
  public.claim_play_session(text),
  public.release_play_session(text),
  public.change_username(text),
  public.is_staff()
to authenticated;

grant execute on function public.username_available(text), public.login_email_for(text) to anon;
