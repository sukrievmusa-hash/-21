-- =====================================================================
--  011: кабинет мастера
--  • staff_me отдаёт услуги мастера (для быстрого выбора при оплате),
--    его график на сегодня, ссылку записи и статус «выходной сегодня»;
--  • мастер сам ставит / снимает «Выходной сегодня»: онлайн-запись
--    к нему на сегодня закрывается, владельцу приходит сообщение.
-- =====================================================================

create or replace function public.staff_me() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.staff; b public.businesses;
  v_day date; v_from timestamptz; v_to timestamptz;
begin
  select * into s from public.staff where user_id = auth.uid();
  if not found then return null; end if;
  select * into b from public.businesses where id = s.business_id;
  v_day := (now() at time zone b.timezone)::date;
  v_from := v_day::timestamp at time zone b.timezone;
  v_to := (v_day + 1)::timestamp at time zone b.timezone;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'title', s.title, 'login', s.login, 'is_active', s.is_active,
    'tg', s.tg_chat_id is not null, 'tg_link_code', s.tg_link_code,
    'business', jsonb_build_object('name', b.name, 'timezone', b.timezone, 'phone', b.phone, 'slug', b.slug,
                                   'address', b.address, 'active', private.biz_active(b)),
    'bot_username', (select bot_username from public.platform_settings where id = 1),
    -- услуги, которые делает мастер (нет привязок у услуги — делают все)
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('name', v.name, 'price', v.price, 'duration', v.duration_min) order by v.sort, v.name)
      from public.services v
      where v.business_id = b.id and v.is_active
        and (not exists (select 1 from public.staff_services x where x.service_id = v.id)
             or exists (select 1 from public.staff_services x where x.service_id = v.id and x.staff_id = s.id))
    ), '[]'::jsonb),
    'hours_today', coalesce((
      select jsonb_agg(jsonb_build_object('start', to_char(h.start_time, 'HH24:MI'), 'end', to_char(h.end_time, 'HH24:MI')) order by h.start_time)
      from public.working_hours h
      where h.staff_id = s.id and h.weekday = extract(isodow from v_day)::int
    ), '[]'::jsonb),
    'off_today', exists (
      select 1 from public.time_off t
      where t.business_id = b.id and (t.staff_id is null or t.staff_id = s.id)
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(greatest(now(), v_from), v_to)),
    'off_by_me', exists (
      select 1 from public.time_off t
      where t.staff_id = s.id and t.reason = 'Выходной — отметил мастер'
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_from, v_to)));
end $$;

-- Мастер ставит или снимает «Выходной сегодня»
create or replace function public.staff_set_day_off(p_off boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.staff; b public.businesses;
  v_day date; v_from timestamptz; v_to timestamptz; v_cnt int;
  c_reason constant text := 'Выходной — отметил мастер';
begin
  select * into s from public.staff where user_id = auth.uid();
  if not found then raise exception 'Нет доступа'; end if;
  select * into b from public.businesses where id = s.business_id;
  v_day := (now() at time zone b.timezone)::date;
  v_from := v_day::timestamp at time zone b.timezone;
  v_to := (v_day + 1)::timestamp at time zone b.timezone;

  select count(*) into v_cnt from public.bookings k
   where k.staff_id = s.id and k.status in ('booked', 'confirmed') and k.starts_at >= now() and k.starts_at < v_to;

  if p_off then
    if not exists (select 1 from public.time_off where staff_id = s.id and reason = c_reason
                     and tstzrange(starts_at, ends_at) && tstzrange(v_from, v_to)) then
      insert into public.time_off (business_id, staff_id, starts_at, ends_at, reason)
      values (s.business_id, s.id, v_from, v_to, c_reason);
      if not b.is_demo then
        perform private.notify(b.tg_chat_id, '🌴 <b>' || private.h(s.name) || '</b> отметил(а) выходной на сегодня.'
          || E'\nОнлайн-запись к мастеру на сегодня закрыта.'
          || case when v_cnt > 0 then E'\n⚠️ На сегодня у мастера ещё ' || v_cnt || ' ' ||
               case when v_cnt % 10 = 1 and v_cnt % 100 <> 11 then 'запись' when v_cnt % 10 between 2 and 4 and v_cnt % 100 not between 12 and 14 then 'записи' else 'записей' end
               || ' — перенесите или отмените их.' else '' end,
          null, b.id, null, 'staff_day_off');
      end if;
    end if;
  else
    delete from public.time_off where staff_id = s.id and reason = c_reason
      and tstzrange(starts_at, ends_at) && tstzrange(v_from, v_to);
    if exists (select 1 from public.time_off t
                where t.business_id = b.id and (t.staff_id is null or t.staff_id = s.id)
                  and tstzrange(t.starts_at, t.ends_at) && tstzrange(greatest(now(), v_from), v_to)) then
      raise exception 'Выходной на сегодня поставил администратор — снять его может только он';
    end if;
    if not b.is_demo then
      perform private.notify(b.tg_chat_id, '✂️ <b>' || private.h(s.name) || '</b> снова на смене сегодня — онлайн-запись открыта.',
        null, b.id, null, 'staff_day_off');
    end if;
  end if;
  return jsonb_build_object('off', p_off, 'bookings_left', v_cnt);
end $$;

revoke execute on function public.staff_me(), public.staff_set_day_off(boolean) from public, anon;
grant execute on function public.staff_me(), public.staff_set_day_off(boolean) to authenticated;
