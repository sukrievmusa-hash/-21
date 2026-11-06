-- =====================================================================
--  003: тарифы в таблице (админ меняет цены и лимиты) + ИИ-ассистент
-- =====================================================================

-- ---------------------------------------------------------------------
--  Тарифы
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  title       text not null check (length(trim(title)) between 2 and 40),
  price       int  not null default 0 check (price between 0 and 10000000),
  staff_limit int  not null default 1 check (staff_limit between 1 and 1000),
  ai          boolean not null default false,
  ai_limit    int  not null default 0 check (ai_limit between 0 and 1000000),  -- ответов ИИ в месяц
  features    text check (length(features) <= 1000),                         -- пункты через перевод строки
  is_public   boolean not null default true,   -- виден всем на сайте и в кабинете
  is_active   boolean not null default true,   -- можно оплатить
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.plans (code, title, price, staff_limit, ai, ai_limit, features, is_public, sort)
select v.code, v.title,
       case v.code when 'start' then s.price_start when 'business' then s.price_business else v.price end,
       v.staff_limit, v.ai, v.ai_limit, v.features, v.is_public, v.sort
from public.platform_settings s,
(values
  ('trial',    'Пробный', 0, 10, true, 30, null, false, 0),
  ('start',    'Старт',   0, 1, false, 0,
     E'1 сотрудник\nОнлайн-запись и журнал\nНапоминания в Telegram\nБаза клиентов', true, 10),
  ('business', 'Бизнес',  0, 10, false, 0,
     E'До 10 сотрудников\nВсё из «Старт»\nГрафик для каждого мастера\nСтатистика по команде', true, 20),
  ('network',  'Сеть',    24990, 30, false, 0,
     E'До 30 сотрудников\nВсё из «Бизнес»\nДля сетей и больших салонов', true, 30),
  ('premium',  'Премиум + ИИ', 34990, 30, true, 2000,
     E'До 30 сотрудников\nВсё из «Сеть»\nИИ-ассистент отвечает клиентам в Telegram 24/7\nИИ сам записывает клиентов\nДо 2000 ответов ИИ в месяц', true, 40)
) as v(code, title, price, staff_limit, ai, ai_limit, features, is_public, sort)
on conflict (code) do nothing;

alter table public.businesses drop constraint if exists businesses_plan_check;
alter table public.businesses drop constraint if exists businesses_plan_fkey;
alter table public.businesses add constraint businesses_plan_fkey foreign key (plan) references public.plans(code) on update cascade;
alter table public.payment_requests drop constraint if exists payment_requests_plan_check;
alter table public.payment_requests drop constraint if exists payment_requests_plan_fkey;
alter table public.payment_requests add constraint payment_requests_plan_fkey foreign key (plan) references public.plans(code) on update cascade;

-- Кто отвечает клиенту из чата владельца (кнопка «Ответить»)
alter table public.businesses add column if not exists tg_reply_to bigint;

alter table public.plans enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to anon, authenticated
  using ((is_public and is_active)
         or public.is_admin()
         or exists (select 1 from public.businesses b where b.owner_id = auth.uid() and b.plan = plans.code));
drop policy if exists plans_admin_ins on public.plans;
create policy plans_admin_ins on public.plans for insert to authenticated with check (public.is_admin());
drop policy if exists plans_admin_upd on public.plans;
create policy plans_admin_upd on public.plans for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant insert, update on public.plans to authenticated;

create or replace function private.plan_staff_limit(p text) returns int
language sql stable set search_path = public, extensions as $$
  select coalesce((select staff_limit from public.plans where code = p), 1)
$$;

create or replace function private.plan_title(p text) returns text
language sql stable set search_path = public, extensions as $$
  select coalesce((select title from public.plans where code = p), p)
$$;

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
      raise exception 'На тарифе «%» можно сотрудников: %. Выберите тариф побольше в разделе «Подписка»',
        private.plan_title(v_plan), v_lim;
    end if;
  end if;
  return new;
end $$;

