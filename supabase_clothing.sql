-- Clothing UGC (Shirt / Pants) - run once in the Supabase SQL editor.
-- I couldn't see your existing supabase_*.sql files, so this only touches the two things clothing can trip over:
--   1) a CHECK constraint on ugc_items.attach that only allows the six body slots
--   2) a storage bucket that only accepts GLB uploads
-- Clothes are stored like every other item: a row in ugc_items (attach = 'Shirt' or 'Pants', file_path = a .png in the ugc bucket).
-- Nothing else (buying, wearing, selling, the RPCs) needs to change.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ugc_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%attach%'
  loop
    execute format('alter table public.ugc_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.ugc_items
  add constraint ugc_items_attach_chk
  check (attach in ('Head','Torso','LeftArm','RightArm','LeftLeg','RightLeg','Shirt','Pants'));

-- let the ugc bucket accept PNGs (only if the bucket has a mime-type allow-list at all)
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'image/png')
 where id = 'ugc' and allowed_mime_types is not null and not ('image/png' = any(allowed_mime_types));
