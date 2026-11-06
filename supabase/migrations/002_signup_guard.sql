-- Не больше 20 регистраций за 10 минут (защита от массовой регистрации ботами)
create or replace function public.signup_guard() returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from auth.users where created_at > now() - interval '10 minutes') < 20
$$;
revoke execute on function public.signup_guard() from public, anon, authenticated;
grant execute on function public.signup_guard() to service_role;
