-- =====================================================================
--  009: личные кабинеты сотрудников
--  • владелец (администратор) выдаёт каждому сотруднику логин и пароль;
--  • сотрудник входит на staff.html и видит только СВОИ записи;
--  • каждому сотруднику в Telegram приходят только его записи:
--    новая, отмена, перенос, подтверждение клиентом,
--    а каждое утро в 8:00 — список клиентов на день.
-- =====================================================================

alter table public.staff add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.staff add column if not exists login text unique;
alter table public.staff add column if not exists tg_chat_id bigint;
alter table public.staff add column if not exists tg_link_code text unique;
update public.staff set tg_link_code = encode(extensions.gen_random_bytes(12), 'hex') where tg_link_code is null;
alter table public.staff alter column tg_link_code set default encode(extensions.gen_random_bytes(12), 'hex');
alter table public.staff alter column tg_link_code set not null;

-- ---------------------------------------------------------------------
--  Защита: владелец через сайт не может сам прописать сотруднику
--  чужой аккаунт или чужой Telegram. Эти поля меняет только сервер
--  (edge-функция account, бот) или функции ниже.
-- ---------------------------------------------------------------------
create or replace function private.trg_staff_protect() returns trigger
language plpgsql set search_path = public, extensions as $$
declare v_role text;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then v_role := null;
  end;
  if v_role in ('anon', 'authenticated') and coalesce(current_setting('app.staff_sys', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.user_id := null;
      new.login := null;
      new.tg_chat_id := null;
      new.tg_link_code := encode(extensions.gen_random_bytes(12), 'hex');
    else
      new.user_id := old.user_id;
      new.login := old.login;
      new.tg_chat_id := old.tg_chat_id;
      new.tg_link_code := old.tg_link_code;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_protect on public.staff;
create trigger staff_protect before insert or update on public.staff
  for each row execute function private.trg_staff_protect();

-- Аккаунт сотрудника не может завести свой бизнес
create or replace function private.trg_business_not_staff() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.owner_id is not null and exists (select 1 from public.staff where user_id = new.owner_id) then
    raise exception 'Это аккаунт сотрудника — войдите на странице сотрудника';
  end if;
  return new;
end $$;
drop trigger if exists business_not_staff on public.businesses;
create trigger business_not_staff before insert on public.businesses
  for each row execute function private.trg_business_not_staff();

-- ---------------------------------------------------------------------
--  Функции кабинета сотрудника
-- ---------------------------------------------------------------------
create or replace function public.staff_me() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s public.staff; b public.businesses;
begin
  select * into s from public.staff where user_id = auth.uid();
  if not found then return null; end if;
  select * into b from public.businesses where id = s.business_id;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'title', s.title, 'login', s.login, 'is_active', s.is_active,
    'tg', s.tg_chat_id is not null, 'tg_link_code', s.tg_link_code,
    'business', jsonb_build_object('name', b.name, 'timezone', b.timezone, 'phone', b.phone,
                                   'address', b.address, 'active', private.biz_active(b)),
    'bot_username', (select bot_username from public.platform_settings where id = 1));
end $$;

-- Записи сотрудника за период (не больше 62 дней за раз)
create or replace function public.staff_bookings(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'starts_at', k.starts_at, 'ends_at', k.ends_at, 'status', k.status,
      'client_name', k.client_name, 'client_phone', k.client_phone,
      'service_name', k.service_name, 'price', k.price, 'comment', k.comment, 'source', k.source
    ) order by k.starts_at), '[]'::jsonb)
  from public.bookings k
  join public.staff s on s.id = k.staff_id
  where s.user_id = auth.uid()
    and k.starts_at >= p_from and k.starts_at < least(p_to, p_from + interval '62 days')
$$;

create or replace function public.staff_unlink_tg() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform set_config('app.staff_sys', '1', true);
  update public.staff
     set tg_chat_id = null, tg_link_code = encode(extensions.gen_random_bytes(12), 'hex')
   where user_id = auth.uid();
