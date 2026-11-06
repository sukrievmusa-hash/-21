-- Самопроверка базы: создаёт тестовых пользователей и бизнес, прогоняет сценарии
-- от имени владельца, чужого владельца, анонимного клиента и админа, затем всё удаляет.
-- Запуск (SQL Editor в Supabase):  select * from private.self_test();

create or replace function private.self_test()
returns table (step text, ok boolean, info text)
language plpgsql set search_path = public, extensions as $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); ua uuid := gen_random_uuid();
  v_biz uuid; v_staff uuid; v_svc uuid; v_day date; v_slot timestamptz; v_tok text; v_tok2 text;
  v_txt text; v_n int; v_j jsonb; v_pay uuid; v_code text; v_until timestamptz;
  v_slug text := 'selftest-' || substr(md5(random()::text), 1, 6);
  v_key text;

begin
  perform set_config('app.no_send', '1', true);  -- тест не отправляет настоящие сообщения в Telegram
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'selftest-' || substr(x::text, 1, 8) || '@example.com', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now()
  from unnest(array[u1, u2, ua]) x;

  begin
    -- 1. владелец создаёт бизнес
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    v_biz := public.create_business('Тестовый салон', v_slug, 'Салон', '+7 701 000 00 00', 'Алматы', 'Айгерим');
    select id into v_staff from public.staff where business_id = v_biz;
    select count(*) into v_n from public.working_hours where staff_id = v_staff;
    step := 'create_business + сотрудник + график по умолчанию'; ok := v_staff is not null and v_n = 6; info := v_n || ' рабочих дней'; return next;

    insert into public.services (business_id, name, duration_min, price) values (v_biz, 'Стрижка', 60, 5000) returning id into v_svc;
    step := 'владелец добавляет услугу'; ok := v_svc is not null; info := null; return next;

    begin
      update public.businesses set plan = 'business', paid_until = '2099-01-01' where id = v_biz;
      step := 'владелец НЕ может менять тариф'; ok := false; info := 'обновление прошло'; return next;
    exception when insufficient_privilege then
      step := 'владелец НЕ может менять тариф'; ok := true; info := sqlerrm; return next;
    end;

    -- 2. чужой владелец
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    select count(*) into v_n from public.businesses where id = v_biz;
    step := 'чужой владелец не видит бизнес'; ok := v_n = 0; info := null; return next;
    select count(*) into v_n from public.services where business_id = v_biz;
    step := 'чужой владелец не видит услуги'; ok := v_n = 0; info := null; return next;
    begin
      insert into public.services (business_id, name, duration_min) values (v_biz, 'Взлом', 30);
      step := 'чужой владелец не может добавить услугу'; ok := false; info := 'вставка прошла'; return next;
    exception when insufficient_privilege then
      step := 'чужой владелец не может добавить услугу'; ok := true; info := sqlerrm; return next;
    end;
    begin
      select public.admin_overview() into v_j;
      step := 'не-админ не видит админку'; ok := false; info := 'доступ есть'; return next;
    exception when others then
      step := 'не-админ не видит админку'; ok := true; info := sqlerrm; return next;
    end;

    -- 3. клиент (аноним) записывается
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    v_day := (now() at time zone 'Asia/Almaty')::date + (8 - extract(isodow from now() at time zone 'Asia/Almaty')::int); -- следующий понедельник
    v_j := public.get_slots(v_slug, v_svc, null, v_day);
    v_slot := (v_j->0->>'t')::timestamptz;
    step := 'слоты на понедельник'; ok := jsonb_array_length(v_j) = 17;
    info := jsonb_array_length(v_j) || ' слотов, первый ' || to_char(v_slot at time zone 'Asia/Almaty', 'HH24:MI'); return next;

    v_j := public.get_slots(v_slug, v_svc, null, v_day + 6);
    step := 'в воскресенье выходной'; ok := jsonb_array_length(v_j) = 0; info := null; return next;

    v_tok := public.create_booking(v_slug, v_svc, null, v_slot, 'Клиент Тест', '8 (701) 111-22-33', 'тест')->>'token';
    step := 'клиент записался онлайн'; ok := v_tok is not null; info := null; return next;

    begin
      perform public.create_booking(v_slug, v_svc, null, v_slot, 'Другой', '+77012223344');
      step := 'повторная запись на занятое время запрещена'; ok := false; info := 'прошло'; return next;
    exception when others then
      step := 'повторная запись на занятое время запрещена'; ok := true; info := sqlerrm; return next;
    end;

    v_j := public.get_slots(v_slug, v_svc, null, v_day);
    step := 'занятое время пропало из слотов'; ok := jsonb_array_length(v_j) = 15; info := jsonb_array_length(v_j) || ' слотов'; return next;

    v_j := public.get_booking(v_tok);
    step := 'страница записи клиента'; ok := v_j->>'status' = 'booked' and (v_j->>'can_cancel')::boolean; info := v_j->>'service_name'; return next;

    begin
      select count(*) into v_n from public.bookings;
      step := 'аноним не читает таблицу записей'; ok := false; info := v_n::text; return next;
    exception when insufficient_privilege then
      step := 'аноним не читает таблицу записей'; ok := true; info := null; return next;
    end;

    -- 4. Telegram: клиент и владелец подключают бота
    perform set_config('role', 'service_role', true);
    v_j := public.tg_handle_start(111111, 'b_' || v_tok);
    step := 'клиент подключил напоминания'; ok := v_j->>'text' like '%Готово%' and v_j ? 'reply_markup'; info := null; return next;
    select tg_link_code into v_code from public.businesses where id = v_biz;
    v_j := public.tg_handle_start(222222, 'o_' || v_code);
    step := 'владелец подключил уведомления'; ok := v_j->>'text' like '%подключены%'; info := null; return next;
    v_j := public.tg_handle_callback(999999, 'c:' || v_tok);
    step := 'чужой чат не может подтвердить запись'; ok := v_j->>'answer' = 'Запись не найдена'; info := null; return next;
    v_j := public.tg_handle_callback(111111, 'c:' || v_tok);
    select status into v_txt from public.bookings where token = v_tok;
    step := 'клиент подтвердил визит кнопкой'; ok := v_txt = 'confirmed'; info := v_txt; return next;

    -- 4б. вопросы клиентов и ИИ-ассистент
    v_j := public.tg_route_text(111111, 'Сколько стоит стрижка?', 'Клиент Тест', null);
    select count(*) into v_n from public.notifications where business_id = v_biz and kind = 'owner_question';
    step := 'без ИИ вопрос клиента уходит владельцу'; ok := v_j->>'mode' = 'reply' and v_n = 1; info := v_j->>'text'; return next;
    v_j := public.tg_route_text(222222, 'Запомни: парковка бесплатная во дворе', 'Владелец', null);
    select knowledge into v_txt from public.business_ai where business_id = v_biz;
    step := 'владелец учит ассистента «Запомни: …»'; ok := v_txt like '%парковка бесплатная%'; info := v_txt; return next;
    v_j := public.tg_handle_callback(999999, 'r:111111');
    step := 'чужой чат не может ответить клиенту'; ok := v_j->>'answer' like '%другим%'; info := null; return next;
    perform public.tg_handle_callback(222222, 'r:111111');
    v_j := public.tg_route_text(222222, 'Стрижка 5000 ₸', 'Владелец', null);
    select count(*) into v_n from public.ai_messages where business_id = v_biz and chat_id = 111111 and role = 'owner';
    step := 'владелец ответил клиенту кнопкой «Ответить»'; ok := v_n = 1 and v_j->>'text' like '%Отправлено%'; info := null; return next;
    v_j := public.tg_route_text(111111, 'Спасибо', 'Клиент Тест', null);
    step := 'пока отвечает владелец, ассистент молчит'; ok := v_j->>'mode' = 'silent'; info := null; return next;
    perform public.tg_handle_callback(222222, 'a:111111');
    perform set_config('role', 'none', true);
    update public.business_ai set enabled = true where business_id = v_biz;
    select ai_api_key into v_key from private.secrets where id = 1;
    update private.secrets set ai_api_key = coalesce(v_key, 'sk-ant-selftest') where id = 1;
    perform set_config('role', 'service_role', true);
    v_j := public.tg_route_text(111111, 'Есть время в понедельник?', 'Клиент Тест', null);
    perform set_config('role', 'none', true);
    update private.secrets set ai_api_key = v_key where id = 1;
    perform set_config('role', 'service_role', true);
    step := 'с ИИ вопрос идёт ассистенту'; ok := v_j->>'mode' = 'ai'; info := v_j::text; return next;
    v_j := public.ai_context(v_biz, 111111);
    step := 'ассистент видит услуги, базу знаний и историю';
    ok := jsonb_array_length(v_j->'services') = 1 and v_j->'ai'->>'knowledge' like '%парковка%' and jsonb_array_length(v_j->'history') >= 4;
    info := jsonb_array_length(v_j->'history') || ' сообщений в истории'; return next;
    v_j := public.ai_book(v_biz, 111111, v_svc, to_char(v_day, 'YYYY-MM-DD') || ' 15:00', 'Клиент Тест', '+77011112233');
    select count(*) into v_n from public.bookings where token = v_j->>'token' and tg_chat_id = 111111 and status = 'booked';
    step := 'ассистент записал клиента'; ok := v_n = 1; info := v_j->>'when'; return next;
    begin
      perform public.ai_book(v_biz, 111111, v_svc, to_char(v_day, 'YYYY-MM-DD') || ' 15:30', 'Клиент Тест', '+77011112233');
      step := 'ассистент не записывает на занятое время'; ok := false; info := 'прошло'; return next;
    exception when others then
      step := 'ассистент не записывает на занятое время'; ok := true; info := sqlerrm; return next;
    end;
    step := 'тариф «Сеть» — 30 сотрудников'; ok := private.plan_staff_limit('network') = 30; info := null; return next;

    -- 5. напоминание за сутки
    perform set_config('role', 'none', true);
    insert into public.bookings (business_id, staff_id, service_id, starts_at, client_name, client_phone, source)
    values (v_biz, v_staff, v_svc, date_trunc('hour', now()) + interval '23 hours', 'Напоминаемый', '+77015556677', 'manual')
    returning token into v_tok2;
    update public.bookings set tg_chat_id = 333333, created_at = now() - interval '2 days' where token = v_tok2;
    perform private.run_reminders();
    select count(*) into v_n from public.notifications n join public.bookings k on k.id = n.booking_id
      where k.token = v_tok2 and n.kind = 'remind_24';
    step := 'напоминание за 24 ч поставлено в очередь'; ok := v_n = 1; info := null; return next;
    perform private.run_reminders();
    select count(*) into v_n from public.notifications n join public.bookings k on k.id = n.booking_id
      where k.token = v_tok2 and n.kind = 'remind_24';
    step := 'напоминание не дублируется'; ok := v_n = 1; info := null; return next;

    -- 6. отмена клиентом
    perform set_config('role', 'anon', true);
    perform public.cancel_booking(v_tok);
    perform set_config('role', 'none', true);
    select status || '/' || cancelled_by into v_txt from public.bookings where token = v_tok;
    select count(*) into v_n from public.notifications where business_id = v_biz and kind = 'owner_cancel';
    step := 'клиент отменил, владельцу ушло уведомление'; ok := v_txt = 'cancelled/client' and v_n = 1; info := v_txt; return next;

    -- 7. ручная запись владельцем и наложение
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    insert into public.bookings (business_id, staff_id, service_id, starts_at, client_name, client_phone)
    values (v_biz, v_staff, v_svc, v_slot, 'Ручной', '87019998877');
    begin
      insert into public.bookings (business_id, staff_id, service_id, starts_at, client_name, client_phone)
      values (v_biz, v_staff, v_svc, v_slot + interval '30 minutes', 'Наложение', '87019998800');
      step := 'наложение записей запрещено'; ok := false; info := 'прошло'; return next;
    exception when exclusion_violation then
      step := 'наложение записей запрещено'; ok := true; info := null; return next;
    end;
    v_j := public.owner_clients(null);
    step := 'база клиентов'; ok := jsonb_array_length(v_j) >= 3; info := jsonb_array_length(v_j) || ' клиентов'; return next;
    v_j := public.owner_stats(now() - interval '1 day', now() + interval '30 days');
    step := 'статистика'; ok := (v_j->>'total')::int >= 2; info := v_j::text; return next;

    -- 8. лимит тарифа «Старт»
    perform set_config('role', 'none', true);
    update public.businesses set plan = 'start' where id = v_biz;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.staff (business_id, name) values (v_biz, 'Второй мастер');
      step := 'лимит сотрудников на «Старт»'; ok := false; info := 'прошло'; return next;
    exception when others then
      step := 'лимит сотрудников на «Старт»'; ok := true; info := sqlerrm; return next;
    end;

    -- 9. оплата и продление
    v_j := public.request_payment('business', 3, 'Муса Ш.');
    v_pay := (v_j->>'id')::uuid;
    step := 'заявка на оплату'; ok := (v_j->>'amount')::int = 3 * (select price from public.plans where code = 'business'); info := v_j->>'amount'; return next;
    begin
      perform public.claim_admin('неверный-код');
      step := 'чужой код админа не подходит'; ok := false; info := 'прошло'; return next;
    exception when others then
      step := 'чужой код админа не подходит'; ok := true; info := sqlerrm; return next;
    end;
    perform set_config('role', 'none', true);
    insert into public.platform_admins (user_id) values (ua);
    select paid_until into v_until from public.businesses where id = v_biz;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    perform public.admin_process_payment(v_pay, true);
    v_j := public.admin_overview();
    perform set_config('role', 'none', true);
    select plan into v_txt from public.businesses where id = v_biz;
    step := 'админ подтвердил оплату → тариф и срок продлены';
    ok := v_txt = 'business' and (select paid_until from public.businesses where id = v_biz) > v_until + interval '85 days';
    info := v_txt || ', обзор: ' || v_j::text; return next;

    -- 10. подписка закончилась
    update public.businesses set paid_until = now() - interval '1 minute' where id = v_biz;
    perform set_config('role', 'anon', true);
    v_j := public.get_slots(v_slug, v_svc, null, v_day);
    step := 'после окончания подписки слотов нет'; ok := jsonb_array_length(v_j) = 0; info := null; return next;
    begin
      perform public.create_booking(v_slug, v_svc, null, v_slot + interval '2 hours', 'Поздний', '+77017770000');
      step := 'после окончания подписки запись закрыта'; ok := false; info := 'прошло'; return next;
    exception when others then
      step := 'после окончания подписки запись закрыта'; ok := true; info := sqlerrm; return next;
    end;
  exception when others then
    step := 'НЕОЖИДАННАЯ ОШИБКА'; ok := false; info := sqlerrm; return next;
  end;

  -- уборка
  perform set_config('role', 'none', true);
  update private.secrets set ai_api_key = null where ai_api_key = 'sk-ant-selftest';
  delete from public.notifications where business_id = v_biz;
  delete from public.businesses where owner_id in (u1, u2, ua);
  delete from auth.users where id in (u1, u2, ua);
end $$;