create or replace function public.request_payment(p_plan text, p_months int, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; p public.plans; v_amount int; v_id uuid; v_pending int;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if not found then raise exception 'Бизнес не найден'; end if;
  select * into p from public.plans where code = p_plan;
  if not found or p.code = 'trial' or not p.is_active or (not p.is_public and b.plan <> p.code) or p.price <= 0 then
    raise exception 'Этот тариф недоступен для оплаты';
  end if;
  if p_months not in (1, 3, 6, 12) then raise exception 'Неверный срок'; end if;
  if length(trim(coalesce(p_note, ''))) < 2 then
    raise exception 'Укажите имя отправителя перевода — так мы найдём ваш платёж';
  end if;
  select count(*) into v_pending from public.payment_requests where business_id = b.id and status = 'pending';
  if v_pending >= 3 then raise exception 'У вас уже есть заявки на проверке. Дождитесь подтверждения'; end if;
  v_amount := p.price * (case p_months when 12 then 10 else p_months end);
  insert into public.payment_requests (business_id, plan, months, amount, payer_note)
  values (b.id, p.code, p_months, v_amount, left(trim(p_note), 200))
  returning id into v_id;
  perform private.notify_admin('💰 Заявка на оплату' || E'\n<b>' || private.h(b.name) || '</b> (' || b.slug || ')'
    || E'\nТариф: ' || private.h(p.title) || ', ' || p_months || ' мес.'
    || E'\nСумма: ' || private.money(v_amount)
    || E'\nОтправитель: ' || private.h(p_note)
    || E'\n\nПроверьте поступление в Kaspi и подтвердите заявку в админке.');
  return jsonb_build_object('id', v_id, 'amount', v_amount);
end $$;

create or replace function public.admin_update_business(p_id uuid, p_plan text, p_paid_until timestamptz, p_blocked boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'Неверный тариф'; end if;
  update public.businesses set plan = p_plan, paid_until = p_paid_until, is_blocked = p_blocked where id = p_id;
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select jsonb_build_object(
    'businesses', count(*),
    'trial',   count(*) filter (where b.plan = 'trial' and b.paid_until > now() and not b.is_blocked),
    'paid',    count(*) filter (where b.plan <> 'trial' and b.paid_until > now() and not b.is_blocked),
    'expired', count(*) filter (where b.paid_until <= now()),
    'blocked', count(*) filter (where b.is_blocked),
    'mrr', coalesce(sum(p.price) filter (where b.plan <> 'trial' and b.paid_until > now() and not b.is_blocked), 0),
    'new_30d', count(*) filter (where b.created_at > now() - interval '30 days'),
    'pending_payments', (select count(*) from public.payment_requests where status = 'pending'),
    'paid_30d', (select coalesce(sum(amount), 0) from public.payment_requests
                 where status = 'approved' and processed_at > now() - interval '30 days'),
    'bookings_30d', (select count(*) from public.bookings k join public.businesses z on z.id = k.business_id
                     where not z.is_demo and k.created_at > now() - interval '30 days'),
    'ai_30d', (select count(*) from public.ai_messages m where m.role = 'assistant' and m.chat_id <> 0
               and m.created_at > now() - interval '30 days'),
    'ai_tokens_30d', (select coalesce(sum(tokens_in + tokens_out), 0) from public.ai_messages m
                      where m.created_at > now() - interval '30 days'))
  into r from public.businesses b left join public.plans p on p.code = b.plan where not b.is_demo;
  return r;
end $$;

-- ---------------------------------------------------------------------
--  ИИ-ассистент
-- ---------------------------------------------------------------------
alter table private.secrets add column if not exists ai_api_key text;
alter table public.platform_settings add column if not exists ai_model text not null default 'claude-haiku-5-5';
grant update (ai_model) on public.platform_settings to authenticated;

create table if not exists public.business_ai (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  enabled      boolean not null default false,
  bot_name     text not null default 'Ассистент' check (length(trim(bot_name)) between 1 and 40),
  knowledge    text not null default '' check (length(knowledge) <= 15000),
  instructions text not null default '' check (length(instructions) <= 2000),
  can_book     boolean not null default true,
  limit_notified_month date,
  updated_at   timestamptz not null default now()
);
alter table public.business_ai enable row level security;
drop policy if exists owner_all on public.business_ai;
create policy owner_all on public.business_ai for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));
revoke all on public.business_ai from anon, authenticated;
grant select, insert on public.business_ai to authenticated;
grant update (enabled, bot_name, knowledge, instructions, can_book, updated_at) on public.business_ai to authenticated;