end $$;

revoke execute on function public.staff_me(), public.staff_bookings(timestamptz, timestamptz), public.staff_unlink_tg()
  from public, anon;
grant execute on function public.staff_me(), public.staff_bookings(timestamptz, timestamptz), public.staff_unlink_tg()
  to authenticated;

-- ---------------------------------------------------------------------
--  Уведомления сотруднику в Telegram — только по его записям
-- ---------------------------------------------------------------------
create or replace function private.staff_card(k public.bookings, b public.businesses) returns text
language sql stable as $$
  select '<b>' || private.h(k.client_name) || '</b>, ' || private.fmt_phone(k.client_phone) || E'\n'
    || '📅 ' || private.fmt_dt(k.starts_at, b.timezone)
    || case when coalesce(k.service_name, '') <> '' then E'\n📋 ' || private.h(k.service_name) else '' end
    || case when coalesce(k.price, 0) > 0 then E'\n💰 ' || private.money(k.price) else '' end
    || case when coalesce(k.comment, '') <> '' then E'\n💬 ' || private.h(k.comment) else '' end
    || E'\n🏠 ' || private.h(b.name)
$$;

create or replace function private.trg_booking_staff_notify() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.businesses;
  v_new bigint; v_old bigint;
  v_actor text := coalesce(nullif(current_setting('app.actor', true), ''), 'owner');
begin
  select * into b from public.businesses where id = new.business_id;
  if b.is_demo then return null; end if;

  if new.staff_id is not null then
    select tg_chat_id into v_new from public.staff where id = new.staff_id;
  end if;
  -- если мастер — сам владелец с тем же Telegram, он и так всё получает
  if v_new = b.tg_chat_id then v_new := null; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' and new.starts_at > now() then
      perform private.notify(v_new, '🆕 Новая запись к вам' || E'\n\n' || private.staff_card(new, b),
                             null, b.id, new.id, 'staff_new');
    end if;
    return null;
  end if;

  -- прошедшие записи (отметки «пришёл / не пришёл») не тревожат мастера
  if new.starts_at <= now() and old.starts_at <= now() then return null; end if;

  if old.staff_id is not null then
    select tg_chat_id into v_old from public.staff where id = old.staff_id;
  end if;
  if v_old = b.tg_chat_id then v_old := null; end if;

  if new.staff_id is distinct from old.staff_id then
    if old.status <> 'cancelled' then
      perform private.notify(v_old, '↪️ Запись передана другому мастеру' || E'\n\n' || private.staff_card(old, b),
                             null, b.id, new.id, 'staff_away');
    end if;
    if new.status <> 'cancelled' then
      perform private.notify(v_new, '🆕 Новая запись к вам' || E'\n\n' || private.staff_card(new, b),
                             null, b.id, new.id, 'staff_new');
    end if;
    return null;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.notify(v_new,
      case when v_actor = 'client' then '❌ Клиент отменил запись' else '❌ Запись отменена' end
      || E'\n\n' || private.staff_card(new, b), null, b.id, new.id, 'staff_cancel');
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    perform private.notify(v_new, '🆕 Запись снова активна' || E'\n\n' || private.staff_card(new, b),
                           null, b.id, new.id, 'staff_new');
  elsif new.status <> 'cancelled' and new.starts_at <> old.starts_at then
    perform private.notify(v_new, '🔄 Запись перенесена'
      || E'\nБыло: ' || private.fmt_dt(old.starts_at, b.timezone)
      || E'\n\n' || private.staff_card(new, b), null, b.id, new.id, 'staff_move');
  elsif new.status = 'confirmed' and old.status = 'booked' then
    perform private.notify(v_new, '✅ Клиент подтвердил, что придёт' || E'\n\n' || private.staff_card(new, b),
                           null, b.id, new.id, 'staff_confirm');
  end if;
  return null;
