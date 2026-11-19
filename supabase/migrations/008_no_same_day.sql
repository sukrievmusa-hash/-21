-- =====================================================================
--  008: «Сегодня — только живая очередь» (по умолчанию выключено)
--  Владелец в «Настройках» включает переключатель — и онлайн-запись на
--  сегодняшний день закрывается (страница записи и ИИ-ассистент в Telegram).
--  Записаться можно с завтрашнего дня. Владелец по-прежнему может сам
--  добавить запись на сегодня в кабинете.
--  Файл можно запускать повторно.
-- =====================================================================
alter table public.businesses add column if not exists no_same_day boolean not null default false;

grant update (no_same_day) on public.businesses to authenticated;

-- ---------- Свободное время: то же, что в 001, плюс проверка no_same_day ----------
create or replace function private.slots(p_business uuid, p_service uuid, p_staff uuid, p_day date)
returns table (slot timestamptz, staff_id uuid, rn bigint)
language sql stable security definer set search_path = public, extensions as $$
  with b as (select * from public.businesses where id = p_business),
  sv as (select * from public.services where id = p_service and business_id = p_business and is_active),
  st as (
    select s.id, s.rn from private.bookable_staff(p_business) s, sv
    where (p_staff is null or s.id = p_staff)
      and (not exists (select 1 from public.staff_services x where x.service_id = sv.id)
           or exists (select 1 from public.staff_services x where x.service_id = sv.id and x.staff_id = s.id))
  ),
  win as (
    select st.id as staff_id, st.rn,
           ((p_day + wh.start_time) at time zone b.timezone) as ws,
           ((p_day + wh.end_time)   at time zone b.timezone) as we
    from st
    join public.working_hours wh on wh.staff_id = st.id and wh.weekday = extract(isodow from p_day)::int
    cross join b
  ),
  cand as (
    select w.staff_id, w.rn, g as slot, g + make_interval(mins => sv.duration_min) as slot_end
    from win w cross join sv cross join b,
         generate_series(w.ws, w.we - make_interval(mins => sv.duration_min), make_interval(mins => b.slot_step)) g
  )
  select c.slot, c.staff_id, c.rn
  from cand c cross join b
  where c.slot >= now() + make_interval(mins => b.min_notice_min)
    and p_day <= (now() at time zone b.timezone)::date + b.max_days_ahead
    and (not b.no_same_day or p_day > (now() at time zone b.timezone)::date)
    and not exists (
      select 1 from public.bookings k
      where k.staff_id = c.staff_id and k.status <> 'cancelled'
        and tstzrange(k.starts_at, k.ends_at) && tstzrange(c.slot, c.slot_end))
    and not exists (
      select 1 from public.time_off t
      where t.business_id = p_business and (t.staff_id is null or t.staff_id = c.staff_id)
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(c.slot, c.slot_end))
  order by c.slot, c.rn
$$;

-- ---------- Страница записи: то же, что в 007, плюс 'no_same_day' ----------
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

-- ---------- ИИ-ассистент: то же, что в 003, плюс 'no_same_day' ----------
create or replace function public.ai_context(p_business uuid, p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; a public.business_ai;
begin
  select * into b from public.businesses where id = p_business;
  select * into a from public.business_ai where business_id = p_business;
  return jsonb_build_object(
    'api_key', (select ai_api_key from private.secrets where id = 1),
    'model', (select ai_model from public.platform_settings where id = 1),
    'site_url', (select site_url from public.platform_settings where id = 1),
    'business', jsonb_build_object('name', b.name, 'slug', b.slug, 'category', b.category, 'phone', coalesce(private.fmt_phone(private.norm_phone(b.phone)), b.phone),
      'address', b.address, 'description', b.description, 'timezone', b.timezone,
      'now_local', to_char(now() at time zone b.timezone, 'YYYY-MM-DD HH24:MI'),
      'weekday', extract(isodow from now() at time zone b.timezone)::int,
      'max_days_ahead', b.max_days_ahead, 'no_same_day', b.no_same_day, 'hours', private.biz_hours_text(b.id)),
    'ai', jsonb_build_object('bot_name', coalesce(a.bot_name, 'Ассистент'), 'knowledge', coalesce(a.knowledge, ''),
      'instructions', coalesce(a.instructions, ''), 'can_book', coalesce(a.can_book, true)),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'minutes', s.duration_min,
                   'price', s.price, 'description', s.description) order by s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.business_id = b.id and s.is_active),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'title', s.title) order by s.rn), '[]'::jsonb)
              from private.bookable_staff(b.id) s),
    'client', (select jsonb_build_object('name', k.client_name, 'phone', private.fmt_phone(k.client_phone))
               from public.bookings k where k.business_id = b.id and k.tg_chat_id = p_chat and p_chat <> 0
               order by k.created_at desc limit 1),
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('when', private.fmt_dt(k.starts_at, b.timezone),
                   'service', k.service_name, 'staff', k.staff_name, 'status', k.status) order by k.starts_at), '[]'::jsonb)
                 from public.bookings k where k.business_id = b.id and k.tg_chat_id = p_chat and p_chat <> 0
                   and k.status in ('booked', 'confirmed') and k.starts_at > now()),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at, id), '[]'::jsonb)
                from (select * from public.ai_messages where business_id = p_business and chat_id = p_chat
                      and created_at > now() - interval '3 days' order by created_at desc, id desc limit 16) t));
end $$;
