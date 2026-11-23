// Kezek — аккаунты без писем: регистрация сразу с подтверждённым email,
// сброс пароля владельцу из админки (без SMTP) и логины/пароли сотрудников,
// которые выдаёт владелец бизнеса.
// Деплой: supabase functions deploy account --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

function tempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

async function userId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user.id;
}

async function adminId(req: Request): Promise<string | null> {
  const uid = await userId(req);
  if (!uid) return null;
  const { data: adm } = await sb.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle();
  return adm ? uid : null;
}

// Сотрудники входят по логину; в Supabase Auth это адрес вида login@staff.jazylam.kz
const STAFF_DOMAIN = "staff.jazylam.kz";
const staffEmail = (login: string) => `${login}@${STAFF_DOMAIN}`;

// Сотрудник, если его бизнес принадлежит тому, кто делает запрос
async function ownStaff(req: Request, staffId: string) {
  const uid = await userId(req);
  if (!uid || !staffId) return null;
  const { data: st } = await sb.from("staff").select("id, business_id, user_id, login, name").eq("id", staffId).maybeSingle();
  if (!st) return null;
  const { data: biz } = await sb.from("businesses").select("id").eq("id", st.business_id).eq("owner_id", uid).maybeSingle();
  return biz ? st : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: true, service: "kezek-account" });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "signup") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: "Проверьте email" }, 400);
      if (password.length < 6 || password.length > 72) return json({ error: "Пароль — от 6 до 72 символов" }, 400);
      if (email.endsWith("@" + STAFF_DOMAIN)) return json({ error: "Проверьте email" }, 400);
      const { data: allowed, error: ge } = await sb.rpc("signup_guard");
      if (ge) throw ge;
      if (!allowed) return json({ error: "Слишком много регистраций подряд. Попробуйте через 10 минут" }, 429);
      const { error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return json({ error: "Этот email уже зарегистрирован — войдите" }, 400);
        return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    if (body.action === "reset_password") {
      if (!(await adminId(req))) return json({ error: "Нет доступа" }, 403);
      const { data: biz, error: be } = await sb.from("businesses").select("owner_id").eq("id", String(body.business_id ?? "")).maybeSingle();
      if (be) throw be;
      if (!biz?.owner_id) return json({ error: "У бизнеса нет владельца" }, 400);
      const password = tempPassword();
      const { error } = await sb.auth.admin.updateUserById(biz.owner_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, password });
    }

    // Владелец выдаёт сотруднику логин (или меняет его) — в ответ новый пароль
    if (body.action === "staff_login_set") {
      const st = await ownStaff(req, String(body.staff_id ?? ""));
      if (!st) return json({ error: "Нет доступа" }, 403);
      const login = String(body.login ?? "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login)) {
        return json({ error: "Логин — от 3 до 40 символов: латинские буквы, цифры, точка, дефис" }, 400);
      }
      const { data: taken } = await sb.from("staff").select("id").eq("login", login).neq("id", st.id).maybeSingle();
      if (taken) return json({ error: "Этот логин уже занят — придумайте другой" }, 400);
      const password = tempPassword();
      if (st.user_id) {
        const { error } = await sb.auth.admin.updateUserById(st.user_id, { email: staffEmail(login), email_confirm: true, password });
        if (error) return json({ error: /already|exists|registered/i.test(error.message) ? "Этот логин уже занят — придумайте другой" : error.message }, 400);
        const { error: ue } = await sb.from("staff").update({ login }).eq("id", st.id);
        if (ue) throw ue;
      } else {
        const { data: u, error } = await sb.auth.admin.createUser({
          email: staffEmail(login), password, email_confirm: true, user_metadata: { staff: true },
        });
        if (error || !u?.user) {
          return json({ error: /already|exists|registered/i.test(error?.message ?? "") ? "Этот логин уже занят — придумайте другой" : (error?.message ?? "Ошибка") }, 400);
        }
        const { error: ue } = await sb.from("staff").update({ user_id: u.user.id, login }).eq("id", st.id);
        if (ue) {
          await sb.auth.admin.deleteUser(u.user.id);
          throw ue;
        }
      }
      return json({ ok: true, login, password });
    }

    // Новый пароль сотруднику (старый посмотреть нельзя — хранится только хеш)
    if (body.action === "staff_password_reset") {
      const st = await ownStaff(req, String(body.staff_id ?? ""));
      if (!st) return json({ error: "Нет доступа" }, 403);
      if (!st.user_id) return json({ error: "У сотрудника ещё нет входа" }, 400);
      const password = tempPassword();
      const { error } = await sb.auth.admin.updateUserById(st.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, login: st.login, password });
    }

    // Закрыть сотруднику доступ (уволился и т.п.)
    if (body.action === "staff_login_remove") {
      const st = await ownStaff(req, String(body.staff_id ?? ""));
      if (!st) return json({ error: "Нет доступа" }, 403);
      if (st.user_id) {
        const { error } = await sb.auth.admin.deleteUser(st.user_id);
        if (error && !/not found/i.test(error.message)) return json({ error: error.message }, 400);
      }
      const { error: ue } = await sb.from("staff").update({ user_id: null, login: null, tg_chat_id: null }).eq("id", st.id);
      if (ue) throw ue;
      return json({ ok: true });
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
