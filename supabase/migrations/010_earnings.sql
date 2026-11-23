-- =====================================================================
--  010: учёт заработка (касса)
--  • после клиента сотрудник со своего телефона нажимает «Оплатил»
--    и вводит, сколько клиент заплатил (наличные / Kaspi / карта);
--  • запись автоматически отмечается «Пришёл»;
--  • клиента без записи тоже можно добавить;
--  • владелец видит всё во вкладке «Касса» и выгружает в Excel.
-- =====================================================================

create table if not exists public.earnings (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  staff_id       uuid,
  staff_name     text,
  booking_id     uuid references public.bookings(id) on delete set null,
  amount         int  not null check (amount > 0 and amount <= 100000000),
  price_expected int  check (price_expected >= 0),
  method         text not null default 'cash' check (method in ('cash', 'kaspi', 'card')),
  client_name    text check (length(client_name) <= 80),
  service_name   text check (length(service_name) <= 120),
  note           text check (length(note) <= 300),
  occurred_at    timestamptz not null default now(),
  created_by     text not null default 'staff' check (created_by in ('staff', 'owner')),
  created_at     timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete set null (staff_id)
);
create unique index if not exists earnings_booking_uidx on public.earnings (booking_id) where booking_id is not null;
create index if not exists earnings_business_time_idx on public.earnings (business_id, occurred_at desc);
create index if not exists earnings_staff_time_idx on public.earnings (staff_id, occurred_at desc);

alter table public.earnings enable row level security;
drop policy if exists owner_all on public.earnings;
create policy owner_all on public.earnings for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));
revoke all on public.earnings from anon;
grant select, insert, update, delete on public.earnings to authenticated;

-- Имя сотрудника запоминаем в строке: отчёты не меняются, если сотрудника переименовали или удалили
create or replace function private.trg_earning_before() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.staff_id is not null and (tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id) then
    select name into new.staff_name from public.staff where id = new.staff_id;
  end if;
  new.client_name := nullif(trim(new.client_name), '');
  new.service_name := nullif(trim(new.service_name), '');
  new.note := nullif(trim(new.note), '');
  return new;
end $$;
drop trigger if exists earning_before on public.earnings;
create trigger earning_before before insert or update on public.earnings
  for each row execute function private.trg_earning_before();

-- ---------------------------------------------------------------------
--  Функции сотрудника
-- ---------------------------------------------------------------------

-- Записать оплату. Если указана запись — она становится «Пришёл», повторный вызов обновляет сумму.
create or replace function public.staff_add_earning(
  p_amount int, p_method text default 'cash', p_booking uuid default null,
  p_client text default null, p_service text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.staff; k public.bookings; e public.earnings; b public.businesses;
begin
  select * into s from public.staff where user_id = auth.uid();
  if not found then raise exception 'Нет доступа'; end if;
  if not s.is_active then raise exception 'Вы отключены от работы — обратитесь к администратору'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'Укажите сумму от 1 до 10 000 000 ₸';
  end if;
  if p_method not in ('cash', 'kaspi', 'card') then raise exception 'Выберите способ оплаты'; end if;
  select * into b from public.businesses where id = s.business_id;

  if p_booking is not null then
    select * into k from public.bookings where id = p_booking and staff_id = s.id for update;
    if not found then raise exception 'Это не ваша запись'; end if;
    if k.status = 'cancelled' then raise exception 'Запись отменена'; end if;
    select * into e from public.earnings where booking_id = k.id;
    if found then
      if e.created_at < now() - interval '24 hours' then
        raise exception 'Оплата уже записана — изменить её может только администратор';
      end if;
      update public.earnings set amount = p_amount, method = p_method, note = nullif(trim(coalesce(p_note, '')), '')
        where id = e.id returning * into e;
    else
      insert into public.earnings (business_id, staff_id, booking_id, amount, price_expected, method,
                                   client_name, service_name, note, occurred_at, created_by)
      values (s.business_id, s.id, k.id, p_amount, k.price, p_method,
              k.client_name, k.service_name, p_note, now(), 'staff')
      returning * into e;
    end if;
    if k.status in ('booked', 'confirmed') then
      update public.bookings set status = 'done' where id = k.id;
    end if;
  else
    insert into public.earnings (business_id, staff_id, amount, method, client_name, service_name, note, occurred_at, created_by)
    values (s.business_id, s.id, p_amount, p_method, left(p_client, 80), left(p_service, 120), left(p_note, 300), now(), 'staff')
    returning * into e;
  end if;
  return jsonb_build_object('id', e.id, 'amount', e.amount, 'method', e.method);
end $$;

-- Свои оплаты за период (не больше 93 дней за раз)
create or replace function public.staff_earnings(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount', e.amount, 'method', e.method, 'client_name', e.client_name,
      'service_name', e.service_name, 'note', e.note, 'booking_id', e.booking_id,
      'occurred_at', e.occurred_at, 'created_at', e.created_at,
      'editable', e.created_by = 'staff' and e.created_at > now() - interval '24 hours'
    ) order by e.occurred_at desc), '[]'::jsonb)
  from public.earnings e
  join public.staff s on s.id = e.staff_id
  where s.user_id = auth.uid()
    and e.occurred_at >= p_from and e.occurred_at < least(p_to, p_from + interval '93 days')