-- С кем сейчас разговаривает клиент в Telegram
create table if not exists public.ai_chats (
  chat_id      bigint primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  tg_name      text,
  tg_username  text,
  muted_until  timestamptz,           -- владелец отвечает сам — ИИ молчит
  updated_at   timestamptz not null default now()
);
create index if not exists ai_chats_business_idx on public.ai_chats (business_id, updated_at desc);
alter table public.ai_chats enable row level security;
revoke all on public.ai_chats from anon, authenticated;

create table if not exists public.ai_messages (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  chat_id     bigint not null,          -- 0 — проверка из кабинета
  role        text not null check (role in ('user', 'assistant', 'owner')),
  content     text not null check (length(content) <= 4000),
  tokens_in   int not null default 0,
  tokens_out  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ai_messages_chat_idx on public.ai_messages (business_id, chat_id, created_at desc);
create index if not exists ai_messages_month_idx on public.ai_messages (business_id, created_at) where role = 'assistant';
alter table public.ai_messages enable row level security;
revoke all on public.ai_messages from anon, authenticated;

create or replace function private.biz_ai_ready(b public.businesses) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select private.biz_active(b)
    and coalesce((select ai from public.plans where code = b.plan), false)
    and coalesce((select enabled from public.business_ai where business_id = b.id), false)
    and (select ai_api_key is not null from private.secrets where id = 1)
$$;

create or replace function private.ai_used(p_business uuid) returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from public.ai_messages
  where business_id = p_business and role = 'assistant' and created_at >= date_trunc('month', now())
$$;

create or replace function private.biz_hours_text(p_business uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(string_agg(
    (array['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])[d] || ': ' ||
      coalesce((select to_char(min(w.start_time), 'HH24:MI') || '–' || to_char(max(w.end_time), 'HH24:MI')
                from public.working_hours w join private.bookable_staff(p_business) s on s.id = w.staff_id
                where w.weekday = d having count(*) > 0), 'выходной'),
    '; ' order by d), '')
  from generate_series(1, 7) d
$$;

-- Страница записи: показать кнопку «Задать вопрос»
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

-- ---------- Кабинет владельца ----------
create or replace function public.owner_ai_info() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; p public.plans; a public.business_ai;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if not found then raise exception 'Бизнес не найден'; end if;
  insert into public.business_ai (business_id) values (b.id) on conflict do nothing;
  select * into a from public.business_ai where business_id = b.id;
  select * into p from public.plans where code = b.plan;
  return jsonb_build_object(
    'settings', to_jsonb(a) - 'limit_notified_month',
    'plan_ai', coalesce(p.ai, false), 'limit', coalesce(p.ai_limit, 0), 'used', private.ai_used(b.id),
    'ready', private.biz_ai_ready(b),
    'platform_ready', (select ai_api_key is not null from private.secrets where id = 1),
    'bot_username', (select bot_username from public.platform_settings where id = 1),
    'chats', (select count(*) from public.ai_chats where business_id = b.id));
end $$;

create or replace function public.owner_ai_dialogs() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where owner_id = auth.uid();
  if v_biz is null then raise exception 'Бизнес не найден'; end if;
  return (select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb) from (
    select m.chat_id, max(m.created_at) as last_at, count(*) as n,
           (select content from public.ai_messages z where z.business_id = v_biz and z.chat_id = m.chat_id
            order by z.created_at desc, z.id desc limit 1) as last_text,
           c.tg_name, c.tg_username, (c.muted_until > now()) as muted,
           (select k.client_name from public.bookings k where k.business_id = v_biz and k.tg_chat_id = m.chat_id
            order by k.created_at desc limit 1) as client_name
    from public.ai_messages m left join public.ai_chats c on c.chat_id = m.chat_id and c.business_id = v_biz
    where m.business_id = v_biz and m.chat_id <> 0 and m.created_at > now() - interval '60 days'
    group by m.chat_id, c.tg_name, c.tg_username, c.muted_until
    order by max(m.created_at) desc limit 100) x);
end $$;

create or replace function public.owner_ai_messages(p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses where owner_id = auth.uid();
  if v_biz is null then raise exception 'Бизнес не найден'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content, 'at', created_at) order by created_at, id), '[]'::jsonb)
          from (select * from public.ai_messages where business_id = v_biz and chat_id = p_chat
                order by created_at desc, id desc limit 200) t);
