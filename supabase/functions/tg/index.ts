// Kezek — Telegram-бот: webhook от Telegram + подключение бота из админки.
// Деплой: supabase functions deploy tg --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type TgResult = { ok: boolean; result?: any; description?: string };

async function tg(token: string, method: string, body: Record<string, unknown>): Promise<TgResult> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

async function getConfig(): Promise<{ token: string | null; secret: string }> {
  const { data, error } = await sb.rpc("tg_config");
  if (error) throw error;
  return data;
}

async function handleUpdate(token: string, update: any) {
  if (update.message?.chat?.id) {
    const chatId = update.message.chat.id;
    if (update.message.chat.type !== "private") return;
    const text = String(update.message.text ?? "").trim();
    const payload = text.startsWith("/start") ? (text.split(/\s+/)[1] ?? "") : "";
    const { data, error } = await sb.rpc("tg_handle_start", { p_chat_id: chatId, p_payload: payload });
    if (error) {
      console.error("tg_handle_start", error);
      return;
    }
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: data.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(data.reply_markup ? { reply_markup: data.reply_markup } : {}),
    });
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const { data, error } = await sb.rpc("tg_handle_callback", {
      p_chat_id: chatId ?? 0,
      p_data: String(cq.data ?? ""),
    });
    if (error) console.error("tg_handle_callback", error);
    await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: data?.answer ?? "" });
    if (cq.message && chatId && (data?.reply_markup || data?.remove_buttons)) {
      await tg(token, "editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: cq.message.message_id,
        reply_markup: data.reply_markup ?? { inline_keyboard: [] },
      });
    }
    if (data?.text && chatId) {
      await tg(token, "sendMessage", { chat_id: chatId, text: data.text, parse_mode: "HTML" });
    }
  }
}

async function requireAdmin(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: adm } = await sb.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return adm ? data.user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: true, service: "kezek-tg" });

  try {
    const cfg = await getConfig();

    // 1) Входящее обновление от Telegram
    const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (tgSecret !== null) {
      if (!cfg.token || tgSecret !== cfg.secret) return json({ ok: false }, 401);
      const update = await req.json();
      await handleUpdate(cfg.token, update);
      return json({ ok: true });
    }

    // 2) Действия администратора платформы
    const adminId = await requireAdmin(req);
    if (!adminId) return json({ error: "Нет доступа: войдите как администратор" }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.action === "setup") {
      const token = String(body.token ?? "").trim();
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
        return json({ error: "Неверный формат токена. Скопируйте его из @BotFather целиком." }, 400);
      }
      const me = await tg(token, "getMe", {});
      if (!me.ok) return json({ error: "Telegram не принял токен: " + (me.description ?? "") }, 400);
      const hook = await tg(token, "setWebhook", {
        url: `${SUPABASE_URL}/functions/v1/tg`,
        secret_token: cfg.secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      if (!hook.ok) return json({ error: "Не удалось подключить webhook: " + (hook.description ?? "") }, 400);
      await tg(token, "setMyDescription", {
        description: "Напоминания о записях: пришлю сообщение за день и за 2 часа до визита. Подтвердить или отменить запись можно одной кнопкой.",
      });
      await tg(token, "setMyShortDescription", { short_description: "Напоминания о ваших записях" });
      const { error } = await sb.rpc("tg_save_bot", { p_token: token, p_username: me.result.username });
      if (error) throw error;
      return json({ ok: true, username: me.result.username });
    }

    if (body.action === "status") {
      if (!cfg.token) return json({ ok: true, connected: false });
      const info = await tg(cfg.token, "getWebhookInfo", {});
      return json({
        ok: true,
        connected: true,
        url_ok: info.result?.url === `${SUPABASE_URL}/functions/v1/tg`,
        pending: info.result?.pending_update_count ?? 0,
        last_error: info.result?.last_error_message ?? null,
      });
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
