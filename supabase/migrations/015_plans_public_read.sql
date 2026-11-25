-- =====================================================================
--  015: гость (anon) не мог прочитать тарифы на главной странице:
--  правило plans_read обращалось к таблице businesses, к которой у anon нет доступа.
--  Делим правило: гостю — только публичные активные тарифы, вошедшему — как было.
-- =====================================================================
drop policy if exists plans_read on public.plans;
drop policy if exists plans_read_anon on public.plans;
create policy plans_read_anon on public.plans for select to anon
  using (is_public and is_active);
drop policy if exists plans_read_auth on public.plans;
create policy plans_read_auth on public.plans for select to authenticated
  using ((is_public and is_active) or public.is_admin()
         or exists (select 1 from public.businesses b where b.owner_id = auth.uid() and b.plan = plans.code));