end $$;
drop trigger if exists booking_staff_notify on public.bookings;
create trigger booking_staff_notify after insert or update on public.bookings
  for each row execute function private.trg_booking_staff_notify();

-- Каждое утро в 8:00 по времени бизнеса — список клиентов на день
create or replace function private.run_staff_digest() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.notifications (chat_id, text, business_id, kind)
  select s.tg_chat_id,
         '☀️ Доброе утро, ' || private.h(s.name) || '!' || E'\n'
         || 'Ваши записи на сегодня — ' || x.cnt || ':' || E'\n\n' || x.lines,
         b.id, 'staff_digest'
  from public.staff s
  join public.businesses b on b.id = s.business_id
  cross join lateral (
    select count(*) as cnt,
           string_agg('<b>' || to_char(k.starts_at at time zone b.timezone, 'HH24:MI') || '</b> — '
                      || private.h(k.client_name)
                      || case when coalesce(k.service_name, '') <> '' then ', ' || private.h(k.service_name) else '' end
                      || E'\n      📞 ' || private.fmt_phone(k.client_phone),
                      E'\n' order by k.starts_at) as lines
    from public.bookings k
    where k.staff_id = s.id and k.status in ('booked', 'confirmed')
      and (k.starts_at at time zone b.timezone)::date = (now() at time zone b.timezone)::date
  ) x
  where s.tg_chat_id is not null and s.is_active and not b.is_demo and private.biz_active(b)
    and extract(hour from now() at time zone b.timezone) = 8
    and x.cnt > 0;
end $$;
select cron.unschedule('jazylam-staff-digest') where exists (select 1 from cron.job where jobname = 'jazylam-staff-digest');
select cron.schedule('jazylam-staff-digest', '0 * * * *', 'select private.run_staff_digest()');

-- ---------------------------------------------------------------------
--  Бот: /start m_<код> — сотрудник подключает свой Telegram
--  (копия функции из 003 + новая ветка m_)
-- ---------------------------------------------------------------------
create or replace function public.tg_handle_start(p_chat_id bigint, p_payload text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  k public.bookings; b public.businesses; a public.business_ai; s public.staff;
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

  elsif left(v_payload, 2) = 'm_' then
    perform set_config('app.staff_sys', '1', true);
    update public.staff set tg_chat_id = p_chat_id where tg_link_code = substr(v_payload, 3) returning * into s;
    if not found then
      return jsonb_build_object('text', 'Ссылка устарела. Откройте свой кабинет сотрудника и нажмите «Подключить Telegram» ещё раз.');
    end if;
    select * into b from public.businesses where id = s.business_id;
    return jsonb_build_object('text', '✅ ' || private.h(s.name) || ', уведомления подключены!'
      || E'\n\nСюда будут приходить только <b>ваши</b> записи в «' || private.h(b.name) || '»:'
      || E'\n🆕 кто к вам записался'
      || E'\n❌ отмены и 🔄 переносы'
      || E'\n✅ когда клиент подтвердил, что придёт'
      || E'\n☀️ каждое утро в 8:00 — список клиентов на день');

  elsif left(v_payload, 4) = 'adm_' then
    update private.secrets set admin_chat_id = p_chat_id where id = 1 and admin_link_code = substr(v_payload, 5);
    if not found then return jsonb_build_object('text', 'Неверная ссылка администратора.'); end if;
    return jsonb_build_object('text', '✅ Уведомления администратора ' || private.h(v_brand)
      || ' подключены: новые регистрации и заявки на оплату.');
  end if;

  return jsonb_build_object('text', 'Здравствуйте! Я бот ' || private.h(v_brand) || ' — присылаю напоминания о записях и отвечаю на вопросы.'
    || E'\n\nОткройте страницу записи нужного места и нажмите «Задать вопрос в Telegram» или «Напомнить в Telegram».');
end $$;
