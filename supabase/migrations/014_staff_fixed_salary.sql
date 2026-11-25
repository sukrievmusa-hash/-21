-- =====================================================================
--  014: фиксированная зарплата сотрудника (в месяц или за выход)
--  Итог к выплате = процент от выручки (share_pct) + фикс.
-- =====================================================================
alter table public.staff add column if not exists salary_fixed int not null default 0
  check (salary_fixed >= 0 and salary_fixed <= 100000000);
alter table public.staff add column if not exists salary_period text not null default 'month'
  check (salary_period in ('month', 'day'));
