-- =====================================================================
--  Kezek — онлайн-запись и напоминания в Telegram
--  Схема базы данных (Supabase / Postgres 17)
--  Файл можно запускать повторно: функции пересоздаются, таблицы
--  создаются только если их ещё нет.
--  Перед запуском нужны расширения: pgcrypto, btree_gist, pg_net, pg_cron.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Настройки платформы
-- ---------------------------------------------------------------------
create table if not exists private.secrets (
  id               int primary key default 1 check (id = 1),
  tg_bot_token     text,
  tg_webhook_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  admin_code_hash  text,
  admin_link_code  text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  admin_chat_id    bigint
);
insert into private.secrets (id) values (1) on conflict do nothing;

create table if not exists public.platform_settings (
  id              int primary key default 1 check (id = 1),
  brand           text not null default 'Kezek',
  site_url        text,
  kaspi_details   text,
  support_contact text,
  price_start     int not null default 3990 check (price_start >= 0),
  price_business  int not null default 9990 check (price_business >= 0),
  trial_days      int not null default 14 check (trial_days between 0 and 90),
  bot_username    text,
  updated_at      timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict do nothing;

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Бизнесы и их данные
-- ---------------------------------------------------------------------
create table if not exists public.businesses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid unique references auth.users(id) on delete cascade,
  name           text not null check (length(trim(name)) between 2 and 80),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  category       text,
  phone          text,
  address        text,
  description    text check (length(description) <= 1000),
  timezone       text not null default 'Asia/Almaty',
  slot_step      int  not null default 30 check (slot_step in (10, 15, 20, 30, 45, 60, 90, 120)),
  min_notice_min int  not null default 60 check (min_notice_min between 0 and 10080),
  max_days_ahead int  not null default 30 check (max_days_ahead between 1 and 365),
  remind_24h     boolean not null default true,
  remind_2h      boolean not null default true,
  plan           text not null default 'trial' check (plan in ('trial', 'start', 'business')),
  paid_until     timestamptz not null default now() + interval '14 days',
  is_blocked     boolean not null default false,
  is_demo        boolean not null default false,
  tg_chat_id     bigint,
  tg_link_code   text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at     timestamptz not null default now()
);

create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  title       text,
  is_active   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, business_id)
);
create index if not exists staff_business_idx on public.staff (business_id);

create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  duration_min int  not null default 60 check (duration_min between 5 and 720),
  price        int  check (price >= 0),
  description  text check (length(description) <= 500),
  is_active    boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  unique (id, business_id)
);
create index if not exists services_business_idx on public.services (business_id);

-- Какие сотрудники оказывают услугу. Нет строк для услуги = её делают все.
create table if not exists public.staff_services (
  business_id uuid not null,
  staff_id    uuid not null,
  service_id  uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id)   references public.staff (id, business_id)   on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);
create index if not exists staff_services_service_idx on public.staff_services (service_id);

-- График: weekday 1 = понедельник … 7 = воскресенье. Несколько интервалов в день = перерывы.
create table if not exists public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  weekday     int  not null check (weekday between 1 and 7),
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index if not exists working_hours_staff_idx on public.working_hours (staff_id, weekday);

-- Отпуска, выходные, праздники. staff_id = null — для всего бизнеса.
create table if not exists public.time_off (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    uuid,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  check (ends_at > starts_at),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);
create index if not exists time_off_business_idx on public.time_off (business_id, starts_at);

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  phone       text not null,
  tg_chat_id  bigint,
  notes       text check (length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  unique (business_id, phone),
  unique (id, business_id)
);

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  staff_id     uuid,
  service_id   uuid,
  client_id    uuid,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'booked'
               check (status in ('booked', 'confirmed', 'done', 'no_show', 'cancelled')),
  client_name  text not null check (length(trim(client_name)) between 1 and 80),
  client_phone text not null,
  service_name text,
  staff_name   text,
  price        int check (price >= 0),
  comment      text check (length(comment) <= 500),
  source       text not null default 'manual' check (source in ('online', 'manual')),
  token        text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  tg_chat_id   bigint,
  reminded_24  boolean not null default false,
  reminded_2   boolean not null default false,
  cancelled_by text,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (staff_id, business_id)   references public.staff (id, business_id)    on delete set null (staff_id),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete set null (service_id),
  foreign key (client_id, business_id)  references public.clients (id, business_id)  on delete set null (client_id),
  -- один сотрудник не может иметь две пересекающиеся записи
  constraint bookings_no_overlap exclude using gist (
    staff_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);
create index if not exists bookings_business_time_idx on public.bookings (business_id, starts_at);
create index if not exists bookings_client_idx on public.bookings (client_id);
create index if not exists bookings_remind_idx on public.bookings (starts_at)
  where tg_chat_id is not null and status in ('booked', 'confirmed');

