-- =====================================================================
--  013: фото у услуги (показывается на странице онлайн-записи)
-- =====================================================================
alter table public.services add column if not exists photo_path text check (photo_path is null or length(photo_path) <= 300);

create or replace function public.get_public_business(p_slug text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category,
    'phone', b.phone, 'address', b.address, 'description', b.description,
    'timezone', b.timezone, 'max_days_ahead', b.max_days_ahead,
    'no_same_day', b.no_same_day,
    'active', private.biz_active(b), 'is_demo', b.is_demo,
    'bot_username', (select bot_username from public.platform_settings where id = 1),
    'ai', private.biz_ai_ready(b),
    'ai_name', (select bot_name from public.business_ai where business_id = b.id),
    'chat', private.biz_ai_ready(b) or (b.tg_chat_id is not null and private.biz_active(b)),
    'prepay_enabled', b.prepay_enabled, 'prepay_percent', b.prepay_percent, 'prepay_details', b.prepay_details,
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'duration_min', s.duration_min, 'price', s.price,
        'description', s.description, 'photo', s.photo_path,
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
