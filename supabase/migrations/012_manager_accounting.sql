-- =====================================================================
--  012: роль «Менеджер» и бухгалтерия владельца
--  • владелец выдаёт менеджеру логин и пароль (в кабинете app.html);
--  • менеджер видит и ведёт журнал записей, клиентов, видит прайс услуг,
--    принимает оплату и расходы ТОЛЬКО за сегодняшний день и закрывает смену;
--  • менеджер НЕ видит: сотрудников и их ставки, настройки, подписку, ИИ,
--    оплаты и расходы за прошлые дни, налог, зарплату;
--  • у владельца появляются: ставка налога, ставка мастера (%),
--    расходы и налоговые платежи, журнал закрытых смен.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Настройки бухгалтерии
-- ---------------------------------------------------------------------
alter table public.businesses add column if not exists tax_rate numeric(4,1) not null default 4
  check (tax_rate >= 0 and tax_rate <= 30);
grant update (tax_rate) on public.businesses to authenticated;

alter table public.staff add column if not exists share_pct smallint not null default 0
  check (share_pct >= 0 and share_pct <= 100);

-- ---------------------------------------------------------------------
--  Менеджеры
-- ---------------------------------------------------------------------
create table if not exists public.managers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid unique references auth.users(id) on delete set null,
  login       text unique,
  name        text not null check (length(trim(name)) between 1 and 80),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists managers_business_idx on public.managers (business_id);
alter table public.managers enable row level security;
drop policy if exists owner_all on public.managers;
create policy owner_all on public.managers for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));
revoke all on public.managers from anon, authenticated;
grant select on public.managers to authenticated;
grant update (name, is_active) on public.managers to authenticated;

-- Не больше трёх менеджеров на бизнес
create or replace function private.trg_manager_limit() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select count(*) from public.managers where business_id = new.business_id) >= 3 then
    raise exception 'Можно добавить не больше трёх менеджеров';
  end if;
  return new;
end $$;
drop trigger if exists manager_limit on public.managers;
create trigger manager_limit before insert on public.managers
  for each row execute function private.trg_manager_limit();

-- Логин и аккаунт менеджера задаёт только сервер (edge-функция account)
create or replace function private.trg_manager_protect() returns trigger
language plpgsql set search_path = public, extensions as $$
declare v_role text;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then v_role := null;
  end;
  if v_role in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.user_id := null;
      new.login := null;
    else
      new.user_id := old.user_id;
      new.login := old.login;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists manager_protect on public.managers;
create trigger manager_protect before insert or update on public.managers
  for each row execute function private.trg_manager_protect();

-- Аккаунт менеджера не может завести свой бизнес
create or replace function private.trg_business_not_manager() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.owner_id is not null and exists (select 1 from public.managers where user_id = new.owner_id) then
    raise exception 'Это аккаунт менеджера — войдите в кабинет менеджера';
  end if;
  return new;
end $$;
drop trigger if exists business_not_manager on public.businesses;
create trigger business_not_manager before insert on public.businesses
  for each row execute function private.trg_business_not_manager();

create or replace function public.is_manager(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.managers
                 where business_id = p_business and user_id = auth.uid() and is_active)
$$;
revoke execute on function public.is_manager(uuid) from public, anon;
grant execute on function public.is_manager(uuid) to authenticated;

-- Начало сегодняшнего дня по времени бизнеса
create or replace function public.biz_day_start(p_business uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select date_trunc('day', now() at time zone b.timezone) at time zone b.timezone
  from public.businesses b where b.id = p_business
$$;
revoke execute on function public.biz_day_start(uuid) from public, anon;
grant execute on function public.biz_day_start(uuid) to authenticated;

-- ---------------------------------------------------------------------
--  Расходы, налоговые платежи и закрытые смены
-- ---------------------------------------------------------------------
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.earnings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%created_by%';
  if c is not null then execute format('alter table public.earnings drop constraint %I', c); end if;
  alter table public.earnings add constraint earnings_created_by_check check (created_by in ('staff', 'owner', 'manager'));
end $$;

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null default 'expense' check (kind in ('expense', 'tax')),
  title       text not null check (length(trim(title)) between 1 and 120),
  amount      int  not null check (amount > 0 and amount <= 100000000),
  occurred_at timestamptz not null default now(),
  created_by  text not null default 'owner' check (created_by in ('owner', 'manager')),
  created_at  timestamptz not null default now()
);
create index if not exists expenses_business_time_idx on public.expenses (business_id, occurred_at desc);
alter table public.expenses enable row level security;
drop policy if exists owner_all on public.expenses;
create policy owner_all on public.expenses for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));
drop policy if exists mgr_today on public.expenses;
create policy mgr_today on public.expenses for select to authenticated
  using (public.is_manager(business_id) and kind = 'expense' and occurred_at >= public.biz_day_start(business_id));
revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

