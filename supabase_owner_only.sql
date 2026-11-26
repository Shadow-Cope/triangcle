-- =====================================================================
-- Owner-only staff, plus chosen staff who may edit Catalog items
--
-- Run this ONCE in the Supabase SQL editor after supabase_schema.sql.
--
-- Result:
--   Owner (Owen's account, or anyone with the Owner badge) -> everything.
--   Chosen staff -> only the Catalog item editor, if their badge has
--                   "can_edit_items" enabled in the Owner panel.
--   Admin badge -> no automatic item-edit powers any more.
-- =====================================================================
begin;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt()->>'email', '')) = lower('owen@players.bounded.app')
      or exists (select 1 from badges where user_id = auth.uid() and badge = 'owner');
$$;

create or replace function public.can_edit_items()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from badges b join badge_defs d on d.key = b.badge
     where b.user_id = auth.uid() and d.can_edit_items
  );
$$;

-- All the other staff-only tables/functions now require the Owner badge
-- (or Owen's account). Chosen staff get only the item editor below.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

-- The built-in Admin badge no longer grants item editing. Create a custom
-- "Staff" badge with "Edit items" ticked if you want chosen staff.
update badge_defs set can_edit_items = false where key = 'admin';

-- Catalog items: creators, Owners, and chosen staff.
drop policy if exists ugc_read on ugc_items;
create policy ugc_read on ugc_items for select
  using (published or creator = auth.uid() or public.can_edit_items());

drop policy if exists ugc_update_own on ugc_items;
create policy ugc_update_own on ugc_items for update to authenticated
  using (creator = auth.uid() or public.can_edit_items())
  with check (creator = auth.uid() or public.can_edit_items());

drop policy if exists ugc_delete_own on ugc_items;
create policy ugc_delete_own on ugc_items for delete to authenticated
  using (creator = auth.uid() or public.can_edit_items());

create or replace function public.ugc_items_by_ids(p_ids text[])
returns setof ugc_items language sql stable security definer set search_path = public as $$
  select * from ugc_items
   where id = any(p_ids) and (published or creator = auth.uid() or public.can_edit_items());
$$;

create or replace function public.owner_update_item(p_item text, p_name text, p_desc text, p_price bigint, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_creator uuid;
begin
  select creator into v_creator from ugc_items where id = p_item;
  if v_creator is null then raise exception 'not_found'; end if;
  if v_creator <> auth.uid() and not public.can_edit_items() then raise exception 'not_allowed'; end if;
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
  if v_creator <> auth.uid() and not public.can_edit_items() then raise exception 'not_allowed'; end if;
  delete from ugc_items where id = p_item;
end $$;

grant execute on function public.is_owner(), public.can_edit_items() to authenticated;

commit;