end $$;

-- Ответ владельца клиенту из кабинета
create or replace function public.owner_ai_reply(p_chat bigint, p_text text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if not found then raise exception 'Бизнес не найден'; end if;
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Пустое сообщение'; end if;
  if not exists (select 1 from public.ai_chats where chat_id = p_chat and business_id = b.id) then
    raise exception 'Клиент уже переписывается с другим бизнесом или ещё не писал';
  end if;
  perform private.owner_send(b, p_chat, p_text);
end $$;

create or replace function private.owner_send(b public.businesses, p_chat bigint, p_text text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.ai_messages (business_id, chat_id, role, content) values (b.id, p_chat, 'owner', left(trim(p_text), 4000));
  update public.ai_chats set muted_until = now() + interval '3 hours', updated_at = now() where chat_id = p_chat;
  perform private.notify(p_chat, '💬 <b>' || private.h(b.name) || '</b>:' || E'\n' || private.h(left(trim(p_text), 3500)),
                         null, b.id, null, 'owner_reply');
end $$;

create or replace function public.owner_ai_unmute(p_chat bigint) returns void
language sql security definer set search_path = public, extensions as $$
  update public.ai_chats set muted_until = null
  where chat_id = p_chat and business_id = (select id from public.businesses where owner_id = auth.uid())
$$;

-- ---------- Для edge-функции (service_role) ----------
create or replace function public.admin_set_ai(p_key text, p_model text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  if p_key is not null then
    if p_key = '' then update private.secrets set ai_api_key = null where id = 1;
    elsif p_key !~ '^sk-ant-[A-Za-z0-9_-]{20,}$' then raise exception 'Ключ должен начинаться с sk-ant-';
    else update private.secrets set ai_api_key = trim(p_key) where id = 1; end if;
  end if;
  if nullif(trim(coalesce(p_model, '')), '') is not null then
    update public.platform_settings set ai_model = trim(p_model), updated_at = now() where id = 1;
  end if;
end $$;

create or replace function public.admin_tg_info() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s private.secrets; v_user text; v_model text;
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  select * into s from private.secrets where id = 1;
  select bot_username, ai_model into v_user, v_model from public.platform_settings where id = 1;
  return jsonb_build_object('token_set', s.tg_bot_token is not null, 'bot_username', v_user,
                            'admin_link_code', s.admin_link_code, 'admin_chat_connected', s.admin_chat_id is not null,
                            'ai_key_set', s.ai_api_key is not null,
                            'ai_key_hint', case when s.ai_api_key is not null then '…' || right(s.ai_api_key, 4) end,
                            'ai_model', v_model);
end $$;

-- Входящий текст в Telegram: решаем, кто ответит
create or replace function public.tg_route_text(p_chat bigint, p_text text, p_name text, p_username text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses; c public.ai_chats; p public.plans; a public.business_ai;
  v_text text := left(trim(coalesce(p_text, '')), 2000);
  v_recent int; v_used int; v_client bigint; v_who text;
begin
  if v_text = '' then return jsonb_build_object('mode', 'reply', 'text', 'Пока я понимаю только текст. Напишите вопрос словами 🙂'); end if;

  -- 1) пишет владелец бизнеса
  select * into b from public.businesses where tg_chat_id = p_chat order by created_at limit 1;
  if found then
    if b.tg_reply_to is not null then
      v_client := b.tg_reply_to;
      update public.businesses set tg_reply_to = null where id = b.id;
      if v_text ~* '^(отмена|/cancel)$' then return jsonb_build_object('mode', 'reply', 'text', 'Ответ отменён.'); end if;
      if exists (select 1 from public.ai_chats where chat_id = v_client and business_id = b.id) then
        perform private.owner_send(b, v_client, v_text);
        return jsonb_build_object('mode', 'reply', 'text', '✅ Отправлено клиенту. Ассистент не будет вмешиваться в этот диалог 3 часа.',
          'reply_markup', jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(
            jsonb_build_object('text', '🤖 Вернуть ассистента сейчас', 'callback_data', 'a:' || v_client)))));
      end if;
      return jsonb_build_object('mode', 'reply', 'text', 'Клиент уже переписывается с другим бизнесом — сообщение не отправлено.');
    end if;
    if v_text ~* '^(запомни|добавь в базу|ассистент запомни)\s*[:,\-—]?\s*' then
      v_text := regexp_replace(v_text, '^(запомни|добавь в базу|ассистент запомни)\s*[:,\-—]?\s*', '', 'i');
      if length(v_text) < 3 then return jsonb_build_object('mode', 'reply', 'text', 'Напишите после «Запомни:» сам факт. Например: «Запомни: парковка бесплатная во дворе».'); end if;
      insert into public.business_ai (business_id) values (b.id) on conflict do nothing;
      update public.business_ai
        set knowledge = left(trim(both E'\n' from knowledge || E'\n' || '- ' || v_text), 15000), updated_at = now()
        where business_id = b.id;
      return jsonb_build_object('mode', 'reply', 'text', '✅ Запомнил: ' || private.h(v_text)
        || E'\n\nВсю базу знаний можно посмотреть и поправить в кабинете → «ИИ-ассистент».');
    end if;
    return jsonb_build_object('mode', 'reply', 'text',
      'Это чат уведомлений «' || private.h(b.name) || '».'
      || E'\n\n• Научить ИИ-ассистента: напишите «Запомни: …» (например, «Запомни: парковка бесплатная во дворе»).'
      || E'\n• Ответить клиенту: нажмите «Ответить» под его вопросом.');
  end if;

  -- 2) пишет клиент
  select * into c from public.ai_chats where chat_id = p_chat;
  if not found then
    select bz.* into b from public.bookings k join public.businesses bz on bz.id = k.business_id
      where k.tg_chat_id = p_chat order by k.created_at desc limit 1;
    if not found then
      return jsonb_build_object('mode', 'reply', 'text',
        'Здравствуйте! Чтобы задать вопрос, откройте страницу записи нужного места и нажмите «Задать вопрос в Telegram».');
    end if;
    insert into public.ai_chats (chat_id, business_id) values (p_chat, b.id) returning * into c;
  end if;
  update public.ai_chats set tg_name = left(p_name, 80), tg_username = left(p_username, 40), updated_at = now()
    where chat_id = p_chat returning * into c;
  select * into b from public.businesses where id = c.business_id;

  select count(*) into v_recent from public.ai_messages
    where chat_id = p_chat and role = 'user' and created_at > now() - interval '10 minutes';
  if v_recent >= 15 then
    return jsonb_build_object('mode', 'reply', 'text', 'Слишком много сообщений подряд. Подождите несколько минут, пожалуйста.');
  end if;

  insert into public.ai_messages (business_id, chat_id, role, content) values (b.id, p_chat, 'user', v_text);
  v_who := coalesce(nullif(trim(p_name), ''), 'Клиент') || coalesce(' (@' || nullif(p_username, '') || ')', '');

  if not private.biz_active(b) then
    return jsonb_build_object('mode', 'reply', 'text', 'Сейчас онлайн-ответы недоступны.'
      || coalesce(E'\nПозвоните, пожалуйста: ' || coalesce(private.fmt_phone(private.norm_phone(b.phone)), nullif(b.phone, '')), ''));
  end if;

  -- владелец сейчас отвечает сам
  if c.muted_until > now() then
    perform private.ask_owner(b, p_chat, v_who, v_text, null);
    return jsonb_build_object('mode', 'silent');
  end if;

  if private.biz_ai_ready(b) then
    select * into p from public.plans where code = b.plan;
    v_used := private.ai_used(b.id);
    if v_used < p.ai_limit then
      return jsonb_build_object('mode', 'ai', 'business_id', b.id);
    end if;
    select * into a from public.business_ai where business_id = b.id;
    if a.limit_notified_month is distinct from date_trunc('month', now())::date then
      update public.business_ai set limit_notified_month = date_trunc('month', now())::date where business_id = b.id;
      perform private.notify(b.tg_chat_id, '⚠️ ИИ-ассистент израсходовал лимит ответов на этот месяц (' || p.ai_limit
        || '). Новые вопросы клиентов будут приходить вам сюда. Увеличить лимит — кабинет → «Подписка».', null, b.id, null, 'ai_limit');
    end if;
  end if;

  -- нет ИИ — передаём владельцу
  if b.tg_chat_id is not null then
    perform private.ask_owner(b, p_chat, v_who, v_text, null);
    return jsonb_build_object('mode', 'reply', 'text', '📨 Передал ваше сообщение в «' || private.h(b.name) || '». Вам ответят здесь.'
      || coalesce(E'\nСрочно — звоните: ' || coalesce(private.fmt_phone(private.norm_phone(b.phone)), nullif(b.phone, '')), ''));
  end if;
  return jsonb_build_object('mode', 'reply', 'text', 'Чтобы получить ответ, позвоните, пожалуйста'
    || coalesce(': ' || coalesce(private.fmt_phone(private.norm_phone(b.phone)), nullif(b.phone, '')), ' в «' || private.h(b.name) || '»') || '.');
