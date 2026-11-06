// Kezek — аккаунты без писем: регистрация сразу с подтверждённым email
// и сброс пароля владельцу из админки (без SMTP).
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

async function adminId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: adm } = await sb.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return adm ? data.user.id : null;
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

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