$$;

-- Исправить сумму/способ своей оплаты — в течение 24 часов
create or replace function public.staff_update_earning(p_id uuid, p_amount int, p_method text, p_note text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.earnings;
begin
  select e2.* into e from public.earnings e2 join public.staff s on s.id = e2.staff_id
    where e2.id = p_id and s.user_id = auth.uid() for update of e2;
  if not found then raise exception 'Запись об оплате не найдена'; end if;
  if e.created_by <> 'staff' or e.created_at < now() - interval '24 hours' then
    raise exception 'Изменить может только администратор';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then raise exception 'Укажите сумму от 1 до 10 000 000 ₸'; end if;
  if p_method not in ('cash', 'kaspi', 'card') then raise exception 'Выберите способ оплаты'; end if;
  update public.earnings set amount = p_amount, method = p_method, note = left(p_note, 300) where id = e.id;
end $$;

create or replace function public.staff_delete_earning(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare e public.earnings;
begin
  select e2.* into e from public.earnings e2 join public.staff s on s.id = e2.staff_id
    where e2.id = p_id and s.user_id = auth.uid() for update of e2;
  if not found then raise exception 'Запись об оплате не найдена'; end if;
  if e.created_by <> 'staff' or e.created_at < now() - interval '24 hours' then
    raise exception 'Удалить может только администратор';
  end if;
  delete from public.earnings where id = e.id;
end $$;

-- Записи сотрудника теперь с суммой оплаты (если уже записана)
create or replace function public.staff_bookings(p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'starts_at', k.starts_at, 'ends_at', k.ends_at, 'status', k.status,
      'client_name', k.client_name, 'client_phone', k.client_phone,
      'service_name', k.service_name, 'price', k.price, 'comment', k.comment, 'source', k.source,
      'paid', e.amount, 'paid_method', e.method, 'earning_id', e.id
    ) order by k.starts_at), '[]'::jsonb)
  from public.bookings k
  join public.staff s on s.id = k.staff_id
  left join public.earnings e on e.booking_id = k.id
  where s.user_id = auth.uid()
    and k.starts_at >= p_from and k.starts_at < least(p_to, p_from + interval '62 days')
$$;

revoke execute on function public.staff_add_earning(int, text, uuid, text, text, text),
  public.staff_earnings(timestamptz, timestamptz), public.staff_update_earning(uuid, int, text, text),
  public.staff_delete_earning(uuid) from public, anon;
grant execute on function public.staff_add_earning(int, text, uuid, text, text, text),
  public.staff_earnings(timestamptz, timestamptz), public.staff_update_earning(uuid, int, text, text),
  public.staff_delete_earning(uuid) to authenticated;
