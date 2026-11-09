-- =====================================================================
--  007: фото работ и товаров (галерея на странице записи)
--  Владелец в «Настройках» загружает фото (причёски, работы, товары) с
--  подписью и необязательной ценой. Клиенты видят их на странице записи.
--  Ничего существующего не меняется: новая таблица, новый бакет и
--  get_public_business с одним добавленным полем 'photos'.
--  Файл можно запускать повторно.
-- =====================================================================

-- ---------- Таблица ----------
create table if not exists public.business_photos (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  path        text not null,
  caption     text check (length(caption) <= 100),
  price       numeric(12,2) check (price >= 0),
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists business_photos_biz_idx on public.business_photos (business_id, sort, created_at);

alter table public.business_photos enable row level security;
drop policy if exists owner_all on public.business_photos;
create policy owner_all on public.business_photos for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

revoke all on public.business_photos from anon;
grant select, insert, update, delete on public.business_photos to authenticated;

-- Не больше 24 фото на бизнес и путь только в своей папке
create or replace function private.photos_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if split_part(new.path, '/', 1) <> new.business_id::text then
    raise exception 'Неверный путь файла';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.business_photos where business_id = new.business_id) >= 24 then
    raise exception 'Можно загрузить не больше 24 фото';
  end if;
  return new;
end $$;
drop trigger if exists photos_guard on public.business_photos;
create trigger photos_guard before insert or update on public.business_photos
  for each row execute function private.photos_guard();

-- ---------- Хранилище файлов ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Читать файлы можно по публичной ссылке; писать и удалять — только владелец в папке своего бизнеса
drop policy if exists photos_owner_insert on storage.objects;
create policy photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_owner(((storage.foldername(name))[1])::uuid));
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_owner(((storage.foldername(name))[1])::uuid));

-- ---------- Страница записи: то же, что в 006, плюс 'photos' ----------
create or replace function public.get_public_business(p_slug text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category,
    'phone', b.phone, 'address', b.address, 'description', b.description,
    'timezone', b.timezone, 'max_days_ahead', b.max_days_ahead,
    'active', private.biz_active(b), 'is_demo', b.is_demo,
    'bot_username', (select bot_username from public.platform_settings where id = 1),
    'ai', private.biz_ai_ready(b),
    'ai_name', (select bot_name from public.business_ai where business_id = b.id),
    'chat', private.biz_ai_ready(b) or (b.tg_chat_id is not null and private.biz_active(b)),
    'prepay_enabled', b.prepay_enabled, 'prepay_percent', b.prepay_percent, 'prepay_details', b.prepay_details,
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'duration_min', s.duration_min, 'price', s.price,
        'description', s.description,
        'staff_ids', (select coalesce(jsonb_agg(x.staff_id), '[]'::jsonb) from public.staff_services x where x.service_id = s.id)
      ) order by s.sort, s.name), '[]'::jsonb)
      from public.services s where s.business_id = b.id and s.is_active),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'title', s.title) order by s.rn), '[]'::jsonb)
      from private.bookable_staff(b.id) s),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', p.path, 'caption', p.caption, 'price', p.price
      ) order by p.sort, p.created_at), '[]'::jsonb)
      from public.business_photos p where p.business_id = b.id)
  )
  from public.businesses b where b.slug = lower(trim(p_slug))
$$;
