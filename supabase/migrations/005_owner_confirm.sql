-- =====================================================================
--  005: мастеру приходит уведомление, когда клиент нажал «✅ Приду»
-- =====================================================================
create or replace function public.tg_handle_callback(p_chat_id bigint, p_data text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare k public.bookings; b public.businesses; v_act text := left(coalesce(p_data, ''), 1); v_client bigint; c public.ai_chats; v_n int;
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
    get diagnostics v_n = row_count;
    select * into k from public.bookings where id = k.id;
    if v_n > 0 and not b.is_demo then
      perform private.notify(b.tg_chat_id, '✅ Клиент подтвердил запись' || E'\n\n' || private.owner_card(k, b),
                             null, b.id, k.id, 'owner_confirm');
    end if;
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
