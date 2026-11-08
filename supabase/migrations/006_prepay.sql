-- =====================================================================
--  006: запись по предоплате (по умолчанию выключено)
--  Владелец в «Настройках» включает/выключает предоплату, выбирает процент
--  и пишет, куда переводить. Клиент видит сумму на странице записи.
--  Файл можно запускать повторно.
-- =====================================================================
alter table public.businesses add column if not exists prepay_enabled boolean not null default false;
alter table public.businesses add column if not exists prepay_percent int not null default 30;
alter table public.businesses add column if not exists prepay_details text;

alter table public.businesses drop constraint if exists businesses_prepay_percent_check;
alter table public.businesses add constraint businesses_prepay_percent_check check (prepay_percent between 1 and 100);
alter table public.businesses drop constraint if exists businesses_prepay_details_check;
alter table public.businesses add constraint businesses_prepay_details_check check (length(prepay_details) <= 300);

grant update (prepay_enabled, prepay_percent, prepay_details) on public.businesses to authenticated;

-- Страница записи: те же поля, что в 003, плюс предоплата
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
      from private.bookable_staff(b.id) s)
  )
  from public.businesses b where b.slug = lower(trim(p_slug))
$$;

-- Страница «Моя запись»: то же, что в 001, плюс предоплата
create or replace function public.get_booking(p_token text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'status', k.status, 'starts_at', k.starts_at, 'ends_at', k.ends_at,
    'service_name', k.service_name, 'staff_name', k.staff_name, 'price', k.price,
    'client_name', k.client_name, 'token', k.token, 'tg', k.tg_chat_id is not null,
    'can_cancel', k.status in ('booked', 'confirmed') and k.starts_at > now(),
    'business', jsonb_build_object('name', b.name, 'slug', b.slug, 'address', b.address,
                                   'phone', b.phone, 'timezone', b.timezone, 'is_demo', b.is_demo,
                                   'prepay_enabled', b.prepay_enabled, 'prepay_percent', b.prepay_percent,
                                   'prepay_details', b.prepay_details),
    'bot_username', (select bot_username from public.platform_settings where id = 1))
  from public.bookings k join public.businesses b on b.id = k.business_id
  where k.token = p_token
$$;