create table if not exists public.shift_closings (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  day            date not null,
  gross          int  not null default 0,
  cash           int  not null default 0,
  noncash        int  not null default 0,
  expenses       int  not null default 0,
  closed_by      text not null check (closed_by in ('owner', 'manager')),
  closed_by_name text,
  note           text check (length(note) <= 300),
  created_at     timestamptz not null default now()
);
create index if not exists shift_closings_business_idx on public.shift_closings (business_id, created_at desc);
alter table public.shift_closings enable row level security;
drop policy if exists owner_all on public.shift_closings;
create policy owner_all on public.shift_closings for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));
drop policy if exists mgr_today on public.shift_closings;
create policy mgr_today on public.shift_closings for select to authenticated
  using (public.is_manager(business_id) and created_at >= public.biz_day_start(business_id));
revoke all on public.shift_closings from anon, authenticated;
grant select, delete on public.shift_closings to authenticated;

-- ---------------------------------------------------------------------
--  Права менеджера на данные бизнеса (в дополнение к правам владельца)
-- ---------------------------------------------------------------------
drop policy if exists mgr_select on public.bookings;
create policy mgr_select on public.bookings for select to authenticated using (public.is_manager(business_id));
drop policy if exists mgr_insert on public.bookings;
create policy mgr_insert on public.bookings for insert to authenticated with check (public.is_manager(business_id));
drop policy if exists mgr_update on public.bookings;
create policy mgr_update on public.bookings for update to authenticated
  using (public.is_manager(business_id)) with check (public.is_manager(business_id));

drop policy if exists mgr_select on public.clients;
create policy mgr_select on public.clients for select to authenticated using (public.is_manager(business_id));
drop policy if exists mgr_insert on public.clients;
create policy mgr_insert on public.clients for insert to authenticated with check (public.is_manager(business_id));
drop policy if exists mgr_update on public.clients;
create policy mgr_update on public.clients for update to authenticated
  using (public.is_manager(business_id)) with check (public.is_manager(business_id));

-- Прайс и графики — только чтение
drop policy if exists mgr_select on public.services;
create policy mgr_select on public.services for select to authenticated using (public.is_manager(business_id));
drop policy if exists mgr_select on public.staff_services;
create policy mgr_select on public.staff_services for select to authenticated using (public.is_manager(business_id));
drop policy if exists mgr_select on public.working_hours;
create policy mgr_select on public.working_hours for select to authenticated using (public.is_manager(business_id));
drop policy if exists mgr_select on public.time_off;
create policy mgr_select on public.time_off for select to authenticated using (public.is_manager(business_id));

-- Оплаты менеджер видит только за сегодня; записывает их только через функцию ниже
drop policy if exists mgr_today on public.earnings;
create policy mgr_today on public.earnings for select to authenticated
  using (public.is_manager(business_id) and occurred_at >= public.biz_day_start(business_id));

-- ---------------------------------------------------------------------
--  Функции менеджера
-- ---------------------------------------------------------------------
-- Бизнес и менеджер — без служебных полей (Telegram-коды, владелец)
create or replace function public.manager_me() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare m public.managers; b public.businesses;
begin
  select * into m from public.managers where user_id = auth.uid() and is_active;
  if not found then return null; end if;
  select * into b from public.businesses where id = m.business_id;
  return jsonb_build_object(
    'manager', jsonb_build_object('id', m.id, 'name', m.name, 'login', m.login),
    'business', jsonb_build_object(
      'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category, 'phone', b.phone, 'address', b.address,
      'timezone', b.timezone, 'slot_step', b.slot_step, 'plan', b.plan, 'paid_until', b.paid_until,
      'is_blocked', b.is_blocked, 'active', private.biz_active(b)));
end $$;

-- Список сотрудников для журнала — без логинов, Telegram и ставок
create or replace function public.manager_staff() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'business_id', s.business_id, 'name', s.name, 'title', s.title,
      'is_active', s.is_active, 'sort', s.sort) order by s.sort, s.created_at), '[]'::jsonb)
  from public.staff s
  where public.is_manager(s.business_id)
$$;

