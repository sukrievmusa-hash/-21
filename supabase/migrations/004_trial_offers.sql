-- =====================================================================
--  004: платный пробный период по тарифам (цена и срок задаются в админке)
--  trial_price + trial_days у тарифа: первая оплата этого тарифа проходит
--  по пробной цене на пробный срок, дальше — полная цена.
-- =====================================================================
alter table public.plans add column if not exists trial_price int check (trial_price between 0 and 10000000);
alter table public.plans add column if not exists trial_days  int check (trial_days between 1 and 90);
alter table public.payment_requests add column if not exists trial_days int;

-- Доступен ли бизнесу пробный период на тарифе (один раз на тариф)
create or replace function private.trial_available(p_business uuid, p_plan text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plans p
                 where p.code = p_plan and p.is_active and p.trial_price is not null and p.trial_days is not null)
     and not exists (select 1 from public.payment_requests r
                     where r.business_id = p_business and r.plan = p_plan and r.status in ('pending', 'approved'));
$$;

-- Коды тарифов, на которых текущему бизнесу доступен пробный период
create or replace function public.my_trial_offers() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.code order by p.sort), '{}')
  from public.plans p, public.businesses b
  where b.owner_id = auth.uid() and p.code <> 'trial' and private.trial_available(b.id, p.code);
$$;
revoke execute on function public.my_trial_offers() from public, anon;
grant execute on function public.my_trial_offers() to authenticated;

create or replace function public.request_payment(p_plan text, p_months int, p_note text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b public.businesses; p public.plans; v_amount int; v_id uuid; v_pending int; v_trial int;
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
  if p_months = 1 and private.trial_available(b.id, p.code) then
    v_amount := p.trial_price; v_trial := p.trial_days;
  else
    v_amount := p.price * (case p_months when 12 then 10 else p_months end);
  end if;
  insert into public.payment_requests (business_id, plan, months, amount, payer_note, trial_days)
  values (b.id, p.code, p_months, v_amount, left(trim(p_note), 200), v_trial)
  returning id into v_id;
  perform private.notify_admin('💰 Заявка на оплату' || E'\n<b>' || private.h(b.name) || '</b> (' || b.slug || ')'
    || E'\nТариф: ' || private.h(p.title) || ', '
    || case when v_trial is not null then 'ПРОБНЫЙ период ' || v_trial || ' дн.' else p_months || ' мес.' end
    || E'\nСумма: ' || private.money(v_amount)
    || E'\nОтправитель: ' || private.h(p_note)
    || E'\n\nПроверьте поступление в Kaspi и подтвердите заявку в админке.');
  return jsonb_build_object('id', v_id, 'amount', v_amount, 'trial_days', v_trial);
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
    set plan = r.plan,
        paid_until = greatest(paid_until, now())
                     + (case when r.trial_days is not null then make_interval(days => r.trial_days)
                             else make_interval(months => r.months) end)
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

update public.plans set trial_price = 20000, trial_days = 14 where code = 'network' and trial_price is null;
update public.plans set trial_price = 25000, trial_days = 14 where code = 'premium' and trial_price is null;