end $$;

create or replace function private.ask_owner(b public.businesses, p_chat bigint, p_who text, p_text text, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform private.notify(b.tg_chat_id,
    '❓ <b>' || private.h(p_who) || '</b> пишет:' || E'\n' || private.h(left(p_text, 2000))
    || coalesce(E'\n\n🤖 ' || private.h(nullif(p_note, '')), ''),
    jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(
      jsonb_build_object('text', '✍️ Ответить', 'callback_data', 'r:' || p_chat)))),
    b.id, null, 'owner_question');
end $$;

-- Контекст для ИИ: данные бизнеса, база знаний, история диалога
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
      'max_days_ahead', b.max_days_ahead, 'hours', private.biz_hours_text(b.id)),
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

create or replace function public.ai_save_reply(p_business uuid, p_chat bigint, p_text text, p_in int, p_out int) returns void
language sql security definer set search_path = public, extensions as $$
  insert into public.ai_messages (business_id, chat_id, role, content, tokens_in, tokens_out)
  values (p_business, p_chat, 'assistant', left(coalesce(nullif(trim(p_text), ''), '…'), 4000), coalesce(p_in, 0), coalesce(p_out, 0))
$$;

-- Тест из кабинета: сообщение владельца как клиента (chat_id = 0)
create or replace function public.ai_test_prepare(p_user uuid, p_text text, p_reset boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; p public.plans; v_n int;
begin
  select * into b from public.businesses where owner_id = p_user;
  if not found then raise exception 'Бизнес не найден'; end if;
  select * into p from public.plans where code = b.plan;
  if not coalesce(p.ai, false) then raise exception 'ИИ-ассистент доступен на тарифе с ИИ'; end if;
  if not private.biz_active(b) then raise exception 'Подписка закончилась'; end if;
  if (select ai_api_key is null from private.secrets where id = 1) then raise exception 'ИИ ещё не подключён администратором платформы'; end if;
  if private.ai_used(b.id) >= p.ai_limit then raise exception 'Лимит ответов ИИ на этот месяц исчерпан'; end if;
  select count(*) into v_n from public.ai_messages where business_id = b.id and chat_id = 0 and role = 'user' and created_at > now() - interval '1 hour';
  if v_n >= 40 then raise exception 'Слишком много тестовых сообщений. Попробуйте через час'; end if;
  if p_reset then delete from public.ai_messages where business_id = b.id and chat_id = 0; end if;
  insert into public.business_ai (business_id) values (b.id) on conflict do nothing;
  insert into public.ai_messages (business_id, chat_id, role, content) values (b.id, 0, 'user', left(trim(p_text), 2000));
  return jsonb_build_object('business_id', b.id);
end $$;

-- Запись клиента через ИИ
create or replace function public.ai_book(p_business uuid, p_chat bigint, p_service uuid, p_local text,
                                          p_name text, p_phone text, p_staff uuid default null, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; v_ts timestamptz; v_j jsonb; k public.bookings;
begin
  select * into b from public.businesses where id = p_business;
  if not coalesce((select can_book from public.business_ai where business_id = b.id), true) then
    raise exception 'Запись через ассистента отключена — дайте клиенту ссылку на страницу записи';
  end if;
  begin
    v_ts := (p_local::timestamp) at time zone b.timezone;
  exception when others then raise exception 'Неверный формат времени, нужно ГГГГ-ММ-ДД ЧЧ:ММ'; end;
  v_j := public.create_booking(b.slug, p_service, p_staff, v_ts, p_name, p_phone,
                               coalesce(nullif(trim(p_comment), ''), 'Записан ИИ-ассистентом в Telegram'));
  update public.bookings set tg_chat_id = p_chat where token = v_j->>'token' returning * into k;
  update public.clients set tg_chat_id = p_chat where id = k.client_id;
  perform private.notify(p_chat, '✅ Вы записаны!' || E'\n\n' || private.booking_card(k, b),
                         private.booking_buttons(k), b.id, k.id, 'client_new');
  return jsonb_build_object('ok', true, 'when', private.fmt_dt(k.starts_at, b.timezone), 'service', k.service_name,
                            'staff', k.staff_name, 'token', k.token);
end $$;

create or replace function public.ai_handoff(p_business uuid, p_chat bigint, p_summary text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; c public.ai_chats; v_q text;
begin
  select * into b from public.businesses where id = p_business;
  select * into c from public.ai_chats where chat_id = p_chat;
  select content into v_q from public.ai_messages where business_id = p_business and chat_id = p_chat and role = 'user'
    order by created_at desc, id desc limit 1;
  if b.tg_chat_id is null then return; end if;
  perform private.ask_owner(b, p_chat,
    coalesce(nullif(c.tg_name, ''), 'Клиент') || coalesce(' (@' || nullif(c.tg_username, '') || ')', ''),
    coalesce(v_q, ''), 'Ассистент не смог ответить сам: ' || coalesce(p_summary, ''));
end $$;

-- ---------- /start и кнопки ----------
create or replace function public.tg_handle_start(p_chat_id bigint, p_payload text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  k public.bookings; b public.businesses; a public.business_ai;
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
    insert into public.ai_chats (chat_id, business_id) values (p_chat_id, k.business_id)
      on conflict (chat_id) do update set business_id = excluded.business_id, muted_until = null, updated_at = now();
    select * into b from public.businesses where id = k.business_id;
    if k.status = 'cancelled' then
      return jsonb_build_object('text', 'Эта запись отменена.' || E'\n\n' || private.booking_card(k, b));
    end if;
    return jsonb_build_object(
      'text', '🔔 Готово! Я напомню о записи за день и за 2 часа.' || E'\n\n' || private.booking_card(k, b)
        || case when private.biz_ai_ready(b) or b.tg_chat_id is not null then E'\n\nЕсть вопрос? Просто напишите его сюда.' else '' end,
      'reply_markup', private.booking_buttons(k));

  elsif left(v_payload, 2) = 's_' then
    select * into b from public.businesses where slug = lower(substr(v_payload, 3));
    if not found then return jsonb_build_object('text', 'Страница не найдена — возможно, адрес изменился.'); end if;
    insert into public.ai_chats (chat_id, business_id) values (p_chat_id, b.id)
      on conflict (chat_id) do update set business_id = excluded.business_id, muted_until = null, updated_at = now();
    select * into a from public.business_ai where business_id = b.id;
    if private.biz_ai_ready(b) then
      return jsonb_build_object('text', '👋 Здравствуйте! Я ' || private.h(a.bot_name) || ', помощник «' || private.h(b.name) || '».'
        || E'\n\nСпросите о ценах, услугах или свободном времени — '
        || case when a.can_book then 'могу сразу записать вас.' else 'подскажу всё, что знаю.' end);
    end if;
    return jsonb_build_object('text', '👋 Здравствуйте! Это чат «' || private.h(b.name) || '».'
      || E'\nНапишите ваш вопрос — я передам его, и вам ответят здесь.');

  elsif left(v_payload, 2) = 'o_' then
    update public.businesses set tg_chat_id = p_chat_id where tg_link_code = substr(v_payload, 3) returning * into b;
    if not found then
      return jsonb_build_object('text', 'Ссылка устарела. Откройте кабинет → «Настройки» и нажмите «Подключить Telegram» ещё раз.');
    end if;
    return jsonb_build_object('text', '✅ Уведомления для «' || private.h(b.name) || '» подключены.'
      || E'\nСюда будут приходить новые онлайн-записи, отмены и вопросы клиентов.'
      || E'\n\nЧтобы научить ИИ-ассистента, напишите: «Запомни: …»');

  elsif left(v_payload, 4) = 'adm_' then
    update private.secrets set admin_chat_id = p_chat_id where id = 1 and admin_link_code = substr(v_payload, 5);
    if not found then return jsonb_build_object('text', 'Неверная ссылка администратора.'); end if;
    return jsonb_build_object('text', '✅ Уведомления администратора ' || private.h(v_brand)
      || ' подключены: новые регистрации и заявки на оплату.');
  end if;

  return jsonb_build_object('text', 'Здравствуйте! Я бот ' || private.h(v_brand) || ' — присылаю напоминания о записях и отвечаю на вопросы.'
    || E'\n\nОткройте страницу записи нужного места и нажмите «Задать вопрос в Telegram» или «Напомнить в Telegram».');
end $$;

create or replace function public.tg_handle_callback(p_chat_id bigint, p_data text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare k public.bookings; b public.businesses; v_act text := left(coalesce(p_data, ''), 1); v_client bigint; c public.ai_chats;
begin
  if v_act in ('r', 'a') then
    begin v_client := substr(p_data, 3)::bigint; exception when others then return jsonb_build_object('answer', ''); end;
    select * into c from public.ai_chats where chat_id = v_client;
    select * into b from public.businesses where id = c.business_id and tg_chat_id = p_chat_id;
    if not found then return jsonb_build_object('answer', 'Клиент уже переписывается с другим бизнесом'); end if;
    if v_act = 'r' then
      update public.businesses set tg_reply_to = v_client where id = b.id;
      return jsonb_build_object('answer', 'Напишите ответ',
        'text', '✍️ Напишите ответ для «' || private.h(coalesce(nullif(c.tg_name, ''), 'клиента')) || '» следующим сообщением. Передумали — «отмена».');
    end if;
    update public.ai_chats set muted_until = null where chat_id = v_client;
    return jsonb_build_object('answer', 'Ассистент снова отвечает', 'remove_buttons', true);
  end if;

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

-- Тесты не должны слать настоящие сообщения
create or replace function private.trg_notification_send() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if current_setting('app.no_send', true) = '1' then
    new.error := 'test';
    return new;
  end if;
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

-- Чистка старых диалогов (раз в сутки вместе с остальными задачами)
create or replace function private.ai_cleanup() returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.ai_messages where created_at < now() - interval '180 days';
  delete from public.ai_messages where chat_id = 0 and created_at < now() - interval '7 days';
$$;
select cron.unschedule('kezek-ai-cleanup') where exists (select 1 from cron.job where jobname = 'kezek-ai-cleanup');
select cron.schedule('kezek-ai-cleanup', '20 3 * * *', 'select private.ai_cleanup()');

-- Права
revoke execute on function public.tg_route_text(bigint, text, text, text), public.ai_context(uuid, bigint),
  public.ai_save_reply(uuid, bigint, text, int, int), public.ai_test_prepare(uuid, text, boolean),
  public.ai_book(uuid, bigint, uuid, text, text, text, uuid, text), public.ai_handoff(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.tg_route_text(bigint, text, text, text), public.ai_context(uuid, bigint),
  public.ai_save_reply(uuid, bigint, text, int, int), public.ai_test_prepare(uuid, text, boolean),
  public.ai_book(uuid, bigint, uuid, text, text, text, uuid, text), public.ai_handoff(uuid, bigint, text)
  to service_role;
revoke execute on function public.owner_ai_info(), public.owner_ai_dialogs(), public.owner_ai_messages(bigint),
  public.owner_ai_reply(bigint, text), public.owner_ai_unmute(bigint), public.admin_set_ai(text, text) from public, anon;
grant execute on function public.owner_ai_info(), public.owner_ai_dialogs(), public.owner_ai_messages(bigint),
  public.owner_ai_reply(bigint, text), public.owner_ai_unmute(bigint), public.admin_set_ai(text, text) to authenticated;
revoke execute on function private.owner_send(public.businesses, bigint, text), private.ask_owner(public.businesses, bigint, text, text, text)
  from public, anon, authenticated;

alter function private.biz_ai_ready(public.businesses) set search_path = public, extensions;