create table if not exists public.payment_requests (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  plan         text not null check (plan in ('start', 'business')),
  months       int  not null check (months in (1, 3, 6, 12)),
  amount       int  not null,
  payer_note   text check (length(payer_note) <= 200),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists payment_requests_business_idx on public.payment_requests (business_id, created_at desc);

-- Очередь сообщений в Telegram (отправляются сразу через pg_net)
create table if not exists public.notifications (
  id          bigserial primary key,
  chat_id     bigint not null,
  text        text not null,
  reply_markup jsonb,
  business_id uuid references public.businesses(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete set null,
  kind        text,
  request_id  bigint,
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Вспомогательные функции
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.is_owner(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses where id = p_business and owner_id = auth.uid())
$$;

create or replace function private.norm_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 11 and left(d, 1) = '8' then d := '7' || substr(d, 2); end if;
  if length(d) = 10 then d := '7' || d; end if;
  if length(d) < 11 or length(d) > 15 then return null; end if;
  return d;
end $$;

create or replace function private.fmt_phone(d text) returns text
language sql immutable as $$
  select case when d ~ '^7\d{10}$'
    then '+7 ' || substr(d, 2, 3) || ' ' || substr(d, 5, 3) || ' ' || substr(d, 8, 2) || ' ' || substr(d, 10, 2)
    else '+' || coalesce(d, '') end
$$;

create or replace function private.h(t text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create or replace function private.money(n int) returns text
language sql immutable as $$
  select replace(to_char(coalesce(n, 0), 'FM999,999,999'), ',', ' ') || ' ₸'
$$;

create or replace function private.fmt_dt(ts timestamptz, tz text) returns text
language sql stable as $$
  select extract(day from l)::int || ' ' ||
    (array['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'])[extract(month from l)::int]
    || ' (' || (array['пн','вт','ср','чт','пт','сб','вс'])[extract(isodow from l)::int] || '), '
    || to_char(l, 'HH24:MI')
  from (select ts at time zone tz as l) x
$$;

create or replace function private.plan_staff_limit(p text) returns int
language sql immutable as $$
  select case p when 'start' then 1 else 10 end
$$;

create or replace function private.plan_title(p text) returns text
language sql immutable as $$
  select case p when 'start' then 'Старт' when 'business' then 'Бизнес' else 'Пробный' end
$$;

create or replace function private.biz_active(b public.businesses) returns boolean
language sql stable as $$
  select not b.is_blocked and (b.is_demo or b.paid_until > now())
$$;

create or replace function private.notify(p_chat bigint, p_text text, p_markup jsonb,
                                          p_business uuid, p_booking uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_chat is null then return; end if;
  insert into public.notifications (chat_id, text, reply_markup, business_id, booking_id, kind)
  values (p_chat, p_text, p_markup, p_business, p_booking, p_kind);
end $$;

create or replace function private.notify_admin(p_text text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_chat bigint;
begin
  select admin_chat_id into v_chat from private.secrets where id = 1;
  perform private.notify(v_chat, p_text, null, null, null, 'admin');
end $$;

create or replace function private.booking_card(k public.bookings, b public.businesses) returns text
language sql stable as $$
  select '<b>' || private.h(b.name) || '</b>' || E'\n'
    || '📅 ' || private.fmt_dt(k.starts_at, b.timezone)
    || coalesce(E'\n📋 ' || private.h(nullif(k.service_name, '')), '')
    || coalesce(E'\n👤 Мастер: ' || private.h(nullif(k.staff_name, '')), '')
    || coalesce(E'\n📍 ' || private.h(nullif(b.address, '')), '')
    || coalesce(E'\n📞 ' || private.h(nullif(b.phone, '')), '')
$$;

create or replace function private.owner_card(k public.bookings, b public.businesses) returns text
language sql stable as $$
  select '<b>' || private.h(k.client_name) || '</b>, ' || private.fmt_phone(k.client_phone) || E'\n'
    || '📅 ' || private.fmt_dt(k.starts_at, b.timezone)
    || coalesce(E'\n📋 ' || private.h(nullif(k.service_name, '')), '')
    || coalesce(E'\n👤 ' || private.h(nullif(k.staff_name, '')), '')
    || coalesce(E'\n💬 ' || private.h(nullif(k.comment, '')), '')
$$;

create or replace function private.booking_buttons(k public.bookings) returns jsonb
language sql stable as $$
  select jsonb_build_object('inline_keyboard', jsonb_build_array(
    case when k.status = 'confirmed'
      then jsonb_build_array(jsonb_build_object('text', '❌ Отменить запись', 'callback_data', 'x:' || k.token))
      else jsonb_build_array(
        jsonb_build_object('text', '✅ Приду', 'callback_data', 'c:' || k.token),
        jsonb_build_object('text', '❌ Отменить', 'callback_data', 'x:' || k.token))
    end))
$$;

-- Сотрудники, доступные для онлайн-записи с учётом лимита тарифа
create or replace function private.bookable_staff(p_business uuid)
returns table (id uuid, name text, title text, sort int, rn bigint)
language sql stable as $$
  select s.id, s.name, s.title, s.sort, s.rn
  from (
    select st.*, row_number() over (order by st.sort, st.created_at) as rn
    from public.staff st where st.business_id = p_business and st.is_active
  ) s
  join public.businesses b on b.id = p_business
  where s.rn <= private.plan_staff_limit(b.plan)
$$;

-- Свободные слоты на день
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

-- ---------------------------------------------------------------------
--  Триггеры
-- ---------------------------------------------------------------------
create or replace function private.trg_business_before() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.slug := lower(trim(new.slug));
  new.name := trim(new.name);
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'Неизвестный часовой пояс: %', new.timezone;
  end;
  return new;
end $$;
drop trigger if exists business_before on public.businesses;
create trigger business_before before insert or update on public.businesses
  for each row execute function private.trg_business_before();

create or replace function private.trg_staff_before() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_plan text; v_cnt int; v_lim int;
begin
  new.name := trim(new.name);
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    select plan into v_plan from public.businesses where id = new.business_id;
    v_lim := private.plan_staff_limit(v_plan);
    select count(*) into v_cnt from public.staff
      where business_id = new.business_id and is_active and id <> new.id;
    if v_cnt >= v_lim then
      raise exception 'На тарифе «%» можно добавить сотрудников: %. Перейдите на тариф «Бизнес»',
        private.plan_title(v_plan), v_lim;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_before on public.staff;
create trigger staff_before before insert or update on public.staff
  for each row execute function private.trg_staff_before();

-- Новому сотруднику — график по умолчанию пн–сб 10:00–19:00
create or replace function private.trg_staff_after_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
  select new.business_id, new.id, d, '10:00', '19:00' from generate_series(1, 6) d;
  return null;
end $$;
drop trigger if exists staff_after_insert on public.staff;
create trigger staff_after_insert after insert on public.staff
  for each row execute function private.trg_staff_after_insert();

create or replace function private.trg_client_before() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.phone := private.norm_phone(new.phone);
  if new.phone is null then raise exception 'Некорректный номер телефона'; end if;
  new.name := trim(new.name);
  return new;
end $$;
drop trigger if exists client_before on public.clients;
create trigger client_before before insert or update of phone, name on public.clients
  for each row execute function private.trg_client_before();

create or replace function private.trg_booking_before() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses;
  v_dur int; v_price int; v_name text; v_cid uuid; v_tg bigint;
  v_phone text;
begin
  select * into b from public.businesses where id = new.business_id;
  if tg_op = 'INSERT' and not private.biz_active(b) then
    raise exception 'Подписка неактивна — продлите её в разделе «Подписка»';
  end if;

  if tg_op = 'INSERT' or new.client_phone is distinct from old.client_phone then
    v_phone := private.norm_phone(new.client_phone);
    if v_phone is null then raise exception 'Укажите корректный номер телефона клиента'; end if;
    new.client_phone := v_phone;
  end if;
  new.client_name := trim(new.client_name);

  if tg_op = 'INSERT' then
    if new.service_id is not null then
      select duration_min, price, name into v_dur, v_price, v_name from public.services where id = new.service_id;
      new.service_name := v_name;
      new.price := coalesce(new.price, v_price);
      new.ends_at := coalesce(new.ends_at, new.starts_at + make_interval(mins => v_dur));
    end if;
    new.ends_at := coalesce(new.ends_at, new.starts_at + interval '1 hour');
  else
    if new.service_id is distinct from old.service_id and new.service_id is not null then
      select duration_min, price, name into v_dur, v_price, v_name from public.services where id = new.service_id;
      new.service_name := v_name;
      if new.price is not distinct from old.price then new.price := v_price; end if;
      if new.ends_at = old.ends_at then new.ends_at := new.starts_at + make_interval(mins => v_dur); end if;
    elsif new.starts_at <> old.starts_at and new.ends_at = old.ends_at then
      new.ends_at := new.starts_at + (old.ends_at - old.starts_at);
    end if;
    if new.starts_at <> old.starts_at then
      new.reminded_24 := false;
      new.reminded_2 := false;
    end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      new.cancelled_by := coalesce(nullif(current_setting('app.actor', true), ''), 'owner');
    elsif new.status <> 'cancelled' then
      new.cancelled_by := null;
    end if;
  end if;

  if new.staff_id is not null and (tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id) then
    select name into new.staff_name from public.staff where id = new.staff_id;
  end if;

  if tg_op = 'INSERT' or new.client_phone is distinct from old.client_phone then
    insert into public.clients as c (business_id, name, phone)
    values (new.business_id, new.client_name, new.client_phone)
    on conflict (business_id, phone) do update set name = c.name
    returning c.id, c.tg_chat_id into v_cid, v_tg;
    new.client_id := v_cid;
    if new.tg_chat_id is null then new.tg_chat_id := v_tg; end if;
  end if;
  return new;
end $$;
drop trigger if exists booking_before on public.bookings;
create trigger booking_before before insert or update on public.bookings
  for each row execute function private.trg_booking_before();

-- Сообщить клиенту в Telegram, если владелец отменил или перенёс запись
create or replace function private.trg_booking_after_update() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses;
  v_actor text := coalesce(nullif(current_setting('app.actor', true), ''), 'owner');
begin
  if new.tg_chat_id is null or v_actor = 'client' then return null; end if;
  select * into b from public.businesses where id = new.business_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.starts_at > now() then
    perform private.notify(new.tg_chat_id,
      '❌ Ваша запись отменена' || E'\n\n' || private.booking_card(new, b)
      || E'\n\nЕсли это ошибка — свяжитесь с нами.', null, b.id, new.id, 'client_cancel');
  elsif new.status in ('booked', 'confirmed') and new.starts_at <> old.starts_at and new.starts_at > now() then
    perform private.notify(new.tg_chat_id,
      '🔄 Ваша запись перенесена' || E'\n\n' || private.booking_card(new, b),
      private.booking_buttons(new), b.id, new.id, 'client_move');
  end if;
  return null;
end $$;
drop trigger if exists booking_after_update on public.bookings;
create trigger booking_after_update after update on public.bookings
  for each row execute function private.trg_booking_after_update();

-- Отправка сообщения в Telegram сразу при постановке в очередь
create or replace function private.trg_notification_send() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  select tg_bot_token into v_token from private.secrets where id = 1;
  if v_token is null then
    new.error := 'no_bot_token';
    return new;
  end if;
  new.request_id := net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body    := jsonb_strip_nulls(jsonb_build_object(
                 'chat_id', new.chat_id, 'text', new.text, 'parse_mode', 'HTML',
                 'disable_web_page_preview', true, 'reply_markup', new.reply_markup)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  new.sent_at := now();
  return new;
end $$;
drop trigger if exists notification_send on public.notifications;
create trigger notification_send before insert on public.notifications
  for each row execute function private.trg_notification_send();

-- ---------------------------------------------------------------------
--  Публичные функции (страница записи — доступны без входа)
-- ---------------------------------------------------------------------
create or replace function public.get_public_business(p_slug text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category,
    'phone', b.phone, 'address', b.address, 'description', b.description,
    'timezone', b.timezone, 'max_days_ahead', b.max_days_ahead,
    'active', private.biz_active(b), 'is_demo', b.is_demo,
    'bot_username', (select bot_username from public.platform_settings where id = 1),
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

create or replace function public.get_slots(p_slug text, p_service uuid, p_staff uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('t', x.slot, 'staff_id', x.staff_id) order by x.slot), '[]'::jsonb)
  from public.businesses b,
  lateral (
    select distinct on (s.slot) s.slot, s.staff_id
    from private.slots(b.id, p_service, p_staff, p_date) s
    order by s.slot, s.rn
  ) x
  where b.slug = lower(trim(p_slug)) and private.biz_active(b)
$$;

create or replace function public.get_free_days(p_slug text, p_service uuid, p_staff uuid, p_from date, p_days int)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb)
  from public.businesses b,
       generate_series(p_from::timestamp, (p_from + least(greatest(p_days, 1), 62) - 1)::timestamp, interval '1 day') d
  where b.slug = lower(trim(p_slug)) and private.biz_active(b)
    and exists (select 1 from private.slots(b.id, p_service, p_staff, d::date))
$$;

create or replace function public.create_booking(
  p_slug text, p_service uuid, p_staff uuid, p_starts timestamptz,
  p_name text, p_phone text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses; k public.bookings;
  v_staff uuid; v_phone text; v_cnt int;
begin
  select * into b from public.businesses where slug = lower(trim(p_slug));
  if not found then raise exception 'Страница записи не найдена'; end if;
  if not private.biz_active(b) then raise exception 'Онлайн-запись временно недоступна'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Укажите ваше имя'; end if;
  v_phone := private.norm_phone(p_phone);
  if v_phone is null then raise exception 'Укажите корректный номер телефона'; end if;

  select count(*) into v_cnt from public.bookings
  where business_id = b.id and client_phone = v_phone
    and status in ('booked', 'confirmed') and starts_at > now();
  if v_cnt >= 3 then
    raise exception 'У вас уже есть 3 активные записи. Чтобы записаться ещё, позвоните нам';
  end if;

  select s.staff_id into v_staff
  from private.slots(b.id, p_service, p_staff, (p_starts at time zone b.timezone)::date) s
  where s.slot = p_starts order by s.rn limit 1;
  if v_staff is null then raise exception 'Это время уже занято — выберите другое'; end if;

  perform set_config('app.actor', 'client', true);
  begin
    insert into public.bookings (business_id, staff_id, service_id, starts_at, client_name, client_phone, comment, source)
    values (b.id, v_staff, p_service, p_starts, left(trim(p_name), 80), v_phone,
            nullif(left(trim(coalesce(p_comment, '')), 500), ''), 'online')
    returning * into k;
  exception when exclusion_violation then
    raise exception 'Это время только что заняли — выберите другое';
  end;

  if not b.is_demo then
    perform private.notify(b.tg_chat_id, '🆕 Новая онлайн-запись' || E'\n\n' || private.owner_card(k, b),
                           null, b.id, k.id, 'owner_new');
  end if;
  if k.tg_chat_id is not null then
    perform private.notify(k.tg_chat_id, '✅ Вы записаны!' || E'\n\n' || private.booking_card(k, b),
                           private.booking_buttons(k), b.id, k.id, 'client_new');
  end if;
  return jsonb_build_object('token', k.token);
end $$;

create or replace function public.get_booking(p_token text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'status', k.status, 'starts_at', k.starts_at, 'ends_at', k.ends_at,
    'service_name', k.service_name, 'staff_name', k.staff_name, 'price', k.price,
    'client_name', k.client_name, 'token', k.token, 'tg', k.tg_chat_id is not null,
    'can_cancel', k.status in ('booked', 'confirmed') and k.starts_at > now(),
    'business', jsonb_build_object('name', b.name, 'slug', b.slug, 'address', b.address,
                                   'phone', b.phone, 'timezone', b.timezone, 'is_demo', b.is_demo),
    'bot_username', (select bot_username from public.platform_settings where id = 1))
  from public.bookings k join public.businesses b on b.id = k.business_id
  where k.token = p_token
$$;

create or replace function public.cancel_booking(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare k public.bookings; b public.businesses;
begin
  select * into k from public.bookings where token = p_token for update;
  if not found then raise exception 'Запись не найдена'; end if;
  if k.status not in ('booked', 'confirmed') or k.starts_at <= now() then
    raise exception 'Эту запись уже нельзя отменить';
  end if;
  perform set_config('app.actor', 'client', true);
  update public.bookings set status = 'cancelled' where id = k.id returning * into k;
  select * into b from public.businesses where id = k.business_id;
  if not b.is_demo then
    perform private.notify(b.tg_chat_id, '❌ Клиент отменил запись' || E'\n\n' || private.owner_card(k, b),
                           null, b.id, k.id, 'owner_cancel');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  Функции владельца бизнеса
-- ---------------------------------------------------------------------
create or replace function public.check_slug(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(trim(p_slug)) ~ '^[a-z0-9][a-z0-9-]{2,39}$'
     and lower(trim(p_slug)) not in ('demo', 'admin', 'app', 'www', 'api', 'book', 'test', 'support', 'kezek')
     and not exists (select 1 from public.businesses where slug = lower(trim(p_slug)))
$$;

create or replace function public.create_business(
  p_name text, p_slug text, p_category text default null, p_phone text default null,
  p_address text default null, p_staff_name text default null) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_trial int; v_email text; v_slug text := lower(trim(p_slug));
begin
  if auth.uid() is null then raise exception 'Требуется вход'; end if;
  if exists (select 1 from public.businesses where owner_id = auth.uid()) then
    raise exception 'У вас уже есть бизнес';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Укажите название'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    raise exception 'Адрес страницы: только латинские буквы, цифры и дефис, от 3 до 40 символов';
  end if;
  if not public.check_slug(v_slug) then raise exception 'Адрес «%» уже занят — выберите другой', v_slug; end if;

  select trial_days into v_trial from public.platform_settings where id = 1;
  insert into public.businesses (owner_id, name, slug, category, phone, address, plan, paid_until)
  values (auth.uid(), trim(p_name), v_slug, nullif(trim(p_category), ''), nullif(trim(p_phone), ''),
          nullif(trim(p_address), ''), 'trial', now() + make_interval(days => coalesce(v_trial, 14)))
  returning id into v_id;

  insert into public.staff (business_id, name) values (v_id, coalesce(nullif(trim(p_staff_name), ''), 'Мастер'));

  select email into v_email from auth.users where id = auth.uid();
  perform private.notify_admin('🎉 Новая регистрация' || E'\n<b>' || private.h(p_name) || '</b> — ' || private.h(v_email));
  return v_id;
exception when unique_violation then
  raise exception 'Адрес «%» уже занят — выберите другой', v_slug;
end $$;

create or replace function public.owner_set_hours(p_staff uuid, p_hours jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare v_b uuid;
begin
  select business_id into v_b from public.staff where id = p_staff;
  if v_b is null then raise exception 'Сотрудник не найден'; end if;
  delete from public.working_hours where staff_id = p_staff;
  insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
  select v_b, p_staff, (h->>'weekday')::int, (h->>'start')::time, (h->>'end')::time
  from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
end $$;

create or replace function public.owner_set_service_staff(p_service uuid, p_staff uuid[]) returns void
language plpgsql security invoker set search_path = public as $$
declare v_b uuid;
begin
  select business_id into v_b from public.services where id = p_service;
  if v_b is null then raise exception 'Услуга не найдена'; end if;
  delete from public.staff_services where service_id = p_service;
  insert into public.staff_services (business_id, staff_id, service_id)
  select v_b, s, p_service from unnest(coalesce(p_staff, '{}')) s;
end $$;

create or replace function public.owner_clients(p_search text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_visit desc nulls last, x.created_at desc), '[]'::jsonb)
  from (
    select c.id, c.name, c.phone, c.notes, c.created_at, (c.tg_chat_id is not null) as tg,
           count(k.id) filter (where k.status = 'done') as visits,
           count(k.id) filter (where k.status = 'no_show') as no_shows,
           count(k.id) filter (where k.status <> 'cancelled') as bookings,
           max(k.starts_at) filter (where k.status <> 'cancelled') as last_visit,
           coalesce(sum(k.price) filter (where k.status = 'done'), 0) as spent
    from public.clients c
    left join public.bookings k on k.client_id = c.id
    where coalesce(trim(p_search), '') = ''
       or c.name ilike '%' || trim(p_search) || '%'
       or (regexp_replace(p_search, '\D', '', 'g') <> '' and c.phone like '%' || regexp_replace(p_search, '\D', '', 'g') || '%')
    group by c.id
    order by max(k.starts_at) desc nulls last
    limit 1000
  ) x
$$;

create or replace function public.owner_stats(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total',     count(*) filter (where status <> 'cancelled'),
    'online',    count(*) filter (where status <> 'cancelled' and source = 'online'),
    'done',      count(*) filter (where status = 'done'),
    'no_show',   count(*) filter (where status = 'no_show'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'revenue',   coalesce(sum(price) filter (where status = 'done'), 0),
    'expected',  coalesce(sum(price) filter (where status in ('booked', 'confirmed', 'done')), 0),
    'new_clients', (select count(*) from public.clients where created_at >= p_from and created_at < p_to))
  from public.bookings where starts_at >= p_from and starts_at < p_to
$$;

create or replace function public.owner_unlink_tg() returns void
language sql security definer set search_path = public, extensions as $$
  update public.businesses
  set tg_chat_id = null, tg_link_code = encode(extensions.gen_random_bytes(12), 'hex')
  where owner_id = auth.uid()
$$;

create or replace function public.request_payment(p_plan text, p_months int, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; s public.platform_settings; v_amount int; v_id uuid;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if not found then raise exception 'Бизнес не найден'; end if;
  if p_plan not in ('start', 'business') or p_months not in (1, 3, 6, 12) then
    raise exception 'Неверный тариф или срок';
  end if;
  if length(trim(coalesce(p_note, ''))) < 2 then
    raise exception 'Укажите имя отправителя перевода — так мы найдём ваш платёж';
  end if;
  select * into s from public.platform_settings where id = 1;
  v_amount := (case p_plan when 'start' then s.price_start else s.price_business end)
              * (case p_months when 12 then 10 else p_months end);
  insert into public.payment_requests (business_id, plan, months, amount, payer_note)
  values (b.id, p_plan, p_months, v_amount, left(trim(p_note), 200))
  returning id into v_id;
  perform private.notify_admin('💰 Заявка на оплату' || E'\n<b>' || private.h(b.name) || '</b> (' || b.slug || ')'
    || E'\nТариф: ' || private.plan_title(p_plan) || ', ' || p_months || ' мес.'
    || E'\nСумма: ' || private.money(v_amount)
    || E'\nОтправитель: ' || private.h(p_note)
    || E'\n\nПроверьте поступление в Kaspi и подтвердите заявку в админке.');
  return jsonb_build_object('id', v_id, 'amount', v_amount);
end $$;

-- ---------------------------------------------------------------------
--  Функции администратора платформы
-- ---------------------------------------------------------------------
create or replace function public.claim_admin(p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'Сначала войдите в аккаунт'; end if;
  select admin_code_hash into v_hash from private.secrets where id = 1;
  if v_hash is null or encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Неверный код администратора';
  end if;
  insert into public.platform_admins (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb; s public.platform_settings;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select * into s from public.platform_settings where id = 1;
  select jsonb_build_object(
    'businesses', count(*),
    'trial',   count(*) filter (where plan = 'trial' and paid_until > now() and not is_blocked),
    'paid',    count(*) filter (where plan <> 'trial' and paid_until > now() and not is_blocked),
    'expired', count(*) filter (where paid_until <= now()),
    'blocked', count(*) filter (where is_blocked),
    'mrr', coalesce(sum(case when plan = 'start' then s.price_start when plan = 'business' then s.price_business end)
                    filter (where plan <> 'trial' and paid_until > now() and not is_blocked), 0),
    'new_30d', count(*) filter (where created_at > now() - interval '30 days'),
    'pending_payments', (select count(*) from public.payment_requests where status = 'pending'),
    'paid_30d', (select coalesce(sum(amount), 0) from public.payment_requests
                 where status = 'approved' and processed_at > now() - interval '30 days'),
    'bookings_30d', (select count(*) from public.bookings k join public.businesses z on z.id = k.business_id
                     where not z.is_demo and k.created_at > now() - interval '30 days'))
  into r from public.businesses where not is_demo;
  return r;
end $$;

create or replace function public.admin_businesses() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into r
  from (
    select b.id, b.name, b.slug, b.category, b.phone, b.plan, b.paid_until, b.is_blocked, b.is_demo,
           b.created_at, u.email, (b.tg_chat_id is not null) as tg,
           (select count(*) from public.staff s where s.business_id = b.id and s.is_active) as staff,
           (select count(*) from public.services s where s.business_id = b.id and s.is_active) as services,
           (select count(*) from public.bookings k where k.business_id = b.id and k.created_at > now() - interval '30 days') as bookings_30d,
           (select count(*) from public.bookings k where k.business_id = b.id and k.source = 'online' and k.created_at > now() - interval '30 days') as online_30d
    from public.businesses b
    left join auth.users u on u.id = b.owner_id
  ) x;
  return r;
end $$;

create or replace function public.admin_payments() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by (x.status = 'pending') desc, x.created_at desc), '[]'::jsonb) into r
  from (
    select p.*, b.name as business_name, b.slug, b.paid_until, u.email
    from public.payment_requests p
    join public.businesses b on b.id = p.business_id
    left join auth.users u on u.id = b.owner_id
    order by p.created_at desc limit 300
  ) x;
  return r;
end $$;

create or replace function public.admin_process_payment(p_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r public.payment_requests; b public.businesses; v_support text;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select * into r from public.payment_requests where id = p_id for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if r.status <> 'pending' then raise exception 'Заявка уже обработана'; end if;
  if p_approve then
    update public.businesses
    set plan = r.plan, paid_until = greatest(paid_until, now()) + make_interval(months => r.months)
    where id = r.business_id returning * into b;
    update public.payment_requests set status = 'approved', processed_at = now() where id = p_id;
    perform private.notify(b.tg_chat_id,
      '✅ Оплата получена, спасибо!' || E'\nТариф «' || private.plan_title(b.plan) || '» активен до '
      || to_char(b.paid_until at time zone b.timezone, 'DD.MM.YYYY') || '.', null, b.id, null, 'payment_ok');
  else
    update public.payment_requests set status = 'rejected', processed_at = now() where id = p_id;
    select * into b from public.businesses where id = r.business_id;
    select support_contact into v_support from public.platform_settings where id = 1;
    perform private.notify(b.tg_chat_id,
      '⚠️ Мы не нашли ваш перевод по заявке на ' || private.money(r.amount) || '.'
      || coalesce(E'\nНапишите в поддержку: ' || private.h(nullif(v_support, '')), ''), null, b.id, null, 'payment_rejected');
  end if;
  return jsonb_build_object('ok', true, 'paid_until', b.paid_until);
end $$;

create or replace function public.admin_update_business(p_id uuid, p_plan text, p_paid_until timestamptz, p_blocked boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if p_plan not in ('trial', 'start', 'business') then raise exception 'Неверный тариф'; end if;
  update public.businesses set plan = p_plan, paid_until = p_paid_until, is_blocked = p_blocked where id = p_id;
end $$;

create or replace function public.admin_tg_info() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s private.secrets; v_user text;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select * into s from private.secrets where id = 1;
  select bot_username into v_user from public.platform_settings where id = 1;
  return jsonb_build_object('token_set', s.tg_bot_token is not null, 'bot_username', v_user,
                            'admin_link_code', s.admin_link_code, 'admin_chat_connected', s.admin_chat_id is not null);
end $$;

create or replace function public.admin_test_message() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_chat bigint;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select admin_chat_id into v_chat from private.secrets where id = 1;
  if v_chat is null then raise exception 'Сначала подключите уведомления администратора'; end if;
  perform private.notify(v_chat, '🔔 Тестовое сообщение: уведомления работают.', null, null, null, 'admin_test');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  Функции для Telegram-бота (только для edge-функции, ключ service_role)
-- ---------------------------------------------------------------------
create or replace function public.tg_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', tg_bot_token, 'secret', tg_webhook_secret) from private.secrets where id = 1
$$;

create or replace function public.tg_save_bot(p_token text, p_username text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update private.secrets set tg_bot_token = p_token where id = 1;
  update public.platform_settings set bot_username = p_username, updated_at = now() where id = 1;
end $$;

create or replace function public.tg_handle_start(p_chat_id bigint, p_payload text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  k public.bookings; b public.businesses;
  v_payload text := coalesce(p_payload, '');
  v_brand text;
begin
  select brand into v_brand from public.platform_settings where id = 1;

  if left(v_payload, 2) = 'b_' then
    select * into k from public.bookings where token = substr(v_payload, 3);
    if not found then
      return jsonb_build_object('text', 'Запись не найдена — возможно, она была удалена.');
    end if;
    update public.bookings set tg_chat_id = p_chat_id where id = k.id returning * into k;
    update public.clients set tg_chat_id = p_chat_id where id = k.client_id;
    select * into b from public.businesses where id = k.business_id;
    if k.status = 'cancelled' then
      return jsonb_build_object('text', 'Эта запись отменена.' || E'\n\n' || private.booking_card(k, b));
    end if;
    return jsonb_build_object(
      'text', '🔔 Готово! Я напомню о записи за день и за 2 часа.' || E'\n\n' || private.booking_card(k, b),
      'reply_markup', private.booking_buttons(k));

  elsif left(v_payload, 2) = 'o_' then
    update public.businesses set tg_chat_id = p_chat_id where tg_link_code = substr(v_payload, 3) returning * into b;
    if not found then
      return jsonb_build_object('text', 'Ссылка устарела. Откройте кабинет → «Настройки» и нажмите «Подключить Telegram» ещё раз.');
    end if;
    return jsonb_build_object('text', '✅ Уведомления для «' || private.h(b.name) || '» подключены.'
      || E'\nСюда будут приходить новые онлайн-записи и отмены.');

  elsif left(v_payload, 4) = 'adm_' then
    update private.secrets set admin_chat_id = p_chat_id where id = 1 and admin_link_code = substr(v_payload, 5);
    if not found then return jsonb_build_object('text', 'Неверная ссылка администратора.'); end if;
    return jsonb_build_object('text', '✅ Уведомления администратора ' || private.h(v_brand)
      || ' подключены: новые регистрации и заявки на оплату.');
  end if;

  return jsonb_build_object('text', 'Здравствуйте! Я бот ' || private.h(v_brand) || ' — присылаю напоминания о записях.'
    || E'\n\nЧтобы получать напоминания, после записи нажмите кнопку «Напомнить в Telegram» на странице вашей записи.');
end $$;

create or replace function public.tg_handle_callback(p_chat_id bigint, p_data text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare k public.bookings; b public.businesses; v_act text := left(coalesce(p_data, ''), 1);
begin
  select * into k from public.bookings where token = substr(coalesce(p_data, ''), 3) and tg_chat_id = p_chat_id;
  if not found then return jsonb_build_object('answer', 'Запись не найдена', 'remove_buttons', true); end if;
  select * into b from public.businesses where id = k.business_id;
  if k.status = 'cancelled' then return jsonb_build_object('answer', 'Запись уже отменена', 'remove_buttons', true); end if;
  if k.starts_at <= now() then return jsonb_build_object('answer', 'Время записи уже прошло', 'remove_buttons', true); end if;

  if v_act = 'c' then
    update public.bookings set status = 'confirmed' where id = k.id and status = 'booked';
    select * into k from public.bookings where id = k.id;
    return jsonb_build_object('answer', 'Спасибо! Ждём вас 🙌', 'reply_markup', private.booking_buttons(k));
  elsif v_act = 'x' then
    perform set_config('app.actor', 'client', true);
    update public.bookings set status = 'cancelled' where id = k.id returning * into k;
    if not b.is_demo then
      perform private.notify(b.tg_chat_id, '❌ Клиент отменил запись' || E'\n\n' || private.owner_card(k, b),
                             null, b.id, k.id, 'owner_cancel');
    end if;
    return jsonb_build_object('answer', 'Запись отменена', 'remove_buttons', true,
                              'text', 'Запись отменена. Будем рады видеть вас в другой раз!');
  end if;
  return jsonb_build_object('answer', '');
end $$;

-- ---------------------------------------------------------------------
--  Задачи по расписанию
-- ---------------------------------------------------------------------
create or replace function private.run_reminders() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- за сутки
  with due as (
    update public.bookings k set reminded_24 = true
    from public.businesses b
    where b.id = k.business_id and b.remind_24h and private.biz_active(b)
      and k.status in ('booked', 'confirmed') and k.tg_chat_id is not null and not k.reminded_24
      and k.starts_at > now() + interval '3 hours' and k.starts_at <= now() + interval '24 hours'
      and k.created_at < now() - interval '1 hour'
    returning k.id
  )
  insert into public.notifications (chat_id, text, reply_markup, business_id, booking_id, kind)
  select k.tg_chat_id, '⏰ Напоминаем о записи' || E'\n\n' || private.booking_card(k, b),
         private.booking_buttons(k), b.id, k.id, 'remind_24'
  from due join public.bookings k on k.id = due.id join public.businesses b on b.id = k.business_id;

  -- за 2 часа
  with due as (
    update public.bookings k set reminded_2 = true
    from public.businesses b
    where b.id = k.business_id and b.remind_2h and private.biz_active(b)
      and k.status in ('booked', 'confirmed') and k.tg_chat_id is not null and not k.reminded_2
      and k.starts_at > now() and k.starts_at <= now() + interval '2 hours'
      and k.created_at < now() - interval '30 minutes'
    returning k.id
  )
  insert into public.notifications (chat_id, text, reply_markup, business_id, booking_id, kind)
  select k.tg_chat_id, '⏰ Скоро ваша запись — в ' || to_char(k.starts_at at time zone b.timezone, 'HH24:MI')
         || E'\n\n' || private.booking_card(k, b),
         private.booking_buttons(k), b.id, k.id, 'remind_2'
  from due join public.bookings k on k.id = due.id join public.businesses b on b.id = k.business_id;
end $$;

create or replace function private.run_daily() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- предупреждения об окончании подписки (за 3 дня, за 1 день, в день окончания)
  insert into public.notifications (chat_id, text, business_id, kind)
  select b.tg_chat_id,
         case when x.days_left = 0
           then '⛔ Сегодня заканчивается подписка для «' || private.h(b.name) || '». Продлите её в кабинете → «Подписка», чтобы онлайн-запись не остановилась.'
           else '⚠️ Подписка для «' || private.h(b.name) || '» закончится через ' || x.days_left
                || case when x.days_left = 1 then ' день' else ' дня' end
                || ' (' || to_char(b.paid_until at time zone b.timezone, 'DD.MM.YYYY') || '). Продлить: кабинет → «Подписка».'
         end,
         b.id, 'expiry'
  from public.businesses b,
       lateral (select (b.paid_until at time zone b.timezone)::date - (now() at time zone b.timezone)::date as days_left) x
  where not b.is_demo and not b.is_blocked and b.tg_chat_id is not null and x.days_left in (0, 1, 3);

  -- демо-записи живут не дольше 2 дней
  delete from public.bookings k using public.businesses b
  where b.id = k.business_id and b.is_demo and (k.starts_at < now() or k.created_at < now() - interval '2 days');
  delete from public.clients c using public.businesses b
  where b.id = c.business_id and b.is_demo and not exists (select 1 from public.bookings k where k.client_id = c.id);

  delete from public.notifications where created_at < now() - interval '60 days';
end $$;

-- ---------------------------------------------------------------------
--  Права доступа и RLS
-- ---------------------------------------------------------------------
alter table public.platform_settings enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.businesses       enable row level security;
alter table public.staff            enable row level security;
alter table public.services         enable row level security;
alter table public.staff_services   enable row level security;
alter table public.working_hours    enable row level security;
alter table public.time_off         enable row level security;
alter table public.clients          enable row level security;
alter table public.bookings         enable row level security;
alter table public.payment_requests enable row level security;
alter table public.notifications    enable row level security;

drop policy if exists ps_read  on public.platform_settings;
create policy ps_read  on public.platform_settings for select to anon, authenticated using (true);
drop policy if exists ps_admin on public.platform_settings;
create policy ps_admin on public.platform_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists pa_self on public.platform_admins;
create policy pa_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists biz_select on public.businesses;
create policy biz_select on public.businesses for select to authenticated using (owner_id = auth.uid());
drop policy if exists biz_update on public.businesses;
create policy biz_update on public.businesses for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['staff', 'services', 'staff_services', 'working_hours', 'time_off', 'clients', 'bookings'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (public.is_owner(business_id)) with check (public.is_owner(business_id))', t);
  end loop;
end $$;

drop policy if exists pr_select on public.payment_requests;
create policy pr_select on public.payment_requests for select to authenticated using (public.is_owner(business_id));

-- Табличные права: анониму — только чтение настроек платформы; остальное — через функции
revoke all on all tables in schema public from anon;
grant select on public.platform_settings to anon;

revoke insert, update, delete on public.platform_settings from authenticated;
grant update (brand, site_url, kaspi_details, support_contact, price_start, price_business, trial_days)
  on public.platform_settings to authenticated;

revoke insert, update, delete on public.platform_admins from authenticated;
revoke insert, update, delete on public.payment_requests from authenticated;
revoke all on public.notifications from authenticated;

revoke insert, update, delete on public.businesses from authenticated;
grant update (name, slug, category, phone, address, description, timezone, slot_step,
              min_notice_min, max_days_ahead, remind_24h, remind_2h)
  on public.businesses to authenticated;

revoke insert, update on public.bookings from authenticated;
grant insert (business_id, staff_id, service_id, starts_at, ends_at, status, client_name, client_phone, comment, price)
  on public.bookings to authenticated;
grant update (staff_id, service_id, starts_at, ends_at, status, client_name, client_phone, comment, price)
  on public.bookings to authenticated;

revoke insert, update on public.clients from authenticated;
grant insert (business_id, name, phone, notes) on public.clients to authenticated;
grant update (name, phone, notes) on public.clients to authenticated;

-- Функции: служебные — только для service_role
revoke execute on function public.tg_config()                         from public, anon, authenticated;
revoke execute on function public.tg_save_bot(text, text)             from public, anon, authenticated;
revoke execute on function public.tg_handle_start(bigint, text)       from public, anon, authenticated;
revoke execute on function public.tg_handle_callback(bigint, text)    from public, anon, authenticated;
grant  execute on function public.tg_config(), public.tg_save_bot(text, text),
                           public.tg_handle_start(bigint, text), public.tg_handle_callback(bigint, text) to service_role;

-- Функции владельца и админа — только для вошедших
revoke execute on function public.create_business(text, text, text, text, text, text) from public, anon;
revoke execute on function public.check_slug(text)                    from public, anon;
revoke execute on function public.owner_set_hours(uuid, jsonb)        from public, anon;
revoke execute on function public.owner_set_service_staff(uuid, uuid[]) from public, anon;
revoke execute on function public.owner_clients(text)                 from public, anon;
revoke execute on function public.owner_stats(timestamptz, timestamptz) from public, anon;
revoke execute on function public.owner_unlink_tg()                   from public, anon;
revoke execute on function public.request_payment(text, int, text)    from public, anon;
revoke execute on function public.claim_admin(text)                   from public, anon;
revoke execute on function public.admin_overview()                    from public, anon;
revoke execute on function public.admin_businesses()                  from public, anon;
revoke execute on function public.admin_payments()                    from public, anon;
revoke execute on function public.admin_process_payment(uuid, boolean) from public, anon;
revoke execute on function public.admin_update_business(uuid, text, timestamptz, boolean) from public, anon;
revoke execute on function public.admin_tg_info()                     from public, anon;
revoke execute on function public.admin_test_message()                from public, anon;
grant execute on function
  public.create_business(text, text, text, text, text, text), public.check_slug(text),
  public.owner_set_hours(uuid, jsonb), public.owner_set_service_staff(uuid, uuid[]),
  public.owner_clients(text), public.owner_stats(timestamptz, timestamptz), public.owner_unlink_tg(),
  public.request_payment(text, int, text), public.claim_admin(text),
  public.admin_overview(), public.admin_businesses(), public.admin_payments(),
  public.admin_process_payment(uuid, boolean), public.admin_update_business(uuid, text, timestamptz, boolean),
  public.admin_tg_info(), public.admin_test_message()
to authenticated;

-- Публичные функции страницы записи
grant execute on function
  public.get_public_business(text), public.get_slots(text, uuid, uuid, date),
  public.get_free_days(text, uuid, uuid, date, int),
  public.create_booking(text, uuid, uuid, timestamptz, text, text, text),
  public.get_booking(text), public.cancel_booking(text)
to anon, authenticated;

-- ---------------------------------------------------------------------
--  Расписание
-- ---------------------------------------------------------------------
select cron.schedule('kezek-reminders', '* * * * *', $cron$select private.run_reminders()$cron$);
select cron.schedule('kezek-daily', '0 3 * * *', $cron$select private.run_daily()$cron$);

-- ---------------------------------------------------------------------
--  Демо-бизнес для показа клиентам (страница book.html?b=demo)
-- ---------------------------------------------------------------------
do $$
declare v_b uuid; s1 uuid; s2 uuid; sv1 uuid; sv2 uuid; sv3 uuid; sv4 uuid;
begin
  if exists (select 1 from public.businesses where slug = 'demo') then return; end if;
  insert into public.businesses (name, slug, category, phone, address, description, plan, paid_until, is_demo, min_notice_min, slot_step)
  values ('Барбершоп «Демо»', 'demo', 'Барбершоп', '+7 700 000 00 00', 'г. Алматы, пр. Абая, 1',
          'Это демонстрационная страница. Записи здесь настоящие, но удаляются автоматически.',
          'business', '2099-01-01', true, 30, 30)
  returning id into v_b;
  insert into public.staff (business_id, name, title, sort) values (v_b, 'Алихан', 'Топ-барбер', 1) returning id into s1;
  insert into public.staff (business_id, name, title, sort) values (v_b, 'Данияр', 'Барбер', 2) returning id into s2;
  delete from public.working_hours where business_id = v_b;
  insert into public.working_hours (business_id, staff_id, weekday, start_time, end_time)
  select v_b, s, d, '10:00', '21:00' from unnest(array[s1, s2]) s, generate_series(1, 7) d;
  insert into public.services (business_id, name, duration_min, price, sort) values (v_b, 'Мужская стрижка', 60, 6000, 1) returning id into sv1;
  insert into public.services (business_id, name, duration_min, price, sort) values (v_b, 'Стрижка бороды', 30, 3500, 2) returning id into sv2;
  insert into public.services (business_id, name, duration_min, price, sort) values (v_b, 'Стрижка + борода', 90, 8500, 3) returning id into sv3;
  insert into public.services (business_id, name, duration_min, price, sort, description)
    values (v_b, 'Детская стрижка', 45, 4000, 4, 'Для детей до 12 лет') returning id into sv4;
  insert into public.staff_services (business_id, staff_id, service_id) values (v_b, s1, sv4);
end $$;