-- Принять оплату (по записи или без записи)
create or replace function public.manager_add_earning(
  p_amount int, p_method text default 'cash', p_staff uuid default null, p_booking uuid default null,
  p_client text default null, p_service text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m public.managers; b public.businesses; k public.bookings; e public.earnings; v_staff uuid;
begin
  select * into m from public.managers where user_id = auth.uid() and is_active;
  if not found then raise exception 'Нет доступа'; end if;
  select * into b from public.businesses where id = m.business_id;
  if not private.biz_active(b) then raise exception 'Подписка неактивна'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'Укажите сумму от 1 до 10 000 000 ₸';
  end if;
  if p_method not in ('cash', 'kaspi', 'card') then raise exception 'Выберите способ оплаты'; end if;
  v_staff := p_staff;

  if p_booking is not null then
    select * into k from public.bookings where id = p_booking and business_id = b.id for update;
    if not found then raise exception 'Запись не найдена'; end if;
    if k.status = 'cancelled' then raise exception 'Запись отменена'; end if;
    v_staff := coalesce(k.staff_id, v_staff);
    select * into e from public.earnings where booking_id = k.id;
    if found then
      if e.created_at < public.biz_day_start(b.id) then
        raise exception 'Оплата уже записана раньше — изменить её может только владелец';
      end if;
      update public.earnings set amount = p_amount, method = p_method, note = nullif(trim(coalesce(p_note, '')), '')
       where id = e.id returning * into e;
    else
      insert into public.earnings (business_id, staff_id, booking_id, amount, price_expected, method,
                                   client_name, service_name, note, occurred_at, created_by)
      values (b.id, v_staff, k.id, p_amount, k.price, p_method, k.client_name, k.service_name, left(p_note, 300), now(), 'manager')
      returning * into e;
    end if;
    if k.status in ('booked', 'confirmed') then
      update public.bookings set status = 'done' where id = k.id;
    end if;
  else
    if v_staff is not null and not exists (select 1 from public.staff where id = v_staff and business_id = b.id) then
      raise exception 'Сотрудник не найден';
    end if;
    insert into public.earnings (business_id, staff_id, amount, method, client_name, service_name, note, occurred_at, created_by)
    values (b.id, v_staff, p_amount, p_method, left(p_client, 80), left(p_service, 120), left(p_note, 300), now(), 'manager')
    returning * into e;
  end if;
  return jsonb_build_object('id', e.id, 'amount', e.amount, 'method', e.method);
end $$;

-- Расход из кассы за сегодня
create or replace function public.manager_add_expense(p_title text, p_amount int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m public.managers; x public.expenses;
begin
  select * into m from public.managers where user_id = auth.uid() and is_active;
  if not found then raise exception 'Нет доступа'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'Укажите сумму от 1 до 10 000 000 ₸';
  end if;
  if length(trim(coalesce(p_title, ''))) < 1 then raise exception 'Укажите, на что расход'; end if;
  insert into public.expenses (business_id, kind, title, amount, occurred_at, created_by)
  values (m.business_id, 'expense', left(trim(p_title), 120), p_amount, now(), 'manager')
  returning * into x;
  return jsonb_build_object('id', x.id, 'amount', x.amount);
end $$;

-- Закрыть смену: суммы считает сервер по оплатам и расходам за сегодня.
-- Может владелец или менеджер.
create or replace function public.close_shift(p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_biz uuid; v_role text; v_name text; b public.businesses; v_from timestamptz;
  g int; c int; n int; x int; r public.shift_closings;
begin
  select id into v_biz from public.businesses where owner_id = auth.uid();
  if found then
    v_role := 'owner'; v_name := 'Владелец';
  else
    select business_id, name into v_biz, v_name from public.managers where user_id = auth.uid() and is_active;
    if not found then raise exception 'Нет доступа'; end if;
    v_role := 'manager';
  end if;
  select * into b from public.businesses where id = v_biz;
  v_from := public.biz_day_start(v_biz);
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where method = 'cash'), 0),
         coalesce(sum(amount) filter (where method <> 'cash'), 0)
    into g, c, n from public.earnings where business_id = v_biz and occurred_at >= v_from;
  select coalesce(sum(amount), 0) into x from public.expenses
   where business_id = v_biz and kind = 'expense' and occurred_at >= v_from;
  insert into public.shift_closings (business_id, day, gross, cash, noncash, expenses, closed_by, closed_by_name, note)
  values (v_biz, (now() at time zone b.timezone)::date, g, c, n, x, v_role, v_name, nullif(left(trim(coalesce(p_note, '')), 300), ''))
  returning * into r;
  if v_role = 'manager' and not b.is_demo then
    perform private.notify(b.tg_chat_id,
      '🔒 Смена закрыта' || E'\n👤 ' || private.h(v_name)
      || E'\n💰 Выручка: ' || private.money(g)
      || E'\n💵 Наличные: ' || private.money(c) || ' · 📱 Безнал: ' || private.money(n)
      || case when x > 0 then E'\n➖ Расходы: ' || private.money(x) else '' end
      || E'\n🏠 ' || private.h(b.name), null, b.id, null, 'shift_closed');
  end if;
  return jsonb_build_object('id', r.id, 'gross', g, 'cash', c, 'noncash', n, 'expenses', x);
end $$;

revoke execute on function public.manager_me(), public.manager_staff(),
  public.manager_add_earning(int, text, uuid, uuid, text, text, text),
  public.manager_add_expense(text, int), public.close_shift(text) from public, anon;
grant execute on function public.manager_me(), public.manager_staff(),
  public.manager_add_earning(int, text, uuid, uuid, text, text, text),
  public.manager_add_expense(text, int), public.close_shift(text) to authenticated;
